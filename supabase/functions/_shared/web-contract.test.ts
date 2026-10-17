/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies and PostgREST rows are untyped here. */
// Browser code ↔ backend, with real code on both sides: the Web client modules (public order
// transport, resumable upload, WhatsApp repositories) run against the real handlers, the real
// stores and the real migrations. It exists so a renamed field or a changed status code fails
// here instead of in the customer's phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCatalog,
  startOrder,
  submitOrder,
  trackOrder,
  uploadPhoto,
  PublicOrderError,
} from '../../../apps/web/src/public-order/client';
import {
  deriveLines,
  startBody,
  type PhotoEntry,
} from '../../../apps/web/src/public-order/model';
import {
  SupabasePhotoJobNotificationRepository,
  SupabaseWhatsAppAdminRepository,
} from '../../../apps/web/src/whatsapp-admin';
import { ApiError } from './http';
import { IDS, asRole } from './pg-harness';
import { createPgServiceDb } from './pg-service-db';
import { createWorld, type World } from './pg-world';
import {
  handlePublicCatalog,
  handlePublicOrderStart,
  handlePublicOrderSubmit,
  handlePublicOrderTrack,
} from './public-order-handlers';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';
import { handleWhatsAppAdmin, handleWhatsAppSend } from './whatsapp-handlers';
import { worldEnv } from './pg-world';

let w: World;
let currentJwt = 'jwt-owner';
let actor: { role: 'authenticated'; userId: string } = {
  role: 'authenticated',
  userId: IDS.owner,
};

const USERS: Record<string, { id: string; role: string }> = {
  'jwt-owner': { id: IDS.owner, role: 'owner' },
  'jwt-staff': { id: IDS.staff, role: 'staff' },
};
const authenticator =
  (adminOnly: boolean) => async (request: Request, businessId: string) => {
    const user =
      USERS[
        (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
      ];
    if (!user)
      throw new ApiError('Autorización inválida.', 401, 'unauthorized');
    if (businessId !== IDS.business || (adminOnly && user.role === 'staff'))
      throw new ApiError('Se requiere rol owner o admin.', 403, 'forbidden');
    return { user: { id: user.id }, membership: { role: user.role } };
  };

// supabase-js stand-in used by the authenticated Web repositories.
vi.mock('../../../apps/web/src/cloud-config', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => createPgServiceDb(w.db, actor).from(table),
    functions: {
      async invoke(name: string, options: { body: unknown }) {
        const adminDeps = {
          authenticate: authenticator(name === 'whatsapp-admin'),
          services: () => ({ store: w.whatsapp, meta: w.metaClient }),
          getEnv: worldEnv,
          now: w.now,
          logger: w.logger,
        };
        const handler =
          name === 'whatsapp-admin' ? handleWhatsAppAdmin : handleWhatsAppSend;
        const response = await handler(
          new Request(`https://project.supabase.co/functions/v1/${name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentJwt}`,
            },
            body: JSON.stringify(options.body),
          }),
          adminDeps,
        );
        if (!response.ok) {
          const error = new Error(
            'Edge Function returned a non-2xx status code',
          );
          error.name = 'FunctionsHttpError';
          Object.assign(error, { context: response });
          return { data: null, error };
        }
        return { data: await response.json(), error: null };
      },
    },
  }),
}));

/** The browser's network: Edge Functions → real handlers; Drive's resumable PUT → emulated Google. */
function installNetwork() {
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    'public-photo-catalog': (r) => handlePublicCatalog(r, w.orderDeps),
    'public-photo-order-start': (r) => handlePublicOrderStart(r, w.orderDeps),
    'public-photo-order-submit': (r) => handlePublicOrderSubmit(r, w.orderDeps),
    'public-photo-order-track': (r) => handlePublicOrderTrack(r, w.orderDeps),
    'photo-upload-session': (r) => handleUploadSession(r, w.uploadDeps),
    'photo-upload-finalize': (r) => handleUploadFinalize(r, w.uploadDeps),
  };
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'www.googleapis.com') {
        // Final chunk of a resumable upload: the bytes are now in Drive.
        const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(
          String((init.headers as any)?.['Content-Range'] ?? ''),
        );
        if (range && Number(range[2]) + 1 === Number(range[3])) {
          const pending = w.google.files.filter(
            (f) =>
              f.mimeType !== 'application/vnd.google-apps.folder' &&
              f.name !== 'PEDIDO.txt' &&
              !(f as any).text,
          );
          (pending.at(-1) as any).text = 'x'.repeat(Number(range[3]));
          return new Response('{}', { status: 200 });
        }
        return new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${range?.[2] ?? 0}` },
        });
      }
      const name = url.pathname.split('/functions/v1/')[1]!;
      calls.push(name);
      return routes[name]!(new Request(url, init));
    }),
  );
  return calls;
}

const photo = (name: string, bytes = 20) =>
  new File(['x'.repeat(bytes)], name, { type: 'image/jpeg' });

beforeEach(async () => {
  w = await createWorld();
  currentJwt = 'jwt-owner';
  actor = { role: 'authenticated', userId: IDS.owner };
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('cliente web del pedido público ↔ funciones reales', () => {
  it('catálogo → pedido → subida real por chunks → confirmación → seguimiento', async () => {
    const calls = installNetwork();
    const catalog = await fetchCatalog();
    expect(catalog.services.map((x) => x.name)).toEqual([
      '10x15',
      '13x18',
      '20x30',
    ]);

    const entries: PhotoEntry[] = [
      {
        id: 'a',
        serviceId: IDS.svc10x15,
        file: photo('IMG_001.jpg'),
        copies: 2,
      },
      {
        id: 'b',
        serviceId: IDS.svc10x15,
        file: photo('IMG_002.jpg', 5),
        copies: 1,
      },
      {
        id: 'c',
        serviceId: IDS.svc20x30,
        file: photo('IMG_003.jpg'),
        copies: 1,
      },
    ];
    const lines = deriveLines(
      catalog.services,
      [IDS.svc10x15, IDS.svc20x30],
      entries,
    );
    const started = await startOrder(
      startBody(
        'client-key-aaaaaaaaaaaa',
        {
          name: 'María García',
          phone: '342 555 1234',
          email: '',
          notes: '',
          whatsappOptIn: true,
        },
        lines,
      ),
    );
    expect(started.totalCents).toBe(3 * 50000 + 250000);
    const destinations = new Map(
      started.destinations.map((x) => [x.serviceId, x.destinationId]),
    );
    for (const entry of entries)
      await uploadPhoto(
        started.uploadToken,
        {
          id: entry.id,
          file: entry.file,
          copies: entry.copies,
          destinationId: destinations.get(entry.serviceId)!,
        },
        () => undefined,
      );
    const done = await submitOrder(started.uploadToken);
    expect(done).toMatchObject({
      orderCode: started.orderCode,
      status: 'received',
      totalCents: 400000,
    });
    const tracked = await trackOrder(done.trackingToken);
    expect(tracked).toMatchObject({
      orderCode: started.orderCode,
      status: 'received',
      totalCents: 400000,
      businessName: 'CentroColor',
    });
    expect(tracked.items).toHaveLength(2);
    expect(calls).toContain('photo-upload-finalize');
    expect(
      (
        await w.db.query<any>(`select status from public.photo_job_files`)
      ).rows.map((x) => x.status),
    ).toEqual(['uploaded', 'uploaded', 'uploaded']);
  });

  it('los errores del servidor llegan con su código y un mensaje legible', async () => {
    installNetwork();
    const lines = deriveLines(
      (await fetchCatalog()).services,
      [IDS.svc10x15],
      [{ id: 'a', serviceId: IDS.svc10x15, file: photo('a.jpg'), copies: 1 }],
    );
    const body = {
      ...startBody(
        'client-key-aaaaaaaaaaaa',
        {
          name: 'Ana',
          phone: '342 555 1234',
          email: '',
          notes: '',
          whatsappOptIn: true,
        },
        lines,
      ),
      expectedTotalCents: 1,
    };
    await expect(startOrder(body)).rejects.toMatchObject({
      code: 'price_changed',
      message: expect.stringMatching(/precios cambiaron/),
    });
    await expect(
      startOrder({
        ...body,
        expectedTotalCents: undefined,
        customer: { name: 'Ana', phone: '12' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(trackOrder('x'.repeat(43))).rejects.toBeInstanceOf(
      PublicOrderError,
    );
  });
});

describe('repositorios Web de WhatsApp ↔ funciones reales', () => {
  async function readyJob() {
    const { orderFlow } = await import('./pg-order-flow');
    const flow = orderFlow(() => w);
    const order = await flow.placeOrder();
    return order.jobId;
  }

  it('configura sin devolver el token, prueba la conexión y desconecta', async () => {
    const repository = new SupabaseWhatsAppAdminRepository();
    expect((await repository.getIntegration(IDS.business)).status).toBe(
      'not_configured',
    );
    const view = await repository.configure(IDS.business, {
      phoneNumberId: '109876543210',
      wabaId: '208765432101',
      templateName: 'pedido_listo',
      templateLanguage: 'es_AR',
      accessToken: 'EAAJ-web-contract-token-0123456789',
    });
    expect(view).toMatchObject({
      status: 'configured',
      templateName: 'pedido_listo',
      templateLanguage: 'es_AR',
    });
    expect(JSON.stringify(view)).not.toContain('EAAJ-web');
    w.meta.reply({
      display_phone_number: '+54 9 342 555 1234',
      verified_name: 'CentroColor',
    });
    w.meta.reply({
      data: [{ name: 'pedido_listo', status: 'APPROVED', language: 'es_AR' }],
    });
    const tested = await repository.test(IDS.business);
    expect(tested).toMatchObject({
      ok: true,
      displayPhoneNumber: '+54 9 342 555 1234',
    });
    expect((await repository.disconnect(IDS.business)).status).toBe(
      'disconnected',
    );
  });

  it('staff recibe un error legible al intentar configurar', async () => {
    currentJwt = 'jwt-staff';
    await expect(
      new SupabaseWhatsAppAdminRepository().configure(IDS.business, {
        phoneNumberId: '1234567',
        wabaId: '',
        templateName: 'x',
        templateLanguage: 'es',
        accessToken: 'EAAJ-web-contract-token-0123456789',
      }),
    ).rejects.toThrow(
      /No se pudo guardar la configuración de WhatsApp: Se requiere rol owner o admin/,
    );
  });

  it('el estado del trabajo muestra consentimiento y avisos; reintento y reenvío funcionan para staff', async () => {
    const admin = new SupabaseWhatsAppAdminRepository();
    const jobId = await readyJob();
    const notifications = new SupabasePhotoJobNotificationRepository();
    currentJwt = 'jwt-staff';
    actor = { role: 'authenticated', userId: IDS.staff };

    // Sin integración: el aviso queda failed y se puede reintentar tras configurar.
    await asRole(w.db, 'authenticated', IDS.staff, () =>
      w.db.query(`update public.photo_jobs set status='ready' where id=$1`, [
        jobId,
      ]),
    );
    let status = await notifications.getStatus(IDS.business, jobId);
    expect(status.consent).toMatchObject({ phone: '+5493425551234' });
    expect(status.notifications).toHaveLength(1);
    expect(status.notifications[0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'integration_not_configured',
      triggerKind: 'auto',
    });

    currentJwt = 'jwt-owner';
    await admin.configure(IDS.business, {
      phoneNumberId: '109876543210',
      wabaId: '',
      templateName: 'pedido_listo',
      templateLanguage: 'es_AR',
      accessToken: 'EAAJ-web-contract-token-0123456789',
    });
    currentJwt = 'jwt-staff';
    const retried = await notifications.retry(
      IDS.business,
      status.notifications[0]!.id,
    );
    expect(retried).toMatchObject({ status: 'sent', attemptCount: 1 });
    const resent = await notifications.resend(IDS.business, jobId);
    expect(resent).toMatchObject({
      status: 'sent',
      triggerKind: 'manual_resend',
    });
    status = await notifications.getStatus(IDS.business, jobId);
    expect(status.notifications.map((x) => x.triggerKind)).toEqual([
      'auto',
      'manual_resend',
    ]);
    expect(
      w.meta.calls.filter((x) => x.url.endsWith('/messages')),
    ).toHaveLength(2);
  });

  it('sin consentimiento no hay datos de WhatsApp y wake nunca lanza', async () => {
    const { orderFlow } = await import('./pg-order-flow');
    const order = await orderFlow(() => w).placeOrder({ whatsappOptIn: false });
    actor = { role: 'authenticated', userId: IDS.staff };
    currentJwt = 'jwt-staff';
    const notifications = new SupabasePhotoJobNotificationRepository();
    expect(
      (await notifications.getStatus(IDS.business, order.jobId)).consent,
    ).toBeNull();
    await expect(
      notifications.wake(IDS.business, order.jobId),
    ).resolves.toBeUndefined();
    currentJwt = 'jwt-nope';
    await expect(
      notifications.wake(IDS.business, order.jobId),
    ).resolves.toBeUndefined();
  });
});

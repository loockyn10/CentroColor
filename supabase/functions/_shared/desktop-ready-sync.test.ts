/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows are untyped in tests. */
// Desktop offline → Cloud → WhatsApp. A job marked "ready" on a device with no Internet is a
// local change; when it syncs, the REAL Desktop push adapter updates the Cloud row and the
// Cloud (not the device) queues exactly one notice. Desktop never talks to Meta.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  syncPhotoEntities,
  type PendingPhotoChange,
  type PhotoSyncCursor,
  type PhotoSyncEntity,
  type PhotoSyncLocalPort,
  type PhotoSyncType,
} from '../../../packages/application/src';
import { IDS } from './pg-harness';
import { createPgServiceDb } from './pg-service-db';
import { configureWhatsApp, notifications } from './pg-order-fixtures';
import { orderFlow } from './pg-order-flow';
import { createWorld, worldEnv, type World } from './pg-world';
import { jsonRequest } from './test-support';
import { handleWhatsAppDispatch } from './whatsapp-handlers';
import { CloudPhotoSyncAdapter } from '../../../apps/desktop/src/cloud-photo-sync-adapter';

let w: World;

// The Desktop signs in as an ordinary member: RLS, grants and triggers apply as in production.
vi.mock('../../../apps/desktop/src/cloud-config', () => ({
  getSupabaseClient: () =>
    createPgServiceDb(w.db, { role: 'authenticated', userId: IDS.staff }),
}));

/** The device's side of the sync: an in-memory stand-in for SQLite. */
function createDevice() {
  const pending: PendingPhotoChange[] = [];
  const applied: PhotoSyncEntity[] = [];
  const cursors = new Map<string, PhotoSyncCursor>();
  const local: PhotoSyncLocalPort = {
    pending: async (type) => pending.filter((x) => x.entityType === type),
    pendingFor: async (type, _b, id) =>
      pending.find((x) => x.entityType === type && x.entity.id === id) ?? null,
    acknowledge: async (change) => {
      pending.splice(pending.indexOf(change), 1);
    },
    fail: async () => undefined,
    conflict: async () => undefined,
    applyRemote: async (_type, entity) => {
      applied.push(entity);
      return true;
    },
    cursor: async (type) => cursors.get(type) ?? null,
    advanceCursor: async (type, _b, cursor) => {
      cursors.set(type, cursor);
    },
  };
  return { local, pending, applied };
}

const sync = (device: ReturnType<typeof createDevice>, type: PhotoSyncType) =>
  syncPhotoEntities(
    type,
    IDS.business,
    device.local,
    new CloudPhotoSyncAdapter(),
  );

const dispatch = () =>
  handleWhatsAppDispatch(
    jsonRequest(
      {},
      { 'x-dispatch-secret': 'dispatch-secret-0123456789abcdef' },
    ),
    {
      services: () => ({ store: w.whatsapp, meta: w.metaClient }),
      getEnv: worldEnv,
      now: w.now,
      logger: w.logger,
    },
  );

beforeEach(async () => {
  w = await createWorld();
});

describe('Desktop offline marca "listo" → sync → un solo aviso desde la nube', () => {
  it('un borrador de pedido web nunca llega a Desktop; el pedido confirmado sí, con su origen', async () => {
    const flow = orderFlow(() => w);
    const device = createDevice();
    const started = await flow.start();
    expect(started.status).toBe(200);
    expect(await sync(device, 'photo_job')).toMatchObject({ pulled: 0 });
    expect(await sync(device, 'photo_job_item')).toMatchObject({ pulled: 0 });

    await flow.placeOrder({
      clientKey: 'client-key-bbbbbbbbbbbb',
      customer: { name: 'Ana', phone: '351 555 1111' },
    });
    expect(await sync(device, 'photo_job')).toMatchObject({ pulled: 1 });
    expect(await sync(device, 'photo_job_item')).toMatchObject({ pulled: 2 });
    expect(device.applied.find((x: any) => x.sourceChannel)).toMatchObject({
      sourceChannel: 'public_web',
      status: 'received',
      fileIntakeStatus: 'submitted',
    });
  });

  it('el cambio offline se empuja con el adaptador real y la nube encola exactamente un aviso', async () => {
    await configureWhatsApp(w.db);
    const flow = orderFlow(() => w);
    const { jobId } = await flow.placeOrder();
    const device = createDevice();
    await sync(device, 'photo_job');
    const pulled = device.applied.find((x: any) => x.id === jobId) as any;
    expect(pulled).toBeDefined();

    // Sin Internet: el empleado marca el trabajo como listo en Desktop.
    device.pending.push({
      outboxId: 'outbox-1',
      entityType: 'photo_job',
      entity: { ...pulled, status: 'ready' },
      localRevision: 2,
      cloudUpdatedAt: pulled.updatedAt,
    });
    expect(await notifications(w.db, jobId)).toEqual([]);

    // Vuelve la conexión: el ciclo de sincronización empuja el cambio.
    expect(await sync(device, 'photo_job')).toMatchObject({
      pushed: 1,
      conflicts: 0,
    });
    expect(
      (
        await w.db.query<any>(
          `select status from public.photo_jobs where id=$1`,
          [jobId],
        )
      ).rows[0].status,
    ).toBe('ready');
    const queued = await notifications(w.db, jobId);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      status: 'pending',
      trigger_kind: 'auto',
      idempotency_key: `photo_job:${jobId}:ready:whatsapp`,
    });

    // La nube (no el equipo) manda el mensaje.
    expect(await (await dispatch()).json()).toMatchObject({ sent: 1 });
    expect(w.meta.calls).toHaveLength(1);
    expect(w.meta.calls[0]!.url).toContain('graph.facebook.com');
  });

  it('empujar de nuevo el mismo estado, o volver a "listo" más tarde, no genera otro aviso', async () => {
    await configureWhatsApp(w.db);
    const flow = orderFlow(() => w);
    const { jobId } = await flow.placeOrder();
    const device = createDevice();
    await sync(device, 'photo_job');
    const pulled = device.applied.find((x: any) => x.id === jobId) as any;
    device.pending.push({
      outboxId: 'o1',
      entityType: 'photo_job',
      entity: { ...pulled, status: 'ready' },
      localRevision: 2,
      cloudUpdatedAt: pulled.updatedAt,
    });
    await sync(device, 'photo_job');
    await dispatch();

    // El equipo (u otro) lo devuelve a "en proceso" y otra vez a "listo" desde la nube.
    await w.db.query(
      `update public.photo_jobs set status='in_progress' where id=$1`,
      [jobId],
    );
    await sync(device, 'photo_job'); // pull de la versión nueva
    const latest = device.applied.at(-1) as any;
    device.pending.push({
      outboxId: 'o2',
      entityType: 'photo_job',
      entity: { ...latest, status: 'ready' },
      localRevision: 3,
      cloudUpdatedAt: latest.updatedAt,
    });
    await sync(device, 'photo_job');
    await dispatch();

    expect(
      (
        await w.db.query<any>(
          `select status from public.photo_jobs where id=$1`,
          [jobId],
        )
      ).rows[0].status,
    ).toBe('ready');
    expect(await notifications(w.db, jobId)).toHaveLength(1);
    expect(w.meta.calls).toHaveLength(1);
  });

  it('la sincronización no puede alterar el origen ni sacar el pedido de Producción', async () => {
    const flow = orderFlow(() => w);
    const { jobId } = await flow.placeOrder();
    const device = createDevice();
    await sync(device, 'photo_job');
    const pulled = device.applied.find((x: any) => x.id === jobId) as any;
    // Un Desktop con datos viejos / alterados intenta reabrir el ingreso y cambiar el canal.
    device.pending.push({
      outboxId: 'o1',
      entityType: 'photo_job',
      entity: {
        ...pulled,
        status: 'in_progress',
        fileIntakeStatus: 'awaiting_files',
        sourceChannel: 'manual',
      },
      localRevision: 2,
      cloudUpdatedAt: pulled.updatedAt,
    });
    await sync(device, 'photo_job');
    const job = (
      await w.db.query<any>(
        `select status, file_intake_status, source_channel, is_draft from public.photo_jobs where id=$1`,
        [jobId],
      )
    ).rows[0];
    expect(job).toEqual({
      status: 'in_progress',
      file_intake_status: 'submitted',
      source_channel: 'public_web',
      is_draft: false,
    });
  });

  it('un pedido sin consentimiento sincronizado como listo no genera aviso', async () => {
    await configureWhatsApp(w.db);
    const { jobId } = await orderFlow(() => w).placeOrder({
      whatsappOptIn: false,
    });
    const device = createDevice();
    await sync(device, 'photo_job');
    const pulled = device.applied.find((x: any) => x.id === jobId) as any;
    device.pending.push({
      outboxId: 'o1',
      entityType: 'photo_job',
      entity: { ...pulled, status: 'ready' },
      localRevision: 2,
      cloudUpdatedAt: pulled.updatedAt,
    });
    await sync(device, 'photo_job');
    expect(await notifications(w.db, jobId)).toEqual([]);
    expect(w.meta.calls).toHaveLength(0);
  });
});

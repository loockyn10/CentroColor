// Public self-service order (/imprimir) and tracking (/pedido/:token).
//
// Every endpoint is anonymous. Authorization is a capability token (SHA-256 → one link →
// one Business → one PhotoJob) and every price is recomputed here from photo_services:
// nothing the browser says about money is trusted.
import { intakeConfig, publicOrderSettings, type GetEnv } from './config.ts';
import type { Logger } from './diagnostics.ts';
import type { DriveGateway } from './google-drive.ts';
import { ApiError, body, json } from './http.ts';
import { normalizeWhatsAppNumber } from './phone.ts';
import {
  orderRuleToApiError,
  parseStartPayload,
  priceOrder,
  type PublicOrderStartPayload,
  type PublicOrderTokenPayload,
} from './public-order-plan.ts';
import { OrderRuleError, type PublicOrderStore } from './public-order-store.ts';
import type { PhotoIntakeStore } from './store.ts';
import {
  destinationId,
  randomToken,
  sha256,
  validateTrackingToken,
  validateUploadToken,
} from './token.ts';
import { buildManifest, run } from './upload-handlers.ts';
import { sha256Hex } from './upload-policy.ts';

export type PublicOrderDeps = {
  intake: PhotoIntakeStore;
  orders: PublicOrderStore;
  drive: DriveGateway;
  getEnv: GetEnv;
  now?: () => number;
  logger?: Logger;
};

export const RATE_LIMITS = {
  perHourGlobal: 300,
  perHourPerClient: 20,
  perHourPerPhone: 8,
} as const;
const HOUR_MS = 3_600_000;
const UNAVAILABLE = 'Los pedidos online no están disponibles por el momento.';

const orderCode = (jobId: string) => `CC-${jobId.slice(0, 8).toUpperCase()}`;

async function openBusiness(deps: PublicOrderDeps) {
  const settings = publicOrderSettings(deps.getEnv);
  const business = await deps.orders.resolveBusiness(settings.businessSlug);
  if (!business) throw new ApiError(UNAVAILABLE, 503, 'orders_unavailable');
  const drive = await deps.intake.getIntegration(business.id);
  return { business, settings, available: drive?.status === 'connected' };
}

function clientAddress(request: Request) {
  const direct = request.headers.get('cf-connecting-ip')?.trim();
  if (direct) return direct;
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

async function guardRule<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof OrderRuleError) throw orderRuleToApiError(cause.code);
    throw cause;
  }
}

/** The price list. Anonymous and read-only; it comes from the administrative catalog. */
export function handlePublicCatalog(request: Request, deps: PublicOrderDeps) {
  return run(request, deps, 'public_photo_catalog', async () => {
    const { business, available } = await openBusiness(deps);
    const services = available
      ? await deps.orders.listPublicServices(business.id)
      : [];
    return json({
      businessName: business.name,
      available,
      services: services.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        widthMm: x.width_mm,
        heightMm: x.height_mm,
        unitPriceCents: x.unit_price_cents,
      })),
    });
  });
}

/**
 * Creates (or refreshes) the draft order: Customer + PhotoJob + items in one database
 * transaction, plus the upload capability. Replaying the same `clientKey` never duplicates.
 */
export function handlePublicOrderStart(
  request: Request,
  deps: PublicOrderDeps,
) {
  return run(
    request,
    deps,
    'public_photo_order_start',
    async (requestId, logger) => {
      const input = parseStartPayload(
        await body<Partial<PublicOrderStartPayload>>(request),
      );
      const now = (deps.now ?? Date.now)();
      const { business, available } = await openBusiness(deps);
      if (!available)
        throw new ApiError(UNAVAILABLE, 503, 'orders_unavailable');
      const phone = normalizeWhatsAppNumber(input.phone);
      if (!phone)
        throw new ApiError(
          'Revisá el número de WhatsApp.',
          422,
          'invalid_phone',
        );
      const settings = intakeConfig(deps.getEnv);

      const address = clientAddress(request);
      const ipHash = address
        ? (
            await sha256Hex(`${settings.signingSecret}:client:${address}`)
          ).slice(0, 32)
        : 'unknown';
      const since = new Date(now - HOUR_MS).toISOString();
      const tooMany = new ApiError(
        'Hay demasiados pedidos en poco tiempo. Probá de nuevo en un rato.',
        429,
        'rate_limited',
      );
      if (
        (await deps.orders.countOrdersSince(business.id, since)) >=
        RATE_LIMITS.perHourGlobal
      )
        throw tooMany;
      if (
        address &&
        (await deps.orders.countOrdersSince(business.id, since, { ipHash })) >=
          RATE_LIMITS.perHourPerClient
      )
        throw tooMany;
      if (
        (await deps.orders.countOrdersSince(business.id, since, {
          phoneE164: phone.e164,
        })) >= RATE_LIMITS.perHourPerPhone
      )
        throw tooMany;

      // The browser's prices are ignored: the catalog row decides.
      const catalog = await deps.orders.getPublicServices(
        business.id,
        input.items.map((x) => x.serviceId),
      );
      const { lines, totalCents } = priceOrder(catalog, input.items);
      if (
        input.expectedTotalCents !== null &&
        input.expectedTotalCents !== totalCents
      )
        throw orderRuleToApiError('price_changed');

      const token = randomToken(32);
      const tokenHash = await sha256(token);
      const started = await guardRule(() =>
        deps.orders.startOrder({
          business_id: business.id,
          client_key: input.clientKey,
          customer_name: input.name,
          phone_e164: phone.e164,
          phone_display: phone.display,
          email: input.email,
          notes: input.notes,
          whatsapp_opt_in: input.whatsappOptIn,
          ip_hash: ipHash,
          items: lines.map((line) => ({
            service_id: line.serviceId,
            quantity: line.quantity,
            expected_unit_price_cents: line.unitPriceCents,
          })),
          token_hash: tokenHash,
          link_expires_at: new Date(
            now + settings.linkDays * 86_400_000,
          ).toISOString(),
        }),
      );
      if (started.status === 'submitted')
        throw new ApiError(
          'Este pedido ya fue enviado.',
          409,
          'order_already_submitted',
        );
      const destinations = [];
      for (const item of started.items)
        destinations.push({
          serviceId: item.service_id,
          destinationId: await destinationId(
            settings.signingSecret,
            started.link_id,
            item.item_id,
          ),
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
          totalCents: item.total_cents,
        });
      logger('info', 'public_photo_order_started', {
        requestId,
        photoJobId: started.job_id,
        items: started.items.length,
        totalCents: started.total_cents,
      });
      return json({
        orderCode: orderCode(started.job_id),
        uploadToken: token,
        customerFirstName: input.name.split(' ')[0],
        totalCents: started.total_cents,
        destinations,
        expiresAt: new Date(now + settings.linkDays * 86_400_000).toISOString(),
      });
    },
  );
}

/**
 * Confirms the order after every file is in Drive. Idempotent: confirming twice returns the
 * same order and a fresh read-only tracking token; it never duplicates a job or an item.
 */
export function handlePublicOrderSubmit(
  request: Request,
  deps: PublicOrderDeps,
) {
  return run(
    request,
    deps,
    'public_photo_order_submit',
    async (requestId, logger) => {
      const { token } = await body<Partial<PublicOrderTokenPayload>>(request);
      const now = (deps.now ?? Date.now)();
      const { link } = await validateUploadToken(deps.intake, token, {
        allowSubmitted: true,
        now,
      });
      const order = await deps.orders.getOrderByJob(
        link.business_id,
        link.photo_job_id,
      );
      if (!order) throw new ApiError('Link inválido.', 404, 'link_invalid');
      const { trackingDays } = publicOrderSettings(deps.getEnv);

      if (order.status !== 'submitted') {
        if (
          (await deps.intake.countFiles(link.business_id, link.photo_job_id, [
            'pending',
            'uploading',
          ])) > 0
        )
          throw orderRuleToApiError('uploads_pending');
        const files = await deps.intake.listFiles(
          link.business_id,
          link.photo_job_id,
          'uploaded',
        );
        if (!files.length) throw orderRuleToApiError('no_files');
        // PEDIDO.txt first (Drive), database last: a failure in between is retried safely.
        const folders = await deps.drive.ensureFolders(
          link.business_id,
          link.photo_job_id,
        );
        const copies = new Map<string, number>();
        for (const file of files)
          if (file.photo_job_item_id)
            copies.set(
              file.photo_job_item_id,
              (copies.get(file.photo_job_item_id) ?? 0) + file.copies,
            );
        const reconciled = {
          ...folders.job,
          items: folders.job.items.map((item) => ({
            ...item,
            quantity: copies.get(item.id) ?? item.quantity,
          })),
        };
        const { text } = buildManifest(reconciled, files);
        await deps.drive.putManifest(
          folders.token,
          folders.root,
          folders.job.id,
          `Pedido web (autoservicio)\r\n${text}`,
        );
      }

      const trackingToken = randomToken(32);
      const trackingHash = await sha256(trackingToken);
      const confirmed = await guardRule(() =>
        deps.orders.confirmOrder({
          business_id: link.business_id,
          job_id: link.photo_job_id,
          upload_link_id: link.id,
          tracking_token_hash: trackingHash,
          tracking_expires_at: new Date(
            now + trackingDays * 86_400_000,
          ).toISOString(),
        }),
      );
      logger('info', 'public_photo_order_submitted', {
        requestId,
        photoJobId: link.photo_job_id,
        alreadySubmitted: confirmed.already_submitted,
        totalCents: confirmed.total_cents,
      });
      return json({
        orderCode: orderCode(link.photo_job_id),
        status: 'received',
        alreadySubmitted: confirmed.already_submitted,
        items: confirmed.items.map((x) => ({
          name: x.name,
          quantity: x.quantity,
          totalCents: x.total_cents,
        })),
        totalCents: confirmed.total_cents,
        trackingToken,
      });
    },
  );
}

/**
 * Read-only status for a tracking link. Returns the order code, date, summary, total and
 * state — never ids, notes, costs, Drive data, other customers or the phone number.
 */
export function handlePublicOrderTrack(
  request: Request,
  deps: PublicOrderDeps,
) {
  return run(request, deps, 'public_photo_order_track', async () => {
    const { token } = await body<Partial<PublicOrderTokenPayload>>(request);
    const { link } = await validateTrackingToken(deps.intake, token, {
      now: (deps.now ?? Date.now)(),
    });
    const order = await deps.orders.getOrderByJob(
      link.business_id,
      link.photo_job_id,
    );
    if (!order || order.status !== 'submitted')
      throw new ApiError('Link inválido.', 404, 'link_invalid');
    const tracking = await deps.orders.getTracking(
      link.business_id,
      link.photo_job_id,
    );
    if (!tracking) throw new ApiError('Link inválido.', 404, 'link_invalid');
    return json({
      businessName: await deps.orders.getBusinessName(link.business_id),
      orderCode: orderCode(link.photo_job_id),
      createdAt: order.submitted_at ?? tracking.job_created_at,
      status: tracking.job_status,
      items: tracking.items.map((x) => ({
        name: x.name,
        quantity: x.quantity,
        totalCents: x.total_cents,
      })),
      totalCents: tracking.items.reduce((sum, x) => sum + x.total_cents, 0),
    });
  });
}

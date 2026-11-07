// Professional portal WITHOUT an account (/profesionales for any visitor).
//
// Everything here is anonymous and deliberately blind to money:
//   * the catalog lists sizes and papers, never a price, tier, list or agreement;
//   * starting a request never prices anything (there is no `expectedTotal`, no `price_changed`,
//     nothing to compare against), so no answer of this module can be used to probe a price;
//   * the request is stored as a PhotoJob `pending_quote` and CentroColor quotes it afterwards,
//     from the panel, with an owner/admin (`quote_photo_job`).
// Authorization is the same capability token as /imprimir (token → link → one PhotoJob); uploading
// photos reuses the `photo-upload-*` functions, whose limits for these orders are tighter than a
// professional account's (see PROFESSIONAL_REQUEST_* in upload-policy.ts).
import { intakeConfig } from './config.ts';
import { ApiError, body, json } from './http.ts';
import { normalizeWhatsAppNumber } from './phone.ts';
import {
  clientAddress,
  confirmUploadedOrder,
  DAY_MS,
  guardRule,
  HOUR_MS,
  openBusiness,
  orderCode,
  RATE_LIMITS,
  requestItemName,
  UNAVAILABLE,
  type PublicOrderDeps,
} from './public-order-handlers.ts';
import {
  parseRequestStartPayload,
  parseSubmitPayload,
  REQUEST_ORDER_LIMITS,
  type ProfessionalRequestStartPayload,
  type PublicOrderSubmitPayload,
} from './public-order-plan.ts';
import {
  isAnonymousProfessionalRequest,
  type RequestServiceRow,
} from './public-order-store.ts';
import {
  destinationId,
  randomToken,
  sha256,
  validateUploadToken,
} from './token.ts';
import { run } from './upload-handlers.ts';
import { sha256Hex } from './upload-policy.ts';

/** One catalog row for a visitor. There is no money field to forget: the type has none. */
const requestServiceBody = (x: RequestServiceRow) => ({
  id: x.id,
  name: x.name,
  photoServiceId: x.photo_service_id,
  variantId: x.variant_id,
  paper: x.paper,
  paperLabel: x.paper === 'matte' ? 'Mate' : 'Brillo',
  sizeName: x.name.replace(/ · (Mate|Brillo)$/, ''),
  description: x.description,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
});

/** Sizes and papers a professional may ask for. Anonymous, read-only, price-free. */
export function handleProfessionalPublicCatalog(
  request: Request,
  deps: PublicOrderDeps,
) {
  return run(request, deps, 'professional_public_catalog', async () => {
    const { business, available } = await openBusiness(deps);
    const services = available
      ? await deps.orders.listRequestServices(business.id)
      : [];
    return json({
      businessName: business.name,
      available,
      services: services.map(requestServiceBody),
    });
  });
}

/**
 * Creates (or refreshes) the draft request: Customer + PhotoJob (`pending_quote`) + items in one
 * transaction, plus the upload capability. Replaying the same `clientKey` never duplicates.
 */
export function handleProfessionalRequestStart(
  request: Request,
  deps: PublicOrderDeps,
) {
  return run(
    request,
    deps,
    'professional_request_start',
    async (requestId, logger) => {
      const input = parseRequestStartPayload(
        await body<Partial<ProfessionalRequestStartPayload>>(request),
      );
      const now = (deps.now ?? Date.now)();
      const { business, available } = await openBusiness(deps);
      if (!available)
        throw new ApiError(UNAVAILABLE, 503, 'orders_unavailable');
      const phone = normalizeWhatsAppNumber(input.phone);
      if (!phone)
        throw new ApiError('Revisá el teléfono.', 422, 'invalid_phone');
      const settings = intakeConfig(deps.getEnv);

      const address = clientAddress(request);
      const ipHash = address
        ? (
            await sha256Hex(`${settings.signingSecret}:client:${address}`)
          ).slice(0, 32)
        : 'unknown';
      const tooMany = new ApiError(
        'Hay demasiados pedidos en poco tiempo. Probá de nuevo en un rato.',
        429,
        'rate_limited',
      );
      const hour = new Date(now - HOUR_MS).toISOString();
      const day = new Date(now - DAY_MS).toISOString();
      // Real limits, counted in the database: a visitor cannot open unlimited drafts (each one may
      // hold gigabytes in Drive) by changing the page or the browser. The order being retried is
      // left out of the count, so repeating a start never counts as one more order.
      const others = { excludeClientKey: input.clientKey };
      if (
        (await deps.orders.countRequestsSince(business.id, hour, others)) >=
        RATE_LIMITS.requestsPerHourGlobal
      )
        throw tooMany;
      if (address) {
        if (
          (await deps.orders.countRequestsSince(business.id, hour, {
            ...others,
            ipHash,
          })) >= RATE_LIMITS.requestsPerHourPerClient ||
          (await deps.orders.countRequestsSince(business.id, day, {
            ...others,
            ipHash,
          })) >= RATE_LIMITS.requestsPerDayPerClient
        )
          throw tooMany;
      }
      if (
        (await deps.orders.countRequestsSince(business.id, hour, {
          ...others,
          phoneE164: phone.e164,
        })) >= RATE_LIMITS.requestsPerHourPerPhone
      )
        throw tooMany;

      const token = randomToken(32);
      const tokenHash = await sha256(token);
      const started = await guardRule(() =>
        deps.orders.startRequest({
          business_id: business.id,
          client_key: input.clientKey,
          customer_name: input.name,
          phone_e164: phone.e164,
          phone_display: phone.display,
          email: input.email,
          notes: input.notes,
          ip_hash: ipHash,
          items: input.items.map((item) => ({
            service_id: item.serviceId,
            variant_id: item.variantId,
            quantity: item.quantity,
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
          name: requestItemName(item.name),
          quantity: item.quantity,
        });
      logger('info', 'professional_request_started', {
        requestId,
        photoJobId: started.job_id,
        items: started.items.length,
      });
      return json({
        orderCode: orderCode(started.job_id),
        uploadToken: token,
        customerFirstName: input.name.split(' ')[0],
        destinations,
        expiresAt: new Date(now + settings.linkDays * 86_400_000).toISOString(),
      });
    },
  );
}

/**
 * Confirms the request after every photo is in Drive. Idempotent like the public submit. The answer
 * lists names and copies only: whatever the database computed for the placeholder items is dropped
 * here, so no amount (not even a zero) leaves this endpoint.
 */
export function handleProfessionalRequestSubmit(
  request: Request,
  deps: PublicOrderDeps,
) {
  return run(
    request,
    deps,
    'professional_request_submit',
    async (requestId, logger) => {
      const payload = await body<Partial<PublicOrderSubmitPayload>>(request);
      const submit = parseSubmitPayload(payload, REQUEST_ORDER_LIMITS);
      const now = (deps.now ?? Date.now)();
      const { link } = await validateUploadToken(deps.intake, payload.token, {
        allowSubmitted: true,
        now,
      });
      const order = await deps.orders.getOrderByJob(
        link.business_id,
        link.photo_job_id,
      );
      // Only a request sent without an account: /imprimir and account orders have their own endpoints.
      if (!order || !isAnonymousProfessionalRequest(order))
        throw new ApiError('Link inválido.', 404, 'link_invalid');
      const done = await confirmUploadedOrder(deps, {
        link,
        order,
        submit,
        now,
        requestId,
        logger,
        headline:
          'Solicitud profesional (web, sin cuenta) · pendiente de presupuestar',
      });
      return json({
        orderCode: orderCode(link.photo_job_id),
        status: 'received' as const,
        alreadySubmitted: done.confirmed.already_submitted,
        quote: 'pending' as const,
        items: done.confirmed.items.map((x) => ({
          name: requestItemName(x.name),
          quantity: x.quantity,
        })),
        trackingToken: done.trackingToken,
      });
    },
  );
}

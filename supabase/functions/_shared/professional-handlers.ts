// Professional portal (/profesionales): the same print order as /imprimir, for a signed-in
// photographer or agreement client.
//
// Who is ordering, which price list applies and whether paying later is allowed are all decided
// HERE from the verified JWT (Auth user → professional account → Customer → its price list).
// Nothing the browser sends can choose them, and these endpoints never answer an anonymous call,
// so professional prices are never public. Uploading photos reuses the token-based
// `photo-upload-*` functions: the token is minted by `professional-order-start` for one order.
import { intakeConfig } from './config.ts';
import { ApiError, body, json } from './http.ts';
import { normalizeWhatsAppNumber } from './phone.ts';
import {
  confirmUploadedOrder,
  catalogServiceBody,
  clientAddress,
  guardRule,
  HOUR_MS,
  orderCode,
  RATE_LIMITS,
  submittedOrderBody,
  UNAVAILABLE,
  type PublicOrderDeps,
} from './public-order-handlers.ts';
import {
  orderRuleToApiError,
  parseProfessionalStartPayload,
  parseSubmitPayload,
  priceOrder,
  PROFESSIONAL_ORDER_LIMITS,
  type ProfessionalOrderStartPayload,
  type PublicOrderSubmitPayload,
} from './public-order-plan.ts';
import type { ProfessionalContext } from './public-order-store.ts';
import {
  destinationId,
  randomToken,
  sha256,
  validateUploadToken,
} from './token.ts';
import { run } from './upload-handlers.ts';
import { sha256Hex } from './upload-policy.ts';

export type ProfessionalDeps = PublicOrderDeps & {
  /**
   * Verifies the caller's JWT and returns the Auth user. Must throw ApiError(401) otherwise.
   * It says nothing about being a professional: that is resolved afterwards, in the database.
   */
  authenticate(request: Request): Promise<{ userId: string }>;
};

/** JWT → active professional account. Nothing else runs before this resolves. */
async function openAccount(request: Request, deps: ProfessionalDeps) {
  if (!request.headers.get('Authorization'))
    throw new ApiError('Iniciá sesión para continuar.', 401, 'unauthorized');
  const { userId } = await deps.authenticate(request);
  const ctx = await deps.orders.getProfessionalContext(userId);
  if (!ctx)
    throw new ApiError(
      'Esta cuenta no tiene acceso al portal profesional.',
      403,
      'not_professional',
    );
  const drive = await deps.intake.getIntegration(ctx.business_id);
  return { ctx, available: drive?.status === 'connected', userId };
}

const paymentTermsOf = (ctx: ProfessionalContext) =>
  ctx.allow_deferred_payment ? 'deferred' : 'prepaid';

/** The price list of the signed-in account (and only that one). */
export function handleProfessionalCatalog(
  request: Request,
  deps: ProfessionalDeps,
) {
  return run(request, deps, 'professional_catalog', async () => {
    const { ctx, available } = await openAccount(request, deps);
    const usable = ctx.price_list_usable && ctx.price_list_id !== null;
    const services =
      available && usable
        ? await deps.orders.listProfessionalServices(
            ctx.business_id,
            ctx.price_list_id!,
          )
        : [];
    return json({
      businessName: await deps.orders.getBusinessName(ctx.business_id),
      available,
      account: {
        customerName: ctx.customer_name,
        priceListName: usable ? ctx.price_list_name : null,
        priceListUsable: usable,
        paymentTerms: paymentTermsOf(ctx),
        phone:
          normalizeWhatsAppNumber(ctx.customer_phone ?? '')?.display ?? null,
      },
      services: services.map(catalogServiceBody),
    });
  });
}

/** Creates (or refreshes) the draft order for the signed-in account; replaying a key never duplicates. */
export function handleProfessionalOrderStart(
  request: Request,
  deps: ProfessionalDeps,
) {
  return run(
    request,
    deps,
    'professional_order_start',
    async (requestId, logger) => {
      const input = parseProfessionalStartPayload(
        await body<Partial<ProfessionalOrderStartPayload>>(request),
      );
      const now = (deps.now ?? Date.now)();
      const { ctx, available } = await openAccount(request, deps);
      if (!available)
        throw new ApiError(UNAVAILABLE, 503, 'orders_unavailable');
      if (!ctx.price_list_usable || !ctx.price_list_id)
        throw orderRuleToApiError('no_professional_list');
      const phone = normalizeWhatsAppNumber(input.phone);
      if (!phone) throw orderRuleToApiError('invalid_phone');
      const settings = intakeConfig(deps.getEnv);

      if (
        (await deps.orders.countProfessionalOrdersSince(
          ctx.account_id,
          new Date(now - HOUR_MS).toISOString(),
        )) >= RATE_LIMITS.perHourPerAccount
      )
        throw new ApiError(
          'Hay demasiados pedidos en poco tiempo. Probá de nuevo en un rato.',
          429,
          'rate_limited',
        );

      // The prices come from the account's own list; the browser's are ignored.
      const wanted = new Set(input.items.map((x) => x.serviceId));
      const catalog = (
        await deps.orders.listProfessionalServices(
          ctx.business_id,
          ctx.price_list_id,
        )
      ).filter((x) => wanted.has(x.id));
      const { lines, totalCents } = priceOrder(catalog, input.items);
      if (
        input.expectedTotalCents !== null &&
        input.expectedTotalCents !== totalCents
      )
        throw orderRuleToApiError('price_changed');

      const address = clientAddress(request);
      const ipHash = address
        ? (
            await sha256Hex(`${settings.signingSecret}:client:${address}`)
          ).slice(0, 32)
        : 'unknown';
      const token = randomToken(32);
      const tokenHash = await sha256(token);
      const started = await guardRule(() =>
        deps.orders.startProfessionalOrder({
          account_id: ctx.account_id,
          client_key: input.clientKey,
          whatsapp_e164: phone.e164,
          notes: input.notes,
          ip_hash: ipHash,
          items: lines.map((line) => ({
            service_id: line.serviceId,
            quantity: line.quantity,
            expected_unit_price_cents: line.unitPriceCents,
            variant_id: line.variantId!,
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
      logger('info', 'professional_order_started', {
        requestId,
        accountId: ctx.account_id,
        photoJobId: started.job_id,
        items: started.items.length,
        totalCents: started.total_cents,
      });
      return json({
        orderCode: orderCode(started.job_id),
        uploadToken: token,
        customerFirstName: ctx.customer_name.split(' ')[0],
        totalCents: started.total_cents,
        destinations,
        expiresAt: new Date(now + settings.linkDays * 86_400_000).toISOString(),
        paymentTerms: started.payment_terms ?? paymentTermsOf(ctx),
      });
    },
  );
}

/**
 * Confirms a professional order. The upload token alone is not enough: the order must belong to
 * the signed-in account, so another account (or an anonymous holder of the token) cannot close it.
 */
export function handleProfessionalOrderSubmit(
  request: Request,
  deps: ProfessionalDeps,
) {
  return run(
    request,
    deps,
    'professional_order_submit',
    async (requestId, logger) => {
      const payload = await body<Partial<PublicOrderSubmitPayload>>(request);
      const submit = parseSubmitPayload(payload, PROFESSIONAL_ORDER_LIMITS);
      const { ctx } = await openAccount(request, deps);
      const now = (deps.now ?? Date.now)();
      const { link } = await validateUploadToken(deps.intake, payload.token, {
        allowSubmitted: true,
        now,
      });
      const order = await deps.orders.getOrderByJob(
        link.business_id,
        link.photo_job_id,
      );
      if (!order || order.professional_account_id !== ctx.account_id)
        throw new ApiError('Link inválido.', 404, 'link_invalid');
      const terms = order.payment_terms ?? 'prepaid';
      const done = await confirmUploadedOrder(deps, {
        link,
        order,
        submit,
        now,
        requestId,
        logger,
        headline: `Pedido profesional (web) · ${
          terms === 'deferred'
            ? 'pago posterior autorizado'
            : 'pago previo por transferencia'
        }`,
      });
      return json({ ...submittedOrderBody(link, done), paymentTerms: terms });
    },
  );
}

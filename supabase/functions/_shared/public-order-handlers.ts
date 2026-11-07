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
  findOrderGaps,
  incompleteOrderError,
  orderRuleToApiError,
  parseStartPayload,
  parseSubmitPayload,
  type ParsedSubmit,
  planFinalNames,
  priceOrder,
  type PublicOrderStartPayload,
  type PublicOrderSubmitPayload,
  type PublicOrderTokenPayload,
} from './public-order-plan.ts';
import {
  isAnonymousProfessionalRequest,
  OrderRuleError,
  type PublicOrderRow,
  type PublicOrderStore,
  type PublicServiceRow,
} from './public-order-store.ts';
import type { FileRow, PhotoIntakeStore } from './store.ts';
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
  /** Professionals place few, large orders; this only stops a runaway client. */
  perHourPerAccount: 60,
  /**
   * Anonymous professional requests (/profesionales without an account). Real photographers send a
   * few large orders, so these are tighter than /imprimir per client and per phone: every draft
   * can hold up to PROFESSIONAL_REQUEST_MAX_TOTAL_BYTES in the shop's Drive.
   */
  requestsPerHourGlobal: 60,
  requestsPerHourPerClient: 6,
  requestsPerDayPerClient: 20,
  requestsPerHourPerPhone: 4,
} as const;
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const UNAVAILABLE =
  'Los pedidos online no están disponibles por el momento.';

/**
 * "Impresión 10x15 · Brillo · Por presupuestar" → "Impresión 10x15 · Brillo". What follows the paper
 * is the price list once the request is quoted, which is commercial information.
 */
export const requestItemName = (name: string) =>
  /^(.*? · (?:Mate|Brillo))( · .*)?$/.exec(name)?.[1] ?? name;

export const orderCode = (jobId: string) =>
  `CC-${jobId.slice(0, 8).toUpperCase()}`;

export async function openBusiness(deps: PublicOrderDeps) {
  const settings = publicOrderSettings(deps.getEnv);
  const business = await deps.orders.resolveBusiness(settings.businessSlug);
  if (!business) throw new ApiError(UNAVAILABLE, 503, 'orders_unavailable');
  const drive = await deps.intake.getIntegration(business.id);
  return { business, settings, available: drive?.status === 'connected' };
}

export function clientAddress(request: Request) {
  const direct = request.headers.get('cf-connecting-ip')?.trim();
  if (direct) return direct;
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

export async function guardRule<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof OrderRuleError) throw orderRuleToApiError(cause.code);
    throw cause;
  }
}

/** Retires the uploaded files of a draft that the order no longer lists; returns the rest. */
async function retireStaleUploads(
  deps: PublicOrderDeps,
  businessId: string,
  jobId: string,
  files: FileRow[],
  keep: string[],
) {
  const wanted = new Set(keep);
  const stale = files.filter((file) => !wanted.has(file.id));
  if (!stale.length) return files;
  const retired: FileRow[] = [];
  for (const file of stale)
    if (
      await deps.intake.transitionFile(
        businessId,
        jobId,
        file.id,
        ['uploaded'],
        'removed',
      )
    )
      retired.push(file);
  try {
    const { token } = await deps.drive.access(businessId);
    for (const file of retired)
      await deps.drive.trashFile(token, file.drive_file_id).catch(() => {
        /* the order is already correct; a leftover copy in Drive is only clutter */
      });
  } catch {
    /* Drive busy: same */
  }
  const gone = new Set(stale.map((file) => file.id));
  return files.filter((file) => !gone.has(file.id));
}

/**
 * Gives every lab photo its final name (`001_3copias.jpg`) in Drive and in the database.
 * Idempotent and safe to repeat after a failure: names come from a deterministic plan and a
 * file already carrying its name is skipped, so a retry converges on the same folder content.
 */
async function nameFilesForPrinting(
  deps: PublicOrderDeps,
  token: string,
  files: FileRow[],
  ranking: string[] | null,
) {
  const byItem = new Map<string, FileRow[]>();
  for (const file of files)
    if (file.workflow_route === 'lab' && file.photo_job_item_id)
      byItem.set(file.photo_job_item_id, [
        ...(byItem.get(file.photo_job_item_id) ?? []),
        file,
      ]);
  const plan = new Map<string, string>();
  for (const group of byItem.values())
    for (const [id, name] of planFinalNames(group, ranking)) plan.set(id, name);
  const pending = files.filter(
    (file) => plan.has(file.id) && plan.get(file.id) !== file.stored_filename,
  );
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (next < pending.length) {
      const file = pending[next++]!;
      const name = plan.get(file.id)!;
      try {
        await deps.drive.renameFile(token, file.drive_file_id, name);
        await deps.intake.transitionFile(
          file.business_id,
          file.photo_job_id,
          file.id,
          ['uploaded'],
          'uploaded',
          { stored_filename: name },
        );
      } catch (cause) {
        failures.push(cause);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, worker),
  );
  if (failures.length) throw failures[0];
  return plan;
}

/** One catalog row as the browser receives it (shared by the public and professional lists). */
export const catalogServiceBody = (x: PublicServiceRow) => ({
  id: x.id,
  name: x.name,
  // Size and paper arrive separately so the page can offer them one after the other. The
  // paper label is the one the SQL appends to `name` (the size is what precedes it).
  ...(x.photo_service_id && x.paper
    ? {
        photoServiceId: x.photo_service_id,
        paper: x.paper,
        paperLabel: x.paper === 'matte' ? 'Mate' : 'Brillo',
        sizeName: x.name.replace(/ · (Mate|Brillo)$/, ''),
      }
    : {}),
  description: x.description,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  unitPriceCents: x.unit_price_cents,
  variantId: x.variant_id,
  tiers: x.tiers?.map((tier) => ({
    minQuantity: tier.min_quantity,
    maxQuantity: tier.max_quantity,
    unitPriceCents: tier.unit_price_cents,
  })),
});

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
      services: services.map(catalogServiceBody),
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
            ...(line.variantId ? { variant_id: line.variantId } : {}),
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

type LinkRow = Awaited<ReturnType<typeof validateUploadToken>>['link'];

/**
 * Everything that happens once the browser says its photos are in: the checks that nothing was
 * lost, the final file names, PEDIDO.txt and the database confirmation. Shared by the public
 * and the professional portals, which differ only in who may call it and how it is introduced.
 */
export async function confirmUploadedOrder(
  deps: PublicOrderDeps,
  args: {
    link: LinkRow;
    order: PublicOrderRow;
    submit: ParsedSubmit;
    now: number;
    requestId: string;
    logger: Logger;
    /** First line of PEDIDO.txt. */
    headline: string;
  },
) {
  const { link, order, submit, now, requestId, logger } = args;
  const { trackingDays } = publicOrderSettings(deps.getEnv);

  if (order.status !== 'submitted') {
    if (
      (await deps.intake.countFiles(link.business_id, link.photo_job_id, [
        'pending',
        'uploading',
      ])) > 0
    )
      throw orderRuleToApiError('uploads_pending');
    let files = await deps.intake.listFiles(
      link.business_id,
      link.photo_job_id,
      'uploaded',
    );
    // Photos the customer removed (or moved to another size) after sending them must not be
    // printed nor billed: only what the browser lists is part of the order.
    if (submit.uploadIds)
      files = await retireStaleUploads(
        deps,
        link.business_id,
        link.photo_job_id,
        files,
        submit.uploadIds,
      );
    if (!files.length) throw orderRuleToApiError('no_files');
    // Never confirm an order as complete when a size lost photos: the database would
    // otherwise drop the empty size and bill only what arrived.
    if (!submit.acceptPartial) {
      const context = await deps.intake.getJobContext(
        link.business_id,
        link.photo_job_id,
      );
      const { signingSecret } = intakeConfig(deps.getEnv);
      const items = (context?.items ?? []).filter((x) => x.is_active);
      const uploaded = new Map<string, number>();
      for (const file of files)
        if (file.photo_job_item_id)
          uploaded.set(
            file.photo_job_item_id,
            (uploaded.get(file.photo_job_item_id) ?? 0) + 1,
          );
      let expected: Map<string, number> | null = null;
      if (submit.expectedFiles) {
        expected = new Map();
        for (const item of items)
          expected.set(
            item.id,
            submit.expectedFiles[
              await destinationId(signingSecret, link.id, item.id)
            ] ?? 0,
          );
      }
      const gaps = findOrderGaps(
        items.map((x) => ({ id: x.id, name: x.service_name_snapshot })),
        uploaded,
        expected,
      );
      if (gaps.length) {
        logger('warn', 'public_photo_order_incomplete', {
          requestId,
          photoJobId: link.photo_job_id,
          gaps: gaps.length,
        });
        throw incompleteOrderError(gaps);
      }
    }
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
    // The laboratory reads the quantity in the file name: it is set here, from the copies the
    // order is priced with, never from anything the browser calls the file.
    const finalNames = await nameFilesForPrinting(
      deps,
      folders.token,
      files,
      submit.uploadIds,
    );
    const { text } = buildManifest(
      reconciled,
      files.map((file) => ({
        ...file,
        final_name: finalNames.get(file.id),
      })),
    );
    await deps.drive.putManifest(
      folders.token,
      folders.root,
      folders.job.id,
      `${args.headline}\r\n${text}`,
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
  return { confirmed, trackingToken };
}

export const submittedOrderBody = (
  link: LinkRow,
  done: Awaited<ReturnType<typeof confirmUploadedOrder>>,
) => ({
  orderCode: orderCode(link.photo_job_id),
  status: 'received' as const,
  alreadySubmitted: done.confirmed.already_submitted,
  items: done.confirmed.items.map((x) => ({
    name: x.name,
    quantity: x.quantity,
    totalCents: x.total_cents,
  })),
  totalCents: done.confirmed.total_cents,
  trackingToken: done.trackingToken,
});

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
      const payload = await body<Partial<PublicOrderSubmitPayload>>(request);
      const { token } = payload;
      const submit = parseSubmitPayload(payload);
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
      // A professional order (with or without an account) is confirmed by its own endpoint: the
      // answer of this one carries amounts, which a professional request must never expose.
      if (order.professional_account_id || order.portal === 'profesionales')
        throw new ApiError('Link inválido.', 404, 'link_invalid');
      const done = await confirmUploadedOrder(deps, {
        link,
        order,
        submit,
        now,
        requestId,
        logger,
        headline: 'Pedido web (autoservicio)',
      });
      return json(submittedOrderBody(link, done));
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
    // A request sent without an account is quoted by CentroColor: whoever holds this link never
    // receives amounts (not even once it is quoted, nor the name of the list that was applied).
    if (isAnonymousProfessionalRequest(order))
      return json({
        businessName: await deps.orders.getBusinessName(link.business_id),
        orderCode: orderCode(link.photo_job_id),
        createdAt: order.submitted_at ?? tracking.job_created_at,
        status: tracking.job_status,
        request: {
          quote:
            tracking.quote_status === 'pending_quote' ? 'pending' : 'quoted',
        },
        items: tracking.items.map((x) => ({
          name: requestItemName(x.name),
          quantity: x.quantity,
        })),
      });
    return json({
      businessName: await deps.orders.getBusinessName(link.business_id),
      orderCode: orderCode(link.photo_job_id),
      createdAt: order.submitted_at ?? tracking.job_created_at,
      status: tracking.job_status,
      // Only professional orders carry it: lets the page tell "pays later" from "transfer".
      ...(order.payment_terms ? { paymentTerms: order.payment_terms } : {}),
      items: tracking.items.map((x) => ({
        name: x.name,
        quantity: x.quantity,
        totalCents: x.total_cents,
      })),
      totalCents: tracking.items.reduce((sum, x) => sum + x.total_cents, 0),
    });
  });
}

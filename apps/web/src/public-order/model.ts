import type { IconName } from '@centrocolor/ui';
import {
  publicOrderStatusLabel,
  publicOrderStatusLabels,
} from '@centrocolor/domain';

// Pure rules of the public order screen. No React, no network: easy to test.
//
// The browser only DISPLAYS prices. The server recomputes every amount from the catalog, so a
// total shown here that differs from the server's is detected (price_changed), never trusted.

export type CatalogService = {
  id: string;
  name: string;
  description: string | null;
  widthMm: number | null;
  heightMm: number | null;
  unitPriceCents: number;
};

export type PhotoEntry = {
  id: string;
  serviceId: string;
  file: File;
  copies: number;
};

export type OrderLine = {
  service: CatalogService;
  files: number;
  copies: number;
  totalCents: number;
};

/** Alias de transferencia y regla comercial de DESIGN-02: se imprime una vez acreditado el pago. */
export const BANK_ALIAS = 'CENTROCOLORESPERANZA';
export const PRINT_AFTER_PAYMENT =
  'La impresión se realiza una vez acreditado el pago.';

export const howItWorks: Array<{ icon: IconName; label: string }> = [
  { icon: 'grid', label: 'Elegí el tamaño' },
  { icon: 'upload', label: 'Subí tus fotos' },
  { icon: 'wallet', label: 'Transferí' },
  { icon: 'store', label: 'Retirá en el local' },
];

/** The one commercial clarification shown next to the total, before confirming. */
export const paymentNote = 'Se imprime una vez acreditada la transferencia.';

export const MIN_COPIES = 1;
export const MAX_COPIES = 99;
export const MAX_FILES_PER_ORDER = 200;
export const ACCEPTED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'tif',
  'tiff',
];
export const FILE_INPUT_ACCEPT = 'image/*,.heic,.heif,.tif,.tiff';

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const clampCopies = (value: number) =>
  Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.trunc(value) || MIN_COPIES));

export function fileExtension(name: string) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Why a picked file cannot be part of the order, in words for the customer. */
export function fileProblem(file: { name: string; size: number }) {
  if (!ACCEPTED_EXTENSIONS.includes(fileExtension(file.name)))
    return `${file.name}: sólo se aceptan fotos (JPG, PNG, HEIC o TIFF).`;
  if (file.size <= 0) return `${file.name}: el archivo está vacío.`;
  return null;
}

/**
 * The quantity of each size is DERIVED from the photos: the sum of the copies chosen for its
 * files. The customer never types "how many 10x15" and then has to make files match.
 */
export function deriveLines(
  catalog: CatalogService[],
  selectedIds: string[],
  entries: PhotoEntry[],
): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const service of catalog) {
    if (!selectedIds.includes(service.id)) continue;
    const own = entries.filter((x) => x.serviceId === service.id);
    const copies = own.reduce((sum, x) => sum + x.copies, 0);
    lines.push({
      service,
      files: own.length,
      copies,
      totalCents: copies * service.unitPriceCents,
    });
  }
  return lines;
}

export const orderTotal = (lines: OrderLine[]) =>
  lines.reduce((sum, line) => sum + line.totalCents, 0);

export const lineLabel = (line: OrderLine) =>
  `${line.copies} × ${line.service.name} = ${formatMoney(line.totalCents)}`;

export type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  notes: string;
  whatsappOptIn: boolean;
};

const digits = (value: string) => value.replace(/\D/g, '');

/** What is still missing before the order can be confirmed (first thing first). */
export function missingForConfirm(
  lines: OrderLine[],
  selectedIds: string[],
  customer: CustomerForm,
): string[] {
  const missing: string[] = [];
  if (!selectedIds.length) missing.push('elegí al menos un tamaño');
  for (const line of lines)
    if (line.files === 0) missing.push(`agregá fotos de ${line.service.name}`);
  if (customer.name.trim().length < 2) missing.push('tu nombre');
  const phoneDigits = digits(customer.phone).length;
  if (phoneDigits < 8 || phoneDigits > 15) missing.push('tu WhatsApp');
  if (
    customer.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())
  )
    missing.push('un email válido (o dejalo vacío)');
  return missing;
}

/** Wire body of public-photo-order-start (contract: PublicOrderStartPayload). */
export function startBody(
  clientKey: string,
  customer: CustomerForm,
  lines: OrderLine[],
) {
  return {
    clientKey,
    customer: {
      name: customer.name.trim(),
      phone: customer.phone.trim(),
      email: customer.email.trim() || undefined,
      notes: customer.notes.trim() || undefined,
    },
    whatsappOptIn: customer.whatsappOptIn,
    items: lines.map((line) => ({
      serviceId: line.service.id,
      quantity: line.copies,
    })),
    expectedTotalCents: orderTotal(lines),
  };
}

/** Random idempotency key; a retry of the same order reuses it. */
export function newClientKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/* ───────────────────────────── tracking presentation ───────────────────────────── */

export type TrackedStatus =
  'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';

export const trackingSteps: { status: TrackedStatus; label: string }[] = (
  ['received', 'in_progress', 'ready', 'delivered'] as const
).map((status) => ({ status, label: publicOrderStatusLabels[status] }));

/** Headline of the tracking page; "ready" is shouted on purpose: it is what the customer waits for. */
export const trackingHeadline = (status: TrackedStatus) =>
  status === 'ready'
    ? publicOrderStatusLabels.ready.toUpperCase()
    : publicOrderStatusLabel(status);

export function trackingNote(status: TrackedStatus) {
  if (status === 'ready')
    return '¡Tu pedido está listo! Podés pasar a retirarlo.';
  if (status === 'delivered') return 'Gracias por elegirnos.';
  if (status === 'cancelled')
    return 'Este pedido fue cancelado. Escribinos si tenés dudas.';
  return 'Te avisaremos por WhatsApp cuando esté listo para retirar.';
}

/** Index of the current step (cancelled has none). */
export const trackingStepIndex = (status: TrackedStatus) =>
  trackingSteps.findIndex((step) => step.status === status);

/* ───────────────────────────── remembered order (this browser) ───────────────────────────── */

const LAST_ORDER_KEY = 'cc.print.lastOrder';
const CLIENT_KEY_KEY = 'cc.print.clientKey';

export type RememberedOrder = {
  orderCode: string;
  trackingToken: string;
  at: string;
};

/** Browser storage can be blocked or empty: it is a convenience, never a requirement. */
function safe<T>(work: () => T, fallback: T) {
  try {
    return work();
  } catch {
    return fallback;
  }
}

export const loadClientKey = () =>
  safe(() => {
    const existing = localStorage.getItem(CLIENT_KEY_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const created = newClientKey();
    localStorage.setItem(CLIENT_KEY_KEY, created);
    return created;
  }, newClientKey());
export const resetClientKey = () =>
  safe(() => localStorage.removeItem(CLIENT_KEY_KEY), undefined);
export const rememberOrder = (order: RememberedOrder) =>
  safe(
    () => localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order)),
    undefined,
  );
export const loadRememberedOrder = (): RememberedOrder | null =>
  safe(() => {
    const raw = localStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedOrder>;
    return typeof value.orderCode === 'string' &&
      typeof value.trackingToken === 'string' &&
      typeof value.at === 'string'
      ? (value as RememberedOrder)
      : null;
  }, null);

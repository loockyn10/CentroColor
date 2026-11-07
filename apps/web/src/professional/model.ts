// Pure rules of the professional portal (/profesionales): picking whole folders, copies for every
// photo, progress of hundreds of uploads and which rows of a long list to draw. No React, no
// network. Prices stay on the server: the browser only displays what the catalog told it.
import {
  ACCEPTED_EXTENSIONS,
  clampCopies,
  fileExtension,
  orderTotal,
  type OrderLine,
  type PhotoEntry,
} from '../public-order/model';
import type { UploadProgress } from '../public-order/order-submission';

/** The server accepts up to a thousand photos and 300 MB per photo from a professional account. */
export const PRO_MAX_FILES_PER_ORDER = 1000;
export const PRO_MAX_FILE_BYTES = 300 * 1024 * 1024;
/** Photos in flight at once: enough to fill the line, few enough to keep a laptop responsive. */
export const PRO_UPLOAD_CONCURRENCY = 4;

/** Name used to order photos the way a person reads them: IMG_2 before IMG_10. */
const natural = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

const pathOf = (file: File) =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
  file.name;

/** Name of the chosen folder (first path segment), when the browser reported one. */
export function pickedFolderName(files: File[]) {
  const first = files.find((file) => pathOf(file).includes('/'));
  return first ? pathOf(first).split('/')[0]! : null;
}

export type PickedFiles = {
  /** Photos the order can take, in natural name order. */
  accepted: File[];
  /** Files that are not photos (catalogs, XMP sidecars, system files): skipped silently. */
  ignored: number;
  empty: string[];
  tooLarge: string[];
};

/**
 * Sorts what a folder or a multiple selection contains. Lightroom folders hold more than photos
 * (`.lrcat`, `.xmp`, `Thumbs.db`): those are counted and skipped, never an error.
 */
export function classifyPickedFiles(files: File[]): PickedFiles {
  const result: PickedFiles = {
    accepted: [],
    ignored: 0,
    empty: [],
    tooLarge: [],
  };
  for (const file of files) {
    if (
      file.name.startsWith('.') ||
      !ACCEPTED_EXTENSIONS.includes(fileExtension(file.name))
    )
      result.ignored += 1;
    else if (file.size <= 0) result.empty.push(file.name);
    else if (file.size > PRO_MAX_FILE_BYTES) result.tooLarge.push(file.name);
    else result.accepted.push(file);
  }
  result.accepted.sort((a, b) => natural.compare(pathOf(a), pathOf(b)));
  return result;
}

/** Identity of a photo inside one size: picking the same folder twice must not add it twice. */
export const fileKey = (file: File) =>
  `${pathOf(file)}|${file.size}|${file.lastModified}`;

export type Additions = {
  entries: PhotoEntry[];
  /** Already in this size: skipped. */
  duplicates: number;
  /** Did not fit in the per-order limit. */
  overflow: number;
};

/**
 * The photo entries a selection adds to ONE size. Photos already there (same path, size and
 * date) are skipped, and the order never grows past the limit. The same photo can still go into
 * another size: each size prints its own copy.
 */
export function planAdditions(
  existing: PhotoEntry[],
  serviceId: string,
  files: File[],
  options: { total?: number; newId?: () => string } = {},
): Additions {
  const total = options.total ?? existing.length;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const seen = new Set(
    existing
      .filter((x) => x.serviceId === serviceId)
      .map((x) => fileKey(x.file)),
  );
  const entries: PhotoEntry[] = [];
  let duplicates = 0;
  let overflow = 0;
  for (const file of files) {
    const key = fileKey(file);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    if (total + entries.length >= PRO_MAX_FILES_PER_ORDER) {
      overflow += 1;
      continue;
    }
    seen.add(key);
    entries.push({ id: newId(), serviceId, file, copies: 1 });
  }
  return { entries, duplicates, overflow };
}

/** "Copias para todas": every photo of one size gets the same number of copies. */
export const applyCopiesToAll = (
  entries: PhotoEntry[],
  serviceId: string,
  copies: number,
) => {
  const value = clampCopies(copies);
  return entries.map((entry) =>
    entry.serviceId === serviceId ? { ...entry, copies: value } : entry,
  );
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** One sentence about what a selection did, for the status line of its size. */
export function describePick(
  folder: string | null,
  picked: PickedFiles,
  added: Additions,
) {
  const parts = [
    folder
      ? `Carpeta «${folder}»: ${plural(added.entries.length, 'foto agregada', 'fotos agregadas')}.`
      : `${plural(added.entries.length, 'foto agregada', 'fotos agregadas')}.`,
  ];
  if (added.duplicates)
    parts.push(
      `${plural(added.duplicates, 'ya estaba', 'ya estaban')} en este formato.`,
    );
  if (picked.ignored)
    parts.push(
      `${plural(picked.ignored, 'archivo que no es una foto se ignoró', 'archivos que no son fotos se ignoraron')}.`,
    );
  if (picked.empty.length)
    parts.push(
      `${plural(picked.empty.length, 'archivo vacío', 'archivos vacíos')}.`,
    );
  if (picked.tooLarge.length)
    parts.push(
      `${plural(picked.tooLarge.length, 'foto supera', 'fotos superan')} los ${PRO_MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  if (added.overflow)
    parts.push(
      `Podés enviar hasta ${PRO_MAX_FILES_PER_ORDER} fotos por pedido: ${plural(added.overflow, 'quedó afuera', 'quedaron afuera')}.`,
    );
  return parts.join(' ');
}

/* ───────────────────────────── progress ───────────────────────────── */

export type ProgressSummary = {
  total: number;
  done: number;
  failed: number;
  uploading: number;
  waiting: number;
  /** 0–100, counting partial uploads. */
  percent: number;
};

/** Counters for the whole order, computed once per refresh (not once per row). */
export function summarizeProgress(
  entries: { id: string }[],
  progress: Map<string, UploadProgress>,
): ProgressSummary {
  let done = 0;
  let failed = 0;
  let uploading = 0;
  let partial = 0;
  for (const entry of entries) {
    const state = progress.get(entry.id);
    if (state?.status === 'done') done += 1;
    else if (state?.status === 'failed') failed += 1;
    else if (state?.status === 'uploading') {
      uploading += 1;
      partial += state.percent;
    }
  }
  const total = entries.length;
  return {
    total,
    done,
    failed,
    uploading,
    waiting: total - done - failed - uploading,
    percent: total ? Math.round((done * 100 + partial) / total) : 0,
  };
}

/* ───────────────────────────── long lists ───────────────────────────── */

/**
 * Rows of a fixed-height list that must exist in the DOM for a scroll position. A few extra rows
 * on each side (`overscan`) avoid blank flashes; a list of 500 photos draws about twenty rows.
 */
export function visibleRows(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 4,
) {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + viewportHeight) / rowHeight);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + overscan),
  };
}

/* ───────────────────────────── order ───────────────────────────── */

/** Wire body of professional-order-start (contract: ProfessionalOrderStartPayload). */
export function startProfessionalBody(
  clientKey: string,
  phone: string,
  notes: string,
  lines: OrderLine[],
) {
  return {
    clientKey,
    phone: phone.trim(),
    notes: notes.trim() || undefined,
    items: lines.map((line) => ({
      serviceId: line.service.id,
      variantId: line.service.variantId!,
      quantity: line.copies,
    })),
    expectedTotalCents: orderTotal(lines),
  };
}

const digits = (value: string) => value.replace(/\D/g, '');

/** What is still missing before the order can be sent (first thing first). */
export function missingForProfessionalConfirm(
  lines: OrderLine[],
  selected: string[],
  phone: string,
) {
  const missing: string[] = [];
  if (!selected.length) missing.push('elegí al menos un formato');
  for (const line of lines)
    if (line.files === 0) missing.push(`agregá fotos de ${line.service.name}`);
    else if (line.pricingAvailable === false)
      missing.push(
        `no hay precio para ${line.copies} copias de ${line.service.name}`,
      );
    else if (!line.service.variantId)
      missing.push(`${line.service.name} no está disponible`);
  const phoneDigits = digits(phone).length;
  if (phoneDigits < 8 || phoneDigits > 15) missing.push('tu WhatsApp');
  return missing;
}

/* ───────────────────────────── session helpers ───────────────────────────── */

export type AuthLink = {
  type: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
};

/**
 * The tokens (or the error) an invitation / password-reset e-mail leaves in the URL fragment.
 * Null when the fragment is not an auth redirect.
 */
export function parseAuthHash(hash: string): AuthLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const error = params.get('error_description') ?? params.get('error');
  if (!accessToken && !error) return null;
  return {
    type: params.get('type'),
    accessToken,
    refreshToken: params.get('refresh_token'),
    error,
  };
}

export const PASSWORD_MIN_LENGTH = 8;

export function passwordProblem(password: string, repeat: string) {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `La contraseña necesita al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (password !== repeat) return 'Las contraseñas no coinciden.';
  return null;
}

const CLIENT_KEY_KEY = 'cc.pro.clientKey';
const PHONE_KEY = 'cc.pro.phone';

function safe<T>(work: () => T, fallback: T) {
  try {
    return work();
  } catch {
    return fallback;
  }
}

/** Idempotency key of the order being built; a retry of the same order reuses it. */
export const loadProfessionalClientKey = (newKey: () => string) =>
  safe(() => {
    const existing = localStorage.getItem(CLIENT_KEY_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const created = newKey();
    localStorage.setItem(CLIENT_KEY_KEY, created);
    return created;
  }, newKey());
export const resetProfessionalClientKey = () =>
  safe(() => localStorage.removeItem(CLIENT_KEY_KEY), undefined);
export const loadProfessionalPhone = () =>
  safe(() => localStorage.getItem(PHONE_KEY) ?? '', '');
export const rememberProfessionalPhone = (phone: string) =>
  safe(() => localStorage.setItem(PHONE_KEY, phone), undefined);

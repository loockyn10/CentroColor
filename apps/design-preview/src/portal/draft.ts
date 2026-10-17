import { useSyncExternalStore } from 'react';
import { PRINT_SIZES, type PrintSize } from '../data';
import { samplePhoto } from '../photos';

// Borrador del pedido público. Vive fuera de React para sobrevivir a la navegación
// (ir a /pedido/demo y volver no pierde las fotos). Todo es local y simulado: no hay upload real.

export interface PhotoEntry {
  id: string;
  sizeId: string;
  name: string;
  src: string; // '' cuando el navegador no puede previsualizar (HEIC/TIFF)
  bytes: number;
  copies: number;
  progress: number; // 0..100
  error?: string;
}

export interface Draft {
  sizes: string[];
  photos: PhotoEntry[];
  name: string;
  phone: string;
  email: string;
  notes: string;
  notify: boolean;
}

const empty = (): Draft => ({
  sizes: [],
  photos: [],
  name: '',
  phone: '',
  email: '',
  notes: '',
  notify: true,
});

let draft: Draft = empty();
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
export const getDraft = () => draft;

export function setDraft(
  patch: Partial<Draft> | ((d: Draft) => Partial<Draft>),
) {
  draft = { ...draft, ...(typeof patch === 'function' ? patch(draft) : patch) };
  subs.forEach((f) => f());
  ensureTicker();
}
export const resetDraft = () => {
  draft = empty();
  subs.forEach((f) => f());
};
export const useDraft = () =>
  useSyncExternalStore(subscribe, getDraft, getDraft);

// ───────── Simulación de subida ─────────
let timer: number | undefined;
function ensureTicker() {
  const pending = draft.photos.some((p) => p.progress < 100 && !p.error);
  if (pending && timer === undefined) {
    timer = window.setInterval(() => {
      const still = draft.photos.some((p) => p.progress < 100 && !p.error);
      if (!still) {
        window.clearInterval(timer);
        timer = undefined;
        return;
      }
      draft = {
        ...draft,
        photos: draft.photos.map((p) =>
          p.progress < 100 && !p.error
            ? {
                ...p,
                progress: Math.min(100, p.progress + 9 + Math.random() * 16),
              }
            : p,
        ),
      };
      subs.forEach((f) => f());
    }, 170);
  }
}

// ───────── Acciones ─────────
export const ACCEPTED = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'tif', 'tiff'];
const PREVIEWABLE = ['jpg', 'jpeg', 'png'];
const MAX_BYTES = 40 * 1024 * 1024;

let seq = 0;
const nextId = () => `ph${++seq}`;

export function toggleSize(id: string) {
  setDraft((d) => {
    const on = d.sizes.includes(id);
    return {
      sizes: on ? d.sizes.filter((s) => s !== id) : [...d.sizes, id],
      // Quitar un tamaño descarta sus fotos (con la confirmación visible en la UI).
      photos: on ? d.photos.filter((p) => p.sizeId !== id) : d.photos,
    };
  });
}

export function addFiles(sizeId: string, files: File[]) {
  const entries: PhotoEntry[] = files.map((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    let error: string | undefined;
    if (!ACCEPTED.includes(ext))
      error = 'Formato no admitido. Usá JPG, PNG, HEIC o TIFF.';
    else if (f.size > MAX_BYTES) error = 'Pesa más de 40 MB.';
    return {
      id: nextId(),
      sizeId,
      name: f.name,
      src: !error && PREVIEWABLE.includes(ext) ? URL.createObjectURL(f) : '',
      bytes: f.size,
      copies: 1,
      progress: error ? 0 : 0,
      error,
    };
  });
  setDraft((d) => ({ photos: [...d.photos, ...entries] }));
}

export function addSamples(
  sizeId: string,
  count: number,
  copies: number[] = [],
) {
  const base = draft.photos.length;
  const entries: PhotoEntry[] = Array.from({ length: count }, (_, i) => ({
    id: nextId(),
    sizeId,
    name: `IMG_${String(400 + base + i).padStart(4, '0')}.jpg`,
    src: samplePhoto(base + i + (sizeId === 's2030' ? 3 : 0)),
    bytes: 1_800_000 + (((base + i) * 377_000) % 3_100_000),
    copies: copies[i] ?? 1,
    progress: 0,
  }));
  setDraft((d) => ({ photos: [...d.photos, ...entries] }));
}

export const removePhoto = (id: string) =>
  setDraft((d) => ({ photos: d.photos.filter((p) => p.id !== id) }));

export const setCopies = (id: string, copies: number) =>
  setDraft((d) => ({
    photos: d.photos.map((p) => (p.id === id ? { ...p, copies } : p)),
  }));

/** Pedido de ejemplo = 20 copias 10×15 (6 fotos) + 2 ampliaciones 20×30 → $18.500. */
export function loadDemoOrder() {
  resetDraft();
  setDraft({
    sizes: ['s1015', 's2030'],
    name: 'María González',
    phone: '3496 41-2231',
    notify: true,
  });
  addSamples('s1015', 6, [4, 4, 3, 3, 3, 3]);
  addSamples('s2030', 2, [1, 1]);
}

// ───────── Derivados ─────────
export interface OrderLine {
  size: PrintSize;
  photos: number;
  copies: number;
  total: number;
}

export function orderLines(d: Draft): OrderLine[] {
  return PRINT_SIZES.filter((s) => d.sizes.includes(s.id))
    .map((size) => {
      const ph = d.photos.filter((p) => p.sizeId === size.id && !p.error);
      const copies = ph.reduce((n, p) => n + p.copies, 0);
      return { size, photos: ph.length, copies, total: copies * size.price };
    })
    .filter((l) => l.photos > 0);
}

export const orderTotals = (lines: OrderLine[]) => ({
  total: lines.reduce((n, l) => n + l.total, 0),
  copies: lines.reduce((n, l) => n + l.copies, 0),
  photos: lines.reduce((n, l) => n + l.photos, 0),
});

export type Missing = 'sizes' | 'photos' | 'uploading' | 'name' | 'phone';

export function missing(d: Draft): Missing[] {
  const out: Missing[] = [];
  const valid = d.photos.filter((p) => !p.error);
  if (!d.sizes.length) out.push('sizes');
  else if (!valid.length) out.push('photos');
  else if (valid.some((p) => p.progress < 100)) out.push('uploading');
  if (d.name.trim().length < 2) out.push('name');
  if (d.phone.replace(/\D/g, '').length < 8) out.push('phone');
  return out;
}

export const MISSING_LABEL: Record<Missing, string> = {
  sizes: 'elegir un tamaño',
  photos: 'subir al menos una foto',
  uploading: 'esperar que terminen de subir las fotos',
  name: 'tu nombre',
  phone: 'tu WhatsApp',
};

export const MISSING_TARGET: Record<Missing, string> = {
  sizes: 'tamanos',
  photos: 'fotos',
  uploading: 'fotos',
  name: 'datos',
  phone: 'datos',
};

import type { CatalogService, PhotoEntry } from './model';

// Pure rules of the cascade of /imprimir: size → paper → photos, repeated for each block.
//
// A block is a catalog entry the customer chose (one size on one paper) with its photos. Its
// identity is the catalog id: the order never holds two blocks of the same size and paper. The
// browser only arranges what the catalog offers; prices and availability stay on the server.

export type PaperOption = { service: CatalogService; label: string };

export type SizeOption = {
  key: string;
  name: string;
  widthMm: number | null;
  heightMm: number | null;
  description: string | null;
  papers: PaperOption[];
};

/** `10x15 · Brillo` → size `10x15`, paper `Brillo`. Only used with a server that sends no split. */
const PAPER_SUFFIX = /^(.*?) · (Mate|Brillo)$/;

const sizeNameOf = (service: CatalogService) =>
  service.sizeName ?? PAPER_SUFFIX.exec(service.name)?.[1] ?? service.name;
const paperLabelOf = (service: CatalogService) =>
  service.paperLabel ?? PAPER_SUFFIX.exec(service.name)?.[2] ?? null;

/**
 * The sizes the catalog really offers and, for each, the papers really available for it, in the
 * catalog's own order. Nothing is hardcoded: a size or paper the business does not sell is not here.
 */
export function catalogSizes(services: CatalogService[]): SizeOption[] {
  const sizes = new Map<string, SizeOption>();
  for (const service of services) {
    const name = sizeNameOf(service);
    const key = service.photoServiceId ?? name;
    const size = sizes.get(key) ?? {
      key,
      name,
      widthMm: service.widthMm,
      heightMm: service.heightMm,
      description: service.description,
      papers: [],
    };
    size.papers.push({ service, label: paperLabelOf(service) ?? name });
    sizes.set(key, size);
  }
  return [...sizes.values()];
}

/** Papers of a size that are still free: not already chosen by another block of the order. */
export const freePapers = (
  size: SizeOption,
  selected: string[],
  ownId?: string,
) =>
  size.papers.filter(
    (paper) =>
      paper.service.id === ownId || !selected.includes(paper.service.id),
  );

/** Whether another block could still be added (some size on some paper is not in the order). */
export const canAddBlock = (sizes: SizeOption[], selected: string[]) =>
  sizes.some((size) => freePapers(size, selected).length > 0);

/** Appends a block. Choosing a size and paper that is already in the order changes nothing. */
export const addBlock = (selected: string[], serviceId: string) =>
  selected.includes(serviceId) ? selected : [...selected, serviceId];

/**
 * Moves a block to another size or paper keeping its place and ALL of its photos. Refused (the
 * state is returned as it was) when the target already is another block: no identical blocks.
 */
export function changeBlock(
  state: { selected: string[]; entries: PhotoEntry[] },
  from: string,
  to: string,
) {
  if (
    from === to ||
    state.selected.includes(to) ||
    !state.selected.includes(from)
  )
    return state;
  return {
    selected: state.selected.map((id) => (id === from ? to : id)),
    entries: state.entries.map((entry) =>
      entry.serviceId === from ? { ...entry, serviceId: to } : entry,
    ),
  };
}

/** Drops a block together with its photos. The other blocks keep theirs, copies included. */
export const removeBlock = (
  state: { selected: string[]; entries: PhotoEntry[] },
  serviceId: string,
) => ({
  selected: state.selected.filter((id) => id !== serviceId),
  entries: state.entries.filter((entry) => entry.serviceId !== serviceId),
});

/**
 * The uploads that make up the order, in the order the customer sees them (block by block, photo
 * by photo). The server numbers the files of each folder in this order. Returns null when some
 * photo has no recorded attempt: then the server is told nothing and retires nothing.
 */
export function orderedUploadIds(
  selected: string[],
  sent: { id: string; serviceId: string }[],
  attempts: Map<string, string>,
): string[] | null {
  const ids: string[] = [];
  for (const serviceId of selected)
    for (const entry of sent)
      if (entry.serviceId === serviceId) {
        const uploadId = attempts.get(entry.id);
        if (!uploadId) return null;
        ids.push(uploadId);
      }
  return sent.every((x) => selected.includes(x.serviceId)) ? ids : null;
}

/** `10x15` → `10×15` for headings; the stored name never changes. */
export const prettySize = (name: string) =>
  name.replace(/(\d)\s*x\s*(\d)/gi, '$1×$2');

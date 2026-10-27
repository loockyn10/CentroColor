import type { ScanResult } from '@centrocolor/application';
import type { Product } from '@centrocolor/domain';

export const POS_PAGE = 'new-sale';
export const PRODUCTS_PAGE = 'products';

export type ScanAlta = { barcode: string; returnTo: string };
export type ScanNotice = { id: number; text: string };

export type ScanState = {
  /** Productos escaneados que el POS todavía debe sumar al ticket. */
  cartQueue: readonly Product[];
  /** Alta de producto originada por un código desconocido. */
  alta: ScanAlta | null;
  notice: ScanNotice | null;
};

export type ScanCoordinatorDeps = {
  /** Misma resolución que usa el POS (`scanBarcode` sobre el repositorio real). */
  lookup: (barcode: string) => Promise<ScanResult>;
  navigate: (page: string) => void;
  activePage: () => string;
};

/**
 * Orquesta el escaneo global: resuelve el código con la lógica del POS, encola el producto para el
 * ticket (el POS sigue siendo el único dueño del carrito) o abre el alta. Los escaneos se
 * serializan para no perder ni duplicar códigos cuando llegan en ráfaga.
 */
export class ScanCoordinator {
  private state: ScanState = { cartQueue: [], alta: null, notice: null };
  private readonly listeners = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();
  private noticeId = 0;

  constructor(public deps: ScanCoordinatorDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): ScanState => this.state;

  /** Un escaneo físico = una llamada. Devuelve cuando el código quedó procesado. */
  enqueue(raw: string): Promise<void> {
    const run = this.tail.then(() => this.process(raw));
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** El POS retira los productos pendientes; cada uno se entrega una sola vez. */
  takeCartProducts(): Product[] {
    const taken = [...this.state.cartQueue];
    if (taken.length) this.set({ cartQueue: [] });
    return taken;
  }

  /** Alta guardada: el producto nuevo va al ticket y se abre el POS. */
  finishAlta(product: Product) {
    if (!this.state.alta) return;
    this.set({ alta: null, cartQueue: [...this.state.cartQueue, product] });
    this.deps.navigate(POS_PAGE);
  }

  /** Alta cancelada: se descarta el código pendiente y se vuelve a donde se estaba. */
  cancelAlta() {
    const alta = this.state.alta;
    if (!alta) return;
    this.set({ alta: null });
    if (alta.returnTo !== PRODUCTS_PAGE) this.deps.navigate(alta.returnTo);
  }

  /** Si el operador sale de Productos por su cuenta, el código pendiente no sobrevive. */
  pageChanged(page: string) {
    if (this.state.alta && page !== PRODUCTS_PAGE) this.set({ alta: null });
  }

  notify(text: string) {
    this.set({ notice: { id: ++this.noticeId, text } });
  }

  dismissNotice(id?: number) {
    if (this.state.notice && (id === undefined || this.state.notice.id === id))
      this.set({ notice: null });
  }

  private async process(raw: string) {
    try {
      const found = await this.deps.lookup(raw);
      if (found.kind === 'found') {
        this.set({ cartQueue: [...this.state.cartQueue, found.product] });
        if (this.deps.activePage() !== POS_PAGE) this.deps.navigate(POS_PAGE);
      } else if (found.kind === 'inactive') {
        this.notify(
          `El producto ${found.product.name} está inactivo. Reactivalo en Configuración → Productos.`,
        );
      } else {
        const returnTo = this.deps.activePage();
        this.set({ alta: { barcode: found.barcode, returnTo } });
        if (returnTo !== PRODUCTS_PAGE) this.deps.navigate(PRODUCTS_PAGE);
      }
    } catch (failure) {
      this.notify(
        failure instanceof Error
          ? failure.message
          : 'No se pudo resolver el código escaneado.',
      );
    }
  }

  private set(patch: Partial<ScanState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

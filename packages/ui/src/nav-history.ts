/**
 * Pila de navegación interna sincronizada con el historial del navegador.
 *
 * Problema que resuelve: la app es una sola página; sin entradas de historial propias, el botón
 * Atrás del navegador (o el gesto del teléfono) saca al usuario de la aplicación. Cada capa
 * (detalle, hoja, diálogo) y cada cambio de módulo registran una entrada: Atrás cierra la capa o
 * vuelve al módulo anterior.
 *
 * Reglas:
 *  - Una capa cerrada por la propia app (Guardar, Cancelar, «Volver») retira su entrada con
 *    `history.back()` si es la última; si ya no lo es queda «muerta» y se salta sola.
 *  - Una entrada desconocida (recarga, Adelante) se ignora: nunca rompe la pantalla visible.
 *  - La lógica no toca `window` directamente: recibe un puerto, de modo que se prueba sin DOM.
 */

export interface HistoryPort {
  readonly state: unknown;
  pushState(state: unknown, title: string): void;
  replaceState(state: unknown, title: string): void;
  back(): void;
  /** Registra el manejador de `popstate` y devuelve la baja. */
  onPop(handler: (state: unknown) => void): () => void;
}

export type NavEntryKind = 'root' | 'module' | 'layer';

export interface NavEntry {
  readonly id: number;
  readonly kind: NavEntryKind;
  /** Para `module`: identificador de la vista. */
  readonly moduleId?: string;
  /** Capa: la entrada fue retirada con Atrás; hay que cerrarla. Módulo: volvió a ser la actual. */
  onPop?: () => void;
  dead: boolean;
}

const MARK = 'cc-nav';

function entryIdOf(state: unknown): number | null {
  if (state && typeof state === 'object' && MARK in state) {
    const value = (state as Record<string, unknown>)[MARK];
    return typeof value === 'number' ? value : null;
  }
  return null;
}

export class NavHistory {
  private entries: NavEntry[] = [];
  private nextId = 1;
  private ignore = 0;
  private stop: (() => void) | null = null;

  constructor(private readonly port: HistoryPort) {}

  /** Arranca: la entrada actual pasa a ser la raíz de la app. */
  start(rootModule: string, onEnterModule: (moduleId: string) => void) {
    this.stopListening();
    this.entries = [];
    this.nextId = 1;
    this.ignore = 0;
    const root = this.makeEntry('root', rootModule, () =>
      onEnterModule(rootModule),
    );
    this.port.replaceState({ [MARK]: root.id }, '');
    this.entries.push(root);
    this.onEnterModule = onEnterModule;
    this.stop = this.port.onPop((state) => this.handlePop(state));
  }

  stopListening() {
    this.stop?.();
    this.stop = null;
  }

  private onEnterModule: (moduleId: string) => void = () => undefined;

  private makeEntry(
    kind: NavEntryKind,
    moduleId: string | undefined,
    onPop?: () => void,
  ): NavEntry {
    return { id: this.nextId++, kind, moduleId, onPop, dead: false };
  }

  /** Vista actual según la pila (último módulo o raíz). */
  currentModule(): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (!entry.dead && entry.moduleId) return entry.moduleId;
    }
    return undefined;
  }

  /** Cantidad de entradas propias (para pruebas). */
  get depth() {
    return this.entries.length;
  }

  /** El usuario navegó a otro módulo con un control de la app. */
  pushModule(moduleId: string) {
    if (this.currentModule() === moduleId && this.topIsModule()) return;
    const entry = this.makeEntry('module', moduleId, () =>
      this.onEnterModule(moduleId),
    );
    this.port.pushState({ [MARK]: entry.id }, '');
    this.entries.push(entry);
  }

  private topIsModule() {
    const top = this.entries[this.entries.length - 1];
    return Boolean(top && (top.kind === 'module' || top.kind === 'root'));
  }

  /** Abre una capa (detalle, hoja, diálogo). `onClose` se invoca si el usuario toca Atrás. */
  pushLayer(onClose: () => void): NavEntry {
    const entry = this.makeEntry('layer', undefined, onClose);
    this.port.pushState({ [MARK]: entry.id }, '');
    this.entries.push(entry);
    return entry;
  }

  /** La app cerró la capa por su cuenta: se retira su entrada del historial. */
  releaseLayer(entry: NavEntry) {
    const at = this.entries.indexOf(entry);
    if (at < 0 || entry.dead) return;
    if (at === this.entries.length - 1) {
      this.entries.pop();
      this.ignore++;
      this.port.back();
      return;
    }
    entry.dead = true;
    entry.onPop = undefined;
  }

  private handlePop(state: unknown) {
    if (this.ignore > 0) {
      this.ignore--;
      return;
    }
    const id = entryIdOf(state);
    const at = id === null ? -1 : this.entries.findIndex((e) => e.id === id);
    if (at < 0) return;
    // Entradas por encima del destino: las capas vivas se cierran, de la más nueva a la más vieja.
    const removed = this.entries.splice(at + 1).reverse();
    for (const entry of removed) {
      if (entry.kind === 'layer' && !entry.dead) entry.onPop?.();
    }
    const landed = this.entries[at]!;
    if (landed.dead) {
      // Entrada de una capa que la app ya cerró: no hay nada que mostrar, se sigue hacia atrás.
      // El `popstate` de este back sí es visible: se atiende con normalidad.
      this.entries.pop();
      this.port.back();
      return;
    }
    if (landed.kind !== 'layer') landed.onPop?.();
  }
}

/** Puerto real sobre `window.history`. */
export function browserHistoryPort(): HistoryPort {
  return {
    get state() {
      return window.history.state;
    },
    pushState: (state, title) => window.history.pushState(state, title),
    replaceState: (state, title) => window.history.replaceState(state, title),
    back: () => window.history.back(),
    onPop: (handler) => {
      const listener = (event: PopStateEvent) => handler(event.state);
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
  };
}

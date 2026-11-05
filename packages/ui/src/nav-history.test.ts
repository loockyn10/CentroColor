import { describe, expect, it } from 'vitest';
import { NavHistory, type HistoryPort } from './nav-history';

/** Historial del navegador simulado: entradas, índice y `back()` que emite `popstate`. */
class FakeHistory implements HistoryPort {
  entries: unknown[] = [null];
  index = 0;
  private handler: ((state: unknown) => void) | null = null;
  get state() {
    return this.entries[this.index];
  }
  pushState(state: unknown) {
    this.entries.splice(this.index + 1);
    this.entries.push(state);
    this.index++;
  }
  replaceState(state: unknown) {
    this.entries[this.index] = state;
  }
  back() {
    if (this.index === 0) return; // salir de la app: aquí no hay a dónde volver
    this.index--;
    this.handler?.(this.entries[this.index]);
  }
  /** Botón Atrás del navegador. */
  userBack() {
    this.back();
  }
  onPop(handler: (state: unknown) => void) {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }
}

function setup() {
  const history = new FakeHistory();
  const nav = new NavHistory(history);
  const visited: string[] = [];
  nav.start('home', (id) => visited.push(id));
  return { history, nav, visited };
}

describe('NavHistory', () => {
  it('Atrás cierra la capa abierta en vez de salir de la app', () => {
    const { history, nav } = setup();
    nav.pushModule('sales');
    let closed = 0;
    nav.pushLayer(() => closed++);
    expect(history.index).toBe(2);
    history.userBack();
    expect(closed).toBe(1);
    expect(history.index).toBe(1); // sigue en Ventas, dentro de la app
  });

  it('Atrás vuelve al módulo anterior', () => {
    const { history, nav, visited } = setup();
    nav.pushModule('sales');
    nav.pushModule('customers');
    history.userBack();
    expect(visited.at(-1)).toBe('sales');
    history.userBack();
    expect(visited.at(-1)).toBe('home');
  });

  it('una capa cerrada por la app retira su entrada del historial', () => {
    const { history, nav } = setup();
    nav.pushModule('sales');
    const layer = nav.pushLayer(() => undefined);
    nav.releaseLayer(layer);
    expect(history.index).toBe(1);
    expect(nav.depth).toBe(2);
  });

  it('una capa cerrada por la app que ya no es la última se salta al volver', () => {
    const { history, nav, visited } = setup();
    nav.pushModule('sales');
    const layer = nav.pushLayer(() => undefined);
    // el usuario cambia de módulo con la capa abierta: la capa se desmonta después
    nav.pushModule('customers');
    nav.releaseLayer(layer);
    history.userBack(); // Clientes → entrada muerta de la capa → se sigue hacia Ventas
    expect(visited.at(-1)).toBe('sales');
    expect(history.index).toBe(1);
  });

  it('con dos capas, Atrás las cierra una por una (la más nueva primero)', () => {
    const { history, nav } = setup();
    const order: string[] = [];
    nav.pushLayer(() => order.push('lista'));
    nav.pushLayer(() => order.push('editor'));
    history.userBack();
    history.userBack();
    expect(order).toEqual(['editor', 'lista']);
  });

  it('ignora entradas desconocidas (recarga, Adelante) sin tocar la pantalla', () => {
    const { history, nav, visited } = setup();
    nav.pushModule('sales');
    history.entries[0] = { 'cc-nav': 999 };
    history.userBack();
    expect(visited).toEqual([]);
  });

  it('no apila el mismo módulo dos veces seguidas', () => {
    const { history, nav } = setup();
    nav.pushModule('sales');
    nav.pushModule('sales');
    expect(history.index).toBe(1);
  });
});

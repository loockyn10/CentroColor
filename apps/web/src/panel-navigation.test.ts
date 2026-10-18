import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AppShell,
  moduleFor,
  navGroups,
  navModules,
  navigation,
} from '@centrocolor/ui';

/** Rutas del panel antes de DESIGN-02 (sidebar plana de 22 entradas). Ninguna se puede perder. */
const legacyViews = [
  'home',
  'new-sale',
  'sales',
  'new-photo-job',
  'photo-jobs',
  'photo-production',
  'photo-services',
  'calendar',
  'appointments',
  'appointment-types',
  'events',
  'resource-calendar',
  'new-quote',
  'frame-jobs',
  'mouldings',
  'materials',
  'customers',
  'products',
  'services',
  'resources',
  'stock',
  'settings',
];

const render = (activeId: string, extra = {}) =>
  renderToStaticMarkup(
    createElement(AppShell, {
      activeId,
      onNavigate: () => undefined,
      platform: 'Web',
      onLogout: () => undefined,
      ...extra,
      children: createElement('p', null, 'contenido'),
    }),
  );

describe('navegación del panel (DESIGN-02)', () => {
  it('conserva todas las vistas que existían', () => {
    const reachable = new Set(navigation.map((item) => item.id));
    for (const id of legacyViews) expect(reachable.has(id)).toBe(true);
    expect(reachable.has('payments')).toBe(true);
  });

  it('agrupa los módulos como en la preview aprobada', () => {
    expect(navGroups).toEqual([
      'Hoy',
      'Mostrador',
      'Taller',
      'Agenda',
      'Catálogo',
      'Sistema',
    ]);
    expect(navModules.map((module) => module.label)).toEqual([
      'Inicio',
      'Cobrar · POS',
      'Clientes',
      'Cobros',
      'Trabajos',
      'Producción',
      'Marquetería',
      'Agenda y turnos',
      'Eventos y recursos',
      'Productos',
      'Configuración',
    ]);
  });

  it('cada vista pertenece a un único módulo y se puede resolver', () => {
    const seen = new Set<string>();
    for (const module of navModules)
      for (const sub of module.subs) {
        expect(seen.has(sub.id)).toBe(false);
        seen.add(sub.id);
        expect(moduleFor(sub.id)?.id).toBe(module.id);
      }
  });

  it('las sub-vistas (Servicios, Nuevo trabajo, Varillas…) cuelgan de su módulo', () => {
    expect(moduleFor('photo-services')?.id).toBe('photo-jobs');
    expect(moduleFor('new-photo-job')?.id).toBe('photo-jobs');
    expect(moduleFor('mouldings')?.id).toBe('frame-jobs');
    expect(moduleFor('resources')?.id).toBe('events');
    expect(moduleFor('stock')?.id).toBe('products');
    expect(moduleFor('sales')?.id).toBe('new-sale');
  });
});

describe('shell responsive', () => {
  it('renderiza barra lateral, tab bar de 5 y contenido', () => {
    const html = render('home');
    for (const label of [
      'Cobrar · POS',
      'Clientes',
      'Cobros',
      'Producción',
      'Marquetería',
      'Agenda y turnos',
      'Eventos y recursos',
      'Configuración',
    ])
      expect(html).toContain(label);
    expect(html).toContain('class="tabbar"');
    expect(html.match(/class="tab"/g)).toHaveLength(5);
    expect(html).toContain('id="contenido"');
    expect(html).toContain('contenido</p>');
  });

  it('marca el módulo activo y muestra sus pestañas', () => {
    const html = render('mouldings');
    expect(html).toContain('aria-label="Marquetería"');
    expect(html).toContain('Varillas');
    expect(html).toContain('Nueva cotización');
    expect(html).toMatch(/aria-current="page"[^>]*>Varillas/);
  });

  it('sólo muestra contadores cuando hay atención real', () => {
    expect(render('home')).not.toContain('nav-count');
    const html = render('home', {
      badges: {
        'photo-jobs': { count: 3, tone: 'alert', label: 'atrasados' },
        payments: { count: 0, tone: 'attention', label: 'con saldo' },
      },
    });
    expect(html).toContain('nav-count nav-count--alert');
    expect(html).toContain('atrasados');
    expect(html).not.toContain('con saldo');
  });
});

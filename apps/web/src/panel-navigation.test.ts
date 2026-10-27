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

/** IDs internos históricos. La reorganización funcional no puede perder ninguno. */
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

describe('navegación funcional del panel', () => {
  it('conserva todas las vistas que existían', () => {
    const reachable = new Set(navigation.map((item) => item.id));
    for (const id of legacyViews) expect(reachable.has(id)).toBe(true);
    expect(reachable.has('payments')).toBe(true);
  });

  it('agrupa las tareas por área del negocio', () => {
    expect(navGroups).toEqual([
      'Inicio',
      'Mostrador',
      'Laboratorio',
      'Servicios',
      'Taller',
      'Configuración',
    ]);
    expect(navModules.map((module) => module.label)).toEqual([
      'Inicio',
      'Nueva venta',
      'Ventas',
      'Clientes',
      'Cobros',
      'Stock',
      'Pedidos',
      'Nuevo pedido',
      'Producción',
      'Presupuestos y reservas',
      'Agenda',
      'Plotter',
      'Marquetería',
      'Productos',
      'Servicios y precios',
      'Listas de precios',
      'Materiales',
      'Recursos',
      'Tipos y parámetros',
      'Integraciones',
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

  it('redistribuye operación y configuración sin cambiar IDs', () => {
    expect(moduleFor('photo-services')?.id).toBe('services');
    expect(moduleFor('services')?.id).toBe('services');
    expect(moduleFor('price-lists')?.id).toBe('price-lists');
    expect(moduleFor('plotter')?.id).toBe('plotter');
    expect(moduleFor('new-photo-job')?.id).toBe('new-photo-job');
    expect(moduleFor('plotter-materials')?.id).toBe('plotter-materials');
    expect(moduleFor('mouldings')?.id).toBe('plotter-materials');
    expect(moduleFor('materials')?.id).toBe('plotter-materials');
    expect(moduleFor('resources')?.id).toBe('resources');
    expect(moduleFor('stock')?.id).toBe('stock');
    expect(moduleFor('sales')?.id).toBe('sales');
    expect(moduleFor('resource-calendar')?.id).toBe('calendar');
    expect(moduleFor('appointment-types')?.id).toBe('appointment-types');
  });
});

describe('shell responsive', () => {
  it('renderiza barra lateral, tab bar de 5 y contenido', () => {
    const html = render('home');
    for (const label of [
      'Nueva venta',
      'Ventas',
      'Clientes',
      'Cobros',
      'Pedidos',
      'Producción',
      'Marquetería',
      'Agenda',
      'Presupuestos y reservas',
      'Servicios y precios',
      'Integraciones',
    ])
      expect(html).toContain(label);
    expect(html).toContain('class="tabbar"');
    expect(html.match(/class="tab"/g)).toHaveLength(5);
    expect(html).toContain('id="contenido"');
    expect(html).toContain('contenido</p>');
  });

  it('marca el módulo activo y muestra sus pestañas', () => {
    const html = render('mouldings');
    expect(html).toContain('aria-label="Materiales"');
    expect(html).toContain('Varillas');
    expect(html).toContain('Otros materiales');
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

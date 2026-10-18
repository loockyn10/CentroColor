import type { IconName } from './icons';

export interface NavSub {
  id: string;
  label: string;
}

/** Un módulo del panel (DESIGN-02). El primer `subs` es la vista principal del módulo. */
export interface NavModule {
  id: string;
  label: string;
  short: string;
  icon: IconName;
  group: string;
  subs: NavSub[];
}

export interface NavigationItem {
  id: string;
  label: string;
}

export const navModules: NavModule[] = [
  {
    id: 'home',
    label: 'Inicio',
    short: 'Inicio',
    icon: 'home',
    group: 'Hoy',
    subs: [{ id: 'home', label: 'Inicio' }],
  },
  {
    id: 'new-sale',
    label: 'Cobrar · POS',
    short: 'Cobrar',
    icon: 'cart',
    group: 'Mostrador',
    subs: [
      { id: 'new-sale', label: 'Nueva venta' },
      { id: 'sales', label: 'Ventas' },
    ],
  },
  {
    id: 'customers',
    label: 'Clientes',
    short: 'Clientes',
    icon: 'users',
    group: 'Mostrador',
    subs: [{ id: 'customers', label: 'Clientes' }],
  },
  {
    id: 'payments',
    label: 'Cobros',
    short: 'Cobros',
    icon: 'wallet',
    group: 'Mostrador',
    subs: [{ id: 'payments', label: 'Cobros' }],
  },
  {
    id: 'photo-jobs',
    label: 'Trabajos',
    short: 'Trabajos',
    icon: 'camera',
    group: 'Taller',
    subs: [
      { id: 'photo-jobs', label: 'Trabajos' },
      { id: 'new-photo-job', label: 'Nuevo trabajo' },
      { id: 'photo-services', label: 'Servicios' },
    ],
  },
  {
    id: 'photo-production',
    label: 'Producción',
    short: 'Producción',
    icon: 'printer',
    group: 'Taller',
    subs: [{ id: 'photo-production', label: 'Producción' }],
  },
  {
    id: 'frame-jobs',
    label: 'Marquetería',
    short: 'Marcos',
    icon: 'frame',
    group: 'Taller',
    subs: [
      { id: 'frame-jobs', label: 'Trabajos' },
      { id: 'new-quote', label: 'Nueva cotización' },
      { id: 'mouldings', label: 'Varillas' },
      { id: 'materials', label: 'Materiales' },
    ],
  },
  {
    id: 'calendar',
    label: 'Agenda y turnos',
    short: 'Agenda',
    icon: 'calendar',
    group: 'Agenda',
    subs: [
      { id: 'calendar', label: 'Calendario' },
      { id: 'appointments', label: 'Turnos' },
      { id: 'appointment-types', label: 'Tipos de turno' },
    ],
  },
  {
    id: 'events',
    label: 'Eventos y recursos',
    short: 'Eventos',
    icon: 'star',
    group: 'Agenda',
    subs: [
      { id: 'events', label: 'Eventos' },
      { id: 'resource-calendar', label: 'Disponibilidad' },
      { id: 'resources', label: 'Recursos' },
    ],
  },
  {
    id: 'products',
    label: 'Productos',
    short: 'Stock',
    icon: 'box',
    group: 'Catálogo',
    subs: [
      { id: 'products', label: 'Productos' },
      { id: 'stock', label: 'Stock' },
    ],
  },
  {
    id: 'settings',
    label: 'Configuración',
    short: 'Ajustes',
    icon: 'sliders',
    group: 'Sistema',
    subs: [{ id: 'settings', label: 'Configuración' }],
  },
];

/**
 * Todas las vistas alcanzables, planas. `services` (Catálogo → Servicios) sigue siendo una ruta
 * válida —muestra la página «en preparación»— aunque ya no tenga entrada en el menú.
 */
export const navigation: NavigationItem[] = [
  ...navModules.flatMap((module) => module.subs),
  { id: 'services', label: 'Servicios' },
];

export const moduleFor = (viewId: string): NavModule | undefined =>
  navModules.find((module) => module.subs.some((sub) => sub.id === viewId));

export const navGroups = [...new Set(navModules.map((module) => module.group))];

/** Contador de atención de un módulo. `alert` sólo cuando algo ya venció. */
export type NavBadges = Partial<
  Record<string, { count: number; tone: 'attention' | 'alert'; label: string }>
>;

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
    group: 'Inicio',
    subs: [{ id: 'home', label: 'Inicio' }],
  },
  {
    id: 'new-sale',
    label: 'Nueva venta',
    short: 'Vender',
    icon: 'cart',
    group: 'Mostrador',
    subs: [{ id: 'new-sale', label: 'Nueva venta' }],
  },
  {
    id: 'sales',
    label: 'Ventas',
    short: 'Ventas',
    icon: 'receipt',
    group: 'Mostrador',
    subs: [{ id: 'sales', label: 'Ventas' }],
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
    id: 'stock',
    label: 'Stock',
    short: 'Stock',
    icon: 'box',
    group: 'Mostrador',
    subs: [{ id: 'stock', label: 'Stock' }],
  },
  {
    id: 'photo-jobs',
    label: 'Pedidos',
    short: 'Pedidos',
    icon: 'camera',
    group: 'Laboratorio',
    subs: [{ id: 'photo-jobs', label: 'Pedidos' }],
  },
  {
    id: 'new-photo-job',
    label: 'Nuevo pedido',
    short: 'Nuevo pedido',
    icon: 'plus',
    group: 'Laboratorio',
    subs: [{ id: 'new-photo-job', label: 'Nuevo pedido' }],
  },
  {
    id: 'photo-production',
    label: 'Producción',
    short: 'Producción',
    icon: 'printer',
    group: 'Laboratorio',
    subs: [{ id: 'photo-production', label: 'Producción' }],
  },
  {
    id: 'events',
    label: 'Presupuestos y reservas',
    short: 'Reservas',
    icon: 'star',
    group: 'Servicios',
    subs: [{ id: 'events', label: 'Presupuestos y reservas' }],
  },
  {
    id: 'calendar',
    label: 'Agenda',
    short: 'Agenda',
    icon: 'calendar',
    group: 'Servicios',
    subs: [
      { id: 'calendar', label: 'Calendario' },
      { id: 'appointments', label: 'Turnos' },
      { id: 'resource-calendar', label: 'Disponibilidad' },
    ],
  },
  {
    id: 'plotter',
    label: 'Plotter',
    short: 'Plotter',
    icon: 'ruler',
    group: 'Taller',
    subs: [{ id: 'plotter', label: 'Cotizaciones' }],
  },
  {
    id: 'frame-jobs',
    label: 'Marquetería',
    short: 'Marcos',
    icon: 'frame',
    group: 'Taller',
    subs: [
      { id: 'frame-jobs', label: 'Trabajos y presupuestos' },
      { id: 'new-quote', label: 'Nueva cotización' },
    ],
  },
  {
    id: 'products',
    label: 'Productos',
    short: 'Productos',
    icon: 'store',
    group: 'Configuración',
    subs: [{ id: 'products', label: 'Productos' }],
  },
  {
    id: 'services',
    label: 'Precios',
    short: 'Precios',
    icon: 'cash',
    group: 'Configuración',
    subs: [{ id: 'services', label: 'Precios' }],
  },
  {
    id: 'plotter-materials',
    label: 'Materiales',
    short: 'Materiales',
    icon: 'layers',
    group: 'Configuración',
    subs: [
      { id: 'plotter-materials', label: 'Plotter' },
      { id: 'mouldings', label: 'Varillas' },
      { id: 'materials', label: 'Otros materiales' },
    ],
  },
  {
    id: 'resources',
    label: 'Recursos',
    short: 'Recursos',
    icon: 'bolt',
    group: 'Configuración',
    subs: [{ id: 'resources', label: 'Recursos' }],
  },
  {
    id: 'appointment-types',
    label: 'Tipos y parámetros',
    short: 'Parámetros',
    icon: 'sliders',
    group: 'Configuración',
    subs: [{ id: 'appointment-types', label: 'Tipos y parámetros' }],
  },
  {
    id: 'settings',
    label: 'Integraciones',
    short: 'Integraciones',
    icon: 'link',
    group: 'Configuración',
    subs: [{ id: 'settings', label: 'Integraciones' }],
  },
];

/** Todas las vistas alcanzables, planas. */
export const navigation: NavigationItem[] = [
  ...navModules.flatMap((module) => module.subs),
  // Rutas históricas: siguen siendo resolubles pero no generan entradas visibles.
  { id: 'photo-services', label: 'Servicios fotográficos' },
  { id: 'price-lists', label: 'Listas de precios' },
];

export const moduleFor = (viewId: string): NavModule | undefined => {
  const direct = navModules.find((module) =>
    module.subs.some((sub) => sub.id === viewId),
  );
  if (direct) return direct;
  if (viewId === 'photo-services' || viewId === 'price-lists')
    return navModules.find((module) => module.id === 'services');
  return undefined;
};

export const navGroups = [...new Set(navModules.map((module) => module.group))];

/** Contador de atención de un módulo. `alert` sólo cuando algo ya venció. */
export type NavBadges = Partial<
  Record<string, { count: number; tone: 'attention' | 'alert'; label: string }>
>;

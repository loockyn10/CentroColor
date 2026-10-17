import type { IconName } from './icons';

// ───────────────────────── Datos 100 % simulados ─────────────────────────
// Nada de esto toca Supabase, SQLite ni ninguna API: son mocks para evaluar el diseño.

/** «Hoy» de la preview: jueves 22 de octubre de 2026. */
export const TODAY = new Date(2026, 9, 22);
export const TODAY_LABEL = 'Jueves 22 de octubre';

export const ars = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');

export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const BANK_ALIAS = 'CENTROCOLORESPERANZA';
export const STORE = {
  name: 'CentroColor',
  tagline: 'Laboratorio fotográfico · Marquetería',
  city: 'Esperanza, Santa Fe',
  address: 'Av. San Martín 1234 (dirección ficticia)',
  hours: 'Lun a Vie 8:30–12:30 y 16–20 · Sáb 9–13',
  whatsapp: '+54 9 3496 55-1234',
};

// ───────────────────────── Catálogo público ─────────────────────────

export interface PrintSize {
  id: string;
  name: string; // «10×15»
  wCm: number;
  hCm: number;
  tagline: string;
  price: number;
  badge?: string;
  polaroid?: boolean;
}

// Precios de ejemplo (ARS). 20 copias 10×15 + 2 ampliaciones 20×30 = $18.500.
export const PRINT_SIZES: PrintSize[] = [
  {
    id: 's1015',
    name: '10×15',
    wCm: 10,
    hCm: 15,
    tagline: 'La clásica',
    price: 450,
  },
  {
    id: 's1318',
    name: '13×18',
    wCm: 13,
    hCm: 18,
    tagline: 'Para el álbum',
    price: 800,
  },
  {
    id: 's1521',
    name: '15×21',
    wCm: 15,
    hCm: 21,
    tagline: 'Para enmarcar',
    price: 1250,
  },
  {
    id: 's2030',
    name: '20×30',
    wCm: 20,
    hCm: 30,
    tagline: 'Ampliación',
    price: 4750,
  },
  {
    id: 's3045',
    name: '30×45',
    wCm: 30,
    hCm: 45,
    tagline: 'Póster',
    price: 11900,
  },
  {
    id: 'spola',
    name: 'Polaroid',
    wCm: 8.8,
    hCm: 10.7,
    tagline: 'Con borde blanco',
    price: 950,
    badge: 'Personalizable',
    polaroid: true,
  },
];

// ───────────────────────── Trabajos ─────────────────────────

export type JobStatus =
  'awaiting_payment' | 'received' | 'in_progress' | 'ready' | 'delivered';

export type Tone =
  | 'neutral'
  | 'yellow'
  | 'amber'
  | 'ink'
  | 'red'
  | 'red-soft'
  | 'green'
  | 'blue';

export const JOB_FLOW: JobStatus[] = [
  'awaiting_payment',
  'received',
  'in_progress',
  'ready',
  'delivered',
];

export const STATUS_META: Record<
  JobStatus,
  { internal: string; public: string; tone: Tone; icon: IconName }
> = {
  awaiting_payment: {
    internal: 'Esperando transferencia',
    public: 'Esperando transferencia',
    tone: 'amber',
    icon: 'hourglass',
  },
  received: {
    internal: 'Recibido',
    public: 'Pago confirmado',
    tone: 'blue',
    icon: 'check',
  },
  in_progress: {
    internal: 'En proceso',
    public: 'En preparación',
    tone: 'yellow',
    icon: 'printer',
  },
  ready: {
    internal: 'Listo',
    public: 'Listo para retirar',
    tone: 'green',
    icon: 'check',
  },
  delivered: {
    internal: 'Entregado',
    public: 'Entregado',
    tone: 'neutral',
    icon: 'store',
  },
};

export type Lane = 'lab' | 'edicion';
export type Origin = 'web' | 'mostrador' | 'telefono';

export interface JobLine {
  label: string;
  qty: number; // fotos distintas
  copies: number; // copias totales
  price: number; // subtotal
}

export interface Job {
  id: string; // código visible
  customer: string;
  phone: string;
  origin: Origin;
  lane: Lane;
  title: string;
  lines: JobLine[];
  total: number;
  paid: number;
  status: JobStatus;
  urgent: boolean;
  dueIn: number; // días desde hoy (negativo = vencido)
  drive: 'ok' | 'pending' | 'none';
  files: number;
  created: string;
  notes?: string;
  whatsapp: 'none' | 'sent' | 'queued';
  queuedPrint?: boolean;
}

export const jobCopies = (j: Job) => j.lines.reduce((s, l) => s + l.copies, 0);
export const jobQty = (j: Job) => j.lines.reduce((s, l) => s + l.qty, 0);
export const jobBalance = (j: Job) => Math.max(0, j.total - j.paid);
export const jobIsPaid = (j: Job) => j.paid >= j.total;
export const jobIsLate = (j: Job) =>
  j.dueIn < 0 && j.status !== 'ready' && j.status !== 'delivered';

export function dueLabel(days: number) {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days === -1) return 'Ayer';
  if (days < 0) return `Hace ${-days} días`;
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export const DEMO_JOB_ID = 'CC-4F7K2';

export const jobsSeed: Job[] = [
  {
    id: DEMO_JOB_ID,
    customer: 'María González',
    phone: '+54 9 3496 41-2231',
    origin: 'web',
    lane: 'lab',
    title: '20 fotos 10×15 + 2 ampliaciones 20×30',
    lines: [
      { label: '10×15', qty: 6, copies: 20, price: 9000 },
      { label: '20×30', qty: 2, copies: 2, price: 9500 },
    ],
    total: 18500,
    paid: 0,
    status: 'awaiting_payment',
    urgent: false,
    dueIn: 2,
    drive: 'ok',
    files: 8,
    created: 'Hace 12 min',
    whatsapp: 'none',
  },
  {
    id: 'CC-6R4ZW',
    customer: 'Marcos Ríos',
    phone: '+54 9 3496 52-8800',
    origin: 'web',
    lane: 'lab',
    title: '30 fotos 10×15',
    lines: [{ label: '10×15', qty: 30, copies: 30, price: 13500 }],
    total: 13500,
    paid: 0,
    status: 'awaiting_payment',
    urgent: false,
    dueIn: 2,
    drive: 'ok',
    files: 30,
    created: 'Hace 40 min',
    whatsapp: 'none',
  },
  {
    id: 'CC-9D2NB',
    customer: 'Estudio Fernández',
    phone: '+54 9 342 455-1020',
    origin: 'web',
    lane: 'lab',
    title: '86 fotos 13×18 · egresados',
    lines: [{ label: '13×18', qty: 86, copies: 86, price: 68800 }],
    total: 68800,
    paid: 68800,
    status: 'in_progress',
    urgent: true,
    dueIn: 0,
    drive: 'ok',
    files: 86,
    created: 'Ayer 17:40',
    notes: 'Entregar en sobres por curso. Pidió papel mate.',
    whatsapp: 'none',
  },
  {
    id: 'CC-5T2VN',
    customer: 'Federico López',
    phone: '+54 9 3496 60-3347',
    origin: 'web',
    lane: 'lab',
    title: 'Polaroids ×12',
    lines: [{ label: 'Polaroid', qty: 12, copies: 12, price: 11400 }],
    total: 11400,
    paid: 11400,
    status: 'received',
    urgent: false,
    dueIn: 2,
    drive: 'ok',
    files: 12,
    created: 'Hoy 9:15',
    whatsapp: 'none',
  },
  {
    id: 'CC-3M9QP',
    customer: 'Juan Pérez',
    phone: '+54 9 3496 47-9012',
    origin: 'mostrador',
    lane: 'edicion',
    title: 'Restauración foto antigua',
    lines: [{ label: 'Restauración', qty: 1, copies: 1, price: 24000 }],
    total: 24000,
    paid: 12000,
    status: 'in_progress',
    urgent: false,
    dueIn: 3,
    drive: 'ok',
    files: 1,
    created: 'Lun 19/10',
    notes: 'Foto de 1950, con rasgaduras. Imprimir 20×30 al terminar.',
    whatsapp: 'none',
  },
  {
    id: 'CC-8K3EM',
    customer: 'Rosa Aguirre',
    phone: '+54 9 3496 44-7765',
    origin: 'telefono',
    lane: 'edicion',
    title: 'Digitalizar 40 diapositivas + retoque',
    lines: [{ label: 'Digitalizado', qty: 40, copies: 40, price: 32000 }],
    total: 32000,
    paid: 16000,
    status: 'in_progress',
    urgent: false,
    dueIn: -2,
    drive: 'pending',
    files: 28,
    created: 'Mar 13/10',
    notes: 'Faltan 12 diapositivas por escanear.',
    whatsapp: 'none',
  },
  {
    id: 'CC-1B7HC',
    customer: 'Lucía Benítez',
    phone: '+54 9 3496 58-1190',
    origin: 'web',
    lane: 'edicion',
    title: 'Retoque de carnet + 4 fotos 15×21',
    lines: [
      { label: 'Retoque', qty: 1, copies: 1, price: 3700 },
      { label: '15×21', qty: 4, copies: 4, price: 5000 },
    ],
    total: 8700,
    paid: 8700,
    status: 'received',
    urgent: true,
    dueIn: 1,
    drive: 'ok',
    files: 5,
    created: 'Hoy 10:02',
    whatsapp: 'none',
  },
  {
    id: 'CC-7P1QD',
    customer: 'Camila Sosa',
    phone: '+54 9 3496 49-3021',
    origin: 'web',
    lane: 'lab',
    title: '12 fotos 15×21 · cumple de 15',
    lines: [{ label: '15×21', qty: 12, copies: 12, price: 15000 }],
    total: 15000,
    paid: 15000,
    status: 'ready',
    urgent: false,
    dueIn: 0,
    drive: 'ok',
    files: 12,
    created: 'Mar 20/10',
    whatsapp: 'sent',
  },
  {
    id: 'CC-2X8LD',
    customer: 'Daniel Ferreyra',
    phone: '+54 9 3496 43-5518',
    origin: 'mostrador',
    lane: 'lab',
    title: '1 ampliación 20×30',
    lines: [{ label: '20×30', qty: 1, copies: 1, price: 4750 }],
    total: 4750,
    paid: 0,
    status: 'ready',
    urgent: false,
    dueIn: 0,
    drive: 'ok',
    files: 1,
    created: 'Hoy 8:50',
    whatsapp: 'queued',
  },
  {
    id: 'CC-0A5SY',
    customer: 'Panadería La Esperanza',
    phone: '+54 9 3496 42-0987',
    origin: 'mostrador',
    lane: 'lab',
    title: '3 ampliaciones 30×45',
    lines: [{ label: '30×45', qty: 3, copies: 3, price: 35700 }],
    total: 35700,
    paid: 17850,
    status: 'ready',
    urgent: false,
    dueIn: -1,
    drive: 'ok',
    files: 3,
    created: 'Lun 19/10',
    whatsapp: 'sent',
  },
  {
    id: 'CC-4Q6WT',
    customer: 'Estudio Fernández',
    phone: '+54 9 342 455-1020',
    origin: 'web',
    lane: 'lab',
    title: '50 fotos 10×15',
    lines: [{ label: '10×15', qty: 50, copies: 50, price: 22500 }],
    total: 22500,
    paid: 22500,
    status: 'delivered',
    urgent: false,
    dueIn: -4,
    drive: 'ok',
    files: 50,
    created: 'Dom 18/10',
    whatsapp: 'sent',
  },
  {
    id: 'CC-3H8RF',
    customer: 'Gabriela Molina',
    phone: '+54 9 3496 56-4410',
    origin: 'web',
    lane: 'lab',
    title: 'Polaroids ×8',
    lines: [{ label: 'Polaroid', qty: 8, copies: 8, price: 7600 }],
    total: 7600,
    paid: 7600,
    status: 'delivered',
    urgent: false,
    dueIn: -3,
    drive: 'ok',
    files: 8,
    created: 'Lun 19/10',
    whatsapp: 'sent',
  },
];

// ───────────────────────── Clientes ─────────────────────────

export interface Customer {
  id: string;
  name: string;
  kind: 'Persona' | 'Empresa';
  phone: string;
  email?: string;
  since: string;
  notes?: string;
  purchases: { date: string; what: string; amount: number }[];
}

export const customers: Customer[] = [
  {
    id: 'c1',
    name: 'María González',
    kind: 'Persona',
    phone: '+54 9 3496 41-2231',
    email: 'maria.gonzalez@example.com',
    since: 'Cliente desde 2019',
    notes: 'Prefiere papel brillante. Retira siempre a la tarde.',
    purchases: [
      { date: '12/09/2026', what: 'Marco 13×18 negro', amount: 6200 },
      { date: '03/07/2026', what: '40 fotos 10×15', amount: 17600 },
      { date: '21/12/2025', what: 'Álbum 200 fotos', amount: 14900 },
    ],
  },
  {
    id: 'c2',
    name: 'Juan Pérez',
    kind: 'Persona',
    phone: '+54 9 3496 47-9012',
    email: 'juanperez@example.com',
    since: 'Cliente desde 2022',
    notes: 'Trae fotos familiares antiguas para restaurar.',
    purchases: [
      {
        date: '19/10/2026',
        what: 'Restauración foto antigua (seña)',
        amount: 12000,
      },
      { date: '02/03/2026', what: 'Enmarcado 30×40', amount: 18400 },
    ],
  },
  {
    id: 'c3',
    name: 'Estudio Fernández',
    kind: 'Empresa',
    phone: '+54 9 342 455-1020',
    email: 'contacto@estudiofernandez.example',
    since: 'Cliente desde 2017',
    notes: 'Estudio de fotografía escolar. Factura A. Pide papel mate.',
    purchases: [
      { date: '18/10/2026', what: '50 fotos 10×15', amount: 22500 },
      { date: '30/09/2026', what: '120 fotos 13×18', amount: 96000 },
      {
        date: '11/09/2026',
        what: 'Evento: sesión institucional',
        amount: 150000,
      },
    ],
  },
  {
    id: 'c4',
    name: 'Federico López',
    kind: 'Persona',
    phone: '+54 9 3496 60-3347',
    since: 'Cliente desde 2026',
    purchases: [{ date: '22/10/2026', what: 'Polaroids ×12', amount: 11400 }],
  },
  {
    id: 'c5',
    name: 'Lucía Benítez',
    kind: 'Persona',
    phone: '+54 9 3496 58-1190',
    email: 'lucia.benitez@example.com',
    since: 'Cliente desde 2024',
    purchases: [
      { date: '22/10/2026', what: 'Retoque carnet + 4 fotos', amount: 8700 },
    ],
  },
  {
    id: 'c6',
    name: 'Panadería La Esperanza',
    kind: 'Empresa',
    phone: '+54 9 3496 42-0987',
    since: 'Cliente desde 2015',
    notes: 'Cartelería para el local. Cuenta corriente informal.',
    purchases: [
      { date: '19/10/2026', what: '3 ampliaciones 30×45', amount: 35700 },
    ],
  },
  {
    id: 'c7',
    name: 'Rosa Aguirre',
    kind: 'Persona',
    phone: '+54 9 3496 44-7765',
    since: 'Cliente desde 2020',
    purchases: [
      {
        date: '13/10/2026',
        what: 'Digitalizar diapositivas (seña)',
        amount: 16000,
      },
    ],
  },
  {
    id: 'c8',
    name: 'Daniel Ferreyra',
    kind: 'Persona',
    phone: '+54 9 3496 43-5518',
    since: 'Cliente desde 2021',
    purchases: [
      { date: '22/10/2026', what: '1 ampliación 20×30', amount: 4750 },
    ],
  },
];

// ───────────────────────── Productos / stock ─────────────────────────

export interface Product {
  id: string;
  name: string;
  category:
    'Marcos' | 'Álbumes' | 'Insumos' | 'Memoria' | 'Cámaras' | 'Servicios';
  sku: string;
  barcode: string;
  price: number;
  stock: number | null; // null = no controla stock
  min: number;
  color: string; // color de ilustración
}

export const products: Product[] = [
  {
    id: 'p1',
    name: 'Portarretrato 13×18 negro',
    category: 'Marcos',
    sku: 'MAR-1318N',
    barcode: '7791234500011',
    price: 6200,
    stock: 14,
    min: 5,
    color: '#26231e',
  },
  {
    id: 'p2',
    name: 'Portarretrato 15×21 madera',
    category: 'Marcos',
    sku: 'MAR-1521M',
    barcode: '7791234500028',
    price: 8900,
    stock: 3,
    min: 4,
    color: '#b07a3a',
  },
  {
    id: 'p3',
    name: 'Portarretrato 10×15 dorado',
    category: 'Marcos',
    sku: 'MAR-1015D',
    barcode: '7791234500035',
    price: 4300,
    stock: 0,
    min: 4,
    color: '#e0b030',
  },
  {
    id: 'p4',
    name: 'Álbum 200 fotos 10×15',
    category: 'Álbumes',
    sku: 'ALB-200',
    barcode: '7791234500042',
    price: 14900,
    stock: 9,
    min: 3,
    color: '#a3232e',
  },
  {
    id: 'p5',
    name: 'Álbum autoadhesivo 20 hojas',
    category: 'Álbumes',
    sku: 'ALB-ADH20',
    barcode: '7791234500059',
    price: 7800,
    stock: 6,
    min: 3,
    color: '#2f5d8a',
  },
  {
    id: 'p6',
    name: 'Pilas AA ×4',
    category: 'Insumos',
    sku: 'PIL-AA4',
    barcode: '7791234500066',
    price: 3900,
    stock: 40,
    min: 12,
    color: '#f2b100',
  },
  {
    id: 'p7',
    name: 'Papel fotográfico A4 ×20',
    category: 'Insumos',
    sku: 'PAP-A4-20',
    barcode: '7791234500073',
    price: 6500,
    stock: 2,
    min: 6,
    color: '#e8ddbd',
  },
  {
    id: 'p8',
    name: 'Tarjeta SD 64 GB',
    category: 'Memoria',
    sku: 'SD-64',
    barcode: '7791234500080',
    price: 11500,
    stock: 12,
    min: 4,
    color: '#3a362f',
  },
  {
    id: 'p9',
    name: 'Pendrive 32 GB',
    category: 'Memoria',
    sku: 'USB-32',
    barcode: '7791234500097',
    price: 7400,
    stock: 18,
    min: 6,
    color: '#5b7f95',
  },
  {
    id: 'p10',
    name: 'Rollo 35 mm ISO 200 ×36',
    category: 'Insumos',
    sku: 'ROL-200',
    barcode: '7791234500103',
    price: 8200,
    stock: 22,
    min: 8,
    color: '#ffc914',
  },
  {
    id: 'p11',
    name: 'Cámara descartable 27 fotos',
    category: 'Cámaras',
    sku: 'CAM-DESC',
    barcode: '7791234500110',
    price: 24900,
    stock: 5,
    min: 3,
    color: '#d7263d',
  },
  {
    id: 'p12',
    name: 'Fotos carnet 4×4 (×6)',
    category: 'Servicios',
    sku: 'SRV-CARNET',
    barcode: '7791234500127',
    price: 3500,
    stock: null,
    min: 0,
    color: '#8a8372',
  },
];

// ───────────────────────── Agenda ─────────────────────────

export type ApptStatus = 'programado' | 'completado' | 'ausente' | 'cancelado';
export interface Appointment {
  id: string;
  day: number; // 0 = lunes 19/10 … 5 = sábado 24/10
  start: string; // HH:MM
  minutes: number;
  customer: string;
  type: string;
  status: ApptStatus;
  notes?: string;
}

export const WEEK_DAYS = [
  'Lun 19',
  'Mar 20',
  'Mié 21',
  'Jue 22',
  'Vie 23',
  'Sáb 24',
];
export const TODAY_INDEX = 3;

export const apptSeed: Appointment[] = [
  {
    id: 'a1',
    day: 3,
    start: '09:30',
    minutes: 15,
    customer: 'Rosa Aguirre',
    type: 'Foto carnet',
    status: 'completado',
  },
  {
    id: 'a2',
    day: 3,
    start: '10:00',
    minutes: 60,
    customer: 'Familia Sosa',
    type: 'Sesión familiar',
    status: 'programado',
    notes: '5 personas. Fondo blanco.',
  },
  {
    id: 'a3',
    day: 3,
    start: '11:30',
    minutes: 60,
    customer: 'Mateo (4 años)',
    type: 'Sesión infantil',
    status: 'programado',
  },
  {
    id: 'a4',
    day: 3,
    start: '16:30',
    minutes: 15,
    customer: 'Cecilia Ortiz',
    type: 'Foto carnet',
    status: 'programado',
  },
  {
    id: 'a5',
    day: 3,
    start: '17:00',
    minutes: 120,
    customer: 'Valentina Ruiz',
    type: 'Sesión de 15',
    status: 'programado',
    notes: '3 cambios de ropa. Trae vestuario.',
  },
  {
    id: 'a6',
    day: 3,
    start: '19:15',
    minutes: 15,
    customer: 'Pablo Gómez',
    type: 'Foto carnet',
    status: 'ausente',
  },
  {
    id: 'a7',
    day: 0,
    start: '10:00',
    minutes: 60,
    customer: 'Familia Ledesma',
    type: 'Sesión familiar',
    status: 'completado',
  },
  {
    id: 'a8',
    day: 1,
    start: '17:00',
    minutes: 60,
    customer: 'Sofía Castro',
    type: 'Sesión infantil',
    status: 'completado',
  },
  {
    id: 'a9',
    day: 2,
    start: '09:00',
    minutes: 15,
    customer: 'Hugo Díaz',
    type: 'Foto carnet',
    status: 'cancelado',
  },
  {
    id: 'a10',
    day: 4,
    start: '10:30',
    minutes: 60,
    customer: 'Familia Romero',
    type: 'Sesión familiar',
    status: 'programado',
  },
  {
    id: 'a11',
    day: 4,
    start: '17:30',
    minutes: 120,
    customer: 'Abril Vera',
    type: 'Sesión de 15',
    status: 'programado',
  },
  {
    id: 'a12',
    day: 5,
    start: '09:30',
    minutes: 60,
    customer: 'Bebé Julián',
    type: 'Sesión infantil',
    status: 'programado',
  },
  {
    id: 'a13',
    day: 5,
    start: '11:00',
    minutes: 15,
    customer: 'Ernesto Páez',
    type: 'Foto carnet',
    status: 'programado',
  },
];

// ───────────────────────── Eventos y recursos ─────────────────────────

export type EventStatus =
  'consulta' | 'presupuestado' | 'reservado' | 'realizado' | 'cancelado';
export interface EventItem {
  id: string;
  name: string;
  customer: string;
  when: string;
  place: string;
  status: EventStatus;
  services: { name: string; price: number }[];
  resources: string[];
}

export const events: EventItem[] = [
  {
    id: 'e1',
    name: 'Cumple de 15 · Camila Sosa',
    customer: 'Familia Sosa',
    when: 'Sáb 31 oct · 21:00 a 03:00',
    place: 'Salón Los Aromos',
    status: 'reservado',
    services: [
      { name: 'Cabina fotográfica 4 h', price: 180000 },
      { name: 'Impresiones ilimitadas', price: 90000 },
      { name: 'Álbum de recuerdos', price: 45000 },
    ],
    resources: ['Cabina #1', 'Impresora dye-sub'],
  },
  {
    id: 'e2',
    name: 'Egresados Escuela 12 · cabina',
    customer: 'Cooperadora Esc. 12',
    when: 'Vie 23 oct · 20:00 a 01:00',
    place: 'Club Unión',
    status: 'reservado',
    services: [{ name: 'Alquiler cabina 5 h', price: 150000 }],
    resources: ['Cabina #2', 'Kit iluminación'],
  },
  {
    id: 'e3',
    name: 'Casamiento Ruiz–Acosta',
    customer: 'Lautaro Ruiz',
    when: 'Sáb 14 nov · 18:00 a 04:00',
    place: 'Quinta Don Mario',
    status: 'presupuestado',
    services: [
      { name: 'Cobertura fotográfica 8 h', price: 420000 },
      { name: 'Álbum 30×30 · 40 páginas', price: 150000 },
    ],
    resources: ['Kit iluminación', 'Fondo cromático'],
  },
  {
    id: 'e4',
    name: 'Sesión corporativa · retratos',
    customer: 'Estudio Fernández',
    when: 'A definir · noviembre',
    place: 'En el estudio',
    status: 'consulta',
    services: [],
    resources: [],
  },
  {
    id: 'e5',
    name: 'Bautismo Benicio',
    customer: 'Familia Aguirre',
    when: 'Sáb 10 oct · 11:00',
    place: 'Parroquia San José',
    status: 'realizado',
    services: [{ name: 'Cobertura 3 h', price: 95000 }],
    resources: [],
  },
];

export const resources = [
  'Cabina #1',
  'Cabina #2',
  'Kit iluminación',
  'Fondo cromático',
  'Impresora dye-sub',
];
// Reservas por día de la semana (0..5) por recurso
export const resourceBookings: Record<
  string,
  { day: number; label: string }[]
> = {
  'Cabina #1': [{ day: 5, label: 'Cumple infantil' }],
  'Cabina #2': [{ day: 4, label: 'Egresados Esc. 12' }],
  'Kit iluminación': [
    { day: 4, label: 'Egresados Esc. 12' },
    { day: 1, label: 'Estudio' },
  ],
  'Fondo cromático': [{ day: 2, label: 'Retratos' }],
  'Impresora dye-sub': [{ day: 4, label: 'Egresados Esc. 12' }],
};

// ───────────────────────── Marquetería ─────────────────────────

export const mouldings = [
  { id: 'v1', name: 'Cedro natural 2 cm', pricePerM: 4200, swatch: '#b8854a' },
  { id: 'v2', name: 'Negra mate 3 cm', pricePerM: 3600, swatch: '#26231e' },
  {
    id: 'v3',
    name: 'Dorada ornamental 4 cm',
    pricePerM: 7800,
    swatch: '#d9a52b',
  },
  {
    id: 'v4',
    name: 'Blanca laqueada 2,5 cm',
    pricePerM: 3900,
    swatch: '#f1ece0',
  },
];
export const glasses = [
  { id: 'g1', name: 'Vidrio común 2 mm', pricePerM2: 28000 },
  { id: 'g2', name: 'Antirreflejo', pricePerM2: 46000 },
];
export const backs = [
  { id: 'b1', name: 'Fondo MDF 3 mm', pricePerM2: 9500 },
  { id: 'b2', name: 'Fondo cartón rígido', pricePerM2: 6200 },
];
export const FRAME_FIXED = {
  hooks: 600, // ganchos + alambre
  paintPerM: 800, // pintura por metro de varilla
  labour: 6500,
};

/**
 * Regla CentroColor: varilla = 2 × (ancho + alto). NO se suma el ancho de la varilla.
 * Vidrio y fondo: ancho × alto (m²). Ej.: 30 × 40 cm → 140 cm de varilla y 0,12 m².
 */
export function quoteFrame(input: {
  wCm: number;
  hCm: number;
  mouldingId: string;
  glassId: string;
  backId: string;
  paint: boolean;
}) {
  const m = mouldings.find((x) => x.id === input.mouldingId) ?? mouldings[0];
  const g = glasses.find((x) => x.id === input.glassId) ?? glasses[0];
  const b = backs.find((x) => x.id === input.backId) ?? backs[0];
  const mouldingCm = 2 * (input.wCm + input.hCm);
  const areaM2 = (input.wCm * input.hCm) / 10000;
  const lines = [
    {
      key: 'varilla',
      label: 'Varilla',
      detail: `${mouldingCm} cm · ${m.name}`,
      amount: Math.round((mouldingCm / 100) * m.pricePerM),
    },
    {
      key: 'vidrio',
      label: 'Vidrio',
      detail: `${areaM2.toFixed(2).replace('.', ',')} m² · ${g.name}`,
      amount: Math.round(areaM2 * g.pricePerM2),
    },
    {
      key: 'fondo',
      label: 'Fondo',
      detail: `${areaM2.toFixed(2).replace('.', ',')} m² · ${b.name}`,
      amount: Math.round(areaM2 * b.pricePerM2),
    },
    {
      key: 'ganchos',
      label: 'Ganchos',
      detail: 'Kit con alambre',
      amount: FRAME_FIXED.hooks,
    },
    {
      key: 'pintura',
      label: 'Pintura',
      detail: input.paint ? `${mouldingCm} cm de varilla` : 'Sin pintura',
      amount: input.paint
        ? Math.round((mouldingCm / 100) * FRAME_FIXED.paintPerM)
        : 0,
    },
    {
      key: 'obra',
      label: 'Mano de obra',
      detail: 'Corte, armado y terminación',
      amount: FRAME_FIXED.labour,
    },
  ];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, mouldingCm, areaM2, moulding: m };
}

export const frameJobsSeed = [
  {
    id: 'MQ-118',
    customer: 'María González',
    what: 'Cuadro 30×40 · cedro',
    stage: 'En corte',
    due: 'Vie 23/10',
    total: 21480,
    paid: 10000,
  },
  {
    id: 'MQ-117',
    customer: 'Panadería La Esperanza',
    what: '3 cuadros 45×60 · negra',
    stage: 'Listo',
    due: 'Hoy',
    total: 96300,
    paid: 96300,
  },
  {
    id: 'MQ-116',
    customer: 'Juan Pérez',
    what: 'Marco 20×30 · dorada',
    stage: 'Presupuestado',
    due: '—',
    total: 19750,
    paid: 0,
  },
];

// ───────────────────────── Integraciones ─────────────────────────

export type IntegrationState = 'connected' | 'disconnected' | 'attention';
export interface Integration {
  id: 'drive' | 'whatsapp' | 'gmail';
  name: string;
  state: IntegrationState;
  summary: string;
  detail: string;
}
export const integrationsSeed: Integration[] = [
  {
    id: 'drive',
    name: 'Google Drive',
    state: 'connected',
    summary: 'Carpeta «CentroColor» · cuenta del negocio',
    detail:
      'Las fotos de los clientes se guardan acá. Última verificación: hace 3 min.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    state: 'attention',
    summary: 'Plantilla «pedido_listo» pendiente de aprobación',
    detail:
      'No se pueden enviar avisos hasta que Meta apruebe la plantilla. Los pedidos se registran igual.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    state: 'disconnected',
    summary: 'Pedidos por correo (próximamente)',
    detail:
      'Permitirá convertir correos con fotos adjuntas en pedidos. Todavía no está disponible.',
  },
];

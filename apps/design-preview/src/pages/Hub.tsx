import { Icon, type IconName } from '../icons';
import { Link } from '../router';
import { useStore } from '../store';
import { Badge, Button, FilmStrip, Logo, useToast } from '../ui';
import { resetDraft } from '../portal/draft';

type Item = { to: string; title: string; note: string; icon: IconName };

const GROUPS: { title: string; blurb: string; items: Item[] }[] = [
  {
    title: 'A · Portal público',
    blurb:
      'Mobile-first, sin navegación administrativa. Recorrelo en orden: elegir → subir → confirmar → transferir → seguir.',
    items: [
      {
        to: '/imprimir',
        title: '/imprimir',
        note: 'Tamaños, fotos, copias, datos y total persistente',
        icon: 'image',
      },
      {
        to: '/imprimir/recibido',
        title: '/imprimir/recibido',
        note: 'PEDIDO RECIBIDO · transferencia · esperando pago',
        icon: 'check',
      },
      {
        to: '/pedido/demo',
        title: '/pedido/demo',
        note: 'Tracking con timeline y simulador de estados',
        icon: 'receipt',
      },
    ],
  },
  {
    title: 'B · Panel interno',
    blurb:
      'Misma identidad con más densidad. Todo reacciona: confirmá una transferencia y mirá cómo cambia el seguimiento del cliente.',
    items: [
      {
        to: '/acceso',
        title: '/acceso',
        note: 'Pantalla de acceso (simulada, no autentica)',
        icon: 'lock',
      },
      {
        to: '/panel',
        title: '/panel',
        note: 'Dashboard: ¿qué necesita atención hoy?',
        icon: 'home',
      },
      {
        to: '/panel/pos',
        title: '/panel/pos',
        note: 'POS: scanner, catálogo, carrito, cobro',
        icon: 'cart',
      },
      {
        to: '/panel/clientes',
        title: '/panel/clientes',
        note: 'Listado + ficha',
        icon: 'users',
      },
      {
        to: '/panel/productos',
        title: '/panel/productos',
        note: 'Inventario y ajuste de stock',
        icon: 'box',
      },
      {
        to: '/panel/agenda',
        title: '/panel/agenda',
        note: 'Turnos día / semana',
        icon: 'calendar',
      },
      {
        to: '/panel/eventos',
        title: '/panel/eventos',
        note: 'Eventos + disponibilidad de recursos',
        icon: 'star',
      },
      {
        to: '/panel/marqueteria',
        title: '/panel/marqueteria',
        note: 'Cotizador: 30×40 → 140 cm de varilla',
        icon: 'frame',
      },
      {
        to: '/panel/trabajos',
        title: '/panel/trabajos',
        note: 'Cola operativa (tablero/lista) + ficha',
        icon: 'camera',
      },
      {
        to: '/panel/produccion',
        title: '/panel/produccion',
        note: 'Laboratorio vs Edición',
        icon: 'printer',
      },
      {
        to: '/panel/pagos',
        title: '/panel/pagos',
        note: 'Total / Pagado / Saldo · confirmar transferencia',
        icon: 'wallet',
      },
      {
        to: '/panel/configuracion',
        title: '/panel/configuracion',
        note: 'Integraciones: Drive, WhatsApp',
        icon: 'sliders',
      },
    ],
  },
  {
    title: 'Sistema y herramientas',
    blurb: 'Para evaluar el diseño y no solo recorrerlo.',
    items: [
      {
        to: '/diseno',
        title: '/diseno',
        note: 'Paleta, tipografías, componentes, contraste real',
        icon: 'sparkle',
      },
      {
        to: '/dispositivos?ruta=/imprimir',
        title: '/dispositivos',
        note: '390 · 768 · desktop lado a lado',
        icon: 'grid',
      },
    ],
  },
];

export function Hub() {
  const { reset } = useStore();
  const toast = useToast();
  return (
    <div className="hub">
      <header className="hub-top on-yellow">
        <div className="hub-in hub-hero">
          <Logo size={148} />
          <div>
            <p className="frame-tag">DESIGN-01 · rediseño UX/UI integral</p>
            <h1>
              CentroColor <span className="marker">design preview</span>
            </h1>
            <p className="lede">
              Una identidad nueva, probada con datos simulados. Nada de esto
              toca la aplicación real: sin Supabase, SQLite, auth ni APIs.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                marginTop: 16,
              }}
            >
              <Link to="/imprimir" className="btn btn--dark btn--lg">
                Empezar por el portal <Icon name="chevR" />
              </Link>
              <Link to="/panel" className="btn btn--lg">
                Ir al panel interno
              </Link>
            </div>
          </div>
        </div>
      </header>
      <FilmStrip />
      <main className="hub-in hub-main">
        {GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={`g-${g.title}`}>
            <h2 id={`g-${g.title}`} style={{ fontSize: '1.7rem' }}>
              {g.title}
            </h2>
            <p
              className="muted"
              style={{ margin: '6px 0 14px', maxWidth: '70ch' }}
            >
              {g.blurb}
            </p>
            <div className="hub-grid">
              {g.items.map((i) => (
                <Link key={i.to} to={i.to} className="hub-card">
                  <span className="ic">
                    <Icon name={i.icon} />
                  </span>
                  <span>
                    <strong className="mono">{i.title}</strong>
                    <span className="muted">{i.note}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <section
          className="card card--pad"
          style={{
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            <strong>Estado de la demo</strong>
            <br />
            <span className="muted">
              Los pedidos, cobros y estados se guardan en memoria mientras no
              recargues la página.
            </span>
          </span>
          <Button
            icon="refresh"
            onClick={() => {
              reset();
              resetDraft();
              toast('Datos de la demo reiniciados', 'refresh');
            }}
          >
            Reiniciar datos de la demo
          </Button>
        </section>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
          <Badge icon="info">Preview</Badge> &nbsp;Datos ficticios: clientes,
          precios y dirección del local son de ejemplo.
        </p>
      </main>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { Link, navigate, useLocation } from '../router';
import { useStore } from '../store';
import { Button, Logo, Sheet } from '../ui';
import { ars, customers, jobBalance, jobIsLate } from '../data';

interface NavItem {
  path: string;
  label: string;
  short: string;
  icon: IconName;
  group: string;
  count?: number;
  alert?: boolean;
}

export function PanelShell({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const { jobs, products } = useStore();
  const [more, setMore] = useState(false);
  const [bell, setBell] = useState(false);
  const [create, setCreate] = useState(false);

  const awaiting = jobs.filter((j) => j.status === 'awaiting_payment').length;
  const ready = jobs.filter((j) => j.status === 'ready').length;
  const late = jobs.filter(jobIsLate).length;
  const lowStock = products.filter(
    (p) => p.stock !== null && p.stock <= p.min,
  ).length;

  const items: NavItem[] = [
    {
      path: '/panel',
      label: 'Inicio',
      short: 'Inicio',
      icon: 'home',
      group: 'Hoy',
    },
    {
      path: '/panel/pos',
      label: 'Cobrar · POS',
      short: 'Cobrar',
      icon: 'cart',
      group: 'Mostrador',
    },
    {
      path: '/panel/clientes',
      label: 'Clientes',
      short: 'Clientes',
      icon: 'users',
      group: 'Mostrador',
    },
    {
      path: '/panel/pagos',
      label: 'Cobros',
      short: 'Cobros',
      icon: 'wallet',
      group: 'Mostrador',
      count: awaiting,
    },
    {
      path: '/panel/trabajos',
      label: 'Trabajos',
      short: 'Trabajos',
      icon: 'camera',
      group: 'Taller',
      count: late,
      alert: true,
    },
    {
      path: '/panel/produccion',
      label: 'Producción',
      short: 'Producción',
      icon: 'printer',
      group: 'Taller',
    },
    {
      path: '/panel/marqueteria',
      label: 'Marquetería',
      short: 'Marcos',
      icon: 'frame',
      group: 'Taller',
    },
    {
      path: '/panel/agenda',
      label: 'Agenda y turnos',
      short: 'Agenda',
      icon: 'calendar',
      group: 'Agenda',
    },
    {
      path: '/panel/eventos',
      label: 'Eventos y recursos',
      short: 'Eventos',
      icon: 'star',
      group: 'Agenda',
    },
    {
      path: '/panel/productos',
      label: 'Productos',
      short: 'Stock',
      icon: 'box',
      group: 'Catálogo',
      count: lowStock,
    },
    {
      path: '/panel/configuracion',
      label: 'Configuración',
      short: 'Ajustes',
      icon: 'sliders',
      group: 'Sistema',
    },
  ];
  const isActive = (p: string) =>
    p === '/panel' ? path === '/panel' : path === p || path.startsWith(p + '/');
  const groups = [...new Set(items.map((i) => i.group))];
  const current = items.find((i) => isActive(i.path));

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>

      <aside className="rail on-dark" aria-label="Navegación principal">
        <Link
          to="/panel"
          className="rail-brand"
          aria-label="CentroColor, inicio del panel"
        >
          <Logo size={56} />
          <span>
            <strong>CentroColor</strong>
            <small>Panel interno</small>
          </span>
        </Link>
        <nav>
          {groups.map((g, gi) => (
            <div key={g}>
              {gi > 0 && <div className="nav-sep" aria-hidden="true" />}
              <div className="nav-group">{g}</div>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <Link
                    key={i.path}
                    to={i.path}
                    className="nav-item"
                    aria-current={isActive(i.path) ? 'page' : undefined}
                  >
                    <Icon name={i.icon} />
                    <span className="short">{i.short}</span>
                    <span className="long">{i.label}</span>
                    {!!i.count && (
                      <span
                        className={`nav-count ${i.alert ? 'nav-count--alert' : ''}`}
                      >
                        {i.count}
                        <span className="sr-only">
                          {i.alert ? ' atrasados' : ' pendientes'}
                        </span>
                      </span>
                    )}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="rail-user">
            <span className="avatar" aria-hidden="true">
              S
            </span>
            <span>
              <strong>Sofía Márquez</strong>
              <small>Mostrador · Esperanza</small>
            </span>
          </div>
          <Link to="/imprimir" className="rail-link">
            <Icon name="globe" size={18} />
            &nbsp; Ver portal público
          </Link>
          <Link to="/" className="rail-link">
            <Icon name="grid" size={18} />
            &nbsp; Índice de la preview
          </Link>
        </div>
        <div className="rail-film" aria-hidden="true" />
      </aside>

      <div className="app-main">
        {/* móvil */}
        <header className="m-top on-dark">
          <Link to="/panel" aria-label="Inicio">
            <Logo size={44} />
          </Link>
          <strong>{current?.short ?? 'CentroColor'}</strong>
          <button
            type="button"
            className="icon-btn"
            aria-label="Crear nuevo"
            onClick={() => setCreate(true)}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Avisos, ${awaiting + ready} sin ver`}
            onClick={() => setBell(true)}
          >
            <Icon name="bell" />
            {awaiting + ready > 0 && (
              <span className="dot">{awaiting + ready}</span>
            )}
          </button>
        </header>

        {/* tablet / desktop */}
        <header className="topbar">
          <GlobalSearch />
          <span className="top-spacer" />
          <span className="top-branch meta">Sucursal Esperanza</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Avisos, ${awaiting + ready} sin ver`}
            onClick={() => setBell(true)}
          >
            <Icon name="bell" />
            {awaiting + ready > 0 && (
              <span className="dot">{awaiting + ready}</span>
            )}
          </button>
          <Button icon="plus" onClick={() => setCreate(true)}>
            Nuevo
          </Button>
        </header>

        <main id="contenido" className="page">
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Navegación">
        {(
          [
            ['/panel', 'Inicio', 'home'],
            ['/panel/pos', 'Cobrar', 'cart'],
            ['/panel/trabajos', 'Trabajos', 'camera'],
            ['/panel/agenda', 'Agenda', 'calendar'],
          ] as const
        ).map(([p, l, ic]) => (
          <Link
            key={p}
            to={p}
            className="tab"
            aria-current={isActive(p) ? 'page' : undefined}
          >
            <Icon name={ic} />
            {l}
            {p === '/panel/trabajos' && late > 0 && (
              <span className="nav-count nav-count--alert">{late}</span>
            )}
          </Link>
        ))}
        <button
          type="button"
          className="tab"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
        >
          <Icon name="grid" />
          Más
          {awaiting > 0 && <span className="nav-count">{awaiting}</span>}
        </button>
      </nav>

      <Sheet
        open={more}
        onClose={() => setMore(false)}
        title="Todos los módulos"
        variant="modal"
      >
        <div className="more-grid">
          {items.map((i) => (
            <Link
              key={i.path}
              to={i.path}
              aria-current={isActive(i.path) ? 'page' : undefined}
              onClick={() => setMore(false)}
            >
              <Icon name={i.icon} size={28} />
              {i.short}
              {!!i.count && <span className="meta">{i.count}</span>}
            </Link>
          ))}
          <Link to="/imprimir" onClick={() => setMore(false)}>
            <Icon name="globe" size={28} />
            Portal público
          </Link>
          <Link to="/" onClick={() => setMore(false)}>
            <Icon name="info" size={28} />
            Índice
          </Link>
        </div>
      </Sheet>

      <Sheet
        open={bell}
        onClose={() => setBell(false)}
        title="Avisos"
        variant="side"
        eyebrow="Lo que necesita atención"
      >
        <Notifications onNavigate={() => setBell(false)} />
      </Sheet>

      <Sheet
        open={create}
        onClose={() => setCreate(false)}
        title="Crear nuevo"
        variant="modal"
      >
        <div
          className="more-grid"
          style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
        >
          {(
            [
              ['/panel/pos', 'Venta', 'cart'],
              ['/panel/trabajos', 'Trabajo fotográfico', 'camera'],
              ['/panel/marqueteria', 'Presupuesto de marco', 'frame'],
              ['/panel/agenda', 'Turno', 'calendar'],
              ['/panel/eventos', 'Evento', 'star'],
              ['/panel/clientes', 'Cliente', 'users'],
            ] as const
          ).map(([p, l, ic]) => (
            <Link key={l} to={p} onClick={() => setCreate(false)}>
              <Icon name={ic} size={28} />
              {l}
            </Link>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function Notifications({ onNavigate }: { onNavigate: () => void }) {
  const { jobs } = useStore();
  const awaiting = jobs.filter((j) => j.status === 'awaiting_payment');
  const ready = jobs.filter((j) => j.status === 'ready');
  const go = (to: string) => {
    onNavigate();
    navigate(to);
  };
  return (
    <ul className="mini-list">
      {awaiting.map((j) => (
        <li key={j.id}>
          <span className="sev sev--mid" aria-hidden="true">
            <Icon name="hourglass" />
          </span>
          <div className="mini-body">
            <strong>
              {j.customer} · {ars(j.total)}
            </strong>
            <span>Esperando transferencia desde {j.created.toLowerCase()}</span>
          </div>
          <Button size="sm" onClick={() => go('/panel/pagos')}>
            Ver
          </Button>
        </li>
      ))}
      {ready.map((j) => (
        <li key={j.id}>
          <span className="sev sev--ok" aria-hidden="true">
            <Icon name="check" />
          </span>
          <div className="mini-body">
            <strong>{j.customer}</strong>
            <span>
              {j.title}
              {jobBalance(j) > 0 ? ` · saldo ${ars(jobBalance(j))}` : ''}
            </span>
          </div>
          <Button size="sm" onClick={() => go('/panel/trabajos')}>
            Entregar
          </Button>
        </li>
      ))}
      {awaiting.length + ready.length === 0 && (
        <li>
          <span className="muted">Todo al día. Nada requiere atención.</span>
        </li>
      )}
    </ul>
  );
}

function GlobalSearch() {
  const { jobs } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const click = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('keydown', down);
    document.addEventListener('mousedown', click);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('mousedown', click);
    };
  }, []);

  const needle = q.trim().toLowerCase();
  const res = useMemo(() => {
    if (!needle) return { c: [], j: [] };
    return {
      c: customers
        .filter((c) => c.name.toLowerCase().includes(needle))
        .slice(0, 4),
      j: jobs
        .filter((j) =>
          (j.customer + j.id + j.title).toLowerCase().includes(needle),
        )
        .slice(0, 4),
    };
  }, [needle, jobs]);

  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };

  return (
    <div className="top-search" ref={wrap}>
      <Icon name="search" />
      <input
        ref={input}
        className="input"
        type="search"
        placeholder="Buscar cliente o pedido…"
        aria-label="Buscar en todo el panel"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      {open && needle && (
        <div className="search-pop" role="listbox" aria-label="Resultados">
          {res.c.length + res.j.length === 0 && (
            <div className="grp-label">Sin resultados para «{q}»</div>
          )}
          {res.c.length > 0 && <div className="grp-label">Clientes</div>}
          {res.c.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => go('/panel/clientes')}
            >
              <span>{c.name}</span>
              <span className="muted mono">{c.phone}</span>
            </button>
          ))}
          {res.j.length > 0 && <div className="grp-label">Trabajos</div>}
          {res.j.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => go('/panel/trabajos')}
            >
              <span>
                {j.customer} · <span className="muted">{j.title}</span>
              </span>
              <span className="mono">{j.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

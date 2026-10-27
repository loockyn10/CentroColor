import {
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';
import { Button, Logo, Tabs } from './primitives';
import {
  moduleFor,
  navGroups,
  navModules,
  type NavBadges,
  type NavModule,
} from './navigation';
import { Sheet } from './sheet';

const createItems: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'new-sale', label: 'Venta', icon: 'cart' },
  { id: 'new-photo-job', label: 'Pedido de laboratorio', icon: 'camera' },
  { id: 'new-quote', label: 'Cotización de marquetería', icon: 'frame' },
  { id: 'appointments', label: 'Turno', icon: 'calendar' },
  { id: 'events', label: 'Presupuesto o reserva', icon: 'star' },
  { id: 'customers', label: 'Cliente', icon: 'users' },
];

const tabbarIds = ['home', 'new-sale', 'photo-jobs', 'calendar'];

export function AppShell({
  activeId,
  onNavigate,
  platform,
  onLogout,
  statusArea,
  badges = {},
  search,
  user,
  children,
}: PropsWithChildren<{
  activeId: string;
  onNavigate: (id: string) => void;
  platform: 'Desktop' | 'Web';
  onLogout: () => void;
  statusArea?: ReactNode;
  badges?: NavBadges;
  /** Buscador global; recibe `onDone` para cerrarse tras navegar. */
  search?: (onDone: () => void) => ReactNode;
  user?: { name: string; detail?: string };
}>) {
  const [more, setMore] = useState(false);
  const [create, setCreate] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const current = moduleFor(activeId);

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [activeId]);

  const go = (id: string) => {
    onNavigate(id);
    setMore(false);
    setCreate(false);
  };
  const isActive = (module: NavModule) => current?.id === module.id;
  const badgeFor = (module: NavModule) => badges[module.id];

  const renderBadge = (module: NavModule) => {
    const badge = badgeFor(module);
    if (!badge || badge.count <= 0) return null;
    return (
      <span
        className={`nav-count ${badge.tone === 'alert' ? 'nav-count--alert' : ''}`.trim()}
      >
        {badge.count}
        <span className="sr-only"> {badge.label}</span>
      </span>
    );
  };

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>

      <aside className="rail on-dark" aria-label="Navegación principal">
        <button
          type="button"
          className="rail-brand"
          aria-label="CentroColor, ir al inicio"
          onClick={() => go('home')}
        >
          <Logo size={56} decorative />
          <span>
            <strong>CentroColor</strong>
            <small>Panel interno</small>
          </span>
        </button>
        <nav aria-label="Módulos">
          {navGroups.map((group, index) => (
            <div key={group}>
              {index > 0 && <div className="nav-sep" aria-hidden="true" />}
              <div className="nav-group">{group}</div>
              {navModules
                .filter((module) => module.group === group)
                .map((module) => (
                  <button
                    key={module.id}
                    type="button"
                    className="nav-item"
                    aria-current={isActive(module) ? 'page' : undefined}
                    onClick={() => go(module.id)}
                  >
                    <Icon name={module.icon} />
                    <span className="short">{module.short}</span>
                    <span className="long">{module.label}</span>
                    {renderBadge(module)}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="rail-user">
            <span className="avatar" aria-hidden="true">
              {(user?.name ?? 'C').trim().charAt(0).toUpperCase() || 'C'}
            </span>
            <span>
              <strong>{user?.name || 'Usuario'}</strong>
              <small>{user?.detail ?? `CentroColor · ${platform}`}</small>
            </span>
          </div>
          <button
            type="button"
            className="rail-link"
            onClick={onLogout}
            aria-label="Cerrar sesión"
          >
            <Icon name="logout" size={20} />
            <span className="label">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="m-top on-dark">
          <Logo size={44} decorative />
          <strong>{current?.short ?? 'CentroColor'}</strong>
          {search && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Buscar"
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label="Crear nuevo"
            onClick={() => setCreate(true)}
          >
            <Icon name="plus" />
          </button>
        </header>

        <header className="topbar">
          {search ? search(() => undefined) : null}
          <span className="top-spacer" />
          <span className="top-platform">{platform}</span>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setCreate(true)}
            aria-haspopup="dialog"
          >
            Nuevo
          </Button>
        </header>

        {statusArea}

        <main id="contenido" className="main-content">
          {current && current.subs.length > 1 && (
            <Tabs
              label={current.label}
              items={current.subs}
              activeId={activeId}
              onSelect={go}
            />
          )}
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Navegación">
        {tabbarIds.map((id) => {
          const module = navModules.find((item) => item.id === id)!;
          return (
            <button
              key={id}
              type="button"
              className="tab"
              aria-current={isActive(module) ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <Icon name={module.icon} />
              {module.short}
              {renderBadge(module)}
            </button>
          );
        })}
        <button
          type="button"
          className="tab"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
        >
          <Icon name="grid" />
          Más
        </button>
      </nav>

      <Sheet
        open={more}
        onClose={() => setMore(false)}
        title="Todos los módulos"
      >
        <div className="more-sections">
          {navGroups.map((group) => (
            <section className="more-section" key={group}>
              <h3>{group}</h3>
              <div className="more-grid">
                {navModules
                  .filter((module) => module.group === group)
                  .map((module) => (
                    <button
                      key={module.id}
                      type="button"
                      aria-current={isActive(module) ? 'page' : undefined}
                      onClick={() => go(module.id)}
                    >
                      <Icon name={module.icon} size={28} />
                      {module.short}
                      {renderBadge(module)}
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
        <Button
          variant="ghost"
          icon="logout"
          onClick={() => {
            setMore(false);
            onLogout();
          }}
        >
          Cerrar sesión
        </Button>
      </Sheet>

      <Sheet open={create} onClose={() => setCreate(false)} title="Crear nuevo">
        <div className="more-grid">
          {createItems.map((item) => (
            <button key={item.id} type="button" onClick={() => go(item.id)}>
              <Icon name={item.icon} size={28} />
              {item.label}
            </button>
          ))}
        </div>
      </Sheet>

      {search && (
        <Sheet
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          title="Buscar"
        >
          {search(() => setSearchOpen(false))}
        </Sheet>
      )}
    </div>
  );
}

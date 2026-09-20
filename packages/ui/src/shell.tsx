import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { Button } from './primitives';

export interface NavigationItem {
  id: string;
  label: string;
  section?: string;
}

export const navigation: NavigationItem[] = [
  { id: 'home', label: 'Inicio' },
  { id: 'new-sale', label: 'Nueva venta', section: 'VENTAS' },
  { id: 'sales', label: 'Ventas' },
  { id: 'sales-jobs', label: 'Trabajos' },
  { id: 'calendar', label: 'Calendario', section: 'AGENDA' },
  { id: 'appointments', label: 'Turnos' },
  { id: 'events', label: 'Eventos' },
  { id: 'new-quote', label: 'Nueva cotización', section: 'MARQUETERÍA' },
  { id: 'frame-jobs', label: 'Trabajos' },
  { id: 'mouldings', label: 'Varillas' },
  { id: 'materials', label: 'Materiales' },
  { id: 'customers', label: 'Clientes', section: 'CLIENTES' },
  { id: 'products', label: 'Productos', section: 'CATÁLOGO' },
  { id: 'services', label: 'Servicios' },
  { id: 'resources', label: 'Recursos' },
  { id: 'stock', label: 'Stock' },
  { id: 'settings', label: 'Configuración', section: 'CONFIGURACIÓN' },
];

export function AppShell({
  activeId,
  onNavigate,
  platform,
  onLogout,
  statusArea,
  children,
}: PropsWithChildren<{
  activeId: string;
  onNavigate: (id: string) => void;
  platform: 'Desktop' | 'Web';
  onLogout: () => void;
  statusArea?: ReactNode;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}
        aria-label="Navegación principal"
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            <strong>CentroColor</strong>
            <small>Espacio de trabajo</small>
          </span>
        </div>
        <nav>
          {navigation.map((item) => (
            <div key={item.id}>
              {item.section && (
                <div className="nav-section">{item.section}</div>
              )}
              <button
                type="button"
                className={`nav-item ${activeId === item.id ? 'active' : ''}`}
                onClick={() => {
                  onNavigate(item.id);
                  setMenuOpen(false);
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>CentroColor · {platform}</span>
          <button type="button" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="menu-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="main-column">
        <div className="topbar">
          <Button
            aria-label="Abrir navegación"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ☰ <span className="mobile-menu-label">Menú</span>
          </Button>
          <span className="topbar-title">CentroColor</span>
          <span className="topbar-platform">{platform}</span>
        </div>
        {statusArea}
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

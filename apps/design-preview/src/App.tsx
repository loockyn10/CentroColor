import { useEffect } from 'react';
import { useLocation } from './router';
import { StoreProvider } from './store';
import { ToastProvider } from './ui';
import { PrintPortal } from './portal/PrintPortal';
import { OrderReceived } from './portal/OrderReceived';
import { OrderTracking } from './portal/OrderTracking';
import { PanelShell } from './panel/PanelShell';
import { Dashboard } from './panel/Dashboard';
import { Pos } from './panel/Pos';
import { Customers } from './panel/Customers';
import { Stock } from './panel/Stock';
import { Agenda } from './panel/Agenda';
import { Events } from './panel/Events';
import { Framing } from './panel/Framing';
import { Jobs } from './panel/Jobs';
import { Production } from './panel/Production';
import { Payments } from './panel/Payments';
import { Settings } from './panel/Settings';
import { Hub } from './pages/Hub';
import { Login } from './pages/Login';
import { DesignSystem } from './pages/DesignSystem';
import { Devices } from './pages/Devices';

const TITLES: Array<[string, string]> = [
  ['/imprimir/recibido', 'Pedido recibido'],
  ['/imprimir', 'Imprimí tus fotos'],
  ['/pedido', 'Seguimiento del pedido'],
  ['/panel/pos', 'Cobrar'],
  ['/panel/clientes', 'Clientes'],
  ['/panel/productos', 'Productos y stock'],
  ['/panel/agenda', 'Agenda'],
  ['/panel/eventos', 'Eventos'],
  ['/panel/marqueteria', 'Marquetería'],
  ['/panel/trabajos', 'Trabajos'],
  ['/panel/produccion', 'Producción'],
  ['/panel/pagos', 'Cobros'],
  ['/panel/configuracion', 'Configuración'],
  ['/panel', 'Inicio'],
  ['/acceso', 'Acceso'],
  ['/diseno', 'Sistema de diseño'],
  ['/dispositivos', 'Comparar tamaños'],
];

export function App() {
  const { path } = useLocation();

  useEffect(() => {
    const hit = TITLES.find(([p]) => path === p || path.startsWith(p + '/'));
    document.title = `${hit ? hit[1] : 'Design preview'} · CentroColor`;
  }, [path]);

  return (
    <StoreProvider>
      <ToastProvider>
        <Routes path={path} />
      </ToastProvider>
    </StoreProvider>
  );
}

const PANEL: Record<string, () => React.JSX.Element> = {
  '/panel': Dashboard,
  '/panel/pos': Pos,
  '/panel/clientes': Customers,
  '/panel/productos': Stock,
  '/panel/agenda': Agenda,
  '/panel/eventos': Events,
  '/panel/marqueteria': Framing,
  '/panel/trabajos': Jobs,
  '/panel/produccion': Production,
  '/panel/pagos': Payments,
  '/panel/configuracion': Settings,
};

function Routes({ path }: { path: string }) {
  if (path === '/imprimir') return <PrintPortal />;
  if (path === '/imprimir/recibido') return <OrderReceived />;
  if (path.startsWith('/pedido/')) return <OrderTracking />;
  if (path === '/acceso') return <Login />;
  if (path === '/diseno') return <DesignSystem />;
  if (path === '/dispositivos') return <Devices />;
  if (path === '/panel' || path.startsWith('/panel/')) {
    const Page = PANEL[path] ?? Dashboard;
    return (
      <PanelShell>
        <Page />
      </PanelShell>
    );
  }
  return <Hub />;
}

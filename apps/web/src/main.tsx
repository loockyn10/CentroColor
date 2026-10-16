import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BusinessContext } from '@centrocolor/application';
import { AppShell, navigation } from '@centrocolor/ui';
import {
  AuthStatePage,
  AppointmentTypesPage,
  AppointmentsPage,
  BusinessContextProvider,
  CalendarPage,
  CustomersPage,
  HomePage,
  LoginPage,
  PlaceholderPage,
  ProductsPage,
  NewSalePage,
  SalesPage,
  StockPage,
  EventsPage,
  ResourcesPage,
  ResourceCalendarPage,
  FramingCatalogPage,
  NewFrameQuotePage,
  FrameJobsPage,
  PhotoServicesPage,
  NewPhotoJobPage,
  PhotoJobsPage,
} from '@centrocolor/features';
import '@centrocolor/ui/styles.css';
import { getSupabaseClient } from './cloud-config';
import { loadCloudBusinessContext } from './cloud-auth-adapter';
import { describeWebAuthError, type AuthStage } from './auth-errors';
import { SupabaseCustomerRepository } from './supabase-customer-repository';
import {
  SupabaseProductRepository,
  SupabaseSaleRepository,
} from './supabase-pos-repositories';
import { SupabaseInventoryRepository } from './supabase-inventory-repository';
import { SupabaseAppointmentRepository } from './supabase-appointment-repository';
import { SupabaseEventRepository } from './supabase-event-repository';
import { SupabaseFramingRepository } from './supabase-framing-repository';
import { SupabasePhotoRepository } from './supabase-photo-repository';
import { SupabaseWorkPaymentRepository } from './supabase-work-payment-repository';

function PosSection({
  section,
}: {
  section: 'products' | 'new-sale' | 'sales' | 'stock';
}) {
  const [productRepository] = useState(() => new SupabaseProductRepository());
  const [saleRepository] = useState(() => new SupabaseSaleRepository());
  const [inventoryRepository] = useState(
    () => new SupabaseInventoryRepository(),
  );
  if (section === 'products')
    return <ProductsPage repository={productRepository} storage="cloud" />;
  if (section === 'new-sale')
    return (
      <NewSalePage
        productRepository={productRepository}
        saleRepository={saleRepository}
        inventoryRepository={inventoryRepository}
      />
    );
  if (section === 'stock')
    return (
      <StockPage
        productRepository={productRepository}
        inventoryRepository={inventoryRepository}
      />
    );
  return <SalesPage repository={saleRepository} storage="cloud" />;
}

type Gate = 'loading' | 'login' | 'no-access' | 'ready' | 'error';

function CustomerSection({
  paymentRepository,
}: {
  paymentRepository: SupabaseWorkPaymentRepository;
}) {
  const [repository] = useState(() => new SupabaseCustomerRepository());
  return (
    <CustomersPage
      repository={repository}
      paymentRepository={paymentRepository}
      storage="cloud"
    />
  );
}

function App() {
  const [activeId, setActiveId] = useState('home');
  const [gate, setGate] = useState<Gate>('loading');
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerRepository] = useState(() => new SupabaseCustomerRepository());
  const [appointmentRepository] = useState(
    () => new SupabaseAppointmentRepository(),
  );
  const [eventRepository] = useState(() => new SupabaseEventRepository());
  const [framingRepository] = useState(() => new SupabaseFramingRepository());
  const [photoRepository] = useState(() => new SupabasePhotoRepository());
  const [paymentRepository] = useState(
    () => new SupabaseWorkPaymentRepository(),
  );

  useEffect(() => {
    let live = true;
    let client;
    try {
      client = getSupabaseClient();
    } catch (initializationError) {
      setError(describeWebAuthError(initializationError, 'configuration'));
      setGate('login');
      return;
    }
    const subscription = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && live) {
        setContext(null);
        setGate('login');
      }
    });
    void (async () => {
      let stage: AuthStage = 'authentication';
      try {
        const { data, error: authError } = await client.auth.getUser();
        if (!live) return;
        if (
          !data.user &&
          (!authError || authError.name === 'AuthSessionMissingError')
        ) {
          setGate('login');
          return;
        }
        if (authError) {
          setError(describeWebAuthError(authError, 'authentication'));
          setGate('error');
          return;
        }
        if (!data.user) return;
        stage = 'membership';
        const resolved = await loadCloudBusinessContext(
          data.user.id,
          {},
          client,
        );
        if (!live) return;
        setContext(resolved);
        setGate(resolved ? 'ready' : 'no-access');
      } catch (restoreError) {
        if (live) {
          setError(describeWebAuthError(restoreError, stage));
          setGate('error');
        }
      }
    })();
    return () => {
      live = false;
      subscription.data.subscription.unsubscribe();
    };
  }, []);

  async function login(email: string, password: string) {
    setBusy(true);
    setError(null);
    let stage: AuthStage = 'configuration';
    try {
      const client = getSupabaseClient();
      stage = 'authentication';
      const { data, error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) {
        setError(describeWebAuthError(authError, stage));
        return;
      }
      if (!data.user) {
        setError('No se recibió un usuario autenticado. Intentá de nuevo.');
        return;
      }
      stage = 'membership';
      const resolved = await loadCloudBusinessContext(data.user.id, {}, client);
      setContext(resolved);
      setGate(resolved ? 'ready' : 'no-access');
    } catch (loginError) {
      if (import.meta.env.DEV)
        console.error('Web login failed at', stage, loginError);
      setError(describeWebAuthError(loginError, stage));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      const { error: signOutError } = await getSupabaseClient().auth.signOut({
        scope: 'local',
      });
      if (signOutError) throw signOutError;
      setContext(null);
      setGate('login');
      setError(null);
    } catch {
      setError('No se pudo cerrar sesión. Reintentá.');
      setGate('error');
    }
  }

  if (gate === 'loading')
    return <AuthStatePage title="Validando sesión" message="Un momento…" />;
  if (gate === 'login')
    return <LoginPage onLogin={login} busy={busy} error={error} />;
  if (gate === 'no-access')
    return (
      <AuthStatePage
        title="Sin acceso asignado"
        message="Tu usuario no tiene un negocio activo asignado. Contactá a un administrador."
        onLogout={() => void logout()}
      />
    );
  if (gate === 'error')
    return (
      <AuthStatePage
        title="No se pudo validar el acceso"
        message={error ?? 'Revisá tu conexión y recargá la página.'}
        onLogout={() => void logout()}
      />
    );
  if (!context) return null;
  const title =
    navigation.find((item) => item.id === activeId)?.label ?? 'Inicio';
  return (
    <BusinessContextProvider context={context}>
      <AppShell
        activeId={activeId}
        onNavigate={setActiveId}
        platform="Web"
        onLogout={() => void logout()}
      >
        {activeId === 'home' ? (
          <HomePage
            appointmentRepository={appointmentRepository}
            eventRepository={eventRepository}
            photoRepository={photoRepository}
            paymentRepository={paymentRepository}
          />
        ) : activeId === 'calendar' ? (
          <CalendarPage
            repository={appointmentRepository}
            customerRepository={customerRepository}
          />
        ) : activeId === 'appointments' ? (
          <AppointmentsPage
            repository={appointmentRepository}
            customerRepository={customerRepository}
          />
        ) : activeId === 'appointment-types' ? (
          <AppointmentTypesPage repository={appointmentRepository} />
        ) : activeId === 'events' ? (
          <EventsPage
            repository={eventRepository}
            customerRepository={customerRepository}
            paymentRepository={paymentRepository}
          />
        ) : activeId === 'resources' ? (
          <ResourcesPage repository={eventRepository} />
        ) : activeId === 'resource-calendar' ? (
          <ResourceCalendarPage repository={eventRepository} />
        ) : activeId === 'new-quote' ? (
          <NewFrameQuotePage repository={framingRepository} />
        ) : activeId === 'frame-jobs' ? (
          <FrameJobsPage
            repository={framingRepository}
            paymentRepository={paymentRepository}
          />
        ) : activeId === 'mouldings' ? (
          <FramingCatalogPage repository={framingRepository} kind="mouldings" />
        ) : activeId === 'materials' ? (
          <FramingCatalogPage repository={framingRepository} kind="materials" />
        ) : activeId === 'new-photo-job' ? (
          <NewPhotoJobPage
            repository={photoRepository}
            customerRepository={customerRepository}
          />
        ) : activeId === 'photo-jobs' ? (
          <PhotoJobsPage
            repository={photoRepository}
            paymentRepository={paymentRepository}
          />
        ) : activeId === 'photo-services' ? (
          <PhotoServicesPage repository={photoRepository} />
        ) : activeId === 'customers' ? (
          <CustomerSection paymentRepository={paymentRepository} />
        ) : activeId === 'products' ? (
          <PosSection section="products" />
        ) : activeId === 'new-sale' ? (
          <PosSection section="new-sale" />
        ) : activeId === 'sales' ? (
          <PosSection section="sales" />
        ) : activeId === 'stock' ? (
          <PosSection section="stock" />
        ) : (
          <PlaceholderPage title={title} />
        )}
      </AppShell>
    </BusinessContextProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

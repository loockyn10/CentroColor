import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BusinessContext } from '@centrocolor/application';
import { navigation, PageHeader } from '@centrocolor/ui';
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
  CobrosPage,
  PanelShell,
  ProductsPage,
  NewSalePage,
  SalesPage,
  StockPage,
  EventsPage,
  EventTypesPage,
  ResourcesPage,
  ResourceCalendarPage,
  FramingCatalogPage,
  NewFrameQuotePage,
  FrameJobsPage,
  PhotoServicesPage,
  NewPhotoJobPage,
  PhotoJobsPage,
  PhotoProductionPage,
  ServiceCatalogPage,
  PlotterMaterialsPage,
  PlotterPage,
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
import { SupabaseServiceCatalogRepository } from './supabase-service-catalog-repository';
import { SupabaseWorkPaymentRepository } from './supabase-work-payment-repository';
import { SupabasePhotoFileIntakeAdminRepository } from './photo-file-intake';
import { DriveSettingsPage } from './drive-settings';
import { publicRoute } from './public-routes';
import { WhatsAppSettingsPage } from './whatsapp-settings';
import {
  SupabasePhotoJobNotificationRepository,
  SupabaseWhatsAppAdminRepository,
} from './whatsapp-admin';

function PosSection({
  section,
  productRepository,
  saleRepository,
  inventoryRepository,
}: {
  section: 'products' | 'new-sale' | 'sales' | 'stock';
  productRepository: SupabaseProductRepository;
  saleRepository: SupabaseSaleRepository;
  inventoryRepository: SupabaseInventoryRepository;
}) {
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

function App() {
  const [activeId, setActiveId] = useState(() =>
    new URLSearchParams(window.location.search).has('googleDrive')
      ? 'settings'
      : 'home',
  );
  const [openPhotoJobId, setOpenPhotoJobId] = useState<string | null>(null);
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
  const [newJobCustomerId, setNewJobCustomerId] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate>('loading');
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerRepository] = useState(() => new SupabaseCustomerRepository());
  const [appointmentRepository] = useState(
    () => new SupabaseAppointmentRepository(),
  );
  const [productRepository] = useState(() => new SupabaseProductRepository());
  const [saleRepository] = useState(() => new SupabaseSaleRepository());
  const [inventoryRepository] = useState(
    () => new SupabaseInventoryRepository(),
  );
  const [eventRepository] = useState(() => new SupabaseEventRepository());
  const [framingRepository] = useState(() => new SupabaseFramingRepository());
  const [photoRepository] = useState(() => new SupabasePhotoRepository());
  const [serviceCatalogRepository] = useState(
    () => new SupabaseServiceCatalogRepository(),
  );
  const [paymentRepository] = useState(
    () => new SupabaseWorkPaymentRepository(),
  );
  const [fileIntakeRepository] = useState(
    () => new SupabasePhotoFileIntakeAdminRepository(),
  );
  const [whatsappRepository] = useState(
    () => new SupabaseWhatsAppAdminRepository(),
  );
  const [notificationRepository] = useState(
    () => new SupabasePhotoJobNotificationRepository(),
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
      <PanelShell
        activeId={activeId}
        onNavigate={navigateTo}
        platform="Web"
        onLogout={() => void logout()}
        customerRepository={customerRepository}
        photoRepository={photoRepository}
        paymentRepository={paymentRepository}
        productRepository={productRepository}
        inventoryRepository={inventoryRepository}
        onOpenCustomer={(id) => {
          setOpenCustomerId(id);
          setActiveId('customers');
        }}
        onOpenJob={openJob}
      >
        {activeId === 'home' ? (
          <HomePage
            appointmentRepository={appointmentRepository}
            eventRepository={eventRepository}
            photoRepository={photoRepository}
            paymentRepository={paymentRepository}
            saleRepository={saleRepository}
            framingRepository={framingRepository}
            productRepository={productRepository}
            inventoryRepository={inventoryRepository}
            onNavigate={navigateTo}
            onOpenJob={openJob}
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
          <>
            <PageHeader title="Tipos y parámetros" />
            <div className="catalog-stack">
              <AppointmentTypesPage
                repository={appointmentRepository}
                embedded
              />
              <EventTypesPage repository={eventRepository} embedded />
            </div>
          </>
        ) : activeId === 'events' ? (
          <EventsPage
            repository={eventRepository}
            customerRepository={customerRepository}
            serviceCatalogRepository={serviceCatalogRepository}
            paymentRepository={paymentRepository}
          />
        ) : activeId === 'resources' ? (
          <ResourcesPage
            repository={eventRepository}
            serviceCatalogRepository={serviceCatalogRepository}
          />
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
            serviceCatalogRepository={serviceCatalogRepository}
            initialCustomerId={newJobCustomerId}
          />
        ) : activeId === 'photo-jobs' ? (
          <PhotoJobsPage
            repository={photoRepository}
            paymentRepository={paymentRepository}
            fileIntakeRepository={fileIntakeRepository}
            notificationRepository={notificationRepository}
            initialJobId={openPhotoJobId}
          />
        ) : activeId === 'photo-production' ? (
          <PhotoProductionPage
            repository={photoRepository}
            fileIntakeRepository={fileIntakeRepository}
            notificationRepository={notificationRepository}
            onOpenJob={openJob}
          />
        ) : activeId === 'photo-services' ? (
          <PhotoServicesPage repository={photoRepository} />
        ) : activeId === 'services' || activeId === 'price-lists' ? (
          <ServiceCatalogPage
            repository={serviceCatalogRepository}
            photoRepository={photoRepository}
            eventRepository={eventRepository}
            onNavigate={navigateTo}
          />
        ) : activeId === 'plotter' ? (
          <PlotterPage
            repository={serviceCatalogRepository}
            customerRepository={customerRepository}
          />
        ) : activeId === 'plotter-materials' ? (
          <PlotterMaterialsPage repository={serviceCatalogRepository} />
        ) : activeId === 'customers' ? (
          <CustomersPage
            repository={customerRepository}
            paymentRepository={paymentRepository}
            photoRepository={photoRepository}
            serviceCatalogRepository={serviceCatalogRepository}
            eventRepository={eventRepository}
            storage="cloud"
            initialCustomerId={openCustomerId}
            onNewJob={(customerId) => {
              setNewJobCustomerId(customerId);
              setActiveId('new-photo-job');
            }}
            onOpenJob={openJob}
          />
        ) : activeId === 'payments' ? (
          <CobrosPage
            repository={paymentRepository}
            customerRepository={customerRepository}
          />
        ) : activeId === 'products' ||
          activeId === 'new-sale' ||
          activeId === 'sales' ||
          activeId === 'stock' ? (
          <PosSection
            section={activeId}
            productRepository={productRepository}
            saleRepository={saleRepository}
            inventoryRepository={inventoryRepository}
          />
        ) : activeId === 'settings' ? (
          <>
            <PageHeader title="Integraciones" />
            <div className="catalog-stack">
              <DriveSettingsPage
                context={context}
                repository={fileIntakeRepository}
              />
              <WhatsAppSettingsPage
                context={context}
                repository={whatsappRepository}
              />
            </div>
          </>
        ) : (
          <PlaceholderPage title={title} />
        )}
      </PanelShell>
    </BusinessContextProvider>
  );

  function navigateTo(id: string) {
    setOpenPhotoJobId(null);
    setOpenCustomerId(null);
    setNewJobCustomerId(null);
    setActiveId(id);
  }
  function openJob(id: string) {
    setOpenPhotoJobId(id);
    setActiveId('photo-jobs');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{publicRoute(window.location.pathname) ?? <App />}</StrictMode>,
);

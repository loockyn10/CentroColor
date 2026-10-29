import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  syncPosMutable,
  syncPosSales,
  syncAppointments,
  syncEventEntities,
  syncFramingEntities,
  syncPhotoEntities,
  syncPhotoFiles,
  syncStockMovements,
  syncWorkPayments,
  type BusinessContext,
} from '@centrocolor/application';
import { InlineMessage, navigation, PageHeader } from '@centrocolor/ui';
import {
  AuthStatePage,
  AppointmentTypesPage,
  AppointmentsPage,
  BusinessContextProvider,
  CalendarPage,
  CustomersPage,
  HomePage,
  CobrosPage,
  PanelShell,
  LoginPage,
  PlaceholderPage,
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
import {
  clearAuthorizedContext,
  loadOfflineContext,
  saveAuthorizedContext,
} from './local-auth-adapter';
import { SQLiteCustomerRepository } from './sqlite-customer-repository';
import {
  SQLiteCustomerSyncAdapter,
  type CustomerConflict,
  type CustomerSyncSummary,
} from './sqlite-customer-sync-adapter';
import {
  syncAuthenticatedCustomers,
  validateCloudBusinessContext,
} from './customer-sync-session';
import { CloudCustomerSyncAdapter } from './cloud-customer-sync-adapter';
import {
  syncServiceCatalog,
  catalogSyncIssues,
  type CatalogSyncIssue,
} from './service-catalog-sync';
import {
  stageNewLedEvents,
  restoreLedEventStatuses,
  clearSyncedLedIntents,
} from './event-led-sync-staging';
import {
  SQLiteProductRepository,
  SQLiteSaleRepository,
} from './sqlite-pos-repositories';
import {
  SQLitePosSyncAdapter,
  type PosConflict,
  type PosSyncSummary,
} from './sqlite-pos-sync-adapter';
import { CloudPosSyncAdapter } from './cloud-pos-sync-adapter';
import { SQLiteInventoryRepository } from './sqlite-inventory-repository';
import { SQLiteStockSyncAdapter } from './sqlite-stock-sync-adapter';
import { CloudStockSyncAdapter } from './cloud-stock-sync-adapter';
import { SQLiteAppointmentRepository } from './sqlite-appointment-repository';
import {
  SQLiteAppointmentSyncAdapter,
  type AppointmentConflict,
  type AppointmentSyncSummary,
} from './sqlite-appointment-sync-adapter';
import { CloudAppointmentSyncAdapter } from './cloud-appointment-sync-adapter';
import { SQLiteEventRepository } from './sqlite-event-repository';
import {
  SQLiteEventSyncAdapter,
  type EventConflict,
  type EventSyncSummary,
} from './sqlite-event-sync-adapter';
import { CloudEventSyncAdapter } from './cloud-event-sync-adapter';
import { SQLiteFramingSyncAdapter } from './sqlite-framing-sync-adapter';
import { CloudFramingSyncAdapter } from './cloud-framing-sync-adapter';
import { SQLiteFramingRepository } from './sqlite-framing-repository';
import { SQLitePhotoRepository } from './sqlite-photo-repository';
import { SQLiteServiceCatalogRepository } from './sqlite-service-catalog-repository';
import { SQLitePhotoSyncAdapter } from './sqlite-photo-sync-adapter';
import { CloudPhotoSyncAdapter } from './cloud-photo-sync-adapter';
import {
  CloudPhotoFileSyncAdapter,
  SQLitePhotoFileSyncAdapter,
} from './photo-file-sync-adapters';
import { SQLiteWorkPaymentRepository } from './sqlite-work-payment-repository';
import { SQLiteWorkPaymentSyncAdapter } from './sqlite-work-payment-sync-adapter';
import { CloudWorkPaymentSyncAdapter } from './cloud-work-payment-sync-adapter';

const customerRepository = new SQLiteCustomerRepository();
const customerSyncLocal = new SQLiteCustomerSyncAdapter();
const productRepository = new SQLiteProductRepository();
const saleRepository = new SQLiteSaleRepository();
const posSyncLocal = new SQLitePosSyncAdapter();
const inventoryRepository = new SQLiteInventoryRepository();
const stockSyncLocal = new SQLiteStockSyncAdapter();
const appointmentRepository = new SQLiteAppointmentRepository();
const appointmentSyncLocal = new SQLiteAppointmentSyncAdapter();
const eventRepository = new SQLiteEventRepository();
const eventSyncLocal = new SQLiteEventSyncAdapter();
const framingRepository = new SQLiteFramingRepository();
const framingSyncLocal = new SQLiteFramingSyncAdapter();
const photoRepository = new SQLitePhotoRepository();
const serviceCatalogRepository = new SQLiteServiceCatalogRepository();
const photoSyncLocal = new SQLitePhotoSyncAdapter();
const photoFileSyncLocal = new SQLitePhotoFileSyncAdapter();
const workPaymentRepository = new SQLiteWorkPaymentRepository();
const workPaymentSyncLocal = new SQLiteWorkPaymentSyncAdapter();

type Gate = 'loading' | 'login' | 'no-access' | 'ready' | 'error';

function App() {
  const [openPhotoJobId, setOpenPhotoJobId] = useState<string | null>(null);
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
  const [newJobCustomerId, setNewJobCustomerId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState('home');
  const [gate, setGate] = useState<Gate>('loading');
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudSessionReady, setCloudSessionReady] = useState(false);
  const [syncPhase, setSyncPhase] = useState<'idle' | 'syncing' | 'error'>(
    'idle',
  );
  const [syncSummary, setSyncSummary] = useState<CustomerSyncSummary | null>(
    null,
  );
  const [conflicts, setConflicts] = useState<CustomerConflict[]>([]);
  const [posSyncSummary, setPosSyncSummary] = useState<PosSyncSummary | null>(
    null,
  );
  const [stockSyncSummary, setStockSyncSummary] = useState<{
    pending: number;
    lastError: string | null;
  } | null>(null);
  const [posConflicts, setPosConflicts] = useState<PosConflict[]>([]);
  const [appointmentSyncSummary, setAppointmentSyncSummary] =
    useState<AppointmentSyncSummary | null>(null);
  const [appointmentConflicts, setAppointmentConflicts] = useState<
    AppointmentConflict[]
  >([]);
  const [eventSyncSummary, setEventSyncSummary] =
    useState<EventSyncSummary | null>(null);
  const [eventConflicts, setEventConflicts] = useState<EventConflict[]>([]);
  const [catalogIssues, setCatalogIssues] = useState<CatalogSyncIssue[]>([]);
  const [showConflicts, setShowConflicts] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [dataRefresh, setDataRefresh] = useState(0);
  const syncing = useRef(false);
  const resolving = useRef(false);

  async function refreshSyncSummary(businessId: string) {
    try {
      const [
        summary,
        currentConflicts,
        posSummary,
        currentPosConflicts,
        stockSummary,
        agendaSummary,
        agendaConflicts,
        eventsSummary,
        eventsConflicts,
        currentCatalogIssues,
      ] = await Promise.all([
        customerSyncLocal.summary(businessId),
        customerSyncLocal.conflicts(businessId),
        posSyncLocal.summary(businessId),
        posSyncLocal.conflicts(businessId),
        stockSyncLocal.summary(businessId),
        appointmentSyncLocal.summary(businessId),
        appointmentSyncLocal.conflicts(businessId),
        eventSyncLocal.summary(businessId),
        eventSyncLocal.conflicts(businessId),
        catalogSyncIssues(businessId),
      ]);
      setSyncSummary(summary);
      setConflicts(currentConflicts);
      setPosSyncSummary(posSummary);
      setStockSyncSummary(stockSummary);
      setPosConflicts(currentPosConflicts);
      setAppointmentSyncSummary(agendaSummary);
      setAppointmentConflicts(agendaConflicts);
      setEventSyncSummary(eventsSummary);
      setEventConflicts(eventsConflicts);
      setCatalogIssues(currentCatalogIssues);
    } catch {
      setSyncPhase('error');
    }
  }

  async function runSync(target: BusinessContext) {
    if (syncing.current || resolving.current || !navigator.onLine) return;
    syncing.current = true;
    setSyncPhase('syncing');
    try {
      // Price lists are a Customer FK and must arrive before Customer pull.
      await syncServiceCatalog('price_list', target.businessId);
      await syncServiceCatalog('travel_pricing_setting', target.businessId);
      await syncAuthenticatedCustomers(
        target,
        getSupabaseClient(),
        customerSyncLocal,
      );
      const cloudPos = new CloudPosSyncAdapter(getSupabaseClient());
      await syncPosMutable(
        'category',
        target.businessId,
        posSyncLocal,
        cloudPos,
      );
      await syncPosMutable(
        'product',
        target.businessId,
        posSyncLocal,
        cloudPos,
      );
      await syncPosSales(target.businessId, posSyncLocal, cloudPos);
      await syncStockMovements(
        target.businessId,
        stockSyncLocal,
        new CloudStockSyncAdapter(getSupabaseClient()),
      );
      const cloudAppointments = new CloudAppointmentSyncAdapter(
        getSupabaseClient(),
      );
      await syncAppointments(
        'appointment_type',
        target.businessId,
        appointmentSyncLocal,
        cloudAppointments,
      );
      await syncAppointments(
        'appointment',
        target.businessId,
        appointmentSyncLocal,
        cloudAppointments,
      );
      const cloudEvents = new CloudEventSyncAdapter(getSupabaseClient());
      for (const type of ['event_type', 'resource'] as const)
        await syncEventEntities(
          type,
          target.businessId,
          eventSyncLocal,
          cloudEvents,
        );
      for (const type of [
        'event_offer',
        'led_panel_pool',
        'led_preset',
        'led_controller',
        'event_offer_rate',
      ] as const)
        await syncServiceCatalog(type, target.businessId);
      await stageNewLedEvents(target.businessId);
      for (const type of [
        'event',
        'event_service_item',
        'resource_reservation',
      ] as const)
        await syncEventEntities(
          type,
          target.businessId,
          eventSyncLocal,
          cloudEvents,
        );
      await syncServiceCatalog('led_panel_reservation', target.businessId);
      await restoreLedEventStatuses(target.businessId);
      // Reservation edits can unblock a pending quoted → reserved transition.
      await syncEventEntities(
        'event',
        target.businessId,
        eventSyncLocal,
        cloudEvents,
      );
      await clearSyncedLedIntents(target.businessId);
      const cloudFraming = new CloudFramingSyncAdapter();
      for (const type of [
        'moulding',
        'material',
        'settings',
        'quote',
        'quote_item',
        'job',
      ] as const)
        await syncFramingEntities(
          type,
          target.businessId,
          framingSyncLocal,
          cloudFraming,
        );
      const cloudPhoto = new CloudPhotoSyncAdapter();
      await syncPhotoEntities(
        'photo_service',
        target.businessId,
        photoSyncLocal,
        cloudPhoto,
      );
      for (const type of [
        'lab_variant',
        'lab_price_tier',
        'plotter_material',
        'plotter_rate',
        'plotter_quote',
      ] as const)
        await syncServiceCatalog(type, target.businessId);
      for (const type of ['photo_job', 'photo_job_item'] as const)
        await syncPhotoEntities(
          type,
          target.businessId,
          photoSyncLocal,
          cloudPhoto,
        );
      await syncPhotoFiles(
        target.businessId,
        photoFileSyncLocal,
        new CloudPhotoFileSyncAdapter(),
      );
      await syncWorkPayments(
        target.businessId,
        workPaymentSyncLocal,
        new CloudWorkPaymentSyncAdapter(),
      );
      setSyncPhase('idle');
      setDataRefresh((value) => value + 1);
    } catch (syncError) {
      if (
        syncError instanceof Error &&
        (syncError.message.includes('sesión Cloud') ||
          syncError.message.includes('acceso Cloud'))
      ) {
        setCloudSessionReady(false);
        setContext((current) =>
          current
            ? { ...current, authorization: 'offline-authenticated' }
            : null,
        );
      }
      setSyncPhase('error');
    } finally {
      syncing.current = false;
      await refreshSyncSummary(target.businessId);
    }
  }

  async function resolvePosConflict(
    item: PosConflict,
    choice: 'local' | 'cloud',
  ) {
    if (!context || !cloudSessionReady || syncing.current || resolving.current)
      return;
    resolving.current = true;
    setResolutionBusy(true);
    setResolutionError(null);
    let resolved = false;
    try {
      const client = getSupabaseClient();
      await validateCloudBusinessContext(context, client);
      const remote = await new CloudPosSyncAdapter(client).get(
        item.type,
        context.businessId,
        item.id,
      );
      if (!remote) throw new Error('El registro Cloud ya no está disponible.');
      if (item.cloudUpdatedAt !== remote.updatedAt) {
        const change = await posSyncLocal.pendingFor(
          item.type,
          context.businessId,
          item.id,
        );
        if (change) await posSyncLocal.conflict(change, remote);
        await refreshSyncSummary(context.businessId);
        throw new Error(
          'Web volvió a cambiar este registro. Revisá ambas versiones actualizadas.',
        );
      }
      if (choice === 'cloud')
        await posSyncLocal.keepCloud(item.type, remote, item.localRevision);
      else await posSyncLocal.keepLocal(item.type, remote, item.localRevision);
      await refreshSyncSummary(context.businessId);
      resolved = true;
    } catch (failure) {
      setResolutionError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo resolver el conflicto.',
      );
    } finally {
      resolving.current = false;
      setResolutionBusy(false);
    }
    if (resolved) void runSync(context);
  }

  async function resolveAppointmentConflict(
    item: AppointmentConflict,
    choice: 'local' | 'cloud',
  ) {
    if (!context || !cloudSessionReady || syncing.current || resolving.current)
      return;
    resolving.current = true;
    setResolutionBusy(true);
    setResolutionError(null);
    let resolved = false;
    try {
      const client = getSupabaseClient();
      await validateCloudBusinessContext(context, client);
      const adapter = new CloudAppointmentSyncAdapter(client);
      const remote = await adapter.get(item.type, context.businessId, item.id);
      if (!remote) throw new Error('El registro Cloud ya no está disponible.');
      if (item.cloudUpdatedAt !== remote.updatedAt) {
        const change = await appointmentSyncLocal.pendingFor(
          item.type,
          context.businessId,
          item.id,
        );
        if (change) await appointmentSyncLocal.conflict(change, remote);
        await refreshSyncSummary(context.businessId);
        throw new Error(
          'Web volvió a cambiar este turno. Revisá las versiones.',
        );
      }
      if (choice === 'cloud')
        await appointmentSyncLocal.keepCloud(
          item.type,
          remote,
          item.localRevision,
        );
      else
        await appointmentSyncLocal.keepLocal(
          item.type,
          remote,
          item.localRevision,
        );
      await refreshSyncSummary(context.businessId);
      resolved = true;
    } catch (failure) {
      setResolutionError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo resolver el conflicto.',
      );
    } finally {
      resolving.current = false;
      setResolutionBusy(false);
    }
    if (resolved) void runSync(context);
  }

  async function resolveEventConflict(
    item: EventConflict,
    choice: 'local' | 'cloud',
  ) {
    if (
      item.kind === 'availability' ||
      !context ||
      !cloudSessionReady ||
      syncing.current ||
      resolving.current
    )
      return;
    resolving.current = true;
    setResolutionBusy(true);
    setResolutionError(null);
    let resolved = false;
    try {
      const client = getSupabaseClient();
      await validateCloudBusinessContext(context, client);
      const adapter = new CloudEventSyncAdapter(client);
      const remote = await adapter.get(item.type, context.businessId, item.id);
      if (!remote) throw new Error('El registro Cloud ya no está disponible.');
      if (item.cloudUpdatedAt !== remote.updatedAt) {
        const change = await eventSyncLocal.pendingFor(
          item.type,
          context.businessId,
          item.id,
        );
        if (change) await eventSyncLocal.conflict(change, remote);
        await refreshSyncSummary(context.businessId);
        throw new Error(
          'Web volvió a cambiar este registro. Revisá las versiones.',
        );
      }
      if (choice === 'cloud')
        await eventSyncLocal.keepCloud(item.type, remote, item.localRevision);
      else
        await eventSyncLocal.keepLocal(item.type, remote, item.localRevision);
      await refreshSyncSummary(context.businessId);
      resolved = true;
    } catch (failure) {
      setResolutionError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo resolver el conflicto.',
      );
    } finally {
      resolving.current = false;
      setResolutionBusy(false);
    }
    if (resolved) void runSync(context);
  }

  async function resolveConflict(
    item: CustomerConflict,
    choice: 'local' | 'cloud',
  ) {
    if (!context || !cloudSessionReady || syncing.current || resolving.current)
      return;
    resolving.current = true;
    setResolutionBusy(true);
    setResolutionError(null);
    let resolved = false;
    try {
      const client = getSupabaseClient();
      await validateCloudBusinessContext(context, client);
      const remote = await new CloudCustomerSyncAdapter(client).get(
        context.businessId,
        item.id,
      );
      if (!remote) throw new Error('El cliente Cloud ya no está disponible.');
      if (choice === 'cloud') {
        await customerSyncLocal.keepCloud(remote, item.localRevision);
        setDataRefresh((value) => value + 1);
      } else {
        await customerSyncLocal.keepLocal(remote, item.localRevision);
      }
      await refreshSyncSummary(context.businessId);
      resolved = true;
    } catch (resolutionFailure) {
      setResolutionError(
        resolutionFailure instanceof Error
          ? resolutionFailure.message
          : 'No se pudo resolver el conflicto.',
      );
    } finally {
      resolving.current = false;
      setResolutionBusy(false);
    }
    if (resolved && choice === 'local') void runSync(context);
  }

  useEffect(() => {
    let live = true;
    void loadOfflineContext()
      .then((cached) => {
        if (!live) return;
        setContext(cached);
        setGate(cached ? 'ready' : 'login');
        if (cached) {
          void refreshSyncSummary(cached.businessId);
          // Desktop normally has no persisted token. A live in-memory session
          // (for example after a hot reload) can resume in the background.
          try {
            void getSupabaseClient()
              .auth.getSession()
              .then(({ data }) => {
                if (live && data.session?.user.id === cached.userId)
                  setCloudSessionReady(true);
              })
              .catch(() => {});
          } catch {
            /* Offline local access must remain available without Cloud config. */
          }
        }
      })
      .catch(() => {
        if (live) {
          setError('No se pudo abrir la identidad local.');
          setGate('error');
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (gate !== 'ready' || !context || !cloudSessionReady) return;
    void runSync(context);
    const timer = window.setInterval(() => void runSync(context), 120_000);
    const onOnline = () => void runSync(context);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [gate, context, cloudSessionReady]);

  async function login(email: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const { data, error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (authError || !data.user) {
        setError('Correo o contraseña incorrectos, o no hay conexión.');
        return;
      }
      const resolved = await loadCloudBusinessContext(
        data.user.id,
        { requireBranch: true, preferredBusinessId: context?.businessId },
        client,
      );
      if (!resolved) {
        await clearAuthorizedContext();
        setCloudSessionReady(false);
        setContext(null);
        setGate('no-access');
        return;
      }
      await saveAuthorizedContext(resolved);
      setContext(resolved);
      setSyncSummary(null);
      setCloudSessionReady(true);
      setGate('ready');
    } catch {
      setError(
        'No se pudo validar el acceso. Revisá la conexión y la configuración de Supabase.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setCloudSessionReady(false);
    try {
      await clearAuthorizedContext();
    } catch {
      setError('No se pudo borrar el acceso local.');
      setGate('error');
      return;
    }
    try {
      await getSupabaseClient().auth.signOut({ scope: 'local' });
    } catch {
      /* No cloud session may exist offline. */
    }
    setContext(null);
    setSyncSummary(null);
    setConflicts([]);
    setPosSyncSummary(null);
    setStockSyncSummary(null);
    setPosConflicts([]);
    setAppointmentSyncSummary(null);
    setAppointmentConflicts([]);
    setEventSyncSummary(null);
    setEventConflicts([]);
    setError(null);
    setGate('login');
  }

  if (gate === 'loading')
    return (
      <AuthStatePage
        title="Abriendo CentroColor"
        message="Comprobando acceso local…"
      />
    );
  if (gate === 'login')
    return (
      <LoginPage
        onLogin={login}
        busy={busy}
        error={error}
        offlineAvailable={Boolean(context)}
        onUseOffline={context ? () => setGate('ready') : undefined}
      />
    );
  if (gate === 'no-access')
    return (
      <AuthStatePage
        title="Sin acceso asignado"
        message="Tu usuario no tiene un negocio y una sucursal activos asignados."
        onLogout={() => void logout()}
      />
    );
  if (gate === 'error')
    return (
      <AuthStatePage
        title="Acceso local no disponible"
        message={error ?? 'Reiniciá la aplicación.'}
      />
    );
  if (!context) return null;
  const navigateTo = (id: string) => {
    setOpenPhotoJobId(null);
    setOpenCustomerId(null);
    setNewJobCustomerId(null);
    setActiveId(id);
  };
  const openJob = (id: string) => {
    setOpenPhotoJobId(id);
    setActiveId('photo-jobs');
  };
  const title =
    navigation.find((item) => item.id === activeId)?.label ?? 'Inicio';
  const catalogPending = catalogIssues.filter(
    (x) => x.status === 'pending',
  ).length;
  const catalogConflicts = catalogIssues.filter(
    (x) => x.status === 'conflict',
  ).length;
  const syncLabel =
    (syncSummary?.conflicts ?? 0) +
      (posSyncSummary?.conflicts ?? 0) +
      (appointmentSyncSummary?.conflicts ?? 0) +
      (eventSyncSummary?.conflicts ?? 0) +
      catalogConflicts >
    0
      ? 'Conflicto'
      : syncPhase === 'syncing'
        ? 'Sincronizando'
        : syncPhase === 'error'
          ? 'Error de sincronización'
          : !cloudSessionReady || !online
            ? 'Sin conexión'
            : (syncSummary?.pending ?? 0) +
                  (posSyncSummary?.pending ?? 0) +
                  (stockSyncSummary?.pending ?? 0) +
                  (appointmentSyncSummary?.pending ?? 0) +
                  (eventSyncSummary?.pending ?? 0) +
                  catalogPending >
                0
              ? 'Cambios pendientes'
              : 'Sincronizado';
  return (
    <BusinessContextProvider context={context}>
      <PanelShell
        activeId={activeId}
        onNavigate={navigateTo}
        platform="Desktop"
        onLogout={() => void logout()}
        customerRepository={customerRepository}
        photoRepository={photoRepository}
        paymentRepository={workPaymentRepository}
        productRepository={productRepository}
        inventoryRepository={inventoryRepository}
        refreshToken={dataRefresh}
        onOpenCustomer={(id) => {
          setOpenCustomerId(id);
          setActiveId('customers');
        }}
        onOpenJob={openJob}
        statusArea={
          <div>
            <div className="sync-status-bar" role="status">
              <strong>Sincronización: {syncLabel}</strong>
              {(syncSummary?.pending ?? 0) +
                (posSyncSummary?.pending ?? 0) +
                (stockSyncSummary?.pending ?? 0) +
                (appointmentSyncSummary?.pending ?? 0) +
                (eventSyncSummary?.pending ?? 0) +
                catalogPending >
                0 && (
                <span>
                  {(syncSummary?.pending ?? 0) +
                    (posSyncSummary?.pending ?? 0) +
                    (stockSyncSummary?.pending ?? 0) +
                    (appointmentSyncSummary?.pending ?? 0) +
                    (eventSyncSummary?.pending ?? 0) +
                    catalogPending}{' '}
                  pendiente(s)
                </span>
              )}
              {(syncSummary?.conflicts ?? 0) +
                (posSyncSummary?.conflicts ?? 0) +
                (appointmentSyncSummary?.conflicts ?? 0) +
                (eventSyncSummary?.conflicts ?? 0) +
                catalogConflicts >
                0 && (
                <span>
                  {(syncSummary?.conflicts ?? 0) +
                    (posSyncSummary?.conflicts ?? 0) +
                    (appointmentSyncSummary?.conflicts ?? 0) +
                    (eventSyncSummary?.conflicts ?? 0) +
                    catalogConflicts}{' '}
                  conflicto(s)
                </span>
              )}
              <button
                type="button"
                disabled={syncPhase === 'syncing' || resolutionBusy}
                onClick={() => {
                  if (cloudSessionReady) {
                    void runSync(context);
                  } else {
                    setContext({
                      ...context,
                      authorization: 'offline-authenticated',
                    });
                    setGate('login');
                  }
                }}
              >
                Sincronizar ahora
              </button>
              {conflicts.length +
                posConflicts.length +
                appointmentConflicts.length +
                eventConflicts.length +
                catalogConflicts >
                0 && (
                <button
                  type="button"
                  onClick={() => setShowConflicts((value) => !value)}
                >
                  {showConflicts ? 'Ocultar conflictos' : 'Revisar conflictos'}
                </button>
              )}
              {(syncSummary?.conflicts ?? 0) +
                (posSyncSummary?.conflicts ?? 0) +
                (appointmentSyncSummary?.conflicts ?? 0) +
                (eventSyncSummary?.conflicts ?? 0) +
                catalogConflicts >
              0 ? (
                <small>Los cambios locales siguen guardados.</small>
              ) : !cloudSessionReady ? (
                <small>Revalidá el acceso para sincronizar.</small>
              ) : syncPhase === 'error' ? (
                <small>
                  {stockSyncSummary?.lastError ??
                    eventSyncSummary?.lastError ??
                    appointmentSyncSummary?.lastError ??
                    posSyncSummary?.lastError ??
                    syncSummary?.lastError ??
                    'Reintentá cuando vuelva la conexión.'}
                </small>
              ) : null}
            </div>
            {showConflicts &&
              conflicts.length +
                posConflicts.length +
                appointmentConflicts.length +
                eventConflicts.length +
                catalogConflicts >
                0 && (
                <div className="sync-conflict-panel">
                  <p>
                    Estos registros cambiaron en este equipo y en Web. Elegí
                    cuál versión conservar. La versión descartada no se
                    recuperará desde esta pantalla.
                  </p>
                  {resolutionError && <p role="alert">{resolutionError}</p>}
                  {conflicts.map((item) => (
                    <div className="sync-conflict-row" key={item.id}>
                      <strong>{item.fullName}</strong>
                      <button
                        type="button"
                        disabled={
                          !cloudSessionReady ||
                          resolutionBusy ||
                          syncPhase === 'syncing'
                        }
                        onClick={() => void resolveConflict(item, 'local')}
                      >
                        Conservar este equipo
                      </button>
                      <button
                        type="button"
                        disabled={
                          !cloudSessionReady ||
                          resolutionBusy ||
                          syncPhase === 'syncing'
                        }
                        onClick={() => void resolveConflict(item, 'cloud')}
                      >
                        Conservar Web
                      </button>
                    </div>
                  ))}
                  {posConflicts.map((item) => (
                    <div
                      className="sync-conflict-row"
                      key={`${item.type}-${item.id}`}
                    >
                      <strong>
                        {item.type === 'category' ? 'Categoría' : 'Producto'}:{' '}
                        {item.name}
                      </strong>
                      <small>Este equipo: {item.localSummary}</small>
                      <small>Web: {item.cloudSummary}</small>
                      <button
                        type="button"
                        disabled={
                          !cloudSessionReady ||
                          resolutionBusy ||
                          syncPhase === 'syncing'
                        }
                        onClick={() => void resolvePosConflict(item, 'local')}
                      >
                        Conservar este equipo
                      </button>
                      <button
                        type="button"
                        disabled={
                          !cloudSessionReady ||
                          resolutionBusy ||
                          syncPhase === 'syncing'
                        }
                        onClick={() => void resolvePosConflict(item, 'cloud')}
                      >
                        Conservar Web
                      </button>
                    </div>
                  ))}
                  {appointmentConflicts.map((item) => (
                    <div
                      className="sync-conflict-row"
                      key={`${item.type}-${item.id}`}
                    >
                      <strong>
                        {item.type === 'appointment_type' ? 'Tipo' : 'Turno'}:{' '}
                        {item.label}
                      </strong>
                      <small>Este equipo: {item.localSummary}</small>
                      <small>Web: {item.cloudSummary}</small>
                      <button
                        type="button"
                        disabled={
                          !cloudSessionReady ||
                          resolutionBusy ||
                          syncPhase === 'syncing'
                        }
                        onClick={() =>
                          void resolveAppointmentConflict(item, 'local')
                        }
                      >
                        Conservar este equipo
                      </button>
                      <button
                        type="button"
                        disabled={
                          !cloudSessionReady ||
                          resolutionBusy ||
                          syncPhase === 'syncing'
                        }
                        onClick={() =>
                          void resolveAppointmentConflict(item, 'cloud')
                        }
                      >
                        Conservar Web
                      </button>
                    </div>
                  ))}
                  {eventConflicts.map((item) => (
                    <div
                      className="sync-conflict-row"
                      key={`${item.type}-${item.id}`}
                    >
                      <strong>
                        {item.kind === 'availability'
                          ? 'Reserva de recurso en conflicto'
                          : 'Servicios y recursos'}
                        : {item.label}
                      </strong>
                      <small>Este equipo: {item.localSummary}</small>
                      <small>Cloud: {item.cloudSummary}</small>
                      {item.kind === 'availability' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId('events');
                            setShowConflicts(false);
                          }}
                        >
                          Abrir Presupuestos y reservas
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={
                              !cloudSessionReady ||
                              resolutionBusy ||
                              syncPhase === 'syncing'
                            }
                            onClick={() =>
                              void resolveEventConflict(item, 'local')
                            }
                          >
                            Conservar este equipo
                          </button>
                          <button
                            type="button"
                            disabled={
                              !cloudSessionReady ||
                              resolutionBusy ||
                              syncPhase === 'syncing'
                            }
                            onClick={() =>
                              void resolveEventConflict(item, 'cloud')
                            }
                          >
                            Conservar Web
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {catalogIssues
                    .filter((x) => x.status === 'conflict')
                    .map((item) => (
                      <div className="sync-conflict-row" key={item.id}>
                        <strong>
                          {item.source}: {item.entityType.replaceAll('_', ' ')}
                        </strong>
                        <small>
                          {item.lastError ??
                            'La versión Cloud cambió o la reserva ya no está disponible.'}
                        </small>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId(
                              item.entityType.includes('reservation')
                                ? 'events'
                                : 'services',
                            );
                            setShowConflicts(false);
                          }}
                        >
                          Abrir módulo
                        </button>
                      </div>
                    ))}
                  {(syncSummary?.conflicts ?? 0) +
                    (posSyncSummary?.conflicts ?? 0) +
                    (appointmentSyncSummary?.conflicts ?? 0) +
                    (eventSyncSummary?.conflicts ?? 0) +
                    catalogConflicts >
                    conflicts.length +
                      posConflicts.length +
                      appointmentConflicts.length +
                      eventConflicts.length +
                      catalogConflicts && (
                    <p>Se muestran los primeros 20 conflictos.</p>
                  )}
                </div>
              )}
          </div>
        }
      >
        {activeId === 'home' ? (
          <HomePage
            appointmentRepository={appointmentRepository}
            eventRepository={eventRepository}
            photoRepository={photoRepository}
            paymentRepository={workPaymentRepository}
            saleRepository={saleRepository}
            framingRepository={framingRepository}
            productRepository={productRepository}
            inventoryRepository={inventoryRepository}
            refreshToken={dataRefresh}
            onNavigate={navigateTo}
            onOpenJob={openJob}
            onRevalidate={
              context.authorization === 'offline-authenticated'
                ? () => setGate('login')
                : undefined
            }
          />
        ) : activeId === 'calendar' ? (
          <CalendarPage
            repository={appointmentRepository}
            customerRepository={customerRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'appointments' ? (
          <AppointmentsPage
            repository={appointmentRepository}
            customerRepository={customerRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'appointment-types' ? (
          <>
            <PageHeader title="Tipos y parámetros" />
            <div className="catalog-stack">
              <AppointmentTypesPage
                repository={appointmentRepository}
                refreshToken={dataRefresh}
                embedded
                onMutation={() => {
                  void refreshSyncSummary(context.businessId);
                  if (cloudSessionReady) void runSync(context);
                }}
              />
              <EventTypesPage
                repository={eventRepository}
                embedded
                onMutation={() => {
                  void refreshSyncSummary(context.businessId);
                  if (cloudSessionReady) void runSync(context);
                }}
              />
            </div>
          </>
        ) : activeId === 'events' ? (
          <EventsPage
            repository={eventRepository}
            customerRepository={customerRepository}
            serviceCatalogRepository={serviceCatalogRepository}
            paymentRepository={workPaymentRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'resources' ? (
          <ResourcesPage
            repository={eventRepository}
            serviceCatalogRepository={serviceCatalogRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'resource-calendar' ? (
          <ResourceCalendarPage
            repository={eventRepository}
            refreshToken={dataRefresh}
          />
        ) : activeId === 'new-quote' ? (
          <NewFrameQuotePage
            repository={framingRepository}
            onMutation={() => setDataRefresh((x) => x + 1)}
          />
        ) : activeId === 'frame-jobs' ? (
          <FrameJobsPage
            repository={framingRepository}
            paymentRepository={workPaymentRepository}
          />
        ) : activeId === 'mouldings' ? (
          <FramingCatalogPage
            repository={framingRepository}
            kind="mouldings"
            onMutation={() => setDataRefresh((x) => x + 1)}
          />
        ) : activeId === 'new-photo-job' ? (
          <NewPhotoJobPage
            repository={photoRepository}
            customerRepository={customerRepository}
            serviceCatalogRepository={serviceCatalogRepository}
            initialCustomerId={newJobCustomerId}
            refreshToken={dataRefresh}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'photo-jobs' ? (
          <PhotoJobsPage
            repository={photoRepository}
            paymentRepository={workPaymentRepository}
            initialJobId={openPhotoJobId}
            refreshToken={dataRefresh}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'photo-production' ? (
          <PhotoProductionPage
            repository={photoRepository}
            refreshToken={dataRefresh}
            onOpenJob={openJob}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'photo-services' ? (
          <PhotoServicesPage
            repository={photoRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'services' || activeId === 'price-lists' ? (
          <ServiceCatalogPage
            repository={serviceCatalogRepository}
            photoRepository={photoRepository}
            eventRepository={eventRepository}
            onNavigate={navigateTo}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'plotter' ? (
          <PlotterPage
            repository={serviceCatalogRepository}
            customerRepository={customerRepository}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'plotter-materials' ? (
          <PlotterMaterialsPage
            repository={serviceCatalogRepository}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'materials' ? (
          <FramingCatalogPage
            repository={framingRepository}
            kind="materials"
            onMutation={() => setDataRefresh((x) => x + 1)}
          />
        ) : activeId === 'customers' ? (
          <CustomersPage
            repository={customerRepository}
            paymentRepository={workPaymentRepository}
            photoRepository={photoRepository}
            serviceCatalogRepository={serviceCatalogRepository}
            eventRepository={eventRepository}
            storage="local"
            initialCustomerId={openCustomerId}
            onNewJob={(customerId) => {
              setNewJobCustomerId(customerId);
              setActiveId('new-photo-job');
            }}
            onOpenJob={openJob}
            refreshToken={dataRefresh}
            onLocalMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'payments' ? (
          <CobrosPage
            repository={workPaymentRepository}
            customerRepository={customerRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              setDataRefresh((x) => x + 1);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'settings' ? (
          <>
            <PageHeader title="Integraciones" />
            <InlineMessage tone="info">
              Google Drive y WhatsApp se configuran desde la versión Web.
            </InlineMessage>
          </>
        ) : activeId === 'products' ? (
          <ProductsPage
            repository={productRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'new-sale' ? (
          <NewSalePage
            productRepository={productRepository}
            saleRepository={saleRepository}
            inventoryRepository={inventoryRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : activeId === 'sales' ? (
          <SalesPage repository={saleRepository} refreshToken={dataRefresh} />
        ) : activeId === 'stock' ? (
          <StockPage
            productRepository={productRepository}
            inventoryRepository={inventoryRepository}
            refreshToken={dataRefresh}
            onMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
        ) : (
          <PlaceholderPage title={title} />
        )}
      </PanelShell>
    </BusinessContextProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

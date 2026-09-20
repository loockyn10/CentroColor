import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BusinessContext } from '@centrocolor/application';
import { AppShell, navigation } from '@centrocolor/ui';
import {
  AuthStatePage,
  BusinessContextProvider,
  CustomersPage,
  HomePage,
  LoginPage,
  PlaceholderPage,
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

const customerRepository = new SQLiteCustomerRepository();
const customerSyncLocal = new SQLiteCustomerSyncAdapter();

type Gate = 'loading' | 'login' | 'no-access' | 'ready' | 'error';

function App() {
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
  const [showConflicts, setShowConflicts] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [customerRefresh, setCustomerRefresh] = useState(0);
  const syncing = useRef(false);
  const resolving = useRef(false);

  async function refreshSyncSummary(businessId: string) {
    try {
      const [summary, currentConflicts] = await Promise.all([
        customerSyncLocal.summary(businessId),
        customerSyncLocal.conflicts(businessId),
      ]);
      setSyncSummary(summary);
      setConflicts(currentConflicts);
    } catch {
      setSyncPhase('error');
    }
  }

  async function runSync(target: BusinessContext) {
    if (syncing.current || resolving.current || !navigator.onLine) return;
    syncing.current = true;
    setSyncPhase('syncing');
    try {
      await syncAuthenticatedCustomers(
        target,
        getSupabaseClient(),
        customerSyncLocal,
      );
      setSyncPhase('idle');
      setCustomerRefresh((value) => value + 1);
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
        setCustomerRefresh((value) => value + 1);
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
  const title =
    navigation.find((item) => item.id === activeId)?.label ?? 'Inicio';
  const syncLabel =
    syncSummary && syncSummary.conflicts > 0
      ? 'Conflicto'
      : syncPhase === 'syncing'
        ? 'Sincronizando'
        : syncPhase === 'error'
          ? 'Error de sincronización'
          : !cloudSessionReady || !online
            ? 'Sin conexión'
            : syncSummary && syncSummary.pending > 0
              ? 'Cambios pendientes'
              : 'Sincronizado';
  return (
    <BusinessContextProvider context={context}>
      <AppShell
        activeId={activeId}
        onNavigate={setActiveId}
        platform="Desktop"
        onLogout={() => void logout()}
        statusArea={
          <div>
            <div className="sync-status-bar" role="status">
              <strong>{syncLabel}</strong>
              {syncSummary && syncSummary.pending > 0 && (
                <span>{syncSummary.pending} pendiente(s)</span>
              )}
              {syncSummary && syncSummary.conflicts > 0 && (
                <span>{syncSummary.conflicts} conflicto(s)</span>
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
              {conflicts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowConflicts((value) => !value)}
                >
                  {showConflicts ? 'Ocultar conflictos' : 'Revisar conflictos'}
                </button>
              )}
              {syncSummary && syncSummary.conflicts > 0 ? (
                <small>Los cambios locales siguen guardados.</small>
              ) : !cloudSessionReady ? (
                <small>Revalidá el acceso para sincronizar.</small>
              ) : syncPhase === 'error' ? (
                <small>Reintentá cuando vuelva la conexión.</small>
              ) : null}
            </div>
            {showConflicts && conflicts.length > 0 && (
              <div className="sync-conflict-panel">
                <p>
                  Cada cliente cambió en este equipo y en Web. Elegí cuál
                  versión conservar. La versión descartada no se recuperará
                  desde esta pantalla.
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
                {syncSummary && syncSummary.conflicts > conflicts.length && (
                  <p>Se muestran los primeros 20 conflictos.</p>
                )}
              </div>
            )}
          </div>
        }
      >
        {activeId === 'home' ? (
          <HomePage
            onRevalidate={
              context.authorization === 'offline-authenticated'
                ? () => setGate('login')
                : undefined
            }
          />
        ) : activeId === 'customers' ? (
          <CustomersPage
            repository={customerRepository}
            storage="local"
            refreshToken={customerRefresh}
            onLocalMutation={() => {
              void refreshSyncSummary(context.businessId);
              if (cloudSessionReady) void runSync(context);
            }}
          />
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

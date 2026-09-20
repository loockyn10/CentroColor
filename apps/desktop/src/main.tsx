import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BusinessContext } from '@centrocolor/application';
import { AppShell, navigation } from '@centrocolor/ui';
import {
  AuthStatePage,
  BusinessContextProvider,
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

type Gate = 'loading' | 'login' | 'no-access' | 'ready' | 'error';

function App() {
  const [activeId, setActiveId] = useState('home');
  const [gate, setGate] = useState<Gate>('loading');
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadOfflineContext()
      .then((cached) => {
        if (!live) return;
        setContext(cached);
        setGate(cached ? 'ready' : 'login');
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
        { requireBranch: true },
        client,
      );
      if (!resolved) {
        await clearAuthorizedContext();
        setContext(null);
        setGate('no-access');
        return;
      }
      await saveAuthorizedContext(resolved);
      setContext(resolved);
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
        offlineAvailable={context?.authorization === 'offline-authenticated'}
        onUseOffline={
          context?.authorization === 'offline-authenticated'
            ? () => setGate('ready')
            : undefined
        }
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
  return (
    <BusinessContextProvider context={context}>
      <AppShell
        activeId={activeId}
        onNavigate={setActiveId}
        platform="Desktop"
        onLogout={() => void logout()}
      >
        {activeId === 'home' ? (
          <HomePage
            onRevalidate={
              context.authorization === 'offline-authenticated'
                ? () => setGate('login')
                : undefined
            }
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

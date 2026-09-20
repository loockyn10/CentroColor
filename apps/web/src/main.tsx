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

type Gate = 'loading' | 'login' | 'no-access' | 'ready' | 'error';

function App() {
  const [activeId, setActiveId] = useState('home');
  const [gate, setGate] = useState<Gate>('loading');
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let client;
    try {
      client = getSupabaseClient();
    } catch {
      setError('Configurá la conexión de Supabase para iniciar sesión.');
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
      try {
        const { data, error: authError } = await client.auth.getUser();
        if (!live) return;
        if (authError || !data.user) {
          setGate('login');
          return;
        }
        const resolved = await loadCloudBusinessContext(
          data.user.id,
          {},
          client,
        );
        if (!live) return;
        setContext(resolved);
        setGate(resolved ? 'ready' : 'no-access');
      } catch {
        if (live) {
          setError(
            'No se pudo validar el acceso. Revisá tu conexión e intentá de nuevo.',
          );
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
    try {
      const client = getSupabaseClient();
      const { data, error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (authError || !data.user) {
        setError('Correo o contraseña incorrectos.');
        return;
      }
      const resolved = await loadCloudBusinessContext(data.user.id, {}, client);
      setContext(resolved);
      setGate(resolved ? 'ready' : 'no-access');
    } catch {
      setError('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
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
        {activeId === 'home' ? <HomePage /> : <PlaceholderPage title={title} />}
      </AppShell>
    </BusinessContextProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

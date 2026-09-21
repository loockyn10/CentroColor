import { StrictMode, useEffect, useState } from 'react';
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
  ProductsPage,
  NewSalePage,
  SalesPage,
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

function PosSection({
  section,
}: {
  section: 'products' | 'new-sale' | 'sales';
}) {
  const [productRepository] = useState(() => new SupabaseProductRepository());
  const [saleRepository] = useState(() => new SupabaseSaleRepository());
  if (section === 'products')
    return <ProductsPage repository={productRepository} storage="cloud" />;
  if (section === 'new-sale')
    return (
      <NewSalePage
        productRepository={productRepository}
        saleRepository={saleRepository}
      />
    );
  return <SalesPage repository={saleRepository} storage="cloud" />;
}

type Gate = 'loading' | 'login' | 'no-access' | 'ready' | 'error';

function CustomerSection() {
  const [repository] = useState(() => new SupabaseCustomerRepository());
  return <CustomersPage repository={repository} storage="cloud" />;
}

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
          <HomePage />
        ) : activeId === 'customers' ? (
          <CustomerSection />
        ) : activeId === 'products' ? (
          <PosSection section="products" />
        ) : activeId === 'new-sale' ? (
          <PosSection section="new-sale" />
        ) : activeId === 'sales' ? (
          <PosSection section="sales" />
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

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell, navigation } from '@centrocolor/ui';
import { HomePage, PlaceholderPage } from '@centrocolor/features';
import '@centrocolor/ui/styles.css';
import { checkSupabaseConnection } from './supabase-identity-adapter';

function App() {
  const [activeId, setActiveId] = useState('home');
  const [cloudStatus, setCloudStatus] = useState('comprobando');
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void checkSupabaseConnection()
      .then((status) => setCloudStatus(status))
      .catch((error: unknown) => {
        setCloudStatus(
          error instanceof Error
            ? error.message
            : 'configuración no disponible',
        );
      });
  }, []);
  const title =
    navigation.find((item) => item.id === activeId)?.label ?? 'Inicio';
  return (
    <AppShell activeId={activeId} onNavigate={setActiveId} platform="Web">
      {activeId === 'home' ? <HomePage /> : <PlaceholderPage title={title} />}
      {import.meta.env.DEV && (
        <p className="dev-status">Supabase: {cloudStatus}</p>
      )}
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

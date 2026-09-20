import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell, navigation } from '@centrocolor/ui';
import { HomePage, PlaceholderPage } from '@centrocolor/features';
import { getStorageHealth } from '@centrocolor/application';
import { SqliteStorageHealthAdapter } from './sqlite-adapter';
import '@centrocolor/ui/styles.css';

function App() {
  const [activeId, setActiveId] = useState('home');
  const [storageHealth, setStorageHealth] = useState('checking');
  useEffect(() => {
    void getStorageHealth(new SqliteStorageHealthAdapter()).then(
      setStorageHealth,
    );
  }, []);
  const title =
    navigation.find((item) => item.id === activeId)?.label ?? 'Inicio';
  return (
    <AppShell activeId={activeId} onNavigate={setActiveId} platform="Desktop">
      {activeId === 'home' ? <HomePage /> : <PlaceholderPage title={title} />}
      {import.meta.env.DEV && (
        <p className="dev-status">Local database: {storageHealth}</p>
      )}
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

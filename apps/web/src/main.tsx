import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell, navigation } from '@centrocolor/ui';
import { HomePage, PlaceholderPage } from '@centrocolor/features';
import '@centrocolor/ui/styles.css';

function App() {
  const [activeId, setActiveId] = useState('home');
  const title =
    navigation.find((item) => item.id === activeId)?.label ?? 'Inicio';
  return (
    <AppShell activeId={activeId} onNavigate={setActiveId} platform="Web">
      {activeId === 'home' ? <HomePage /> : <PlaceholderPage title={title} />}
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

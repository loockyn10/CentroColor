import { createContext, type ReactNode } from 'react';

/** El shell entrega sus pestañas de módulo al `PageHeader` para dibujarlas bajo el título. */
export const PageTabsContext = createContext<{
  tabs: ReactNode;
  moduleLabel: string;
  claim: (on: boolean) => void;
} | null>(null);

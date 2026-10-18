import type { PropsWithChildren, ReactNode } from 'react';
import type {
  CustomerRepository,
  InventoryRepository,
  PhotoRepository,
  ProductRepository,
  WorkPaymentRepository,
} from '@centrocolor/application';
import { AppShell } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { useNavAttention } from './attention';
import { GlobalSearch } from './search';
import { GlobalScannerProvider } from './global-scanner';

/**
 * Shell del panel para Web y Desktop: navegación por módulos, buscador global, contadores de
 * atención y datos del usuario. Cada app aporta sus repositorios; no hay lógica de plataforma.
 */
export function PanelShell({
  activeId,
  onNavigate,
  platform,
  onLogout,
  statusArea,
  customerRepository,
  photoRepository,
  paymentRepository,
  productRepository,
  inventoryRepository,
  refreshToken,
  onOpenCustomer,
  onOpenJob,
  children,
}: PropsWithChildren<{
  activeId: string;
  onNavigate: (id: string) => void;
  platform: 'Desktop' | 'Web';
  onLogout: () => void;
  statusArea?: ReactNode;
  customerRepository: CustomerRepository;
  photoRepository: PhotoRepository;
  paymentRepository: WorkPaymentRepository;
  productRepository: ProductRepository;
  inventoryRepository: InventoryRepository;
  refreshToken?: number;
  onOpenCustomer: (customerId: string) => void;
  onOpenJob: (jobId: string) => void;
}>) {
  const context = useBusinessContext();
  const badges = useNavAttention({
    photoRepository,
    paymentRepository,
    productRepository,
    inventoryRepository,
    refreshToken,
  });
  return (
    <AppShell
      activeId={activeId}
      onNavigate={onNavigate}
      platform={platform}
      onLogout={onLogout}
      statusArea={statusArea}
      badges={badges}
      user={{
        name: context.profile.displayName || 'Usuario',
        detail:
          [context.businessName, context.branchName]
            .filter(Boolean)
            .join(' · ') || undefined,
      }}
      search={(onDone) => (
        <GlobalSearch
          customerRepository={customerRepository}
          photoRepository={photoRepository}
          onOpenCustomer={onOpenCustomer}
          onOpenJob={onOpenJob}
          onDone={onDone}
        />
      )}
    >
      <GlobalScannerProvider
        productRepository={productRepository}
        activePage={activeId}
        onNavigate={onNavigate}
      >
        {children}
      </GlobalScannerProvider>
    </AppShell>
  );
}

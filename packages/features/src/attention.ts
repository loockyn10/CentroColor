import { useEffect, useState } from 'react';
import type {
  InventoryRepository,
  PhotoRepository,
  ProductRepository,
  WorkPaymentRepository,
} from '@centrocolor/application';
import { isPhotoJobOverdue } from '@centrocolor/domain';
import type { NavBadges } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

/** Estados de la fuente que significan «el trabajo ya terminó»: ahí un saldo sí requiere acción. */
const finished = new Set(['ready', 'completed', 'delivered']);

/**
 * Contadores de la barra lateral. Sólo cuentan lo que pide atención real:
 * trabajos atrasados (rojo), trabajos terminados con saldo y productos sin stock.
 * Cada repositorio es opcional: sin él, ese contador no aparece.
 */
export function useNavAttention({
  photoRepository,
  paymentRepository,
  productRepository,
  inventoryRepository,
  refreshToken,
}: {
  photoRepository?: PhotoRepository;
  paymentRepository?: WorkPaymentRepository;
  productRepository?: ProductRepository;
  inventoryRepository?: InventoryRepository;
  refreshToken?: number;
}): NavBadges {
  const context = useBusinessContext();
  const [badges, setBadges] = useState<NavBadges>({});
  const { businessId, branchId, role } = context;

  useEffect(() => {
    if (!branchId) return;
    let live = true;
    const load = async () => {
      const next: NavBadges = {};
      try {
        if (photoRepository) {
          const jobs = await photoRepository.listJobs(businessId, branchId, {
            statuses: ['received', 'in_progress', 'ready'],
            limit: 200,
          });
          const late = jobs.filter((row) => isPhotoJobOverdue(row.job)).length;
          if (late)
            next['photo-jobs'] = {
              count: late,
              tone: 'alert',
              label: 'atrasados',
            };
        }
      } catch {
        /* un contador que falla no debe molestar */
      }
      try {
        if (paymentRepository && role !== 'staff') {
          const accounts = await paymentRepository.listOutstanding(
            businessId,
            branchId,
          );
          const due = accounts.filter((account) =>
            finished.has(account.sourceStatus),
          ).length;
          if (due)
            next.payments = {
              count: due,
              tone: 'attention',
              label: 'con saldo para cobrar',
            };
        }
      } catch {
        /* idem */
      }
      try {
        if (productRepository && inventoryRepository) {
          const products = (
            await productRepository.list(businessId, '', 500)
          ).filter((product) => product.isActive && product.tracksInventory);
          if (products.length) {
            const balances = await inventoryRepository.balances(
              businessId,
              branchId,
              products.map((product) => product.id),
            );
            const quantity = new Map(
              balances.map((row) => [row.productId, row.quantity]),
            );
            const out = products.filter(
              (product) => (quantity.get(product.id) ?? 0) <= 0,
            ).length;
            if (out)
              next.products = {
                count: out,
                tone: 'attention',
                label: 'sin stock',
              };
          }
        }
      } catch {
        /* idem */
      }
      if (live) setBadges(next);
    };
    void load();
    const timer = setInterval(() => void load(), 120_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [
    photoRepository,
    paymentRepository,
    productRepository,
    inventoryRepository,
    businessId,
    branchId,
    role,
    refreshToken,
  ]);

  return badges;
}

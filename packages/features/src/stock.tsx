import { useEffect, useState, type FormEvent } from 'react';
import {
  recordStockChange,
  type InventoryRepository,
  type ProductRepository,
} from '@centrocolor/application';
import type {
  Product,
  ProductCategory,
  StockMovement,
} from '@centrocolor/domain';
import { Card, PageHeader } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return 'No se pudo completar la operación.';
}
const labels = {
  initial: 'Inicial',
  entry: 'Entrada',
  adjustment: 'Ajuste',
  sale: 'Venta',
};

export function StockPage({
  productRepository,
  inventoryRepository,
  refreshToken,
  onMutation,
}: {
  productRepository: ProductRepository;
  inventoryRepository: InventoryRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const branchId = context.branchId;
  const canManage = context.role === 'owner' || context.role === 'admin';
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Product | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [mode, setMode] = useState<'initial' | 'entry' | 'adjustment' | null>(
    null,
  );
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!branchId) return;
    let live = true;
    const timer = setTimeout(
      () => {
        void Promise.all([
          productRepository.list(context.businessId, query, 100),
          productRepository.listCategories(context.businessId),
        ])
          .then(async ([items, groups]) => {
            const rows = await inventoryRepository.balances(
              context.businessId,
              branchId,
              items.map((item) => item.id),
            );
            if (live) {
              setProducts(items);
              setSelected((current) =>
                current
                  ? (items.find((item) => item.id === current.id) ?? current)
                  : null,
              );
              setCategories(groups);
              setBalances(
                Object.fromEntries(
                  rows.map((row) => [row.productId, row.quantity]),
                ),
              );
              setError(null);
            }
          })
          .catch((failure: unknown) => {
            if (live) setError(errorMessage(failure));
          });
      },
      query ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    productRepository,
    inventoryRepository,
    context.businessId,
    branchId,
    query,
    refresh,
    refreshToken,
  ]);

  useEffect(() => {
    if (!selected || !branchId) return;
    let live = true;
    void inventoryRepository
      .movements(context.businessId, branchId, selected.id, 100)
      .then((items) => {
        if (live) setMovements(items);
      })
      .catch((failure: unknown) => {
        if (live) setError(errorMessage(failure));
      });
    return () => {
      live = false;
    };
  }, [
    inventoryRepository,
    context.businessId,
    branchId,
    selected,
    refresh,
    refreshToken,
  ]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !mode || !branchId || !canManage) return;
    const quantity = Number(value);
    setBusy(true);
    try {
      await recordStockChange(
        inventoryRepository,
        {
          businessId: context.businessId,
          branchId,
          role: context.role,
        },
        selected.id,
        mode,
        quantity,
        note,
      );
      setMode(null);
      setValue('');
      setNote('');
      setRefresh((number) => number + 1);
      onMutation?.();
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  if (!branchId)
    return (
      <p role="alert">Se requiere una sucursal activa para consultar stock.</p>
    );
  let running = selected ? (balances[selected.id] ?? 0) : 0;
  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Stock"
        description="Inventario de la sucursal actual. Las ventas pueden dejar stock negativo."
      />
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
      <div className="customer-toolbar">
        <label>
          Buscar producto
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre o código de barras"
          />
        </label>
      </div>
      <Card className="pos-list-card">
        <div className="stock-head">
          <span>Producto</span>
          <span>Categoría</span>
          <span>Control</span>
          <span>Stock actual</span>
          <span>Acciones</span>
        </div>
        {products.length === 0 && (
          <p className="pos-empty">No hay productos para mostrar.</p>
        )}
        {products.map((product) => (
          <div className="stock-row" key={product.id}>
            <strong>
              {product.name}
              <small>{product.barcode ?? ''}</small>
            </strong>
            <span>
              {categories.find((item) => item.id === product.categoryId)
                ?.name ?? '—'}
            </span>
            <span>
              {product.tracksInventory ? 'Controlado' : 'No controlado'}
            </span>
            <strong
              className={
                product.tracksInventory && (balances[product.id] ?? 0) < 0
                  ? 'stock-negative'
                  : ''
              }
            >
              {product.tracksInventory ? (balances[product.id] ?? 0) : '—'}
            </strong>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setSelected(product);
                  setMode(null);
                  setMovements([]);
                }}
              >
                Ver movimientos
              </button>
            )}
          </div>
        ))}
        {products.length === 100 && (
          <p className="pos-empty">
            Se muestran 100 productos. Usá la búsqueda para encontrar otros.
          </p>
        )}
      </Card>
      {selected && (
        <Card className="pos-list-card">
          <div className="pos-actions">
            <h2>{selected.name}</h2>
            <button type="button" onClick={() => setSelected(null)}>
              Cerrar
            </button>
          </div>
          <p>
            Stock actual:{' '}
            <strong
              className={
                (balances[selected.id] ?? 0) < 0 ? 'stock-negative' : ''
              }
            >
              {selected.tracksInventory
                ? (balances[selected.id] ?? 0)
                : 'Sin control'}
            </strong>
          </p>
          {canManage && (
            <div className="pos-actions">
              {movements.length === 0 && (
                <button type="button" onClick={() => setMode('initial')}>
                  Establecer stock inicial
                </button>
              )}
              {selected.tracksInventory && (
                <>
                  <button type="button" onClick={() => setMode('entry')}>
                    Entrada de stock
                  </button>
                  <button type="button" onClick={() => setMode('adjustment')}>
                    Ajustar conteo
                  </button>
                </>
              )}
            </div>
          )}
          {mode && (
            <form className="pos-form" onSubmit={(event) => void save(event)}>
              <h3 className="pos-wide">{labels[mode]}</h3>
              <label>
                {mode === 'entry' ? 'Cantidad a ingresar' : 'Stock contado'}
                <input
                  type="number"
                  min={mode === 'entry' ? '1' : '0'}
                  step="1"
                  required
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
              <label>
                Nota opcional
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div className="pos-actions pos-wide">
                <button type="button" onClick={() => setMode(null)}>
                  Cancelar
                </button>
                <button
                  className="customer-primary"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          )}
          <h3>Movimientos</h3>
          {movements.length === 0 && (
            <p className="pos-empty">Todavía no hay movimientos.</p>
          )}
          {movements.map((movement) => {
            const resulting = running;
            running -= movement.quantityDelta;
            return (
              <div className="stock-movement" key={movement.id}>
                <time>
                  {new Date(movement.occurredAt).toLocaleString('es-AR')}
                </time>
                <span>{labels[movement.movementType]}</span>
                <strong
                  className={movement.quantityDelta < 0 ? 'stock-negative' : ''}
                >
                  {movement.quantityDelta > 0 ? '+' : ''}
                  {movement.quantityDelta}
                </strong>
                <span>Saldo {resulting}</span>
                <small>
                  Usuario {movement.createdBy.slice(0, 8)}
                  {movement.saleId
                    ? ` · Venta ${movement.saleId.slice(0, 8)}`
                    : ''}
                  {movement.note ? ` · ${movement.note}` : ''}
                </small>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}

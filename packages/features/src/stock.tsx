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
import {
  Button,
  Card,
  Chip,
  EmptyState,
  FilterBar,
  Icon,
  InlineMessage,
  PageHeader,
  Sheet,
  StatusBadge,
} from '@centrocolor/ui';
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
  const [view, setView] = useState<'all' | 'out' | 'tracked' | 'untracked'>(
    'all',
  );

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
      <InlineMessage tone="error">
        Se requiere una sucursal activa para consultar stock.
      </InlineMessage>
    );
  let running = selected ? (balances[selected.id] ?? 0) : 0;
  const tracked = products.filter((p) => p.tracksInventory);
  const outOfStock = tracked.filter((p) => (balances[p.id] ?? 0) <= 0);
  const negative = tracked.filter((p) => (balances[p.id] ?? 0) < 0);
  const shown = products.filter((p) =>
    view === 'out'
      ? p.tracksInventory && (balances[p.id] ?? 0) <= 0
      : view === 'tracked'
        ? p.tracksInventory
        : view === 'untracked'
          ? !p.tracksInventory
          : true,
  );
  const stockState = (product: Product) => {
    const quantity = balances[product.id] ?? 0;
    if (!product.tracksInventory) return null;
    if (quantity < 0) return { label: 'Negativo', tone: 'alert' as const };
    if (quantity === 0)
      return { label: 'Sin stock', tone: 'progress' as const };
    return null;
  };
  const filters = [
    ['all', 'Todos', products.length],
    ['out', 'Sin stock', outOfStock.length],
    ['tracked', 'Controlados', tracked.length],
    ['untracked', 'Sin control', products.length - tracked.length],
  ] as const;
  return (
    <>
      <PageHeader title="Stock" />
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {negative.length > 0 && (
        <InlineMessage tone="info">
          {negative.length === 1
            ? '1 producto con stock negativo.'
            : `${negative.length} productos con stock negativo.`}{' '}
          Una venta puede dejar el stock en negativo.
        </InlineMessage>
      )}
      <FilterBar
        label="Filtrar stock"
        search={
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Buscar producto"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre o código de barras"
            />
          </div>
        }
      >
        {filters.map(([value, label, count]) => (
          <Chip
            key={value}
            pressed={view === value}
            count={count}
            onClick={() => setView(value)}
          >
            {label}
          </Chip>
        ))}
      </FilterBar>
      <Card className="card--flush">
        {shown.length === 0 ? (
          <EmptyState icon="box" title="No hay productos para mostrar" />
        ) : (
          <div className="rows catalog-rows">
            {shown.map((product) => {
              const quantity = balances[product.id] ?? 0;
              const state = stockState(product);
              return (
                <div className="price-row" key={product.id}>
                  <div className="price-row__id">
                    <strong>{product.name}</strong>
                    <span className="meta">
                      {[
                        product.barcode,
                        categories.find(
                          (item) => item.id === product.categoryId,
                        )?.name,
                      ]
                        .filter(Boolean)
                        .join(' · ') || undefined}
                    </span>
                  </div>
                  <div className="price-row__values">
                    <span className="config-value">
                      <small>Stock actual</small>
                      <strong
                        className={
                          product.tracksInventory && quantity < 0
                            ? 'stock-negative'
                            : ''
                        }
                      >
                        {product.tracksInventory ? quantity : 'Sin control'}
                      </strong>
                    </span>
                  </div>
                  <div className="price-row__state">
                    {state && (
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelected(product);
                        setMode(null);
                        setMovements([]);
                      }}
                    >
                      Movimientos
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {products.length === 100 && (
          <p className="pad meta">
            Se muestran 100 productos. Usá la búsqueda para encontrar otros.
          </p>
        )}
      </Card>
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        variant="side"
        title={selected ? `Movimientos · ${selected.name}` : 'Movimientos'}
      >
        {selected && (
          <>
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
              <div className="editor-state-actions">
                {movements.length === 0 && (
                  <Button onClick={() => setMode('initial')}>
                    Establecer stock inicial
                  </Button>
                )}
                {selected.tracksInventory && (
                  <>
                    <Button onClick={() => setMode('entry')}>
                      Entrada de stock
                    </Button>
                    <Button onClick={() => setMode('adjustment')}>
                      Ajustar conteo
                    </Button>
                  </>
                )}
              </div>
            )}
            {mode && (
              <form
                className="form-drawer"
                onSubmit={(event) => void save(event)}
              >
                <h3>{labels[mode]}</h3>
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
                <div className="editor-state-actions">
                  <Button variant="primary" type="submit" disabled={busy}>
                    {busy ? 'Guardando…' : 'Guardar'}
                  </Button>
                  <Button variant="ghost" onClick={() => setMode(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
            <h3>Historial</h3>
            {movements.length === 0 && (
              <p className="meta">Todavía no hay movimientos.</p>
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
                    className={
                      movement.quantityDelta < 0 ? 'stock-negative' : ''
                    }
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
          </>
        )}
      </Sheet>
    </>
  );
}

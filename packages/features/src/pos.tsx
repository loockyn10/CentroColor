import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  addToCart,
  completeSale,
  createCategory,
  createProduct,
  removeFromCart,
  scanBarcode,
  setCartQuantity,
  updateProduct,
  type ProductRepository,
  type SaleRepository,
} from '@centrocolor/application';
import {
  cartTotal,
  lineTotal,
  requireCents,
  type CartLine,
  type Product,
  type ProductCategory,
  type ProductDetails,
  type Sale,
  type SaleItem,
} from '@centrocolor/domain';
import { Card, PageHeader } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

const emptyDetails: ProductDetails = {
  name: '',
  barcode: null,
  salePriceCents: 0,
  costPriceCents: null,
  categoryId: null,
};
const payments = [
  ['cash', 'Efectivo'],
  ['debit', 'Débito'],
  ['credit', 'Crédito'],
  ['transfer', 'Transferencia'],
  ['other', 'Otro'],
] as const;

export function formatCents(cents: number): string {
  requireCents(cents);
  const whole = (BigInt(cents) / 100n).toLocaleString('es-AR');
  const fraction = Number(BigInt(cents) % 100n);
  return `$${whole}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''}`;
}

export function parsePrice(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error('Ingresá un precio válido con hasta dos decimales.');
  const [whole, fraction = ''] = normalized.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('El importe supera el máximo permitido.');
  return requireCents(Number(cents));
}

function priceInput(cents: number | null): string {
  if (cents === null) return '';
  const whole = BigInt(cents) / 100n;
  const fraction = Number(BigInt(cents) % 100n);
  return `${whole}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ProductForm({
  initial,
  categories,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  autofocus,
  lockedBarcode,
}: {
  initial: ProductDetails;
  categories: ProductCategory[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (details: ProductDetails) => Promise<void>;
  onCancel: () => void;
  autofocus?: boolean;
  lockedBarcode?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [barcode, setBarcode] = useState(initial.barcode ?? '');
  const [salePrice, setSalePrice] = useState(
    priceInput(initial.salePriceCents),
  );
  const [costPrice, setCostPrice] = useState(
    priceInput(initial.costPriceCents),
  );
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError(null);
      await onSubmit({
        name,
        barcode: barcode || null,
        salePriceCents: parsePrice(salePrice),
        costPriceCents: costPrice.trim() ? parsePrice(costPrice) : null,
        categoryId: categoryId || null,
      });
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <form className="pos-form" onSubmit={(event) => void submit(event)}>
      {error && (
        <p className="customer-error pos-wide" role="alert">
          {error}
        </p>
      )}
      <label>
        Nombre *
        <input
          autoFocus={autofocus}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Código de barras
        <input
          value={barcode}
          readOnly={lockedBarcode}
          onChange={(event) => setBarcode(event.target.value)}
        />
      </label>
      <label>
        Precio de venta *
        <input
          required
          inputMode="decimal"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          placeholder="0,00"
        />
      </label>
      <label>
        Costo
        <input
          inputMode="decimal"
          value={costPrice}
          onChange={(event) => setCostPrice(event.target.value)}
          placeholder="Opcional"
        />
      </label>
      <label>
        Categoría
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Sin categoría</option>
          {categories
            .filter(
              (category) => category.isActive || category.id === categoryId,
            )
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
      </label>
      <div className="pos-actions pos-wide">
        <button
          className="customer-secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button className="customer-primary" type="submit" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ProductsPage({
  repository,
  storage = 'local',
  onMutation,
  refreshToken,
}: {
  repository: ProductRepository;
  storage?: 'local' | 'cloud';
  onMutation?: () => void;
  refreshToken?: number;
}) {
  const { businessId } = useBusinessContext();
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        void Promise.all([
          repository.list(businessId, query, 100),
          repository.listCategories(businessId),
        ])
          .then(([items, groups]) => {
            if (live) {
              setProducts(items);
              setCategories(groups);
            }
          })
          .catch((failure: unknown) => {
            if (live) setError(message(failure));
          });
      },
      query ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repository, businessId, query, refresh, refreshToken]);

  async function save(details: ProductDetails) {
    setBusy(true);
    try {
      const saved =
        mode === 'new'
          ? await createProduct(repository, businessId, details)
          : await updateProduct(
              repository,
              businessId,
              selected!.id,
              details,
              selected!.updatedAt,
            );
      setSelected(saved);
      setMode('list');
      setRefresh((value) => value + 1);
      onMutation?.();
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(product: Product) {
    setBusy(true);
    try {
      await repository.setActive(
        businessId,
        product.id,
        !product.isActive,
        product.updatedAt,
      );
      setRefresh((value) => value + 1);
      onMutation?.();
      setError(null);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    const name = window.prompt('Nombre de la nueva categoría');
    if (name === null) return;
    setBusy(true);
    try {
      await createCategory(repository, businessId, name);
      setRefresh((value) => value + 1);
      onMutation?.();
      setError(null);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function editCategory(category: ProductCategory) {
    const name = window.prompt('Nombre de la categoría', category.name);
    if (name === null) return;
    setBusy(true);
    try {
      await repository.updateCategory(
        businessId,
        category.id,
        name,
        category.updatedAt,
      );
      setRefresh((value) => value + 1);
      onMutation?.();
      setError(null);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCategory(category: ProductCategory) {
    setBusy(true);
    try {
      await repository.setCategoryActive(
        businessId,
        category.id,
        !category.isActive,
        category.updatedAt,
      );
      setRefresh((value) => value + 1);
      onMutation?.();
      setError(null);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Productos"
        description={
          storage === 'local'
            ? 'Catálogo local de este negocio. Se sincroniza al validar la sesión Cloud.'
            : 'Catálogo de este negocio en Cloud. Requiere conexión.'
        }
      />
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'list' ? (
        <>
          <div className="customer-toolbar">
            <label>
              Buscar productos
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nombre o código de barras"
              />
            </label>
            <div className="pos-actions">
              <button
                className="customer-secondary"
                type="button"
                onClick={() => void addCategory()}
                disabled={busy}
              >
                Nueva categoría
              </button>
              <button
                className="customer-primary"
                type="button"
                onClick={() => {
                  setSelected(null);
                  setMode('new');
                }}
              >
                + Nuevo producto
              </button>
            </div>
          </div>
          <Card className="pos-list-card">
            <div className="pos-product-head">
              <span>Nombre</span>
              <span>Código</span>
              <span>Categoría</span>
              <span>Precio</span>
              <span>Estado</span>
              <span>Acciones</span>
            </div>
            {products.length === 0 && (
              <p className="pos-empty">
                {query ? 'No hay resultados.' : 'Todavía no hay productos.'}
              </p>
            )}
            {products.map((product) => (
              <div className="pos-product-row" key={product.id}>
                <strong>{product.name}</strong>
                <span>{product.barcode ?? '—'}</span>
                <span>
                  {categories.find(
                    (category) => category.id === product.categoryId,
                  )?.name ?? '—'}
                </span>
                <span>{formatCents(product.salePriceCents)}</span>
                <span>{product.isActive ? 'Activo' : 'Inactivo'}</span>
                <span className="pos-row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(product);
                      setMode('edit');
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggle(product)}
                  >
                    {product.isActive ? 'Desactivar' : 'Reactivar'}
                  </button>
                </span>
              </div>
            ))}
            {products.length === 100 && (
              <p className="pos-empty">
                Se muestran 100 productos. Usá la búsqueda para encontrar otros.
              </p>
            )}
          </Card>
          <Card className="pos-list-card">
            <h2>Categorías</h2>
            {categories.length === 0 && (
              <p className="pos-empty">Todavía no hay categorías.</p>
            )}
            {categories.map((category) => (
              <div className="pos-category-row" key={category.id}>
                <strong>{category.name}</strong>
                <span>{category.isActive ? 'Activa' : 'Inactiva'}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void editCategory(category)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleCategory(category)}
                >
                  {category.isActive ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            ))}
          </Card>
        </>
      ) : (
        <Card className="pos-form-card">
          <h2>
            {mode === 'new' ? 'Nuevo producto' : `Editar ${selected?.name}`}
          </h2>
          <ProductForm
            key={selected?.id ?? 'new'}
            initial={selected ?? emptyDetails}
            categories={categories}
            submitLabel={
              mode === 'new' ? 'Guardar producto' : 'Guardar cambios'
            }
            busy={busy}
            onSubmit={save}
            onCancel={() => setMode('list')}
            autofocus
          />
        </Card>
      )}
    </>
  );
}

export function NewSalePage({
  productRepository,
  saleRepository,
  onMutation,
  refreshToken,
}: {
  productRepository: ProductRepository;
  saleRepository: SaleRepository;
  onMutation?: () => void;
  refreshToken?: number;
}) {
  const context = useBusinessContext();
  const cartKey = `centrocolor-cart-${context.businessId}`;
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem(cartKey) ?? '[]',
      );
      if (!Array.isArray(stored)) return [];
      return stored.map((entry) => {
        const line = entry as CartLine;
        if (
          typeof line.productId !== 'string' ||
          typeof line.productName !== 'string' ||
          (line.barcode !== null && typeof line.barcode !== 'string')
        )
          throw new Error('Carrito local inválido.');
        return {
          ...line,
          lineTotalCents: lineTotal(line.unitPriceCents, line.quantity),
        };
      });
    } catch {
      return [];
    }
  });
  const [entry, setEntry] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [payment, setPayment] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  const scanning = useRef(false);

  function focusScanner() {
    window.requestAnimationFrame(() => scanner.current?.focus());
  }
  useEffect(() => {
    sessionStorage.setItem(cartKey, JSON.stringify(lines));
  }, [cartKey, lines]);
  useEffect(() => {
    focusScanner();
  }, []);
  useEffect(() => {
    if (!entry.trim() || unknown !== null || checkout) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void productRepository
        .list(context.businessId, entry, 8)
        .then((products) => {
          if (live) setResults(products.filter((product) => product.isActive));
        })
        .catch((failure: unknown) => {
          if (live) setError(message(failure));
        });
    }, 170);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    productRepository,
    context.businessId,
    entry,
    unknown,
    checkout,
    refreshToken,
  ]);

  function add(product: Product) {
    setLines((current) => addToCart(current, product));
    setEntry('');
    setResults([]);
    setHighlight(-1);
    setError(null);
    setNotice(null);
    focusScanner();
  }

  async function scan() {
    if (scanning.current || !entry.trim()) return;
    scanning.current = true;
    setBusy(true);
    setError(null);
    try {
      const found = await scanBarcode(
        productRepository,
        context.businessId,
        entry,
      );
      if (found.kind === 'found') add(found.product);
      else if (found.kind === 'inactive') {
        setError(
          `El producto ${found.product.name} está inactivo. Reactivalo en Catálogo.`,
        );
        setEntry('');
        focusScanner();
      } else {
        setUnknown(found.barcode);
        setEntry('');
        setResults([]);
        void productRepository
          .listCategories(context.businessId)
          .then(setCategories)
          .catch((failure: unknown) => setError(message(failure)));
      }
    } catch (failure) {
      setError(message(failure));
      focusScanner();
    } finally {
      scanning.current = false;
      setBusy(false);
    }
  }

  async function quickSave(details: ProductDetails) {
    if (!unknown) return;
    setBusy(true);
    try {
      const product = await createProduct(
        productRepository,
        context.businessId,
        { ...details, barcode: unknown },
      );
      setUnknown(null);
      add(product);
      onMutation?.();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const sale = await completeSale(saleRepository, context, lines, payment);
      setLines([]);
      setCheckout(false);
      setPayment('cash');
      setNotice(
        `Venta ${sale.id.slice(0, 8).toUpperCase()} registrada por ${formatCents(sale.totalCents)}.`,
      );
      onMutation?.();
      focusScanner();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  function changeQuantity(productId: string, quantity: number, refocus = true) {
    try {
      setLines((current) => setCartQuantity(current, productId, quantity));
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
    if (refocus) focusScanner();
  }

  return (
    <>
      <PageHeader
        eyebrow="VENTAS"
        title="Nueva venta"
        description="Escaneá un código y presioná Enter, o buscá un producto por nombre."
      />
      {notice && (
        <p className="pos-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
      <div className="pos-layout">
        <Card className="pos-scan-card">
          <label className="pos-scan-label">
            Escanear código o buscar producto
            <input
              ref={scanner}
              type="search"
              autoComplete="off"
              value={entry}
              disabled={unknown !== null || checkout}
              onChange={(event) => {
                setEntry(event.target.value);
                setHighlight(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && results.length) {
                  event.preventDefault();
                  setHighlight((value) => (value + 1) % results.length);
                }
                if (event.key === 'ArrowUp' && results.length) {
                  event.preventDefault();
                  setHighlight((value) =>
                    value <= 0 ? results.length - 1 : value - 1,
                  );
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (highlight >= 0 && results[highlight])
                    add(results[highlight]);
                  else void scan();
                }
                if (event.key === 'Escape') {
                  setEntry('');
                  setResults([]);
                }
              }}
              placeholder="Código de barras o nombre"
            />
          </label>
          {entry && results.length > 0 && (
            <div
              className="pos-search-results"
              role="listbox"
              aria-label="Resultados de productos"
            >
              {results.map((product, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={highlight === index}
                  className={highlight === index ? 'selected' : ''}
                  key={product.id}
                  onClick={() => add(product)}
                >
                  <strong>{product.name}</strong>
                  <span>
                    {product.barcode ?? 'Sin código'} ·{' '}
                    {formatCents(product.salePriceCents)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="pos-hint">
            Enter busca el código exacto. Para buscar por nombre, elegí un
            resultado con mouse o flechas y Enter.
          </p>
        </Card>
        <Card className="pos-cart-card">
          <h2>Carrito</h2>
          {lines.length === 0 ? (
            <p className="pos-empty">Escaneá o buscá el primer producto.</p>
          ) : (
            <div className="pos-cart-lines">
              {lines.map((line) => (
                <div className="pos-cart-line" key={line.productId}>
                  <div>
                    <strong>{line.productName}</strong>
                    <small>{formatCents(line.unitPriceCents)} c/u</small>
                  </div>
                  <div className="pos-quantity">
                    <button
                      type="button"
                      aria-label={`Disminuir ${line.productName}`}
                      onClick={() => {
                        if (line.quantity === 1) {
                          setLines((current) =>
                            removeFromCart(current, line.productId),
                          );
                          focusScanner();
                        } else
                          changeQuantity(line.productId, line.quantity - 1);
                      }}
                    >
                      −
                    </button>
                    <input
                      aria-label={`Cantidad de ${line.productName}`}
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (value > 0)
                          changeQuantity(line.productId, value, false);
                      }}
                      onFocus={(event) => event.target.select()}
                      onBlur={focusScanner}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') focusScanner();
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Incrementar ${line.productName}`}
                      onClick={() =>
                        changeQuantity(line.productId, line.quantity + 1)
                      }
                    >
                      +
                    </button>
                  </div>
                  <strong>{formatCents(line.lineTotalCents)}</strong>
                  <button
                    className="pos-remove"
                    type="button"
                    onClick={() => {
                      setLines((current) =>
                        removeFromCart(current, line.productId),
                      );
                      focusScanner();
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="pos-total">
            <span>Total</span>
            <strong>{formatCents(cartTotal(lines))}</strong>
          </div>
          <div className="pos-actions">
            <button
              className="customer-secondary"
              type="button"
              disabled={!lines.length}
              onClick={() => {
                setLines([]);
                focusScanner();
              }}
            >
              Vaciar
            </button>
            <button
              className="customer-primary"
              type="button"
              disabled={!lines.length || busy}
              onClick={() => {
                setCheckout(true);
                setError(null);
              }}
            >
              Cobrar
            </button>
          </div>
        </Card>
      </div>
      {unknown !== null && (
        <div className="pos-modal-backdrop" role="presentation">
          <div
            className="pos-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Alta rápida de producto"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                setUnknown(null);
                focusScanner();
              }
            }}
          >
            <h2>Producto nuevo</h2>
            <p>
              Código escaneado: <strong>{unknown}</strong>
            </p>
            <ProductForm
              key={unknown}
              initial={{ ...emptyDetails, barcode: unknown }}
              categories={categories}
              submitLabel="Guardar y agregar"
              busy={busy}
              onSubmit={quickSave}
              onCancel={() => {
                setUnknown(null);
                focusScanner();
              }}
              lockedBarcode
              autofocus
            />
          </div>
        </div>
      )}
      {checkout && (
        <div className="pos-modal-backdrop" role="presentation">
          <div
            className="pos-modal pos-checkout"
            role="dialog"
            aria-modal="true"
            aria-label="Cobrar venta"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                setCheckout(false);
                setError(null);
                focusScanner();
              }
            }}
          >
            <h2>Cobrar</h2>
            <p className="pos-checkout-total">
              {formatCents(cartTotal(lines))}
            </p>
            <label>
              Forma de pago
              <select
                autoFocus
                value={payment}
                onChange={(event) => setPayment(event.target.value)}
              >
                {payments.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p className="customer-error" role="alert">
                {error}
              </p>
            )}
            <div className="pos-actions">
              <button
                className="customer-secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setCheckout(false);
                  setError(null);
                  focusScanner();
                }}
              >
                Cancelar
              </button>
              <button
                className="customer-primary"
                type="button"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? 'Guardando…' : 'Confirmar venta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function SalesPage({
  repository,
  storage = 'local',
  refreshToken,
}: {
  repository: SaleRepository;
  storage?: 'local' | 'cloud';
  refreshToken?: number;
}) {
  const context = useBusinessContext();
  const [sales, setSales] = useState<Sale[]>([]);
  const [detail, setDetail] = useState<{
    sale: Sale;
    items: SaleItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void repository
      .list(context.businessId, 100)
      .then((rows) => {
        if (live) setSales(rows);
      })
      .catch((failure: unknown) => {
        if (live) setError(message(failure));
      });
    return () => {
      live = false;
    };
  }, [repository, context.businessId, refreshToken]);
  async function open(id: string) {
    try {
      setDetail(await repository.get(context.businessId, id));
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="VENTAS"
        title={
          detail
            ? `Venta ${detail.sale.id.slice(0, 8).toUpperCase()}`
            : 'Ventas'
        }
        description={
          storage === 'local'
            ? 'Historial local de ventas completadas. Se sincroniza con Cloud.'
            : 'Historial de ventas completadas en Cloud.'
        }
      />
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
      {detail ? (
        <Card className="pos-history-detail">
          <button
            className="customer-back"
            type="button"
            onClick={() => setDetail(null)}
          >
            ← Volver a ventas
          </button>
          <p>
            {new Date(detail.sale.createdAt).toLocaleString('es-AR')} ·{' '}
            {
              payments.find(
                ([value]) => value === detail.sale.paymentMethod,
              )?.[1]
            }{' '}
            · Completada
          </p>
          <p>
            Usuario:{' '}
            {detail.sale.createdBy === context.userId
              ? context.profile.displayName || context.userId
              : detail.sale.createdBy}
          </p>
          {detail.items.map((item) => (
            <div className="pos-detail-item" key={item.id}>
              <span>
                {item.productName} · {item.quantity} ×{' '}
                {formatCents(item.unitPriceCents)}
              </span>
              <strong>{formatCents(item.totalCents)}</strong>
            </div>
          ))}
          <div className="pos-total">
            <span>Total</span>
            <strong>{formatCents(detail.sale.totalCents)}</strong>
          </div>
        </Card>
      ) : (
        <Card className="pos-list-card">
          <div className="pos-sale-head">
            <span>Fecha</span>
            <span>Venta</span>
            <span>Total</span>
            <span>Pago</span>
            <span>Usuario</span>
            <span>Estado</span>
          </div>
          {sales.length === 0 && (
            <p className="pos-empty">Todavía no hay ventas.</p>
          )}
          {sales.map((sale) => (
            <button
              className="pos-sale-row"
              type="button"
              key={sale.id}
              onClick={() => void open(sale.id)}
            >
              <span>{new Date(sale.createdAt).toLocaleString('es-AR')}</span>
              <strong>{sale.id.slice(0, 8).toUpperCase()}</strong>
              <span>{formatCents(sale.totalCents)}</span>
              <span>
                {payments.find(([value]) => value === sale.paymentMethod)?.[1]}
              </span>
              <span>
                {sale.createdBy === context.userId
                  ? context.profile.displayName || context.userId.slice(0, 8)
                  : sale.createdBy.slice(0, 8)}
              </span>
              <span>Completada</span>
            </button>
          ))}
        </Card>
      )}
    </>
  );
}

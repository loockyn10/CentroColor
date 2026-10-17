import { useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useStore } from '../store';
import { Badge, Button, Chip, Sheet, Stepper, useToast } from '../ui';
import { ars, plural, type Product } from '../data';
import { PageHead } from './shared';

type Line = { product: Product; qty: number };
const METHODS: { id: string; label: string; icon: IconName }[] = [
  { id: 'cash', label: 'Efectivo', icon: 'cash' },
  { id: 'transfer', label: 'Transferencia', icon: 'swap' },
  { id: 'debit', label: 'Débito', icon: 'card' },
  { id: 'credit', label: 'Crédito', icon: 'card' },
  { id: 'qr', label: 'QR / billetera', icon: 'qr' },
];
const CATS = [
  'Todos',
  'Marcos',
  'Álbumes',
  'Insumos',
  'Memoria',
  'Cámaras',
  'Servicios',
] as const;

export function Pos() {
  const { products, completeSale } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<(typeof CATS)[number]>('Todos');
  const [cart, setCart] = useState<Line[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [method, setMethod] = useState('cash');
  const [received, setReceived] = useState('');
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState<null | {
    total: number;
    change: number;
    n: number;
  }>(null);
  const input = useRef<HTMLInputElement>(null);

  const total = cart.reduce((n, l) => n + l.product.price * l.qty, 0);
  const units = cart.reduce((n, l) => n + l.qty, 0);
  const recv = Number(received.replace(/\D/g, '')) || 0;
  const change = method === 'cash' && recv > total ? recv - total : 0;
  const short = method === 'cash' && recv > 0 && recv < total;

  const add = (p: Product) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      return i >= 0
        ? c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { product: p, qty: 1 }];
    });
    setFlash(p.id);
    window.setTimeout(() => setFlash(null), 800);
    if (p.stock !== null && p.stock <= 0)
      toast(`${p.name}: sin stock registrado. Se puede vender igual.`, 'alert');
  };

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (cat === 'Todos' || p.category === cat) &&
        (!n ||
          p.name.toLowerCase().includes(n) ||
          p.barcode.includes(n) ||
          p.sku.toLowerCase().includes(n)),
    );
  }, [products, q, cat]);

  const scan = () => {
    const n = q.trim();
    if (!n) return;
    const exact = products.find(
      (p) => p.barcode === n || p.sku.toLowerCase() === n.toLowerCase(),
    );
    if (exact) {
      add(exact);
      setQ('');
      toast(`Escaneado: ${exact.name}`, 'scan');
    } else if (list.length === 1) {
      add(list[0]);
      setQ('');
    } else if (!list.length) {
      toast(`Código ${n} no existe. Podrías darlo de alta desde acá.`, 'alert');
    }
  };

  const simulateScan = () => {
    const p = products[Math.floor(Math.random() * products.length)];
    add(p);
    toast(`Escaneado: ${p.name}`, 'scan');
  };

  const charge = () => {
    if (!cart.length) return;
    completeSale(
      total,
      cart.map((l) => ({ id: l.product.id, qty: l.qty })),
    );
    setDone({ total, change, n: 1048 });
    setCart([]);
    setReceived('');
    setSheet(false);
  };

  const cartUI = (
    <div className="cart" aria-label="Carrito">
      <div className="section-head" style={{ margin: 0 }}>
        <h2 style={{ fontSize: '1.3rem' }}>Venta actual</h2>
        <Badge icon="cart">{plural(units, 'unidad', 'unidades')}</Badge>
      </div>
      {cart.length === 0 ? (
        <div className="empty" style={{ padding: '26px 8px' }}>
          <Icon name="scan" size={38} />
          <strong style={{ color: 'var(--text)' }}>
            Escaneá un producto para empezar
          </strong>
          <p>O tocá una tarjeta del catálogo.</p>
        </div>
      ) : (
        <ul className="cart-lines">
          {cart.map((l) => (
            <li
              className="cart-line"
              key={l.product.id}
              data-flash={flash === l.product.id}
            >
              <span>
                <strong>{l.product.name}</strong>
                <br />
                <span className="muted mono">{ars(l.product.price)} c/u</span>
              </span>
              <span className="mono" style={{ fontWeight: 500 }}>
                {ars(l.product.price * l.qty)}
              </span>
              <Stepper
                small
                label={l.product.name}
                min={0}
                max={99}
                value={l.qty}
                onChange={(v) =>
                  setCart((c) =>
                    v === 0
                      ? c.filter((x) => x !== l)
                      : c.map((x) => (x === l ? { ...x, qty: v } : x)),
                  )
                }
              />
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                aria-label={`Quitar ${l.product.name}`}
                onClick={() => setCart((c) => c.filter((x) => x !== l))}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="cart-total">
        <span className="eyebrow">Total</span>
        <b className="num">{ars(total)}</b>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="eyebrow" style={{ marginBottom: 8 }}>
          Forma de pago
        </legend>
        <div className="paym">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={method === m.id}
              onClick={() => setMethod(m.id)}
            >
              <Icon name={m.icon} /> {m.label}
            </button>
          ))}
        </div>
      </fieldset>
      {method === 'cash' && cart.length > 0 && (
        <div className="field">
          <label htmlFor="recv">Recibido</label>
          <input
            id="recv"
            className="input mono"
            inputMode="numeric"
            placeholder={ars(total)}
            value={received}
            onChange={(e) => setReceived(e.target.value)}
          />
          <div className="chips">
            {[total, 5000, 10000, 20000]
              .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
              .map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip"
                  onClick={() => setReceived(String(v))}
                >
                  {ars(v)}
                </button>
              ))}
          </div>
          {change > 0 && (
            <Badge tone="green" icon="cash" large>
              Vuelto {ars(change)}
            </Badge>
          )}
          {short && (
            <span className="err">
              <Icon name="alert" size={18} /> Falta {ars(total - recv)}
            </span>
          )}
        </div>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        icon="check"
        disabled={!cart.length || short}
        onClick={charge}
      >
        Cobrar {ars(total)}
      </Button>
    </div>
  );

  return (
    <>
      <PageHead title={<>Nueva venta</>}>
        <Button icon="scan" onClick={simulateScan}>
          Simular escaneo
        </Button>
      </PageHead>

      <div className="pos">
        <div className="stack">
          <div className="scan">
            <div className="search-wrap">
              <Icon name="scan" />
              <input
                ref={input}
                className="input"
                inputMode="search"
                autoFocus
                placeholder="Escaneá o buscá…"
                aria-label="Código de barras o nombre del producto"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && scan()}
              />
            </div>
            <Button size="lg" onClick={scan}>
              Agregar
            </Button>
          </div>
          <p
            className="muted"
            style={{ fontSize: 'var(--fs-sm)', marginTop: -8 }}
          >
            Probá escribir{' '}
            <button
              type="button"
              className="mono"
              style={{
                background: 'var(--y-100)',
                border: 0,
                borderRadius: 6,
                padding: '2px 6px',
              }}
              onClick={() => setQ('7791234500011')}
            >
              7791234500011
            </button>{' '}
            y Enter, o buscar «marco».
          </p>
          <div
            className="chips chips--scroll"
            role="group"
            aria-label="Categorías"
          >
            {CATS.map((c) => (
              <Chip key={c} pressed={cat === c} onClick={() => setCat(c)}>
                {c}
              </Chip>
            ))}
          </div>
          <div className="pgrid">
            {list.map((p) => (
              <button
                type="button"
                className="ptile"
                key={p.id}
                onClick={() => add(p)}
                aria-label={`Agregar ${p.name}, ${ars(p.price)}`}
              >
                <span
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    className="sw"
                    style={{ background: p.color }}
                    aria-hidden="true"
                  />
                  {p.stock === null ? null : p.stock <= 0 ? (
                    <Badge tone="red-soft" icon="alert">
                      Sin stock
                    </Badge>
                  ) : p.stock <= p.min ? (
                    <Badge tone="amber" icon="alert">
                      Quedan {p.stock}
                    </Badge>
                  ) : (
                    <span
                      className="muted mono"
                      style={{ fontSize: '0.78rem' }}
                    >
                      Stock {p.stock}
                    </span>
                  )}
                </span>
                <span className="nm">{p.name}</span>
                <span className="pr num">{ars(p.price)}</span>
              </button>
            ))}
            {list.length === 0 && (
              <p className="muted">
                Sin resultados. Podés darlo de alta como producto nuevo.
              </p>
            )}
          </div>
        </div>

        <div className="pos-cart">{cartUI}</div>
      </div>

      {/* móvil: barra con total + carrito en sheet */}
      <div className="cart-bar">
        <button
          type="button"
          className="btn btn--ghost"
          style={{ flex: 1, justifyContent: 'flex-start', padding: 0 }}
          onClick={() => setSheet(true)}
        >
          <span style={{ display: 'grid', textAlign: 'left' }}>
            <span className="eyebrow" style={{ color: 'var(--ink-900)' }}>
              {plural(units, 'unidad', 'unidades')} · ver carrito
            </span>
            <b className="num">{ars(total)}</b>
          </span>
        </button>
        <Button
          variant="dark"
          size="lg"
          icon="check"
          disabled={!cart.length}
          onClick={() => setSheet(true)}
        >
          Cobrar
        </Button>
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Venta actual"
        variant="side"
      >
        {cartUI}
      </Sheet>

      <Sheet
        open={!!done}
        onClose={() => setDone(null)}
        title="Venta registrada"
        variant="modal"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            icon="plus"
            onClick={() => {
              setDone(null);
              input.current?.focus();
            }}
          >
            Nueva venta
          </Button>
        }
      >
        {done && (
          <div
            style={{
              display: 'grid',
              gap: 14,
              justifyItems: 'center',
              textAlign: 'center',
              padding: '8px 0',
            }}
          >
            <span className="stamp">
              <Icon name="check" />
            </span>
            <div
              className="num"
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '3rem',
                letterSpacing: '-0.03em',
              }}
            >
              {ars(done.total)}
            </div>
            <span className="frame-tag">Venta N.º {done.n}</span>
            {done.change > 0 && (
              <Badge tone="green" icon="cash" large>
                Entregá {ars(done.change)} de vuelto
              </Badge>
            )}
            <p className="muted">
              El stock de los productos controlados se descontó. Podés imprimir
              el comprobante.
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}

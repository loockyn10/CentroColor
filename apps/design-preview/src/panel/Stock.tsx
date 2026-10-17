import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import {
  Badge,
  Button,
  Chip,
  Segmented,
  Sheet,
  Stepper,
  useToast,
} from '../ui';
import { ars, type Product } from '../data';
import { PageHead, useMedia } from './shared';

type F = 'all' | 'low' | 'out';
const level = (p: Product): 'ok' | 'low' | 'out' | 'na' =>
  p.stock === null
    ? 'na'
    : p.stock <= 0
      ? 'out'
      : p.stock <= p.min
        ? 'low'
        : 'ok';

/** `quiet`: en listados solo se marca lo que requiere atención (bajo mínimo / sin stock). */
function StockBadge({ p, quiet }: { p: Product; quiet?: boolean }) {
  const l = level(p);
  if (quiet && (l === 'ok' || l === 'na'))
    return l === 'na' ? <span className="meta">No controla</span> : null;
  if (l === 'na')
    return (
      <Badge icon="info" dashed>
        No controla
      </Badge>
    );
  if (l === 'out')
    return (
      <Badge tone="red" icon="alert">
        Sin stock
      </Badge>
    );
  if (l === 'low')
    return (
      <Badge tone="amber" icon="alert">
        Bajo mínimo
      </Badge>
    );
  return (
    <Badge tone="green" icon="check">
      OK
    </Badge>
  );
}

function Bar({ p }: { p: Product }) {
  const l = level(p);
  if (l === 'na') return <span className="muted">—</span>;
  const pct = Math.min(100, ((p.stock ?? 0) / Math.max(1, p.min * 3)) * 100);
  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span
        className="sbar"
        data-lvl={l}
        role="img"
        aria-label={`Stock ${p.stock}, mínimo ${p.min}`}
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <strong className="mono">{p.stock}</strong>
    </span>
  );
}

export function Stock() {
  const { products, adjustStock } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [f, setF] = useState<F>('all');
  const [edit, setEdit] = useState<Product | null>(null);
  const [delta, setDelta] = useState(1);
  const [kind, setKind] = useState<'entry' | 'adjust'>('entry');
  const table = useMedia('(min-width: 900px)');

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!n || (p.name + p.sku + p.barcode).toLowerCase().includes(n)) &&
        (f === 'all' ||
          (f === 'low' && level(p) === 'low') ||
          (f === 'out' && level(p) === 'out')),
    );
  }, [products, q, f]);

  const low = products.filter((p) => level(p) === 'low').length;
  const out = products.filter((p) => level(p) === 'out').length;
  const value = products.reduce((n, p) => n + (p.stock ?? 0) * p.price, 0);

  const open = (p: Product) => {
    setEdit(p);
    setDelta(1);
    setKind('entry');
  };
  const apply = () => {
    if (!edit) return;
    adjustStock(edit.id, kind === 'entry' ? delta : -delta);
    toast(
      kind === 'entry'
        ? `Entrada registrada: +${delta} ${edit.name}`
        : `Ajuste registrado: −${delta} ${edit.name}`,
      'box',
    );
    setEdit(null);
  };
  const live = edit ? (products.find((p) => p.id === edit.id) ?? edit) : null;
  const left = live
    ? Math.max(0, (live.stock ?? 0) + (kind === 'entry' ? delta : -delta))
    : 0;

  return (
    <>
      <PageHead title={<>Productos y stock</>}>
        <Button variant="primary" icon="plus">
          Nuevo producto
        </Button>
      </PageHead>

      <div className="tiles" style={{ marginBottom: 18 }}>
        <div className="tile">
          <span className="k">
            <Icon name="box" /> Productos
          </span>
          <span className="v">{products.length}</span>
          <span className="s">en el catálogo</span>
        </div>
        <div className={`tile ${low ? 'tile--warn' : ''}`}>
          <span className="k">
            <Icon name="alert" /> Bajo mínimo
          </span>
          <span className="v">{low}</span>
          <span className="s">reponer pronto</span>
        </div>
        <div className={`tile ${out ? 'tile--alert' : ''}`}>
          <span className="k">
            <Icon name="x" /> Sin stock
          </span>
          <span className="v">{out}</span>
          <span className="s">se venden igual</span>
        </div>
        <div className="tile">
          <span className="k">
            <Icon name="wallet" /> Valor del stock
          </span>
          <span className="v">{ars(value)}</span>
          <span className="s">a precio de venta</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" />
          <input
            className="input input--search"
            type="search"
            placeholder="Producto, SKU o código…"
            aria-label="Buscar productos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Filtros">
          <Chip pressed={f === 'all'} onClick={() => setF('all')}>
            Todos
          </Chip>
          <Chip
            pressed={f === 'low'}
            onClick={() => setF('low')}
            icon="alert"
            count={low}
          >
            Bajo mínimo
          </Chip>
          <Chip
            pressed={f === 'out'}
            onClick={() => setF('out')}
            icon="x"
            count={out}
          >
            Sin stock
          </Chip>
        </div>
      </div>

      {table ? (
        <div className="card table-wrap">
          <table className="dt">
            <caption className="sr-only">Inventario</caption>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Categoría</th>
                <th scope="col" className="r">
                  Precio
                </th>
                <th scope="col">Stock</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} onClick={() => open(p)}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="muted mono" style={{ fontSize: '0.78rem' }}>
                      {p.sku} · {p.barcode}
                    </div>
                  </td>
                  <td>{p.category}</td>
                  <td className="r mono">{ars(p.price)}</td>
                  <td>
                    <Bar p={p} />
                  </td>
                  <td>
                    <StockBadge p={p} quiet />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      disabled={p.stock === null}
                      onClick={() => open(p)}
                    >
                      Ajustar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="m-cards">
          {shown.map((p) => (
            <button
              type="button"
              key={p.id}
              className="rcard"
              onClick={() => open(p)}
            >
              <span
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <strong>{p.name}</strong>
                <span className="mono">{ars(p.price)}</span>
              </span>
              <Bar p={p} />
              <span
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <StockBadge p={p} quiet />
                <span className="muted mono" style={{ fontSize: '0.78rem' }}>
                  {p.sku}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 && (
        <div className="empty">
          <Icon name="search" size={32} />
          Sin resultados
        </div>
      )}

      <Sheet
        open={!!live}
        onClose={() => setEdit(null)}
        variant="modal"
        title={live?.name ?? ''}
        eyebrow="Ajustar stock"
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancelar</Button>
            <Button
              variant="primary"
              icon="check"
              onClick={apply}
              disabled={live?.stock === null}
            >
              Registrar movimiento
            </Button>
          </>
        }
      >
        {live && (
          <>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <StockBadge p={live} />
              <span>
                Actual: <strong className="mono">{live.stock ?? '—'}</strong> ·
                mínimo <span className="mono">{live.min}</span>
              </span>
            </div>
            <Segmented
              label="Tipo de movimiento"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'entry', label: 'Entrada (llegó mercadería)' },
                { value: 'adjust', label: 'Ajuste de conteo' },
              ]}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <Stepper
                label="cantidad"
                value={delta}
                min={1}
                max={500}
                onChange={setDelta}
              />
              <span>
                Quedarán <strong className="mono">{left}</strong>{' '}
                {left === 1 ? 'unidad' : 'unidades'}
              </span>
            </div>
            <p className="meta">
              Cada movimiento queda registrado: se corrige con otro movimiento.
            </p>
          </>
        )}
      </Sheet>
    </>
  );
}

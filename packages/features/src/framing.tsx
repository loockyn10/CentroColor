/* eslint-disable @typescript-eslint/no-explicit-any -- compact UI state is mapped at repository boundaries. */
import { useEffect, useState, type FormEvent } from 'react';
import {
  createMaterial,
  createMoulding,
  newQuote,
  type FramingRepository,
} from '@centrocolor/application';
import {
  centimetersToMillimeters,
  type FrameJobStatus,
  type FrameMaterial,
  type FrameMoulding,
} from '@centrocolor/domain';
import { Card, PageHeader } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
const money = (x: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    x / 100,
  );
const error = (x: unknown) =>
  x instanceof Error ? x.message : 'No se pudo completar la operación.';
export function FramingCatalogPage({
  repository,
  kind,
  onMutation,
}: {
  repository: FramingRepository;
  kind: 'mouldings' | 'materials';
  onMutation?: () => void;
}) {
  const c = useBusinessContext();
  const [rows, setRows] = useState<(FrameMoulding | FrameMaterial)[]>([]);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('0');
  const [message, setMessage] = useState<string | null>(null);
  const load = () => {
    (kind === 'mouldings'
      ? repository.listMouldings(c.businessId, true)
      : repository.listMaterials(c.businessId, true)
    )
      .then(setRows)
      .catch((x) => setMessage(error(x)));
  };
  useEffect(load, [repository, c.businessId, kind]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (kind === 'mouldings')
        await createMoulding(repository, c.businessId, {
          code: null,
          name,
          description: null,
          faceWidthMm: null,
          costPerMeterCents: Math.round(Number(cost) * 100),
          salePricePerMeterCents: null,
          wastePercent: null,
        });
      else
        await createMaterial(repository, c.businessId, {
          name,
          materialType: 'other',
          pricingUnit: 'unit',
          costCents: Math.round(Number(cost) * 100),
          salePriceCents: null,
          wastePercent: null,
        });
      setName('');
      setCost('0');
      load();
      onMutation?.();
    } catch (x) {
      setMessage(error(x));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="MARQUETERÍA"
        title={kind === 'mouldings' ? 'Varillas' : 'Materiales'}
        description="Catálogo configurable. Desactivar conserva el historial."
      />
      <Card>
        <form className="pos-form" onSubmit={submit}>
          <label>
            Nombre
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Costo {kind === 'mouldings' ? 'por metro' : 'por unidad'}
            <input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <button className="customer-primary" type="submit">
            Agregar
          </button>
        </form>
        {message && <p className="appointment-error">{message}</p>}
      </Card>
      <Card className="pos-list-card">
        <div className="pos-product-head">
          <span>Nombre</span>
          <span>Tipo</span>
          <span>Costo</span>
          <span>Estado</span>
        </div>
        {rows.map((x: any) => (
          <div className="pos-product-row" key={x.id}>
            <strong>
              {x.code ? `${x.code} · ` : ''}
              {x.name}
            </strong>
            <span>{x.pricingUnit ?? 'varilla'}</span>
            <span>{money(x.costCents ?? x.costPerMeterCents)}</span>
            <span>{x.isActive ? 'Activo' : 'Inactivo'}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
export function NewFrameQuotePage({
  repository,
  onMutation,
}: {
  repository: FramingRepository;
  onMutation?: () => void;
}) {
  const c = useBusinessContext();
  const [mouldings, setMouldings] = useState<FrameMoulding[]>([]);
  const [materials, setMaterials] = useState<FrameMaterial[]>([]);
  const [width, setWidth] = useState('40');
  const [height, setHeight] = useState('60');
  const [mouldingId, setMouldingId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      repository.listMouldings(c.businessId),
      repository.listMaterials(c.businessId),
    ])
      .then(([a, b]) => {
        setMouldings(a);
        setMaterials(b);
        setMouldingId(a[0]?.id ?? '');
      })
      .catch((x) => setMessage(error(x)));
  }, [repository, c.businessId]);
  async function calculate(save = false) {
    try {
      const m = mouldings.find((x) => x.id === mouldingId);
      if (!m) throw new Error('Creá o elegí una varilla.');
      const settings = await repository.getSettings(c.businessId);
      const built = newQuote({
        businessId: c.businessId,
        branchId: c.branchId!,
        customerId: null,
        createdBy: c.userId,
        widthMm: centimetersToMillimeters(width),
        heightMm: centimetersToMillimeters(height),
        notes: null,
        moulding: m,
        materials: materials.filter((x) => selected.includes(x.id)),
        settings,
      });
      setResult(built);
      if (save) {
        await repository.saveQuote(built.quote, built.items);
        await repository.setQuoteStatus(c.businessId, built.quote.id, 'quoted');
        onMutation?.();
        setMessage('Presupuesto guardado como cotizado.');
      }
    } catch (x) {
      setMessage(error(x));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="MARQUETERÍA"
        title="Nueva cotización"
        description="La medida opening es la medida interior útil. Los precios son snapshots al guardar."
      />
      {message && <p className="appointment-error">{message}</p>}
      <div className="pos-layout">
        <Card>
          <label>
            Ancho (cm)
            <input value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <label>
            Alto (cm)
            <input value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
          <label>
            Varilla
            <select
              value={mouldingId}
              onChange={(e) => setMouldingId(e.target.value)}
            >
              {mouldings.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code ? `${x.code} · ` : ''}
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <p>Materiales</p>
          {materials.map((x) => (
            <label key={x.id}>
              <input
                type="checkbox"
                checked={selected.includes(x.id)}
                onChange={() =>
                  setSelected((v) =>
                    v.includes(x.id)
                      ? v.filter((id) => id !== x.id)
                      : [...v, x.id],
                  )
                }
              />
              {x.name}
            </label>
          ))}
          <p>
            <button onClick={() => void calculate()}>Actualizar cálculo</button>{' '}
            <button
              className="customer-primary"
              onClick={() => void calculate(true)}
            >
              Guardar cotizado
            </button>
          </p>
        </Card>
        <Card>
          {result ? (
            <>
              <h2>Desglose</h2>
              <p>
                Varilla ·{' '}
                {(result.calculation.mouldingLengthMm / 1000).toFixed(3)} m ·{' '}
                {money(result.calculation.mouldingPriceCents)}
              </p>
              {result.calculation.materials.map((x: any) => (
                <p key={x.sourceId}>
                  {x.name} ·{' '}
                  {(x.quantityNumerator / x.quantityDenominator).toFixed(3)}{' '}
                  {x.unit === 'square_meter' ? 'm²' : x.unit} ·{' '}
                  {money(x.priceCents)}
                </p>
              ))}
              <p>Mano de obra · {money(result.calculation.labourCents)}</p>
              <h2>Total {money(result.calculation.totalCents)}</h2>
            </>
          ) : (
            <p>Elegí dimensiones y actualizá para ver el desglose.</p>
          )}
        </Card>
      </div>
    </>
  );
}
export function FrameJobsPage({
  repository,
}: {
  repository: FramingRepository;
}) {
  const c = useBusinessContext();
  const [jobs, setJobs] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const load = () =>
    Promise.all([
      repository.listJobs(c.businessId, c.branchId!),
      repository.listQuotes(c.businessId, c.branchId!, ['quoted']),
    ])
      .then(([a, b]) => {
        setJobs(a);
        setQuotes(b);
      })
      .catch((x) => setMessage(error(x)));
  useEffect(() => {
    void load();
  }, [repository, c.businessId, c.branchId]);
  async function status(id: string, status: FrameJobStatus) {
    try {
      await repository.setJobStatus(c.businessId, id, status);
      void load();
    } catch (x) {
      setMessage(error(x));
    }
  }
  async function accept(q: any) {
    try {
      await repository.setQuoteStatus(c.businessId, q.id, 'accepted');
      const now = new Date().toISOString();
      await repository.createJob({
        id: crypto.randomUUID(),
        businessId: c.businessId,
        branchId: c.branchId!,
        quoteId: q.id,
        customerId: q.customerId,
        status: 'pending',
        promisedAt: null,
        notes: q.notes,
        createdAt: now,
        updatedAt: now,
      });
      void load();
    } catch (x) {
      setMessage(error(x));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="MARQUETERÍA"
        title="Presupuestos / Trabajos"
        description="Aceptar una cotización crea un trabajo pendiente; no intervienen pagos ni stock."
      />
      {message && <p className="appointment-error">{message}</p>}
      <Card>
        {quotes.map((q) => (
          <div className="stock-movement" key={q.id}>
            <strong>
              {q.widthMm / 10} × {q.heightMm / 10} cm · {money(q.totalCents)}
            </strong>
            <button onClick={() => void accept(q)}>Aceptar presupuesto</button>
          </div>
        ))}
        {jobs.length
          ? jobs.map((x) => (
              <div className="stock-movement" key={x.id}>
                <strong>{x.status}</strong>
                <span>{x.promisedAt ?? 'Sin fecha prometida'}</span>
                {x.status === 'pending' && (
                  <button onClick={() => void status(x.id, 'in_progress')}>
                    En producción
                  </button>
                )}
                {x.status === 'in_progress' && (
                  <button onClick={() => void status(x.id, 'ready')}>
                    Listo
                  </button>
                )}
                {x.status === 'ready' && (
                  <button onClick={() => void status(x.id, 'delivered')}>
                    Entregado
                  </button>
                )}
              </div>
            ))
          : !quotes.length && (
              <p>Aún no hay trabajos ni presupuestos cotizados.</p>
            )}
      </Card>
    </>
  );
}

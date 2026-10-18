/* eslint-disable @typescript-eslint/no-explicit-any -- compact UI state is mapped at repository boundaries. */
import { useEffect, useState, type FormEvent } from 'react';
import {
  createMaterial,
  createMoulding,
  newQuote,
  type FramingRepository,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import {
  centimetersToMillimeters,
  type FrameJobStatus,
  type FrameMaterial,
  type FrameMoulding,
} from '@centrocolor/domain';
import { Button, Card, EmptyState, PageHeader } from '@centrocolor/ui';
import { dueText } from './format';
import { useBusinessContext } from './auth';
import { PaymentAccountPanel } from './payments';
const money = (x: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    x / 100,
  );
const error = (x: unknown) =>
  x instanceof Error ? x.message : 'No se pudo completar la operación.';
const unitLabel: Record<string, string> = {
  square_meter: 'Por m²',
  linear_meter: 'Por metro',
  unit: 'Por unidad',
};
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
      <PageHeader title={kind === 'mouldings' ? 'Varillas' : 'Materiales'} />
      <Card>
        <form className="catalog-form" onSubmit={submit}>
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
          <Button variant="primary" type="submit" icon="plus">
            Agregar
          </Button>
        </form>
        {message && <p className="appointment-error">{message}</p>}
      </Card>
      <Card className="card--flush">
        {rows.length === 0 ? (
          <EmptyState icon="frame" title="Todavía no hay registros" />
        ) : (
          <div className="rows">
            <div className="oprow rows-head catalog-row" aria-hidden="true">
              <span>Nombre</span>
              <span>Tipo</span>
              <span>Costo</span>
              <span>Estado</span>
            </div>
            {rows.map((x: any) => (
              <div className="oprow catalog-row" key={x.id}>
                <span className="who">
                  {x.code ? `${x.code} · ` : ''}
                  {x.name}
                </span>
                <span className="meta">
                  {x.pricingUnit
                    ? (unitLabel[x.pricingUnit] ?? x.pricingUnit)
                    : 'Varilla'}
                </span>
                <span className="num">
                  {money(x.costCents ?? x.costPerMeterCents)}
                </span>
                <span className={x.isActive ? 'meta' : 'txt-warn'}>
                  {x.isActive ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            ))}
          </div>
        )}
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
  const calc = result?.calculation;
  return (
    <>
      <PageHeader title="Nueva cotización" />
      {message && <p className="appointment-error">{message}</p>}
      <div className="quote-layout">
        <Card className="quote-form">
          <div className="quote-size">
            <label>
              Ancho (cm)
              <input
                inputMode="decimal"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </label>
            <label>
              Alto (cm)
              <input
                inputMode="decimal"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </label>
          </div>
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
          <fieldset className="quote-materials">
            <legend>Materiales</legend>
            {materials.map((x) => (
              <label className="check-row" key={x.id}>
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
          </fieldset>
          <div className="quote-actions">
            <Button onClick={() => void calculate()}>Actualizar cálculo</Button>
            <Button variant="primary" onClick={() => void calculate(true)}>
              Guardar cotizado
            </Button>
          </div>
        </Card>
        <Card className="card--dark quote-ticket on-dark">
          {calc ? (
            <>
              <h2>Desglose</h2>
              <dl className="ticket">
                <div>
                  <dt>
                    Varilla
                    <span className="meta">
                      {Math.round(calc.mouldingLengthMm / 10)} cm
                    </span>
                  </dt>
                  <dd>{money(calc.mouldingPriceCents)}</dd>
                </div>
                {calc.materials.map((x: any) => (
                  <div key={x.sourceId}>
                    <dt>
                      {x.name}
                      <span className="meta">
                        {x.unit === 'square_meter'
                          ? `${(x.quantityNumerator / x.quantityDenominator)
                              .toFixed(2)
                              .replace('.', ',')} m²`
                          : x.unit === 'linear_meter'
                            ? `${Math.round((x.quantityNumerator / x.quantityDenominator) * 100)} cm`
                            : `${x.quantityNumerator} u.`}
                      </span>
                    </dt>
                    <dd>{money(x.priceCents)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Mano de obra</dt>
                  <dd>{money(calc.labourCents)}</dd>
                </div>
              </dl>
              <p className="ticket-total">
                <span>Total</span>
                <strong>{money(calc.totalCents)}</strong>
              </p>
            </>
          ) : (
            <p className="muted">
              Elegí las medidas y actualizá el cálculo para ver el desglose.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
const frameStatusLabel: Record<FrameJobStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En producción',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};
export function FrameJobsPage({
  repository,
  paymentRepository,
}: {
  repository: FramingRepository;
  paymentRepository: WorkPaymentRepository;
}) {
  const c = useBusinessContext();
  const [jobs, setJobs] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
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
      <PageHeader title="Trabajos de marquetería" />
      {message && <p className="appointment-error">{message}</p>}
      {quotes.length > 0 && (
        <Card className="card--flush">
          <div className="section-head pad">
            <h2>Presupuestos cotizados</h2>
          </div>
          <div className="rows">
            {quotes.map((q) => (
              <div
                className="oprow"
                style={{ ['--cols' as string]: 'minmax(0, 1fr) auto' }}
                key={q.id}
              >
                <span className="who">
                  {q.widthMm / 10} × {q.heightMm / 10} cm ·{' '}
                  <span className="num">{money(q.totalCents)}</span>
                </span>
                <span className="act">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void accept(q)}
                  >
                    Aceptar presupuesto
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card className="card--flush">
        {jobs.length === 0 ? (
          !quotes.length && (
            <EmptyState
              icon="frame"
              title="Aún no hay trabajos ni presupuestos cotizados"
            />
          )
        ) : (
          <div className="rows">
            {jobs.map((x) => (
              <div key={x.id}>
                <div
                  className="oprow"
                  data-flag={x.status === 'ready' ? 'ok' : undefined}
                  style={{
                    ['--cols' as string]: 'minmax(0, 1fr) minmax(0, 1fr) auto',
                  }}
                >
                  <span className="state-line">
                    <span
                      className={x.status === 'ready' ? 'tone-ok' : undefined}
                    >
                      {frameStatusLabel[x.status as FrameJobStatus] ?? x.status}
                    </span>
                  </span>
                  <span className="meta">
                    {x.promisedAt
                      ? dueText(x.promisedAt)
                      : 'Sin fecha prometida'}
                  </span>
                  <span className="act">
                    {x.status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => void status(x.id, 'in_progress')}
                      >
                        En producción
                      </Button>
                    )}
                    {x.status === 'in_progress' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void status(x.id, 'ready')}
                      >
                        Listo
                      </Button>
                    )}
                    {x.status === 'ready' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void status(x.id, 'delivered')}
                      >
                        Entregado
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSelectedJobId(selectedJobId === x.id ? null : x.id)
                      }
                    >
                      {selectedJobId === x.id ? 'Cerrar cuenta' : 'Ver cuenta'}
                    </Button>
                  </span>
                </div>
                {selectedJobId === x.id && (
                  <div className="pad">
                    <PaymentAccountPanel
                      repository={paymentRepository}
                      sourceType="frame_job"
                      sourceId={x.id}
                      onMutation={() => void load()}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

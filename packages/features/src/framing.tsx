/* eslint-disable @typescript-eslint/no-explicit-any -- compact UI state is mapped at repository boundaries. */
import { useEffect, useMemo, useState } from 'react';
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
import {
  Button,
  Card,
  EmptyState,
  FlashMessage,
  FormDrawer,
  PageHeader,
  Sheet,
  StatusBadge,
  useFlash,
} from '@centrocolor/ui';
import { CatalogRow, CatalogSection } from './configuration-ui';
import { frameJobStatus, statusMeta } from './status';
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('0');
  const flash = useFlash();
  const load = () => {
    (kind === 'mouldings'
      ? repository.listMouldings(c.businessId, true)
      : repository.listMaterials(c.businessId, true)
    )
      .then(setRows)
      .catch((x) => flash.error(error(x)));
  };
  useEffect(load, [repository, c.businessId, kind]);
  async function submit() {
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
      setOpen(false);
      load();
      onMutation?.();
    } catch (x) {
      flash.error(error(x));
    }
  }
  const noun = kind === 'mouldings' ? 'varilla' : 'material';
  return (
    <>
      <PageHeader
        title={kind === 'mouldings' ? 'Varillas' : 'Materiales'}
        primaryAction={
          <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
            {kind === 'mouldings' ? 'Nueva varilla' : 'Nuevo material'}
          </Button>
        }
      />
      {!open && <FlashMessage flash={flash} />}
      <Card className="card--flush">
        {rows.length === 0 ? (
          <EmptyState icon="frame" title={`Todavía no hay ${noun}s`} />
        ) : (
          <div className="rows catalog-rows">
            {rows.map((x: any) => (
              <CatalogRow
                key={x.id}
                title={`${x.code ? `${x.code} · ` : ''}${x.name}`}
                values={[
                  {
                    label: x.pricingUnit
                      ? `Costo ${(unitLabel[x.pricingUnit] ?? '').toLowerCase()}`
                      : 'Costo por metro',
                    value: money(x.costCents ?? x.costPerMeterCents),
                  },
                ]}
                active={x.isActive}
              />
            ))}
          </div>
        )}
      </Card>
      <FormDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={kind === 'mouldings' ? 'Nueva varilla' : 'Nuevo material'}
        error={open ? flash.current?.text : null}
        onSubmit={submit}
      >
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
      </FormDrawer>
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
  const [settings, setSettings] = useState<any>(null);
  const [width, setWidth] = useState('40');
  const [height, setHeight] = useState('60');
  const [mouldingId, setMouldingId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const flash = useFlash();
  useEffect(() => {
    Promise.all([
      repository.listMouldings(c.businessId),
      repository.listMaterials(c.businessId),
      repository.getSettings(c.businessId),
    ])
      .then(([a, b, s]) => {
        setMouldings(a);
        setMaterials(b);
        setSettings(s);
        setMouldingId(a[0]?.id ?? '');
      })
      .catch((x) => flash.error(error(x)));
  }, [repository, c.businessId]);
  // El cálculo es en vivo: se recalcula con cada cambio de medidas, varilla o componentes.
  const preview = useMemo(() => {
    if (!settings) return null;
    const m = mouldings.find((x) => x.id === mouldingId);
    if (!m) return { error: 'Creá o elegí una varilla.' };
    try {
      return {
        built: newQuote({
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
        }),
      };
    } catch (x) {
      return { error: error(x) };
    }
  }, [settings, mouldings, materials, mouldingId, selected, width, height]);
  async function save() {
    const built = preview && 'built' in preview ? preview.built : null;
    if (!built) return;
    try {
      await repository.saveQuote(built.quote, built.items);
      await repository.setQuoteStatus(c.businessId, built.quote.id, 'quoted');
      onMutation?.();
      flash.success('Presupuesto guardado.');
    } catch (x) {
      flash.error(error(x));
    }
  }
  const calc =
    preview && 'built' in preview ? (preview.built as any).calculation : null;
  return (
    <>
      <PageHeader title="Nueva cotización" />
      <FlashMessage flash={flash} />
      <div className="quote-workspace">
        <Card className="quote-inputs">
          <section className="drawer-section drawer-section--first">
            <h3>Medidas</h3>
            <div className="form-row">
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
          </section>
          <section className="drawer-section">
            <h3>Varilla</h3>
            <select
              aria-label="Varilla"
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
          </section>
          <section className="drawer-section">
            <h3>Componentes</h3>
            {materials.length === 0 ? (
              <p className="meta">No hay materiales cargados.</p>
            ) : (
              <div className="quote-components">
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
              </div>
            )}
          </section>
        </Card>
        <Card className="card--dark quote-ticket quote-result on-dark">
          <h2>Resultado</h2>
          {calc ? (
            <>
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
              <Button variant="primary" block onClick={() => void save()}>
                Guardar presupuesto
              </Button>
            </>
          ) : (
            <p className="muted">
              {preview && 'error' in preview ? preview.error : 'Cargando…'}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

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
  const [accepted, setAccepted] = useState<any[]>([]);
  const [accountJob, setAccountJob] = useState<any | null>(null);
  const flash = useFlash();
  const load = () =>
    Promise.all([
      repository.listJobs(c.businessId, c.branchId!),
      repository.listQuotes(c.businessId, c.branchId!, ['quoted', 'accepted']),
    ])
      .then(([a, b]) => {
        setJobs(a);
        setQuotes(b.filter((x: any) => x.status === 'quoted'));
        setAccepted(b.filter((x: any) => x.status === 'accepted'));
      })
      .catch((x) => flash.error(error(x)));
  useEffect(() => {
    void load();
  }, [repository, c.businessId, c.branchId]);
  async function status(id: string, status: FrameJobStatus) {
    try {
      await repository.setJobStatus(c.businessId, id, status);
      void load();
    } catch (x) {
      flash.error(error(x));
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
      flash.error(error(x));
    }
  }
  const size = (q: any) => `${q.widthMm / 10} × ${q.heightMm / 10} cm`;
  const quoteOf = (job: any) =>
    accepted.find((x) => x.id === job.quoteId) ?? null;
  return (
    <>
      <PageHeader title="Marquetería" />
      <FlashMessage flash={flash} />
      {quotes.length > 0 && (
        <CatalogSection title="Presupuestos">
          {quotes.map((q) => (
            <div className="price-row" key={q.id}>
              <div className="price-row__id">
                <strong>{size(q)}</strong>
                <span className="meta">
                  {new Date(q.createdAt).toLocaleDateString('es-AR')}
                </span>
              </div>
              <div className="price-row__values">
                <span className="config-value">
                  <small>Total</small>
                  <strong>{money(q.totalCents)}</strong>
                </span>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void accept(q)}
              >
                Aceptar presupuesto
              </Button>
            </div>
          ))}
        </CatalogSection>
      )}
      <CatalogSection title="Trabajos">
        {jobs.length === 0 ? (
          <EmptyState icon="frame" title="Todavía no hay trabajos">
            Los trabajos se crean al aceptar un presupuesto.
          </EmptyState>
        ) : (
          jobs.map((x) => {
            const q = quoteOf(x);
            const state = statusMeta(frameJobStatus, x.status);
            return (
              <div className="price-row" key={x.id}>
                <div className="price-row__id">
                  <strong>{q ? size(q) : 'Trabajo de marquetería'}</strong>
                  <span className="meta">
                    {x.promisedAt
                      ? `Entrega ${dueText(x.promisedAt).toLowerCase()}`
                      : 'Sin fecha prometida'}
                  </span>
                </div>
                {q && (
                  <div className="price-row__values">
                    <span className="config-value">
                      <small>Total</small>
                      <strong>{money(q.totalCents)}</strong>
                    </span>
                  </div>
                )}
                <div className="price-row__state">
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                </div>
                {x.status === 'pending' && (
                  <Button
                    size="sm"
                    onClick={() => void status(x.id, 'in_progress')}
                  >
                    En proceso
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
                  onClick={() => setAccountJob(x)}
                >
                  Cuenta
                </Button>
              </div>
            );
          })
        )}
      </CatalogSection>
      <Sheet
        open={accountJob !== null}
        onClose={() => setAccountJob(null)}
        variant="side"
        title="Cuenta del trabajo"
      >
        {accountJob && (
          <PaymentAccountPanel
            repository={paymentRepository}
            sourceType="frame_job"
            sourceId={accountJob.id}
            onMutation={() => void load()}
          />
        )}
      </Sheet>
    </>
  );
}

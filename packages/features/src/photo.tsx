import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  buildPhotoJob,
  createCustomer,
  createPhotoService,
  getCustomer,
  searchCustomers,
  sortPhotoProductionQueue,
  describeNotificationFailure,
  latestNotification,
  type CustomerRepository,
  type PhotoJobBundle,
  type PhotoJobNotification,
  type PhotoJobNotificationRepository,
  type PhotoJobWhatsAppStatus,
  type PhotoJobSummary,
  type PhotoRepository,
  type ServiceCatalogRepository,
  type PhotoFileIntakeAdminRepository,
  type UploadLinkView,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import {
  isPhotoJobOverdue,
  normalizePhotoServiceDetails,
  photoServiceTypes,
  photoWorkflowRoutes,
  effectivePriceListId,
  labUnitPrice,
  type Customer,
  type PriceList,
  type LabVariant,
  type LabPriceTier,
  type PhotoJobStatus,
  type PhotoJobPriority,
  type PhotoService,
  type PhotoServiceType,
  type PhotoWorkflowRoute,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  FilterBar,
  FlashMessage,
  FormDrawer,
  Icon,
  PageHeader,
  Segmented,
  Sheet,
  StatusBadge,
  useFlash,
} from '@centrocolor/ui';
import { CatalogRow } from './configuration-ui';
import { CustomerField } from './editor-parts';
import { photoJobStatus, statusMeta } from './status';
import { dueText, shortDateTime } from './format';
import { useBusinessContext } from './auth';
import { PaymentAccountPanel } from './payments';
const money = (x: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    x / 100,
  );
export const errorText = (x: unknown) =>
  x instanceof Error ? x.message : 'No se pudo completar la operación.';
const statusLabel: Record<PhotoJobStatus, string> = {
  received: 'Recibido',
  in_progress: 'En proceso',
  ready: 'Listo para entregar',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};
const typeLabel: Record<string, string> = {
  print: 'Impresión',
  enlargement: 'Ampliación',
  id_photo: 'Foto carnet',
  editing: 'Edición',
  restoration: 'Restauración',
  scanning: 'Digitalización',
  album: 'Álbum',
  other: 'Otro',
};
const routeLabel: Record<PhotoWorkflowRoute, string> = {
  none: 'Sin archivos',
  lab: 'Laboratorio',
  editing: 'Edición',
  other: 'Otros',
};
const intakeLabel = {
  not_required: 'No requiere archivos',
  not_requested: 'Link no generado',
  awaiting_files: 'Esperando archivos',
  receiving: 'Recibiendo archivos',
  submitted: 'Archivos recibidos',
} as const;

const noticeStatusLabel: Record<PhotoJobNotification['status'], string> = {
  pending: 'Enviando aviso…',
  sending: 'Enviando aviso…',
  sent: '✓ Aviso enviado',
  delivered: '✓ Aviso entregado',
  read: '✓ Aviso leído',
  failed: '⚠ No pudo enviarse',
};

function WhatsAppNoticePanel({
  jobStatus,
  value,
  busy,
  onRetry,
  onResend,
}: {
  jobStatus: PhotoJobStatus;
  value: PhotoJobWhatsAppStatus;
  busy: boolean;
  onRetry: (notice: PhotoJobNotification) => void;
  onResend: () => void;
}) {
  const latest = latestNotification(value.notifications);
  if (!value.consent)
    return (
      <section className="whatsapp-panel">
        <h3>WhatsApp</h3>
        <p>El cliente no pidió avisos por WhatsApp.</p>
      </section>
    );
  const delivered =
    latest && ['sent', 'delivered', 'read'].includes(latest.status);
  return (
    <section
      className={`whatsapp-panel ${latest?.status === 'failed' ? 'whatsapp-failed' : ''}`}
    >
      <h3>WhatsApp</h3>
      <p>{value.consent.phone}</p>
      {!latest && (
        <p>
          {jobStatus === 'ready'
            ? 'El aviso quedó pendiente de envío.'
            : 'Se avisará automáticamente cuando el pedido esté listo.'}
        </p>
      )}
      {latest && (
        <p className="whatsapp-state">
          <strong>{noticeStatusLabel[latest.status]}</strong>
          {latest.sentAt &&
            ` · ${new Date(latest.sentAt).toLocaleString('es-AR')}`}
        </p>
      )}
      {latest?.status === 'failed' && (
        <>
          <p className="whatsapp-error">
            {describeNotificationFailure(latest)}
          </p>
          <Button disabled={busy} onClick={() => onRetry(latest)}>
            Reintentar
          </Button>
        </>
      )}
      {delivered && jobStatus === 'ready' && (
        <Button disabled={busy} onClick={onResend}>
          Reenviar aviso
        </Button>
      )}
      {value.notifications.length > 1 && (
        <ul className="whatsapp-history">
          {value.notifications.map((notice) => (
            <li key={notice.id}>
              {notice.triggerKind === 'manual_resend'
                ? 'Reenvío'
                : 'Automático'}{' '}
              · {noticeStatusLabel[notice.status].replace(/^[✓⚠] /, '')} ·{' '}
              {new Date(notice.createdAt).toLocaleString('es-AR')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PhotoServicesPage({
  repository,
  onMutation,
  refreshToken,
}: {
  repository: PhotoRepository;
  onMutation?: () => void;
  refreshToken?: number;
}) {
  const c = useBusinessContext(),
    canEdit = c.role !== 'staff';
  const [rows, setRows] = useState<PhotoService[]>([]),
    [editing, setEditing] = useState<PhotoService | null>(null),
    [editorOpen, setEditorOpen] = useState(false);
  const flash = useFlash();
  const [code, setCode] = useState(''),
    [name, setName] = useState(''),
    [type, setType] = useState<PhotoServiceType>('print'),
    [width, setWidth] = useState(''),
    [height, setHeight] = useState(''),
    [price, setPrice] = useState('0'),
    [workflowRoute, setWorkflowRoute] = useState<PhotoWorkflowRoute>('none'),
    [requiresFiles, setRequiresFiles] = useState(false),
    [isPublic, setIsPublic] = useState(false),
    [publicName, setPublicName] = useState(''),
    [publicDescription, setPublicDescription] = useState(''),
    [publicSortOrder, setPublicSortOrder] = useState('0'),
    [publicOrder, setPublicOrder] = useState(false);
  const load = () =>
    repository
      .listServices(c.businessId, true)
      .then(setRows)
      .catch((x) => flash.error(errorText(x)));
  useEffect(() => {
    void load();
  }, [repository, c.businessId, refreshToken]);
  function select(x: PhotoService) {
    setEditing(x);
    setCode(x.code ?? '');
    setName(x.name);
    setType(x.serviceType);
    setWidth(x.widthMm === null ? '' : String(x.widthMm / 10));
    setHeight(x.heightMm === null ? '' : String(x.heightMm / 10));
    setPrice(String(x.defaultUnitPriceCents / 100));
    setWorkflowRoute(x.workflowRoute);
    setRequiresFiles(x.requiresCustomerFiles);
    setIsPublic(x.isPublic);
    setPublicName(x.publicName ?? '');
    setPublicDescription(x.publicDescription ?? '');
    setPublicSortOrder(String(x.publicSortOrder));
    setPublicOrder(x.publicOrderEnabled);
    setEditorOpen(true);
  }
  function clear() {
    setEditing(null);
    setCode('');
    setName('');
    setType('print');
    setWidth('');
    setHeight('');
    setPrice('0');
    setWorkflowRoute('none');
    setRequiresFiles(false);
    setIsPublic(false);
    setPublicName('');
    setPublicDescription('');
    setPublicSortOrder('0');
    setPublicOrder(false);
    setEditorOpen(false);
  }
  async function save() {
    try {
      const details = normalizePhotoServiceDetails({
        code,
        name,
        serviceType: type,
        widthMm: width
          ? Math.round(Number(width.replace(',', '.')) * 10)
          : null,
        heightMm: height
          ? Math.round(Number(height.replace(',', '.')) * 10)
          : null,
        defaultUnitPriceCents: Math.round(
          Number(price.replace(',', '.')) * 100,
        ),
        workflowRoute,
        requiresCustomerFiles: requiresFiles,
        isPublic,
        publicName: publicName || null,
        publicDescription: publicDescription || null,
        publicSortOrder: Number(publicSortOrder || 0),
        publicOrderEnabled: publicOrder,
      });
      if (editing)
        await repository.updateService(c.businessId, editing.id, details);
      else await createPhotoService(repository, c.businessId, details);
      clear();
      load();
      onMutation?.();
    } catch (x) {
      flash.error(errorText(x));
    }
  }
  async function toggle(x: PhotoService) {
    try {
      await repository.setServiceActive(c.businessId, x.id, !x.isActive);
      load();
      onMutation?.();
    } catch (e) {
      flash.error(errorText(e));
    }
  }
  return (
    <>
      <PageHeader
        title="Servicios fotográficos"
        primaryAction={
          canEdit ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                clear();
                setEditorOpen(true);
              }}
            >
              Nuevo servicio
            </Button>
          ) : undefined
        }
      />
      {!editorOpen && <FlashMessage flash={flash} />}
      <Card className="card--flush">
        {rows.length === 0 ? (
          <EmptyState icon="camera" title="Todavía no hay servicios" />
        ) : (
          <div className="rows catalog-rows">
            {rows.map((x) => (
              <CatalogRow
                key={x.id}
                title={`${x.code ? `${x.code} · ` : ''}${x.name}`}
                meta={[
                  typeLabel[x.serviceType] +
                    (x.widthMm
                      ? ` · ${x.widthMm / 10} × ${x.heightMm! / 10} cm`
                      : ''),
                  routeLabel[x.workflowRoute] === typeLabel[x.serviceType]
                    ? null
                    : routeLabel[x.workflowRoute],
                  x.requiresCustomerFiles ? 'recibe archivos' : null,
                  x.isPublic
                    ? x.publicOrderEnabled
                      ? 'Web · pedido directo'
                      : 'Web · sólo lista de precios'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                values={[
                  {
                    label: 'Precio',
                    value:
                      x.workflowRoute === 'lab'
                        ? 'Por variante y lista'
                        : money(x.defaultUnitPriceCents),
                  },
                ]}
                active={x.isActive}
                onEdit={canEdit ? () => select(x) : undefined}
              />
            ))}
          </div>
        )}
      </Card>
      <FormDrawer
        open={canEdit && editorOpen}
        onClose={clear}
        title={
          editing ? 'Editar servicio fotográfico' : 'Nuevo servicio fotográfico'
        }
        error={editorOpen ? flash.current?.text : null}
        submitLabel={editing ? 'Guardar cambios' : 'Crear servicio'}
        onSubmit={save}
      >
        <div className="config-editor-form__grid">
          <label>
            Código
            <input value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            Tipo
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PhotoServiceType)}
            >
              {photoServiceTypes.map((x) => (
                <option key={x} value={x}>
                  {typeLabel[x]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Nombre *
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="config-editor-form__grid">
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
        <section className="drawer-section">
          <h3>Operación</h3>
          <label>
            Flujo operativo
            <select
              value={workflowRoute}
              onChange={(e) =>
                setWorkflowRoute(e.target.value as PhotoWorkflowRoute)
              }
            >
              {photoWorkflowRoutes.map((x) => (
                <option key={x} value={x}>
                  {routeLabel[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={requiresFiles}
              onChange={(e) => setRequiresFiles(e.target.checked)}
            />
            Requiere archivos del cliente
          </label>
          {workflowRoute === 'lab' ? (
            <p className="meta">
              El precio se configura en Precios › Laboratorio.
            </p>
          ) : (
            <label>
              Precio unitario
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
          )}
        </section>
        <section className="drawer-section">
          <h3>Publicación web (/imprimir)</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => {
                setIsPublic(e.target.checked);
                if (!e.target.checked) setPublicOrder(false);
              }}
            />
            Mostrar en la web
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={publicOrder}
              disabled={!isPublic || workflowRoute !== 'lab' || !requiresFiles}
              onChange={(e) => setPublicOrder(e.target.checked)}
            />
            Aceptar pedidos directos
          </label>
          <p className="meta">
            Los pedidos directos requieren flujo Laboratorio y archivos del
            cliente.
          </p>
          <label>
            Nombre público
            <input
              maxLength={80}
              placeholder={name || 'Ej.: 10x15'}
              value={publicName}
              onChange={(e) => setPublicName(e.target.value)}
            />
          </label>
          <label>
            Descripción pública
            <input
              maxLength={300}
              value={publicDescription}
              onChange={(e) => setPublicDescription(e.target.value)}
            />
          </label>
          <label>
            Orden en la lista
            <input
              inputMode="numeric"
              value={publicSortOrder}
              onChange={(e) => setPublicSortOrder(e.target.value)}
            />
          </label>
        </section>
        {editing && (
          <section className="drawer-section">
            <h3>Estado</h3>
            <Button
              variant={editing.isActive ? 'danger' : 'secondary'}
              onClick={() => {
                void toggle(editing);
                clear();
              }}
            >
              {editing.isActive ? 'Desactivar servicio' : 'Activar servicio'}
            </Button>
          </section>
        )}
      </FormDrawer>
    </>
  );
}

type DraftLine = {
  key: string;
  serviceId: string | null;
  name: string;
  quantity: string;
  price: string;
  widthMm: number | null;
  heightMm: number | null;
  notes: string;
  variantId?: string | null;
};
export function NewPhotoJobPage({
  repository,
  customerRepository,
  serviceCatalogRepository,
  onMutation,
  refreshToken,
  initialCustomerId,
}: {
  repository: PhotoRepository;
  customerRepository: CustomerRepository;
  serviceCatalogRepository?: ServiceCatalogRepository;
  onMutation?: () => void;
  refreshToken?: number;
  /** Cliente preseleccionado (p. ej. desde su ficha). */
  initialCustomerId?: string | null;
}) {
  const c = useBusinessContext();
  const flash = useFlash();
  const formId = useId();
  const [services, setServices] = useState<PhotoService[]>([]),
    [priceLists, setPriceLists] = useState<PriceList[]>([]),
    [labVariants, setLabVariants] = useState<LabVariant[]>([]),
    [labTiers, setLabTiers] = useState<LabPriceTier[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [query, setQuery] = useState(''),
    [customerId, setCustomerId] = useState(initialCustomerId ?? ''),
    [preset, setPreset] = useState<Customer | null>(null),
    [promised, setPromised] = useState(''),
    [priority, setPriority] = useState<PhotoJobPriority>('normal'),
    [notes, setNotes] = useState(''),
    [lines, setLines] = useState<DraftLine[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    repository
      .listServices(c.businessId)
      .then(setServices)
      .catch((x) => flash.error(errorText(x)));
  }, [repository, c.businessId, refreshToken]);
  useEffect(() => {
    if (!serviceCatalogRepository) return;
    void Promise.all([
      serviceCatalogRepository.listPriceLists(c.businessId),
      serviceCatalogRepository.listLabVariants(c.businessId),
      serviceCatalogRepository.listLabTiers(c.businessId),
    ])
      .then(([lists, variants, tiers]) => {
        setPriceLists(lists);
        setLabVariants(variants);
        setLabTiers(tiers);
      })
      .catch((error) => flash.error(errorText(error)));
  }, [serviceCatalogRepository, c.businessId, refreshToken]);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        searchCustomers(customerRepository, c.businessId, query)
          .then((r) => setCustomers(r.filter((x) => x.isActive)))
          .catch((x) => flash.error(errorText(x))),
      120,
    );
    return () => clearTimeout(timer);
  }, [customerRepository, c.businessId, query]);
  useEffect(() => {
    if (!initialCustomerId) return;
    let live = true;
    void getCustomer(customerRepository, c.businessId, initialCustomerId)
      .then((x) => live && setPreset(x))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [customerRepository, c.businessId, initialCustomerId]);
  function addService(id: string) {
    const variant = labVariants.find((x) => x.id === id);
    const s = services.find((x) => x.id === (variant?.photoServiceId ?? id));
    if (!s) return;
    if (s.workflowRoute === 'lab' && !variant && serviceCatalogRepository)
      return;
    setLines((v) => [
      ...v,
      {
        key: crypto.randomUUID(),
        serviceId: s.id,
        name: s.name,
        quantity: '1',
        price: String(s.defaultUnitPriceCents / 100),
        widthMm: s.widthMm,
        heightMm: s.heightMm,
        notes: '',
        variantId: variant?.id ?? null,
      },
    ]);
  }
  function addCustom() {
    setLines((v) => [
      ...v,
      {
        key: crypto.randomUUID(),
        serviceId: null,
        name: '',
        quantity: '1',
        price: '0',
        widthMm: null,
        heightMm: null,
        notes: '',
      },
    ]);
  }
  function patchLine(key: string, p: Partial<DraftLine>) {
    setLines((v) => v.map((x) => (x.key === key ? { ...x, ...p } : x)));
  }
  const selectedCustomer =
    customers.find((x) => x.id === customerId) ??
    (preset?.id === customerId ? preset : null);
  const selectedList = priceLists.length
    ? (priceLists.find(
        (x) => x.id === effectivePriceListId(selectedCustomer, priceLists),
      ) ?? null)
    : null;
  function priceForLine(line: DraftLine) {
    if (!line.variantId)
      return Math.round(Number(line.price.replace(',', '.')) * 100);
    const variant = labVariants.find((x) => x.id === line.variantId);
    if (!variant || !selectedList)
      throw new Error('No se pudo resolver la variante o la lista.');
    return labUnitPrice(
      variant,
      labTiers,
      selectedList.id,
      Number(line.quantity),
    );
  }
  function lineName(line: DraftLine) {
    if (!line.variantId) return line.name;
    const variant = labVariants.find((x) => x.id === line.variantId);
    return `${line.name} · ${variant?.paper === 'matte' ? 'Mate' : 'Brillo'} · ${selectedList?.name ?? 'Público'}`;
  }
  async function quickCreate(fullName: string): Promise<boolean> {
    try {
      const x = await createCustomer(customerRepository, c.businessId, {
        fullName,
        phone: null,
        email: null,
        documentNumber: null,
        notes: null,
      });
      setCustomers((v) => [x, ...v]);
      setCustomerId(x.id);
      setQuery(x.fullName);
      onMutation?.();
      return true;
    } catch (e) {
      flash.error(errorText(e));
      return false;
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    flash.clear();
    try {
      const built = buildPhotoJob({
        businessId: c.businessId,
        branchId: c.branchId!,
        customerId,
        priority,
        promisedAt: promised ? new Date(promised).toISOString() : null,
        notes: notes || null,
        createdBy: c.userId,
        fileIntakeStatus: lines.some(
          (line) =>
            services.find((service) => service.id === line.serviceId)
              ?.requiresCustomerFiles,
        )
          ? 'not_requested'
          : 'not_required',
        items: lines.map((x) => ({
          photoServiceId: x.serviceId,
          serviceNameSnapshot: lineName(x),
          quantity: Number(x.quantity),
          unitPriceCents: priceForLine(x),
          labVariantId: x.variantId ?? null,
          priceListId: x.variantId ? (selectedList?.id ?? null) : null,
          notes: x.notes || null,
          widthMm: x.widthMm,
          heightMm: x.heightMm,
        })),
      });
      await repository.saveJob(built.job, built.items);
      setLines([]);
      setNotes('');
      setPromised('');
      flash.success('Pedido creado como Recibido.');
      onMutation?.();
    } catch (x) {
      flash.error(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const total = lines.reduce((sum, line) => {
    try {
      return sum + Number(line.quantity) * priceForLine(line);
    } catch {
      return sum;
    }
  }, 0);
  const customerOptions =
    preset && !customers.some((x) => x.id === preset.id)
      ? [preset, ...customers]
      : customers;
  const lineErrors = lines.length === 0;
  return (
    <>
      <PageHeader title="Nuevo pedido" />
      <FlashMessage flash={flash} />
      <form id={formId} className="editor-form" onSubmit={save}>
        <Card>
          <div className="editor-grid">
            <div className="span-12">
              <CustomerField
                customers={customerOptions}
                query={query}
                onQuery={setQuery}
                value={customerId}
                onChange={setCustomerId}
                onQuickCreate={quickCreate}
                busy={busy}
              />
            </div>
            {selectedList && (
              <p className="meta span-12">
                Lista aplicada: {selectedList.name}
              </p>
            )}
            <label className="span-6">
              Entrega prometida
              <input
                type="datetime-local"
                value={promised}
                onChange={(e) => setPromised(e.target.value)}
              />
            </label>
            <label className="check-row span-3">
              <input
                type="checkbox"
                checked={priority === 'urgent'}
                onChange={(e) =>
                  setPriority(e.target.checked ? 'urgent' : 'normal')
                }
              />
              Urgente
            </label>
            <label className="span-12">
              Notas
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </Card>

        <section className="editor-block editor-block--service">
          <div className="section-head">
            <div>
              <h3>Servicios</h3>
            </div>
            <div className="editor-line__actions">
              <select
                aria-label="Agregar servicio"
                defaultValue=""
                onChange={(e) => {
                  addService(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="">+ Agregar servicio</option>
                {services.flatMap((x) =>
                  x.workflowRoute === 'lab' && serviceCatalogRepository
                    ? labVariants
                        .filter(
                          (v) =>
                            v.photoServiceId === x.id &&
                            v.channel === 'laboratory' &&
                            v.isActive,
                        )
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {x.name} · {v.paper === 'matte' ? 'Mate' : 'Brillo'}
                          </option>
                        ))
                    : [
                        <option key={x.id} value={x.id}>
                          {x.name} · {money(x.defaultUnitPriceCents)}
                        </option>,
                      ],
                )}
              </select>
              <Button variant="secondary" icon="plus" onClick={addCustom}>
                Concepto personalizado
              </Button>
            </div>
          </div>
          {lines.length === 0 ? (
            <p className="meta price-empty">
              Agregá al menos un servicio para guardar el pedido.
            </p>
          ) : (
            <div className="editor-lines">
              {lines.map((x) => {
                let unit = '';
                try {
                  unit = x.variantId ? String(priceForLine(x) / 100) : x.price;
                } catch {
                  unit = 'Sin tarifa';
                }
                return (
                  <div
                    className="editor-line editor-line--resource"
                    key={x.key}
                  >
                    <label className="editor-mini span-5">
                      Servicio
                      <input
                        required
                        value={x.name}
                        readOnly={Boolean(x.serviceId)}
                        onChange={(e) =>
                          patchLine(x.key, { name: e.target.value })
                        }
                      />
                    </label>
                    <label className="editor-mini span-3">
                      Cantidad
                      <input
                        required
                        min="1"
                        type="number"
                        value={x.quantity}
                        onChange={(e) =>
                          patchLine(x.key, { quantity: e.target.value })
                        }
                      />
                    </label>
                    <label className="editor-mini span-4">
                      Precio unitario
                      <input
                        required
                        inputMode="decimal"
                        value={unit}
                        readOnly={Boolean(x.variantId)}
                        onChange={(e) =>
                          patchLine(x.key, { price: e.target.value })
                        }
                      />
                    </label>
                    <label className="editor-mini span-5">
                      Notas
                      <input
                        value={x.notes}
                        onChange={(e) =>
                          patchLine(x.key, { notes: e.target.value })
                        }
                      />
                    </label>
                    {!x.serviceId && (
                      <>
                        <label className="editor-mini span-3">
                          Ancho (cm)
                          <input
                            inputMode="decimal"
                            value={x.widthMm === null ? '' : x.widthMm / 10}
                            onChange={(e) =>
                              patchLine(x.key, {
                                widthMm: e.target.value
                                  ? Math.round(
                                      Number(e.target.value.replace(',', '.')) *
                                        10,
                                    )
                                  : null,
                              })
                            }
                          />
                        </label>
                        <label className="editor-mini span-3">
                          Alto (cm)
                          <input
                            inputMode="decimal"
                            value={x.heightMm === null ? '' : x.heightMm / 10}
                            onChange={(e) =>
                              patchLine(x.key, {
                                heightMm: e.target.value
                                  ? Math.round(
                                      Number(e.target.value.replace(',', '.')) *
                                        10,
                                    )
                                  : null,
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                    <div className="editor-line__actions span-4">
                      {x.widthMm ? (
                        <span className="meta">
                          {x.widthMm / 10} × {x.heightMm! / 10} cm
                        </span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines((v) => v.filter((i) => i.key !== x.key))
                        }
                      >
                        Quitar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="sticky-foot">
          <strong className="sticky-foot__total">Total {money(total)}</strong>
          <Button variant="primary" type="submit" disabled={busy || lineErrors}>
            Guardar pedido
          </Button>
        </div>
      </form>
    </>
  );
}

export function PhotoJobsPage({
  repository,
  paymentRepository,
  fileIntakeRepository,
  notificationRepository,
  onMutation,
  refreshToken,
  initialJobId,
}: {
  repository: PhotoRepository;
  paymentRepository: WorkPaymentRepository;
  fileIntakeRepository?: PhotoFileIntakeAdminRepository;
  /** Web only: WhatsApp notices are sent by the Cloud, so Desktop has no repository. */
  notificationRepository?: PhotoJobNotificationRepository;
  onMutation?: () => void;
  refreshToken?: number;
  initialJobId?: string | null;
}) {
  const c = useBusinessContext();
  const flash = useFlash();
  const openDriveFolder = (folderId: string) =>
    fileIntakeRepository?.openDriveFolder(folderId) ??
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
      '_blank',
      'noopener,noreferrer',
    );
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<PhotoJobSummary[]>([]),
    [selected, setSelected] = useState<PhotoJobBundle | null>(null),
    [editPromised, setEditPromised] = useState(''),
    [editPriority, setEditPriority] = useState<PhotoJobPriority>('normal'),
    [editNotes, setEditNotes] = useState(''),
    [filter, setFilter] = useState('active'),
    [view, setView] = useState<'list' | 'board'>('list'),
    [balances, setBalances] = useState<Record<string, number>>({}),
    [query, setQuery] = useState(''),
    [uploadLink, setUploadLink] = useState<UploadLinkView | null>(null),
    [whatsapp, setWhatsapp] = useState<PhotoJobWhatsAppStatus | null>(null),
    [whatsappBusy, setWhatsappBusy] = useState(false),
    [editMode, setEditMode] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false);
  const loadWhatsapp = async (jobId: string, channel: string) => {
    if (!notificationRepository || channel !== 'public_web') {
      setWhatsapp(null);
      return;
    }
    try {
      setWhatsapp(await notificationRepository.getStatus(c.businessId, jobId));
    } catch (e) {
      setWhatsapp(null);
      flash.error(errorText(e));
    }
  };
  const load = () => {
    const statuses =
      filter === 'active'
        ? (['received', 'in_progress', 'ready'] as PhotoJobStatus[])
        : filter === 'all'
          ? undefined
          : filter === 'urgent'
            ? (['received', 'in_progress', 'ready'] as PhotoJobStatus[])
            : [filter as PhotoJobStatus];
    repository
      .listJobs(c.businessId, c.branchId!, {
        statuses,
        urgentOnly: filter === 'urgent',
        search: query,
      })
      .then((x) => {
        setRows(sortPhotoProductionQueue(x));
        setLoaded(true);
      })
      .catch((e) => {
        flash.error(errorText(e));
        setLoaded(true);
      });
  };
  useEffect(() => {
    const t = setTimeout(load, 120);
    return () => clearTimeout(t);
  }, [repository, c.businessId, c.branchId, filter, query, refreshToken]);
  useEffect(() => {
    if (c.role === 'staff') return;
    let live = true;
    paymentRepository
      .listOutstanding(c.businessId, c.branchId!)
      .then((accounts) => {
        if (live)
          setBalances(
            Object.fromEntries(
              accounts
                .filter((x) => x.sourceType === 'photo_job')
                .map((x) => [x.sourceId, x.balanceCents]),
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [paymentRepository, c.businessId, c.branchId, c.role, refreshToken, rows]);
  const boardColumns: PhotoJobStatus[] =
    filter === 'all'
      ? ['received', 'in_progress', 'ready', 'delivered', 'cancelled']
      : filter === 'delivered' || filter === 'cancelled'
        ? [filter]
        : ['received', 'in_progress', 'ready'];
  async function open(id: string) {
    try {
      const bundle = await repository.getJob(c.businessId, id);
      setEditMode(false);
      setSelected(bundle);
      void loadWhatsapp(id, bundle?.job.sourceChannel ?? 'manual');
      setUploadLink(
        fileIntakeRepository && c.role !== 'staff'
          ? await fileIntakeRepository.getUploadLink(id)
          : null,
      );
      setEditPromised(
        bundle?.job.promisedAt
          ? new Date(
              new Date(bundle.job.promisedAt).getTime() -
                new Date(bundle.job.promisedAt).getTimezoneOffset() * 60_000,
            )
              .toISOString()
              .slice(0, 16)
          : '',
      );
      setEditPriority(bundle?.job.priority ?? 'normal');
      setEditNotes(bundle?.job.notes ?? '');
    } catch (e) {
      flash.error(errorText(e));
    }
  }
  useEffect(() => {
    if (initialJobId) void open(initialJobId);
  }, [initialJobId]);
  async function createLink() {
    if (!selected || !fileIntakeRepository) return;
    try {
      const link = await fileIntakeRepository.createUploadLink(selected.job.id);
      setUploadLink(link);
      setSelected(await repository.getJob(c.businessId, selected.job.id));
      // Copying is a convenience: browsers may refuse it after async work, and that
      // must not hide that the link was created. The URL is also shown on screen.
      const copied = link.url
        ? await navigator.clipboard.writeText(link.url).then(
            () => true,
            () => false,
          )
        : false;
      flash.success(
        copied
          ? 'Link generado y copiado.'
          : 'Link generado. Copialo desde aquí abajo.',
      );
      load();
    } catch (e) {
      flash.error(errorText(e));
    }
  }
  async function revokeLink() {
    if (!selected || !fileIntakeRepository) return;
    try {
      await fileIntakeRepository.revokeUploadLink(selected.job.id);
      setUploadLink(await fileIntakeRepository.getUploadLink(selected.job.id));
      flash.success('Link revocado.');
    } catch (e) {
      flash.error(errorText(e));
    }
  }
  async function saveDetails(): Promise<boolean> {
    if (!selected) return false;
    try {
      const updated = await repository.updateJob(
        {
          ...selected.job,
          promisedAt: editPromised
            ? new Date(editPromised).toISOString()
            : null,
          priority: editPriority,
          notes: editNotes.trim() || null,
          updatedAt: new Date().toISOString(),
        },
        selected.items,
      );
      setSelected(updated);
      load();
      onMutation?.();
      return true;
    } catch (e) {
      flash.error(errorText(e));
      return false;
    }
  }
  function patchSelectedItem(
    id: string,
    patch: Partial<PhotoJobBundle['items'][number]>,
  ) {
    setSelected((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => {
              if (item.id !== id) return item;
              const next = { ...item, ...patch };
              return {
                ...next,
                totalCents: next.quantity * next.unitPriceCents,
              };
            }),
          }
        : current,
    );
  }
  function status(next: PhotoJobStatus) {
    if (next === 'cancelled') setConfirmCancel(true);
    else void applyStatus(next);
  }
  async function applyStatus(next: PhotoJobStatus) {
    if (!selected) return;
    try {
      await repository.setJobStatus(c.businessId, selected.job.id, next);
      setSelected(await repository.getJob(c.businessId, selected.job.id));
      load();
      onMutation?.();
      if (next === 'ready' && selected.job.sourceChannel === 'public_web') {
        // The notice is queued by the database the moment the job becomes ready; this only
        // asks the Cloud to deliver it now. A failure never undoes the status change.
        await notificationRepository?.wake(c.businessId, selected.job.id);
        await loadWhatsapp(selected.job.id, selected.job.sourceChannel);
      }
    } catch (e) {
      flash.error(errorText(e));
    }
  }
  async function noticeAction(work: () => Promise<unknown>) {
    if (!selected) return;
    setWhatsappBusy(true);
    try {
      await work();
    } catch (e) {
      flash.error(errorText(e));
    } finally {
      await loadWhatsapp(selected.job.id, selected.job.sourceChannel);
      setWhatsappBusy(false);
    }
  }
  const closed =
    selected && ['delivered', 'cancelled'].includes(selected.job.status);
  const activeItems = selected?.items.filter((x) => x.isActive) ?? [];
  const itemsTotal = activeItems.reduce((s, x) => s + x.totalCents, 0);
  return (
    <>
      <PageHeader title="Pedidos" />
      <FlashMessage flash={flash} />
      <FilterBar
        label="Filtrar pedidos"
        search={
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Buscar pedidos"
              placeholder="Cliente, teléfono, servicio o notas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
        end={
          <Segmented
            label="Vista"
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: 'Lista' },
              { value: 'board', label: 'Tablero' },
            ]}
          />
        }
      >
        {jobFilters.map(([value, label]) => (
          <Chip
            key={value}
            pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </Chip>
        ))}
      </FilterBar>
      {view === 'list' ? (
        <Card className="card--flush">
          {!loaded ? (
            <p className="pad meta">Cargando pedidos…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon="camera" title="No hay pedidos para este filtro" />
          ) : (
            <div className="rows">
              <div className="rows-head oprow job-row" aria-hidden="true">
                <span>Cliente</span>
                <span>Pedido</span>
                <span>Entrega</span>
                <span>Estado</span>
              </div>
              {rows.map((x) => (
                <JobRow
                  key={x.job.id}
                  row={x}
                  balance={balances[x.job.id] ?? 0}
                  onOpen={() => void open(x.job.id)}
                />
              ))}
            </div>
          )}
        </Card>
      ) : (
        <div className="board">
          {boardColumns.map((status) => {
            const column = rows.filter((x) => x.job.status === status);
            return (
              <section
                className="board-col"
                key={status}
                aria-label={statusLabel[status]}
              >
                <header>
                  <h2>{statusLabel[status]}</h2>
                  <span className="meta">{column.length}</span>
                </header>
                {column.map((x) => (
                  <JobRow
                    key={x.job.id}
                    row={x}
                    balance={balances[x.job.id] ?? 0}
                    onOpen={() => void open(x.job.id)}
                    card
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.customerName ?? 'Pedido'}
        variant="side"
        size="lg"
      >
        {selected && (
          <div className="photo-detail">
            <header className="ficha-head">
              <div className="prod-badges">
                <JobStateLine job={selected.job} />
                {selected.job.sourceChannel === 'public_web' && (
                  <StatusBadge tone="info">Pedido web</StatusBadge>
                )}
              </div>
              <div className="ficha-actions">
                {selected.job.status === 'received' && (
                  <Button onClick={() => void status('in_progress')}>
                    En proceso
                  </Button>
                )}
                {['received', 'in_progress'].includes(selected.job.status) && (
                  <Button
                    variant="primary"
                    onClick={() => void status('ready')}
                  >
                    Marcar listo
                  </Button>
                )}
                {selected.job.status === 'ready' && (
                  <Button
                    variant="primary"
                    onClick={() => void status('delivered')}
                  >
                    Entregado
                  </Button>
                )}
                {!closed && !editMode && (
                  <Button
                    variant="ghost"
                    icon="edit"
                    onClick={() => setEditMode(true)}
                  >
                    Editar pedido
                  </Button>
                )}
              </div>
            </header>

            <dl className="ficha-data">
              <div>
                <dt>Teléfono</dt>
                <dd>{selected.customerPhone ?? 'Sin teléfono'}</dd>
              </div>
              <div>
                <dt>Ingreso</dt>
                <dd>{shortDateTime(selected.job.createdAt)}</dd>
              </div>
              <div>
                <dt>Entrega prometida</dt>
                <dd>{dueText(selected.job.promisedAt)}</dd>
              </div>
              <div>
                <dt>Archivos</dt>
                <dd>{intakeLabel[selected.job.fileIntakeStatus]}</dd>
              </div>
              {selected.job.notes && !editMode && (
                <div className="ficha-data__wide">
                  <dt>Notas</dt>
                  <dd>{selected.job.notes}</dd>
                </div>
              )}
            </dl>

            {editMode && (
              <section className="drawer-section" aria-label="Editar pedido">
                <h3>Editar pedido</h3>
                <div className="config-editor-form__grid">
                  <label>
                    Entrega prometida
                    <input
                      type="datetime-local"
                      value={editPromised}
                      onChange={(e) => setEditPromised(e.target.value)}
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={editPriority === 'urgent'}
                      onChange={(e) =>
                        setEditPriority(e.target.checked ? 'urgent' : 'normal')
                      }
                    />
                    Urgente
                  </label>
                </div>
                <label>
                  Notas
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </label>
              </section>
            )}

            <section className="editor-block editor-block--service">
              <div className="section-head">
                <h3>Servicios</h3>
              </div>
              <div className="editor-lines">
                {activeItems.map((x) => (
                  <div className="photo-detail-line" key={x.id}>
                    <span>
                      {x.quantity} × {x.serviceNameSnapshot}
                      {x.widthMm
                        ? ` · ${x.widthMm / 10}×${x.heightMm! / 10} cm`
                        : ''}
                    </span>
                    <b>{money(x.totalCents)}</b>
                    {x.notes && <small>{x.notes}</small>}
                    {editMode && (
                      <div className="photo-detail-line-edit">
                        <label>
                          Cantidad
                          <input
                            type="number"
                            min="1"
                            value={x.quantity}
                            onChange={(e) =>
                              patchSelectedItem(x.id, {
                                quantity: Math.max(1, Number(e.target.value)),
                              })
                            }
                          />
                        </label>
                        <label>
                          Precio unitario
                          <input
                            inputMode="decimal"
                            value={x.unitPriceCents / 100}
                            onChange={(e) =>
                              patchSelectedItem(x.id, {
                                unitPriceCents: Math.max(
                                  0,
                                  Math.round(
                                    Number(e.target.value.replace(',', '.')) *
                                      100,
                                  ),
                                ),
                              })
                            }
                          />
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            patchSelectedItem(x.id, { isActive: false })
                          }
                        >
                          Quitar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="quote-total">
                <span>Total</span>
                <strong>{money(itemsTotal)}</strong>
              </p>
            </section>

            {editMode && (
              <div className="editor-state-actions">
                <Button
                  variant="primary"
                  onClick={() =>
                    void saveDetails().then(() => setEditMode(false))
                  }
                >
                  Guardar cambios
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditMode(false);
                    void open(selected.job.id);
                  }}
                >
                  Descartar
                </Button>
              </div>
            )}

            <section className="editor-block editor-block--resource photo-files">
              <div className="section-head">
                <h3>Archivos</h3>
              </div>
              {activeItems.map((item) => {
                const files = (selected.files ?? []).filter(
                  (file) =>
                    file.photoJobItemId === item.id &&
                    file.status === 'uploaded',
                );
                if (!files.length) return null;
                const copies = files.reduce(
                  (sum, file) => sum + file.copies,
                  0,
                );
                return (
                  <div key={item.id}>
                    <strong>{item.serviceNameSnapshot}</strong>
                    <span>
                      {files.length} archivos
                      {files.some((x) => x.workflowRoute === 'lab')
                        ? ` / ${copies} copias`
                        : ''}
                    </span>
                  </div>
                );
              })}
              {!(selected.files ?? []).some((x) => x.status === 'uploaded') && (
                <p className="meta">Todavía no hay archivos recibidos.</p>
              )}
              <div className="editor-state-actions">
                {selected.job.driveFolderId && (
                  <Button
                    icon="folder"
                    onClick={() => openDriveFolder(selected.job.driveFolderId!)}
                  >
                    Abrir carpeta en Drive
                  </Button>
                )}
                {selected.job.driveEditedFolderId && (
                  <Button
                    icon="folder"
                    onClick={() =>
                      openDriveFolder(selected.job.driveEditedFolderId!)
                    }
                  >
                    Abrir Editadas
                  </Button>
                )}
                {fileIntakeRepository &&
                  c.role !== 'staff' &&
                  selected.job.fileIntakeStatus !== 'not_required' && (
                    <>
                      {uploadLink?.url && (
                        <Button
                          icon="copy"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(uploadLink.url!)
                              .then(
                                () => flash.success('Link copiado.'),
                                () =>
                                  flash.error(
                                    'No se pudo copiar automáticamente. Seleccioná el link y copialo.',
                                  ),
                              )
                          }
                        >
                          Copiar link
                        </Button>
                      )}
                      <Button icon="link" onClick={() => void createLink()}>
                        {uploadLink ? 'Regenerar link' : 'Generar link'}
                      </Button>
                      {uploadLink && !uploadLink.revokedAt && (
                        <Button
                          variant="danger"
                          onClick={() => void revokeLink()}
                        >
                          Revocar link
                        </Button>
                      )}
                    </>
                  )}
              </div>
              {uploadLink?.url && (
                <input
                  className="upload-link-url"
                  readOnly
                  aria-label="Link del cliente"
                  value={uploadLink.url}
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
              {uploadLink &&
                !uploadLink.url &&
                !uploadLink.revokedAt &&
                !uploadLink.submittedAt && (
                  <small className="meta">
                    Por seguridad el token no se puede volver a leer. Regeneralo
                    para obtener un link nuevo.
                  </small>
                )}
              {!fileIntakeRepository &&
                selected.job.fileIntakeStatus !== 'not_required' &&
                !selected.job.driveFolderId && (
                  <small className="meta">
                    Google Drive requiere conexión.
                  </small>
                )}
            </section>

            {selected.job.sourceChannel === 'public_web' &&
              (whatsapp && notificationRepository ? (
                <WhatsAppNoticePanel
                  jobStatus={selected.job.status}
                  value={whatsapp}
                  busy={whatsappBusy}
                  onRetry={(notice) =>
                    void noticeAction(() =>
                      notificationRepository.retry(c.businessId, notice.id),
                    )
                  }
                  onResend={() =>
                    void noticeAction(() =>
                      notificationRepository.resend(
                        c.businessId,
                        selected.job.id,
                      ),
                    )
                  }
                />
              ) : !notificationRepository ? (
                <small className="meta whatsapp-panel">
                  El aviso por WhatsApp lo envía la nube cuando este cambio se
                  sincroniza; no hace falta hacer nada en este equipo.
                </small>
              ) : null)}

            <PaymentAccountPanel
              repository={paymentRepository}
              sourceType="photo_job"
              sourceId={selected.job.id}
              onMutation={() => {
                load();
                onMutation?.();
              }}
            />

            {selected.job.sourceAppointmentId && (
              <small className="meta">
                Origen: turno {selected.job.sourceAppointmentId}
              </small>
            )}
            {selected.job.sourceEventId && (
              <small className="meta">
                Origen: presupuesto o reserva {selected.job.sourceEventId}
              </small>
            )}
            {!closed && (
              <section className="drawer-section">
                <Button
                  variant="danger"
                  onClick={() => void status('cancelled')}
                >
                  Cancelar pedido
                </Button>
              </section>
            )}
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar pedido"
        destructive
        confirmLabel="Cancelar pedido"
        cancelLabel="Volver"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          return applyStatus('cancelled');
        }}
      >
        Quedará en el historial.
      </ConfirmDialog>
    </>
  );
}

const jobFilters: Array<[string, string]> = [
  ['active', 'Activos'],
  ['received', 'Recibidos'],
  ['in_progress', 'En proceso'],
  ['ready', 'Listos'],
  ['urgent', 'Urgentes'],
  ['delivered', 'Entregados'],
  ['cancelled', 'Cancelados'],
  ['all', 'Todos'],
];

/** Estado del pedido como pastillas: urgencia y atraso (alerta) más el estado de trabajo. */
export function JobStateLine({ job }: { job: PhotoJobSummary['job'] }) {
  const open = !['delivered', 'cancelled'].includes(job.status);
  const state = statusMeta(photoJobStatus, job.status);
  return (
    <span className="prod-badges">
      {open && job.priority === 'urgent' && (
        <StatusBadge tone="alert">Urgente</StatusBadge>
      )}
      {open && isPhotoJobOverdue(job) && (
        <StatusBadge tone="alert">Atrasado</StatusBadge>
      )}
      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
    </span>
  );
}

function JobRow({
  row,
  balance,
  onOpen,
  card = false,
}: {
  row: PhotoJobSummary;
  balance: number;
  onOpen: () => void;
  card?: boolean;
}) {
  const { job } = row;
  const active = !['delivered', 'cancelled'].includes(job.status);
  const flag =
    active && (isPhotoJobOverdue(job) || job.priority === 'urgent')
      ? 'alert'
      : job.status === 'ready'
        ? 'ok'
        : undefined;
  return (
    <button
      type="button"
      className={`oprow job-row ${card ? 'job-card' : ''}`.trim()}
      data-flag={flag}
      onClick={onOpen}
    >
      <span className="who">
        {row.customerName}
        {job.sourceChannel === 'public_web' && (
          <span
            className="meta block"
            title="Pedido hecho por el cliente en la web"
          >
            Pedido web
          </span>
        )}
      </span>
      <span className="what">{row.itemSummary || 'Sin ítems activos'}</span>
      <span className="when">
        <span className={isPhotoJobOverdue(job) ? 'txt-alert' : undefined}>
          {dueText(job.promisedAt)}
        </span>
      </span>
      <span className="when">
        <JobStateLine job={job} />
        {active && balance > 0 && (
          <span className={job.status === 'ready' ? 'txt-warn' : 'meta'}>
            Saldo {money(balance)}
          </span>
        )}
      </span>
    </button>
  );
}

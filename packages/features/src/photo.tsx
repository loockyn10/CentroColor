import { useEffect, useState, type FormEvent } from 'react';
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
  comparePhotoProductionQueue,
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
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Segmented,
  Sheet,
  StateLine,
} from '@centrocolor/ui';
import { dueText, plural } from './format';
import { useBusinessContext } from './auth';
import { PaymentAccountPanel } from './payments';
const money = (x: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    x / 100,
  );
const errorText = (x: unknown) =>
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
        <h3>WHATSAPP</h3>
        <p>El cliente no pidió avisos por WhatsApp.</p>
      </section>
    );
  const delivered =
    latest && ['sent', 'delivered', 'read'].includes(latest.status);
  return (
    <section
      className={`whatsapp-panel ${latest?.status === 'failed' ? 'whatsapp-failed' : ''}`}
    >
      <h3>WHATSAPP</h3>
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
          <button type="button" disabled={busy} onClick={() => onRetry(latest)}>
            Reintentar
          </button>
        </>
      )}
      {delivered && jobStatus === 'ready' && (
        <button type="button" disabled={busy} onClick={onResend}>
          Reenviar aviso
        </button>
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
    [editorOpen, setEditorOpen] = useState(false),
    [message, setMessage] = useState<string | null>(null);
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
      .catch((x) => setMessage(errorText(x)));
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
  async function save(e: FormEvent) {
    e.preventDefault();
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
      setMessage(errorText(x));
    }
  }
  async function toggle(x: PhotoService) {
    try {
      await repository.setServiceActive(c.businessId, x.id, !x.isActive);
      load();
      onMutation?.();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  return (
    <>
      <PageHeader
        title="Servicios fotográficos"
        description="Catálogo operativo de Laboratorio, archivos y publicación web."
        actions={
          canEdit ? (
            <button
              className="customer-primary"
              onClick={() => {
                clear();
                setEditorOpen(true);
              }}
            >
              + Nuevo servicio
            </button>
          ) : undefined
        }
      />
      {message && <p className="appointment-error">{message}</p>}
      <Sheet
        open={canEdit && editorOpen}
        onClose={clear}
        title={
          editing ? 'Editar servicio fotográfico' : 'Nuevo servicio fotográfico'
        }
        variant="side"
      >
        <Card>
          <form className="photo-service-form" onSubmit={save}>
            <label>
              Código
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label>
              Nombre *
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
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
            {workflowRoute === 'lab' ? (
              <p className="meta">
                El precio se configura por Brillo/Mate, tramo y lista dentro de
                Configuración → Precios → Laboratorio.
              </p>
            ) : (
              <label>
                Precio unitario legado
                <input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
            )}
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
            <label className="photo-checkbox">
              <input
                type="checkbox"
                checked={requiresFiles}
                onChange={(e) => setRequiresFiles(e.target.checked)}
              />
              Requiere archivos del cliente
            </label>
            <fieldset className="photo-public-fields">
              <legend>Catálogo público (/imprimir)</legend>
              <label className="photo-checkbox">
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
              <label className="photo-checkbox">
                <input
                  type="checkbox"
                  checked={publicOrder}
                  disabled={
                    !isPublic || workflowRoute !== 'lab' || !requiresFiles
                  }
                  onChange={(e) => setPublicOrder(e.target.checked)}
                />
                Aceptar pedidos directos
              </label>
              <small>
                Los pedidos directos requieren flujo Laboratorio y archivos del
                cliente. Papel y tramos públicos se configuran en Configuración
                → Precios → Laboratorio.
              </small>
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
            </fieldset>
            <div>
              <button className="customer-primary" type="submit">
                {editing ? 'Guardar cambios' : 'Crear servicio'}
              </button>
              <button type="button" onClick={clear}>
                Cancelar
              </button>
            </div>
          </form>
        </Card>
      </Sheet>
      {!canEdit && (
        <p className="identity-summary">
          Tu rol puede consultar el catálogo, pero no administrar precios.
        </p>
      )}
      <div className="photo-card-grid">
        {rows.map((x) => (
          <Card key={x.id} className={!x.isActive ? 'photo-inactive' : ''}>
            <strong>
              {x.code ? `${x.code} · ` : ''}
              {x.name}
            </strong>
            <span>
              {typeLabel[x.serviceType]}
              {x.widthMm ? ` · ${x.widthMm / 10} × ${x.heightMm! / 10} cm` : ''}
            </span>
            <b>
              {x.workflowRoute === 'lab'
                ? 'Precios por variante y lista'
                : money(x.defaultUnitPriceCents)}
            </b>
            <span>
              {routeLabel[x.workflowRoute]} ·{' '}
              {x.requiresCustomerFiles
                ? 'recibe archivos'
                : 'sin carga del cliente'}
            </span>
            <span>{x.isActive ? 'Activo' : 'Inactivo'}</span>
            {x.isPublic && (
              <span className="photo-web-tag">
                {x.publicOrderEnabled
                  ? `Web · pedido directo${x.publicName ? ` · «${x.publicName}»` : ''}`
                  : 'Web · sólo lista de precios'}
              </span>
            )}
            {canEdit && (
              <div>
                <button onClick={() => select(x)}>Editar</button>
                <button onClick={() => void toggle(x)}>
                  {x.isActive ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>
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
  const [services, setServices] = useState<PhotoService[]>([]),
    [priceLists, setPriceLists] = useState<PriceList[]>([]),
    [labVariants, setLabVariants] = useState<LabVariant[]>([]),
    [labTiers, setLabTiers] = useState<LabPriceTier[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [query, setQuery] = useState(''),
    [customerId, setCustomerId] = useState(initialCustomerId ?? ''),
    [preset, setPreset] = useState<Customer | null>(null),
    [quick, setQuick] = useState(''),
    [showQuick, setShowQuick] = useState(false),
    [promised, setPromised] = useState(''),
    [priority, setPriority] = useState<PhotoJobPriority>('normal'),
    [notes, setNotes] = useState(''),
    [lines, setLines] = useState<DraftLine[]>([]),
    [message, setMessage] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    repository
      .listServices(c.businessId)
      .then(setServices)
      .catch((x) => setMessage(errorText(x)));
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
      .catch((error) => setMessage(errorText(error)));
  }, [serviceCatalogRepository, c.businessId, refreshToken]);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        searchCustomers(customerRepository, c.businessId, query)
          .then((r) => setCustomers(r.filter((x) => x.isActive)))
          .catch((x) => setMessage(errorText(x))),
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
  async function quickCreate() {
    try {
      const x = await createCustomer(customerRepository, c.businessId, {
        fullName: quick,
        phone: null,
        email: null,
        documentNumber: null,
        notes: null,
      });
      setCustomers((v) => [x, ...v]);
      setCustomerId(x.id);
      setQuery(x.fullName);
      setQuick('');
      setShowQuick(false);
      onMutation?.();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
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
      setMessage('Pedido creado como Recibido.');
      onMutation?.();
    } catch (x) {
      setMessage(errorText(x));
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
  return (
    <>
      <PageHeader title="Nuevo pedido" />
      {message && <p className="appointment-error">{message}</p>}
      <Card>
        <form className="photo-job-form" onSubmit={save}>
          <label className="photo-wide">
            Buscar cliente
            <input
              type="search"
              placeholder="Nombre o teléfono"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="photo-wide">
            Cliente *
            <select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {(preset && !customers.some((x) => x.id === preset.id)
                ? [preset, ...customers]
                : customers
              ).map((x) => (
                <option value={x.id} key={x.id}>
                  {x.fullName}
                  {x.phone ? ` · ${x.phone}` : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedList && (
            <p className="photo-wide meta">
              Lista aplicada: {selectedList.name}
            </p>
          )}
          <div className="photo-wide">
            <button type="button" onClick={() => setShowQuick((v) => !v)}>
              + Crear cliente
            </button>
            {showQuick && (
              <span className="photo-inline">
                <input
                  placeholder="Nombre completo"
                  value={quick}
                  onChange={(e) => setQuick(e.target.value)}
                />
                <button type="button" onClick={() => void quickCreate()}>
                  Crear y seleccionar
                </button>
              </span>
            )}
          </div>
          <label>
            Entrega prometida
            <input
              type="datetime-local"
              value={promised}
              onChange={(e) => setPromised(e.target.value)}
            />
          </label>
          <label>
            Prioridad
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as PhotoJobPriority)}
            >
              <option value="normal">Normal</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
          <label className="photo-wide">
            Notas
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="photo-wide photo-add">
            <select
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
            <button type="button" onClick={addCustom}>
              + Concepto personalizado
            </button>
          </div>
          {lines.map((x) => (
            <div className="photo-line photo-wide" key={x.key}>
              <label>
                Servicio
                <input
                  required
                  value={x.name}
                  readOnly={Boolean(x.serviceId)}
                  onChange={(e) => patchLine(x.key, { name: e.target.value })}
                />
              </label>
              <label>
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
              <label>
                Precio unitario
                <input
                  required
                  inputMode="decimal"
                  value={
                    x.variantId
                      ? (() => {
                          try {
                            return String(priceForLine(x) / 100);
                          } catch {
                            return 'Sin tarifa';
                          }
                        })()
                      : x.price
                  }
                  readOnly={Boolean(x.variantId)}
                  onChange={(e) => patchLine(x.key, { price: e.target.value })}
                />
              </label>
              <label>
                Notas
                <input
                  value={x.notes}
                  onChange={(e) => patchLine(x.key, { notes: e.target.value })}
                />
              </label>
              {!x.serviceId && (
                <label>
                  Ancho (cm)
                  <input
                    inputMode="decimal"
                    value={x.widthMm === null ? '' : x.widthMm / 10}
                    onChange={(e) =>
                      patchLine(x.key, {
                        widthMm: e.target.value
                          ? Math.round(
                              Number(e.target.value.replace(',', '.')) * 10,
                            )
                          : null,
                      })
                    }
                  />
                </label>
              )}
              {!x.serviceId && (
                <label>
                  Alto (cm)
                  <input
                    inputMode="decimal"
                    value={x.heightMm === null ? '' : x.heightMm / 10}
                    onChange={(e) =>
                      patchLine(x.key, {
                        heightMm: e.target.value
                          ? Math.round(
                              Number(e.target.value.replace(',', '.')) * 10,
                            )
                          : null,
                      })
                    }
                  />
                </label>
              )}
              <span>
                {x.widthMm ? `${x.widthMm / 10} × ${x.heightMm! / 10} cm` : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  setLines((v) => v.filter((i) => i.key !== x.key))
                }
              >
                Quitar
              </button>
            </div>
          ))}
          <div className="photo-wide photo-total">
            <strong>Total {money(total)}</strong>
            <button
              className="customer-primary"
              disabled={busy || !lines.length}
              type="submit"
            >
              Guardar pedido
            </button>
          </div>
        </form>
      </Card>
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
  const openDriveFolder = (folderId: string) =>
    fileIntakeRepository?.openDriveFolder(folderId) ??
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
      '_blank',
      'noopener,noreferrer',
    );
  const [rows, setRows] = useState<PhotoJobSummary[]>([]),
    [selected, setSelected] = useState<PhotoJobBundle | null>(null),
    [editPromised, setEditPromised] = useState(''),
    [editPriority, setEditPriority] = useState<PhotoJobPriority>('normal'),
    [editNotes, setEditNotes] = useState(''),
    [filter, setFilter] = useState('active'),
    [view, setView] = useState<'list' | 'board'>('list'),
    [balances, setBalances] = useState<Record<string, number>>({}),
    [query, setQuery] = useState(''),
    [message, setMessage] = useState<string | null>(null),
    [uploadLink, setUploadLink] = useState<UploadLinkView | null>(null),
    [whatsapp, setWhatsapp] = useState<PhotoJobWhatsAppStatus | null>(null),
    [whatsappBusy, setWhatsappBusy] = useState(false);
  const loadWhatsapp = async (jobId: string, channel: string) => {
    if (!notificationRepository || channel !== 'public_web') {
      setWhatsapp(null);
      return;
    }
    try {
      setWhatsapp(await notificationRepository.getStatus(c.businessId, jobId));
    } catch (e) {
      setWhatsapp(null);
      setMessage(errorText(e));
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
      .then((x) => setRows(sortPhotoProductionQueue(x)))
      .catch((e) => setMessage(errorText(e)));
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
      setMessage(errorText(e));
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
      setMessage(
        copied
          ? 'Link generado y copiado.'
          : 'Link generado. Copialo desde aquí abajo.',
      );
      load();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function revokeLink() {
    if (!selected || !fileIntakeRepository) return;
    try {
      await fileIntakeRepository.revokeUploadLink(selected.job.id);
      setUploadLink(await fileIntakeRepository.getUploadLink(selected.job.id));
      setMessage('Link revocado.');
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function saveDetails() {
    if (!selected) return;
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
    } catch (e) {
      setMessage(errorText(e));
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
  async function status(next: PhotoJobStatus) {
    if (!selected) return;
    if (
      next === 'cancelled' &&
      !window.confirm('¿Cancelar este pedido? Quedará en el historial.')
    )
      return;
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
      setMessage(errorText(e));
    }
  }
  async function noticeAction(work: () => Promise<unknown>) {
    if (!selected) return;
    setWhatsappBusy(true);
    try {
      await work();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      await loadWhatsapp(selected.job.id, selected.job.sourceChannel);
      setWhatsappBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Pedidos"
        actions={
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
      />
      {message && <p className="appointment-error">{message}</p>}
      <div className="jobs-toolbar">
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
        <div className="chips" role="group" aria-label="Filtrar por estado">
          {jobFilters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'list' ? (
        <Card className="card--flush">
          {rows.length === 0 ? (
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
      >
        {selected && (
          <div className="photo-detail">
            <div className="ficha-head">
              <div>
                <p className="meta">
                  {selected.customerPhone ?? 'Sin teléfono'}
                </p>
                <JobStateLine job={selected.job} />
                {selected.job.sourceChannel === 'public_web' && (
                  <p className="meta">Pedido web</p>
                )}
              </div>
            </div>
            <div className="photo-actions">
              {selected.job.status === 'received' && (
                <button onClick={() => void status('in_progress')}>
                  En proceso
                </button>
              )}
              {['received', 'in_progress'].includes(selected.job.status) && (
                <button
                  className="customer-primary"
                  onClick={() => void status('ready')}
                >
                  Marcar listo
                </button>
              )}
              {selected.job.status === 'ready' && (
                <button
                  className="customer-primary"
                  onClick={() => void status('delivered')}
                >
                  Entregado
                </button>
              )}
              {!['delivered', 'cancelled'].includes(selected.job.status) && (
                <button onClick={() => void status('cancelled')}>
                  Cancelar
                </button>
              )}
            </div>
            <dl>
              <dt>Fecha ingreso</dt>
              <dd>
                {new Date(selected.job.createdAt).toLocaleString('es-AR')}
              </dd>
              <dt>Entrega prometida</dt>
              <dd>
                {selected.job.promisedAt
                  ? new Date(selected.job.promisedAt).toLocaleString('es-AR')
                  : 'Sin fecha'}
              </dd>
              <dt>Estado</dt>
              <dd>{statusLabel[selected.job.status]}</dd>
              <dt>Archivos</dt>
              <dd>{intakeLabel[selected.job.fileIntakeStatus]}</dd>
            </dl>
            {!['delivered', 'cancelled'].includes(selected.job.status) && (
              <div className="photo-detail-edit">
                <label>
                  Entrega prometida
                  <input
                    type="datetime-local"
                    value={editPromised}
                    onChange={(e) => setEditPromised(e.target.value)}
                  />
                </label>
                <label>
                  Prioridad
                  <select
                    value={editPriority}
                    onChange={(e) =>
                      setEditPriority(e.target.value as PhotoJobPriority)
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </label>
                <label>
                  Notas
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void saveDetails()}>
                  Guardar datos
                </button>
              </div>
            )}
            {selected.items
              .filter((x) => x.isActive)
              .map((x) => (
                <div className="photo-detail-line" key={x.id}>
                  <span>
                    {x.quantity} × {x.serviceNameSnapshot}
                    {x.widthMm
                      ? ` · ${x.widthMm / 10}×${x.heightMm! / 10} cm`
                      : ''}
                  </span>
                  <b>{money(x.totalCents)}</b>
                  {x.notes && <small>{x.notes}</small>}
                  {!['delivered', 'cancelled'].includes(
                    selected.job.status,
                  ) && (
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
                      <button
                        type="button"
                        onClick={() =>
                          patchSelectedItem(x.id, { isActive: false })
                        }
                      >
                        Quitar línea
                      </button>
                    </div>
                  )}
                </div>
              ))}
            <section className="photo-files">
              <h3>ARCHIVOS</h3>
              {selected.items
                .filter((x) => x.isActive)
                .map((item) => {
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
                <p>Todavía no hay archivos recibidos.</p>
              )}
              {fileIntakeRepository &&
                c.role !== 'staff' &&
                selected.job.fileIntakeStatus !== 'not_required' && (
                  <div className="photo-actions">
                    {uploadLink?.url && (
                      <button
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(uploadLink.url!)
                            .then(
                              () => setMessage('Link copiado.'),
                              () =>
                                setMessage(
                                  'No se pudo copiar automáticamente. Seleccioná el link y copialo.',
                                ),
                            )
                        }
                      >
                        Copiar link
                      </button>
                    )}
                    <button onClick={() => void createLink()}>
                      {uploadLink ? 'Regenerar' : 'Generar link'}
                    </button>
                    {uploadLink && !uploadLink.revokedAt && (
                      <button
                        className="danger-action"
                        onClick={() => void revokeLink()}
                      >
                        Revocar
                      </button>
                    )}
                  </div>
                )}
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
                  <small>
                    Por seguridad el token no se puede volver a leer. Regeneralo
                    para obtener un link nuevo.
                  </small>
                )}
              {selected.job.driveFolderId && (
                <button
                  onClick={() => openDriveFolder(selected.job.driveFolderId!)}
                >
                  Abrir carpeta en Drive
                </button>
              )}
              {selected.job.driveEditedFolderId && (
                <button
                  onClick={() =>
                    openDriveFolder(selected.job.driveEditedFolderId!)
                  }
                >
                  Abrir Editadas
                </button>
              )}
              {!fileIntakeRepository &&
                selected.job.fileIntakeStatus !== 'not_required' &&
                !selected.job.driveFolderId && (
                  <small>Google Drive requiere conexión.</small>
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
                <small className="whatsapp-panel">
                  El aviso por WhatsApp lo envía la nube cuando este cambio se
                  sincroniza; no hace falta hacer nada en este equipo.
                </small>
              ) : null)}
            <h3>
              TOTAL{' '}
              {money(
                selected.items
                  .filter((x) => x.isActive)
                  .reduce((s, x) => s + x.totalCents, 0),
              )}
            </h3>
            <PaymentAccountPanel
              repository={paymentRepository}
              sourceType="photo_job"
              sourceId={selected.job.id}
              onMutation={() => {
                load();
                onMutation?.();
              }}
            />
            {!['delivered', 'cancelled'].includes(selected.job.status) && (
              <button
                className="customer-primary"
                type="button"
                onClick={() => void saveDetails()}
              >
                Guardar líneas y datos
              </button>
            )}
            {selected.job.notes && <p>{selected.job.notes}</p>}
            {selected.job.sourceAppointmentId && (
              <small>Origen: turno {selected.job.sourceAppointmentId}</small>
            )}
            {selected.job.sourceEventId && (
              <small>Origen: evento {selected.job.sourceEventId}</small>
            )}
          </div>
        )}
      </Sheet>
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

/** Estado principal del trabajo en una línea; sólo urgencia/atraso/listo llevan tono. */
function JobStateLine({ job }: { job: PhotoJobSummary['job'] }) {
  const parts: Array<{ text: string; tone?: 'alert' | 'warn' | 'ok' }> = [];
  if (
    job.priority === 'urgent' &&
    !['delivered', 'cancelled'].includes(job.status)
  )
    parts.push({ text: 'Urgente', tone: 'alert' });
  if (isPhotoJobOverdue(job)) parts.push({ text: 'Atrasado', tone: 'alert' });
  parts.push({
    text: statusLabel[job.status],
    tone: job.status === 'ready' ? 'ok' : undefined,
  });
  return <StateLine parts={parts} />;
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

type ProductionRow = {
  bundle: PhotoJobBundle;
  item: PhotoJobBundle['items'][number];
  route: 'lab' | 'editing';
  files: NonNullable<PhotoJobBundle['files']>;
};
type ProductionJob = {
  key: string;
  bundle: PhotoJobBundle;
  route: 'lab' | 'editing';
  services: string[];
  files: NonNullable<PhotoJobBundle['files']>;
};

/**
 * Producción: la cola de Laboratorio y de Edición. Una fila por trabajo y carril, pensada para
 * una tablet de ~10": ver la cola, abrir Drive o el trabajo y pasarlo a «en proceso» / «listo».
 */
export function PhotoProductionPage({
  repository,
  fileIntakeRepository,
  notificationRepository,
  refreshToken,
  onOpenJob,
  onMutation,
}: {
  repository: PhotoRepository;
  fileIntakeRepository?: PhotoFileIntakeAdminRepository;
  /** Web: avisa a la nube de que el pedido quedó listo (el aviso de WhatsApp lo envía ella). */
  notificationRepository?: PhotoJobNotificationRepository;
  refreshToken?: number;
  onOpenJob?: (jobId: string) => void;
  onMutation?: () => void;
}) {
  const c = useBusinessContext();
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void repository
      .listJobs(c.businessId, c.branchId!, {
        statuses: ['received', 'in_progress', 'ready'],
        limit: 300,
      })
      .then(
        async (jobs) =>
          (
            await Promise.all(
              jobs
                .filter((x) => x.job.fileIntakeStatus === 'submitted')
                .map((x) => repository.getJob(c.businessId, x.job.id)),
            )
          ).filter(Boolean) as PhotoJobBundle[],
      )
      .then((bundles) => {
        const next: ProductionRow[] = [];
        for (const bundle of bundles)
          for (const item of bundle.items.filter((x) => x.isActive)) {
            const files = (bundle.files ?? []).filter(
              (x) => x.photoJobItemId === item.id && x.status === 'uploaded',
            );
            const route = files[0]?.workflowRoute;
            if ((route === 'lab' || route === 'editing') && files.length)
              next.push({ bundle, item, route, files });
          }
        next.sort((a, b) =>
          comparePhotoProductionQueue(a.bundle.job, b.bundle.job),
        );
        if (live) {
          setRows(next);
          setLoaded(true);
        }
      })
      .catch((x) => live && setMessage(errorText(x)));
    return () => {
      live = false;
    };
  }, [repository, c.businessId, c.branchId, refreshToken, reload]);
  const openFolder = (id: string) =>
    fileIntakeRepository?.openDriveFolder(id) ??
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`,
      '_blank',
      'noopener,noreferrer',
    );

  const queue = (route: 'lab' | 'editing'): ProductionJob[] => {
    const byJob = new Map<string, ProductionJob>();
    for (const row of rows.filter((x) => x.route === route)) {
      const found = byJob.get(row.bundle.job.id);
      if (found) {
        found.services.push(row.item.serviceNameSnapshot);
        found.files.push(...row.files);
      } else
        byJob.set(row.bundle.job.id, {
          key: `${route}:${row.bundle.job.id}`,
          bundle: row.bundle,
          route,
          services: [row.item.serviceNameSnapshot],
          files: [...row.files],
        });
    }
    return [...byJob.values()];
  };

  async function advance(job: ProductionJob, next: PhotoJobStatus) {
    setBusyJob(job.bundle.job.id);
    setMessage(null);
    try {
      await repository.setJobStatus(c.businessId, job.bundle.job.id, next);
      if (next === 'ready' && job.bundle.job.sourceChannel === 'public_web')
        await notificationRepository?.wake(c.businessId, job.bundle.job.id);
      setReload((x) => x + 1);
      onMutation?.();
    } catch (x) {
      setMessage(errorText(x));
    } finally {
      setBusyJob(null);
    }
  }

  return (
    <div className="production">
      <PageHeader
        title="Producción"
        description="Vista operativa de los pedidos de laboratorio y edición."
      />
      {message && <p className="appointment-error">{message}</p>}
      {(['lab', 'editing'] as const).map((route) => {
        const jobs = queue(route);
        const urgent = jobs.filter(
          (x) =>
            x.bundle.job.priority === 'urgent' ||
            isPhotoJobOverdue(x.bundle.job),
        ).length;
        return (
          <section
            className="lane"
            key={route}
            aria-label={route === 'lab' ? 'Laboratorio' : 'Edición'}
          >
            <header className="lane-head on-dark">
              <h2>{route === 'lab' ? 'LABORATORIO' : 'EDICIÓN'}</h2>
              <span className="lane-stats">
                {jobs.length} en cola
                {urgent > 0 && (
                  <span className="hot"> · {urgent} urgentes o atrasados</span>
                )}
              </span>
            </header>
            {!loaded ? (
              <p className="pad meta">Cargando cola…</p>
            ) : jobs.length === 0 ? (
              <EmptyState icon="printer" title="No hay pedidos en esta cola" />
            ) : (
              <div className="rows">
                {jobs.map((job) => {
                  const j = job.bundle.job;
                  const busy = busyJob === j.id;
                  const copies = job.files.reduce((s, x) => s + x.copies, 0);
                  const flag =
                    isPhotoJobOverdue(j) || j.priority === 'urgent'
                      ? 'alert'
                      : j.status === 'ready'
                        ? 'ok'
                        : undefined;
                  return (
                    <div
                      className="oprow prod-row"
                      data-flag={flag}
                      key={job.key}
                    >
                      <span className="who">
                        {job.bundle.customerName}
                        {j.sourceChannel === 'public_web' && (
                          <span className="meta block">Pedido web</span>
                        )}
                      </span>
                      <span className="what">
                        {job.services.join(' · ')}
                        <span className="meta block">
                          {plural(job.files.length, 'archivo', 'archivos')}
                          {route === 'lab' ? ` · ${copies} copias` : ''}
                        </span>
                      </span>
                      <span className="when">
                        <span
                          className={
                            isPhotoJobOverdue(j) ? 'txt-alert' : undefined
                          }
                        >
                          {dueText(j.promisedAt)}
                        </span>
                        <JobStateLine job={j} />
                      </span>
                      <span className="act">
                        {j.status === 'received' && (
                          <button
                            type="button"
                            className="btn touch-lg"
                            disabled={busy}
                            onClick={() => void advance(job, 'in_progress')}
                          >
                            En proceso
                          </button>
                        )}
                        {['received', 'in_progress'].includes(j.status) && (
                          <button
                            type="button"
                            className="btn btn--primary touch-lg"
                            disabled={busy}
                            onClick={() => void advance(job, 'ready')}
                          >
                            Listo
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost touch-lg"
                          onClick={() =>
                            openFolder(job.files[0]!.driveFolderId)
                          }
                        >
                          {route === 'editing' ? 'Originales' : 'Drive'}
                        </button>
                        {onOpenJob && (
                          <button
                            type="button"
                            className="btn btn--ghost touch-lg"
                            onClick={() => onOpenJob(j.id)}
                          >
                            Abrir
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

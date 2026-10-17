import { useEffect, useState, type FormEvent } from 'react';
import {
  buildPhotoJob,
  createCustomer,
  createPhotoService,
  searchCustomers,
  sortPhotoProductionQueue,
  type CustomerRepository,
  type PhotoJobBundle,
  type PhotoJobSummary,
  type PhotoRepository,
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
  type Customer,
  type PhotoJobStatus,
  type PhotoJobPriority,
  type PhotoService,
  type PhotoServiceType,
  type PhotoWorkflowRoute,
} from '@centrocolor/domain';
import { Card, PageHeader } from '@centrocolor/ui';
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
    [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState(''),
    [name, setName] = useState(''),
    [type, setType] = useState<PhotoServiceType>('print'),
    [width, setWidth] = useState(''),
    [height, setHeight] = useState(''),
    [price, setPrice] = useState('0'),
    [workflowRoute, setWorkflowRoute] = useState<PhotoWorkflowRoute>('none'),
    [requiresFiles, setRequiresFiles] = useState(false);
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
        eyebrow="FOTOGRAFÍA"
        title="Servicios"
        description="Catálogo configurable. Los trabajos conservan nombre y precio históricos."
      />
      {message && <p className="appointment-error">{message}</p>}
      {canEdit ? (
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
            <label>
              Precio unitario
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
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
            <div>
              <button className="customer-primary" type="submit">
                {editing ? 'Guardar cambios' : 'Crear servicio'}
              </button>
              {editing && (
                <button type="button" onClick={clear}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </Card>
      ) : (
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
            <b>{money(x.defaultUnitPriceCents)}</b>
            <span>
              {routeLabel[x.workflowRoute]} ·{' '}
              {x.requiresCustomerFiles
                ? 'recibe archivos'
                : 'sin carga del cliente'}
            </span>
            <span>{x.isActive ? 'Activo' : 'Inactivo'}</span>
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
};
export function NewPhotoJobPage({
  repository,
  customerRepository,
  onMutation,
  refreshToken,
}: {
  repository: PhotoRepository;
  customerRepository: CustomerRepository;
  onMutation?: () => void;
  refreshToken?: number;
}) {
  const c = useBusinessContext();
  const [services, setServices] = useState<PhotoService[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [query, setQuery] = useState(''),
    [customerId, setCustomerId] = useState(''),
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
    const timer = window.setTimeout(
      () =>
        searchCustomers(customerRepository, c.businessId, query)
          .then((r) => setCustomers(r.filter((x) => x.isActive)))
          .catch((x) => setMessage(errorText(x))),
      120,
    );
    return () => clearTimeout(timer);
  }, [customerRepository, c.businessId, query]);
  function addService(id: string) {
    const s = services.find((x) => x.id === id);
    if (!s) return;
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
          serviceNameSnapshot: x.name,
          quantity: Number(x.quantity),
          unitPriceCents: Math.round(Number(x.price.replace(',', '.')) * 100),
          notes: x.notes || null,
          widthMm: x.widthMm,
          heightMm: x.heightMm,
        })),
      });
      await repository.saveJob(built.job, built.items);
      setLines([]);
      setNotes('');
      setPromised('');
      setMessage('Trabajo creado como Recibido.');
      onMutation?.();
    } catch (x) {
      setMessage(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const total = lines.reduce(
    (s, x) =>
      s +
      (Number(x.quantity) || 0) *
        Math.round((Number(x.price.replace(',', '.')) || 0) * 100),
    0,
  );
  return (
    <>
      <PageHeader
        eyebrow="FOTOGRAFÍA"
        title="Nuevo trabajo"
        description="Carga rápida con precio snapshot; no modifica el catálogo."
      />
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
              {customers.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.fullName}
                  {x.phone ? ` · ${x.phone}` : ''}
                </option>
              ))}
            </select>
          </label>
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
              {services.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.widthMm
                    ? ` · ${x.widthMm / 10}×${x.heightMm! / 10} cm`
                    : ''}{' '}
                  · {money(x.defaultUnitPriceCents)}
                </option>
              ))}
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
                  value={x.price}
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
              Guardar trabajo
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
  onMutation,
  refreshToken,
  initialJobId,
}: {
  repository: PhotoRepository;
  paymentRepository: WorkPaymentRepository;
  fileIntakeRepository?: PhotoFileIntakeAdminRepository;
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
    [query, setQuery] = useState(''),
    [message, setMessage] = useState<string | null>(null),
    [uploadLink, setUploadLink] = useState<UploadLinkView | null>(null);
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
  async function open(id: string) {
    try {
      const bundle = await repository.getJob(c.businessId, id);
      setSelected(bundle);
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
      !window.confirm('¿Cancelar este trabajo? Quedará en el historial.')
    )
      return;
    try {
      await repository.setJobStatus(c.businessId, selected.job.id, next);
      setSelected(await repository.getJob(c.businessId, selected.job.id));
      load();
      onMutation?.();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="FOTOGRAFÍA"
        title="Trabajos"
        description="Cola de producción: urgentes, atrasados y entrega más próxima primero."
      />
      {message && <p className="appointment-error">{message}</p>}
      <Card>
        <div className="photo-filters">
          <input
            type="search"
            placeholder="Cliente, teléfono, servicio o notas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Todos activos</option>
            <option value="received">Recibidos</option>
            <option value="in_progress">En proceso</option>
            <option value="ready">Listos</option>
            <option value="delivered">Entregados</option>
            <option value="cancelled">Cancelados</option>
            <option value="urgent">Urgentes</option>
            <option value="all">Todos</option>
          </select>
        </div>
      </Card>
      <div className="photo-jobs-layout">
        <div className="photo-job-list">
          {rows.map((x) => {
            const overdue = isPhotoJobOverdue(x.job);
            return (
              <button
                key={x.job.id}
                className={`photo-job-card ${x.job.status === 'ready' ? 'photo-ready' : ''}`}
                onClick={() => void open(x.job.id)}
              >
                {x.job.priority === 'urgent' && (
                  <b className="photo-urgent">URGENTE</b>
                )}
                {overdue && <b className="photo-overdue">ATRASADO</b>}
                <strong>{x.customerName}</strong>
                <span>{x.itemSummary || 'Sin ítems activos'}</span>
                <span>
                  {x.job.promisedAt
                    ? new Date(x.job.promisedAt).toLocaleString('es-AR')
                    : 'Sin fecha prometida'}
                </span>
                <span className={`photo-status status-${x.job.status}`}>
                  {statusLabel[x.job.status]}
                </span>
                <b>{money(x.totalCents)}</b>
              </button>
            );
          })}
          {!rows.length && <Card>No hay trabajos para este filtro.</Card>}
        </div>
        {selected && (
          <Card className="photo-detail">
            <button
              className="photo-detail-close"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
            <h2>{selected.customerName}</h2>
            <p>{selected.customerPhone ?? 'Sin teléfono'}</p>
            {selected.job.priority === 'urgent' && (
              <b className="photo-urgent">URGENTE</b>
            )}
            {isPhotoJobOverdue(selected.job) && (
              <b className="photo-overdue">ATRASADO</b>
            )}
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
            {selected.job.sourceAppointmentId && (
              <small>Origen: turno {selected.job.sourceAppointmentId}</small>
            )}
            {selected.job.sourceEventId && (
              <small>Origen: evento {selected.job.sourceEventId}</small>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

export function PhotoJobsDashboard({
  repository,
  refreshToken,
}: {
  repository: PhotoRepository;
  refreshToken?: number;
}) {
  const c = useBusinessContext();
  const [rows, setRows] = useState<PhotoJobSummary[]>([]);
  useEffect(() => {
    repository
      .listJobs(c.businessId, c.branchId!, {
        statuses: ['received', 'in_progress', 'ready'],
        limit: 100,
      })
      .then((x) => setRows(sortPhotoProductionQueue(x)))
      .catch(() => setRows([]));
  }, [repository, c.businessId, c.branchId, refreshToken]);
  const pending = rows.filter((x) =>
      ['received', 'in_progress'].includes(x.job.status),
    ).length,
    ready = rows.filter((x) => x.job.status === 'ready').length,
    urgent = rows.filter(
      (x) =>
        x.job.priority === 'urgent' &&
        !['delivered', 'cancelled'].includes(x.job.status),
    ).length;
  return (
    <Card className="metric-card">
      <h2>Trabajos fotográficos</h2>
      <div className="metric-value">{pending}</div>
      <p>
        {urgent} urgentes · <strong>{ready} listos para entregar</strong>
      </p>
      {rows.slice(0, 3).map((x) => (
        <small key={x.job.id}>
          {x.job.priority === 'urgent' ? 'URGENTE · ' : ''}
          {x.customerName} · {statusLabel[x.job.status]}
        </small>
      ))}
    </Card>
  );
}

type ProductionRow = {
  bundle: PhotoJobBundle;
  item: PhotoJobBundle['items'][number];
  route: 'lab' | 'editing';
  files: NonNullable<PhotoJobBundle['files']>;
};
export function PhotoProductionPage({
  repository,
  fileIntakeRepository,
  refreshToken,
  onOpenJob,
}: {
  repository: PhotoRepository;
  fileIntakeRepository?: PhotoFileIntakeAdminRepository;
  refreshToken?: number;
  onOpenJob?: (jobId: string) => void;
}) {
  const c = useBusinessContext();
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
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
        setRows(next);
      })
      .catch((x) => setMessage(errorText(x)));
  }, [repository, c.businessId, c.branchId, refreshToken]);
  const openFolder = (id: string) =>
    fileIntakeRepository?.openDriveFolder(id) ??
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`,
      '_blank',
      'noopener,noreferrer',
    );
  const queue = (route: 'lab' | 'editing') =>
    rows.filter((x) => x.route === route);
  return (
    <>
      <PageHeader
        eyebrow="FOTOGRAFÍA"
        title="Producción"
        description="Archivos enviados y listos para laboratorio o edición."
      />
      {message && <p className="appointment-error">{message}</p>}
      {(['lab', 'editing'] as const).map((route) => (
        <section className="production-queue" key={route}>
          <h2>{route === 'lab' ? 'LABORATORIO' : 'EDICIÓN'}</h2>
          {queue(route).map((row) => (
            <Card
              key={`${row.bundle.job.id}:${row.item.id}`}
              className="production-row"
            >
              <div>
                {row.bundle.job.priority === 'urgent' && (
                  <b className="photo-urgent">URGENTE</b>
                )}{' '}
                {isPhotoJobOverdue(row.bundle.job) && (
                  <b className="photo-overdue">ATRASADO</b>
                )}
                <strong>{row.bundle.customerName}</strong>
                <span>{row.item.serviceNameSnapshot}</span>
              </div>
              <span>
                {row.files.length} archivos ·{' '}
                {row.files.reduce((s, x) => s + x.copies, 0)} copias
              </span>
              <span>
                {row.bundle.job.promisedAt
                  ? new Date(row.bundle.job.promisedAt).toLocaleString('es-AR')
                  : 'Sin fecha prometida'}
              </span>
              <button onClick={() => openFolder(row.files[0].driveFolderId)}>
                {route === 'editing' ? 'Abrir originales' : 'Abrir Drive'}
              </button>
              {onOpenJob && (
                <button onClick={() => onOpenJob(row.bundle.job.id)}>
                  Abrir Job
                </button>
              )}
            </Card>
          ))}
          {!queue(route).length && <Card>No hay trabajos en esta cola.</Card>}
        </section>
      ))}
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Button, Icon, Sheet } from '@centrocolor/ui';
import {
  fetchCatalog,
  PublicOrderError,
  runPool,
  startOrder,
  submitOrder,
  uploadPhoto,
  type Catalog,
  type StartedOrder,
  type SubmittedOrder,
} from './client';
import {
  deriveLines,
  fileProblem,
  FILE_INPUT_ACCEPT,
  formatMoney,
  formatSize,
  howItWorks,
  loadClientKey,
  loadRememberedOrder,
  MAX_FILES_PER_ORDER,
  missingForConfirm,
  orderTotal,
  paymentNote,
  BANK_ALIAS,
  PRINT_AFTER_PAYMENT,
  rememberOrder,
  resetClientKey,
  startBody,
  type CatalogService,
  type CustomerForm,
  type OrderLine,
  type PhotoEntry,
} from './model';
import { CopiesStepper, PrintFrame, Thumb } from './parts';
import { PublicShell, useDocumentMeta } from './shell';
import './public-order.css';

type Phase = 'edit' | 'sending' | 'partial' | 'done';
type Progress = {
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  percent: number;
  error?: string;
};

const messageFor = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'No se pudo completar la operación. Reintentá.';

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const dimensions = (service: CatalogService) =>
  service.widthMm && service.heightMm
    ? `${service.widthMm / 10} × ${service.heightMm / 10} cm`.replaceAll(
        '.',
        ',',
      )
    : null;

export function PrintOrderPortal() {
  useDocumentMeta('Imprimí tus fotos · CentroColor', false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const [customer, setCustomer] = useState<CustomerForm>({
    name: '',
    phone: '',
    email: '',
    notes: '',
    whatsappOptIn: true,
  });
  const [phase, setPhase] = useState<Phase>('edit');
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SubmittedOrder | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState<'alias' | 'amount' | null>(null);
  const session = useRef<{ started: StartedOrder } | null>(null);
  const remembered = useMemo(() => loadRememberedOrder(), []);

  const loadCatalog = () =>
    fetchCatalog()
      .then((value) => {
        setCatalog(value);
        setLoadError(null);
        return value;
      })
      .catch((error) => {
        setLoadError(messageFor(error));
        return null;
      });
  useEffect(() => {
    void loadCatalog();
  }, []);

  const lines = useMemo(
    () => deriveLines(catalog?.services ?? [], selected, entries),
    [catalog, selected, entries],
  );
  const total = orderTotal(lines);
  const missing = missingForConfirm(lines, selected, customer);

  async function copy(text: string, key: 'alias' | 'amount') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* el portapapeles puede no estar disponible: igual se confirma visualmente */
    }
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2200);
  }

  function toggleService(id: string) {
    if (selected.includes(id)) {
      const hasPhotos = entries.some((x) => x.serviceId === id);
      if (hasPhotos && !window.confirm('¿Quitar este tamaño y sus fotos?'))
        return;
      setSelected((current) => current.filter((x) => x !== id));
      setEntries((current) => current.filter((x) => x.serviceId !== id));
    } else setSelected((current) => [...current, id]);
  }

  function addFiles(serviceId: string, list: FileList | null) {
    if (!list) return;
    const accepted: PhotoEntry[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      const problem = fileProblem(file);
      if (problem) problems.push(problem);
      else if (entries.length + accepted.length >= MAX_FILES_PER_ORDER) {
        problems.push(
          `Podés enviar hasta ${MAX_FILES_PER_ORDER} fotos por pedido.`,
        );
        break;
      } else
        accepted.push({ id: crypto.randomUUID(), serviceId, file, copies: 1 });
    }
    setEntries((current) => [...current, ...accepted]);
    setNotice(problems.length ? [...new Set(problems)].join(' ') : null);
  }

  const patchEntry = (id: string, patch: Partial<PhotoEntry>) =>
    setEntries((current) =>
      current.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    );
  const removeEntry = (id: string) =>
    setEntries((current) => current.filter((x) => x.id !== id));
  const patchProgress = (id: string, value: Progress) =>
    setProgress((current) => ({ ...current, [id]: value }));

  async function sendPhotos(targets: PhotoEntry[]) {
    const started = session.current!.started;
    const destinations = new Map(
      started.destinations.map((x) => [x.serviceId, x.destinationId]),
    );
    const failures = await runPool(targets, 2, async (entry) => {
      patchProgress(entry.id, { status: 'uploading', percent: 0 });
      try {
        await uploadPhoto(
          started.uploadToken,
          {
            id: entry.id,
            file: entry.file,
            copies: entry.copies,
            destinationId: destinations.get(entry.serviceId)!,
          },
          (percent) =>
            patchProgress(entry.id, { status: 'uploading', percent }),
        );
        patchProgress(entry.id, { status: 'done', percent: 100 });
      } catch (error) {
        patchProgress(entry.id, {
          status: 'failed',
          percent: 0,
          error: messageFor(error),
        });
        throw error;
      }
    });
    return failures.length;
  }

  async function finish() {
    const done = await submitOrder(session.current!.started.uploadToken);
    rememberOrder({
      orderCode: done.orderCode,
      trackingToken: done.trackingToken,
      at: new Date().toISOString(),
    });
    resetClientKey();
    setResult(done);
    setPhase('done');
    window.history.replaceState(null, '', '/imprimir/recibido');
    window.scrollTo?.({ top: 0 });
  }

  async function confirm() {
    setSheet(false);
    if (missing.length) {
      setShowMissing(true);
      // Take the customer to the first thing that is missing.
      const target = missing[0]!.startsWith('elegí')
        ? 'tamanos'
        : missing[0]!.startsWith('agregá')
          ? 'fotos'
          : 'datos';
      window.setTimeout(
        () =>
          document
            .getElementById(target)
            ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
        60,
      );
      return;
    }
    setNotice(null);
    setShowMissing(false);
    setPhase('sending');
    setProgress(
      Object.fromEntries(
        entries.map((x) => [x.id, { status: 'waiting', percent: 0 }]),
      ),
    );
    try {
      const started = await startOrder(
        startBody(loadClientKey(), customer, lines),
      );
      session.current = { started };
      const failed = await sendPhotos(entries);
      if (failed) setPhase('partial');
      else await finish();
    } catch (error) {
      await handleFailure(error);
    }
  }

  async function handleFailure(error: unknown) {
    const code = error instanceof PublicOrderError ? error.code : null;
    if (code === 'price_changed' || code === 'service_unavailable') {
      const fresh = await loadCatalog();
      if (fresh) {
        const ids = new Set(fresh.services.map((x) => x.id));
        setSelected((current) => current.filter((x) => ids.has(x)));
        setEntries((current) => current.filter((x) => ids.has(x.serviceId)));
      }
      setNotice(
        code === 'price_changed'
          ? 'Los precios cambiaron. Revisá el total actualizado y confirmá de nuevo.'
          : 'Un tamaño ya no está disponible. Revisá tu pedido.',
      );
    } else setNotice(messageFor(error));
    setPhase('edit');
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  async function retryFailed() {
    const failed = entries.filter((x) => progress[x.id]?.status === 'failed');
    setPhase('sending');
    try {
      const stillFailed = await sendPhotos(failed);
      if (stillFailed) setPhase('partial');
      else await finish();
    } catch (error) {
      await handleFailure(error);
    }
  }

  async function skipFailed() {
    const kept = entries.filter((x) => progress[x.id]?.status === 'done');
    if (!kept.length) {
      setNotice('Ninguna foto llegó. Reintentá o volvé a empezar.');
      return;
    }
    setEntries(kept);
    setPhase('sending');
    try {
      await finish();
    } catch (error) {
      await handleFailure(error);
    }
  }

  /* ───────────────────────────── screens ───────────────────────────── */

  if (loadError && !catalog)
    return (
      <PublicShell>
        <div className="pt-page">
          <section className="po-card po-center">
            <h2>No pudimos cargar la lista de precios</h2>
            <p>{loadError}</p>
            <Button variant="primary" onClick={() => void loadCatalog()}>
              Reintentar
            </Button>
          </section>
        </div>
      </PublicShell>
    );
  if (!catalog)
    return (
      <PublicShell>
        <p className="po-center pad" role="status">
          Cargando…
        </p>
      </PublicShell>
    );
  if (!catalog.available || !catalog.services.length)
    return (
      <PublicShell businessName={catalog.businessName}>
        <div className="pt-page">
          <section className="po-card po-center">
            <h2>Los pedidos online no están disponibles por ahora</h2>
            <p>Podés acercarte al local y te atendemos enseguida.</p>
          </section>
        </div>
      </PublicShell>
    );

  if (phase === 'done' && result)
    return (
      <PublicShell businessName={catalog.businessName}>
        <div className="pt-page" aria-live="polite">
          <div className="rcv-title">
            <span className="stamp" aria-hidden="true">
              <Icon name="check" />
            </span>
            <div>
              <h1>
                PEDIDO <span className="marker">RECIBIDO</span>
              </h1>
              <p className="frame-tag code">{result.orderCode}</p>
            </div>
          </div>
          <section className="po-card">
            <ul className="order-lines">
              {result.items.map((item) => (
                <li key={item.name}>
                  <span className="sz">{item.name}</span>
                  <span className="meta">
                    {plural(item.quantity, 'copia', 'copias')}
                  </span>
                  <b className="num">{formatMoney(item.totalCents)}</b>
                </li>
              ))}
            </ul>
            <p className="order-total">
              <span>TOTAL</span>
              <b className="num">{formatMoney(result.totalCents)}</b>
            </p>
          </section>
          <section className="xfer on-dark" aria-labelledby="h-xfer">
            <div className="xfer-in">
              <div>
                <h2 id="h-xfer" className="lbl">
                  Total a transferir
                </h2>
                <div className="amount num">
                  {formatMoney(result.totalCents)}
                </div>
              </div>
              <div>
                <div className="lbl po-xfer-label">Transferí a este alias</div>
                <div className="alias-row">
                  <span className="alias" translate="no">
                    {BANK_ALIAS}
                  </span>
                  <Button
                    variant="primary"
                    icon={copied === 'alias' ? 'check' : 'copy'}
                    onClick={() => void copy(BANK_ALIAS, 'alias')}
                  >
                    {copied === 'alias' ? 'Copiado' : 'Copiar alias'}
                  </Button>
                </div>
              </div>
              <ol className="xfer-steps">
                <li>
                  <b>1</b>
                  <span>
                    Transferí <strong>{formatMoney(result.totalCents)}</strong>{' '}
                    al alias de arriba.{' '}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm on-dark po-copy-amount"
                      onClick={() =>
                        void copy(String(result.totalCents / 100), 'amount')
                      }
                    >
                      {copied === 'amount' ? 'Monto copiado ✓' : 'Copiar monto'}
                    </button>
                  </span>
                </li>
                <li>
                  <b>2</b>
                  <span>Cuando se acredite, empezamos a imprimir.</span>
                </li>
              </ol>
            </div>
          </section>
          <div className="callout" role="note">
            <Icon name="printer" />
            <div>
              <strong>{PRINT_AFTER_PAYMENT}</strong>
            </div>
          </div>
          <div className="callout callout--wa">
            <Icon name="chat" />
            <div>
              <strong>
                Te avisaremos por WhatsApp cuando tu pedido esté listo.
              </strong>
              <p className="mono">{customer.phone}</p>
            </div>
          </div>
          <div className="row-actions">
            <a
              className="btn btn--primary btn--lg"
              href={`/pedido/${result.trackingToken}`}
            >
              <Icon name="receipt" /> Ver estado del pedido
            </a>
          </div>
        </div>
      </PublicShell>
    );

  if (phase === 'sending' || phase === 'partial') {
    const states = entries.map((x) => progress[x.id]?.status ?? 'waiting');
    const done = states.filter((x) => x === 'done').length;
    const failed = entries.filter((x) => progress[x.id]?.status === 'failed');
    const percent = entries.length
      ? Math.round(
          entries.reduce(
            (sum, x) =>
              sum +
              (progress[x.id]?.status === 'done'
                ? 100
                : (progress[x.id]?.percent ?? 0)),
            0,
          ) / entries.length,
        )
      : 0;
    return (
      <PublicShell businessName={catalog.businessName}>
        <div className="pt-page">
          <section className="po-card" aria-live="polite">
            {phase === 'sending' ? (
              <>
                <h2>Enviando tu pedido…</h2>
                <p>
                  {done} de {entries.length} fotos enviadas. No cierres esta
                  página hasta que termine.
                </p>
                <progress
                  max="100"
                  value={percent}
                  aria-label="Progreso total"
                />
              </>
            ) : (
              <>
                <h2>Algunas fotos no se pudieron enviar</h2>
                <p>
                  Llegaron {done} de {entries.length}. Podés reintentar las que
                  faltan o enviar el pedido sólo con las que llegaron.
                </p>
              </>
            )}
            {notice && <p className="po-error">{notice}</p>}
            <ul className="po-upload-list">
              {entries.map((entry) => {
                const state = progress[entry.id];
                return (
                  <li key={entry.id}>
                    <Thumb file={entry.file} />
                    <span className="po-upload-name">
                      {entry.file.name}
                      <small>
                        {state?.status === 'done'
                          ? '✓ recibida'
                          : state?.status === 'failed'
                            ? state.error
                            : state?.status === 'uploading'
                              ? `${state.percent}%`
                              : 'esperando'}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
            {phase === 'partial' && (
              <div className="row-actions">
                <Button variant="primary" onClick={() => void retryFailed()}>
                  Reintentar ({failed.length})
                </Button>
                <Button onClick={() => void skipFailed()}>
                  Enviar sin esas fotos
                </Button>
              </div>
            )}
          </section>
        </div>
      </PublicShell>
    );
  }

  const photoCount = lines.reduce((sum, line) => sum + line.files, 0);
  const copyCount = lines.reduce((sum, line) => sum + line.copies, 0);

  const summary = (
    <Summary
      lines={lines}
      total={total}
      missing={showMissing ? missing : []}
      onConfirm={() => void confirm()}
    />
  );

  const hero = (
    <div className="pt-hero">
      <div>
        <h1>
          Imprimí <span className="marker">tus fotos</span>
        </h1>
        <p className="lede">
          Elegí el tamaño, subí tus fotos y pasá a retirarlas por el local.
        </p>
        <div className="actions">
          <a className="btn btn--dark btn--lg" href="#tamanos">
            Empezar <Icon name="chevD" />
          </a>
        </div>
      </div>
      <div className="print-stack" aria-hidden="true">
        <span className="print p1" />
        <span className="print p2" />
        <span className="print p3" />
      </div>
      <ul className="how how-row" aria-label="Cómo funciona">
        {howItWorks.map((step, index) => (
          <li key={step.label}>
            <span className="ico">
              <Icon name={step.icon} />
            </span>
            <span>
              {index + 1}. {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <PublicShell businessName={catalog.businessName} hero={hero}>
      <div className="pt-main">
        <div className="pt-flow">
          {remembered && (
            <a className="po-last" href={`/pedido/${remembered.trackingToken}`}>
              Ver el estado de tu último pedido ({remembered.orderCode})
            </a>
          )}
          {notice && (
            <p className="po-error" role="alert">
              {notice}
            </p>
          )}

          <section id="tamanos" aria-labelledby="h-tam">
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                1
              </span>
              <h2 id="h-tam">Elegí el tamaño</h2>
            </div>
            <div className="sizes">
              {catalog.services.map((service) => (
                <SizeCard
                  key={service.id}
                  service={service}
                  selected={selected.includes(service.id)}
                  onToggle={() => toggleService(service.id)}
                />
              ))}
            </div>
          </section>

          <section id="fotos" aria-labelledby="h-fotos">
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                2
              </span>
              <h2 id="h-fotos">Subí tus fotos</h2>
            </div>
            {!lines.length ? (
              <div className="empty-box">
                <Icon name="image" size={38} />
                <strong>Primero elegí un tamaño</strong>
              </div>
            ) : (
              lines.map((line) => (
                <PhotoGroup
                  key={line.service.id}
                  line={line}
                  entries={entries.filter(
                    (x) => x.serviceId === line.service.id,
                  )}
                  onAdd={(files) => addFiles(line.service.id, files)}
                  onCopies={(id, copies) => patchEntry(id, { copies })}
                  onRemove={removeEntry}
                  onRemoveSize={() => toggleService(line.service.id)}
                />
              ))
            )}
          </section>

          <section id="datos" aria-labelledby="h-datos">
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                3
              </span>
              <h2 id="h-datos">Tus datos</h2>
            </div>
            <form
              className="cust"
              onSubmit={(event) => event.preventDefault()}
              noValidate
            >
              <label className="field">
                <span>Nombre</span>
                <input
                  className="input"
                  autoComplete="name"
                  value={customer.name}
                  maxLength={80}
                  onChange={(e) =>
                    setCustomer({ ...customer, name: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>WhatsApp</span>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="342 555 1234"
                  value={customer.phone}
                  maxLength={30}
                  onChange={(e) =>
                    setCustomer({ ...customer, phone: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>
                  Email <span className="opt">Opcional</span>
                </span>
                <input
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={customer.email}
                  maxLength={120}
                  onChange={(e) =>
                    setCustomer({ ...customer, email: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>
                  Notas <span className="opt">Opcional</span>
                </span>
                <textarea
                  className="textarea"
                  rows={2}
                  maxLength={500}
                  value={customer.notes}
                  onChange={(e) =>
                    setCustomer({ ...customer, notes: e.target.value })
                  }
                />
              </label>
            </form>
          </section>

          <section
            className="narrow-only"
            aria-labelledby="h-conf"
            id="resumen"
          >
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                4
              </span>
              <h2 id="h-conf">Confirmá tu pedido</h2>
            </div>
            {summary}
          </section>
        </div>

        <aside className="sum-side" aria-label="Resumen del pedido">
          {summary}
        </aside>
      </div>

      {selected.length > 0 && (
        <div className="pt-bar on-dark">
          <button
            type="button"
            className="sum-open"
            onClick={() => setSheet(true)}
            aria-label={`Ver resumen del pedido. Total ${formatMoney(total)}`}
          >
            <span className="lbl">TOTAL</span>
            <span className="amt num">{formatMoney(total)}</span>
            <span className="cnt">
              {plural(copyCount, 'copia', 'copias')} ·{' '}
              {plural(photoCount, 'foto', 'fotos')}
              <Icon name="chevR" />
            </span>
          </button>
          <Button variant="primary" size="lg" onClick={() => void confirm()}>
            Confirmar
          </Button>
        </div>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Tu pedido">
        {summary}
      </Sheet>
    </PublicShell>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

function SizeCard({
  service,
  selected,
  onToggle,
}: {
  service: CatalogService;
  selected: boolean;
  onToggle: () => void;
}) {
  const dims = dimensions(service);
  return (
    <article className="size-card" data-selected={selected}>
      <div className="size-stage">
        {dims && <span className="dim">{dims}</span>}
        <PrintFrame
          widthMm={service.widthMm}
          heightMm={service.heightMm}
          label={dims ? `Proporción de ${service.name}: ${dims}` : service.name}
        />
      </div>
      <div className="size-body">
        <h3>{service.name}</h3>
        {service.description && <p className="tag">{service.description}</p>}
        <div className="size-price">
          <b className="num">{formatMoney(service.unitPriceCents)}</b>
          <small>c/u</small>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--block"
          aria-pressed={selected}
          onClick={onToggle}
        >
          <Icon name={selected ? 'check' : 'plus'} />
          {selected ? 'Elegido' : 'Elegir'}
          <span className="sr-only"> tamaño {service.name}</span>
        </button>
      </div>
    </article>
  );
}

function PhotoGroup({
  line,
  entries,
  onAdd,
  onCopies,
  onRemove,
  onRemoveSize,
}: {
  line: OrderLine;
  entries: PhotoEntry[];
  onAdd: (files: FileList | null) => void;
  onCopies: (id: string, copies: number) => void;
  onRemove: (id: string) => void;
  onRemoveSize: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { service } = line;
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    onAdd(event.dataTransfer.files);
  };
  return (
    <section className="grp" aria-label={`Fotos para ${service.name}`}>
      <div className="grp-head">
        <h3>{service.name}</h3>
        <div className="meta">
          {plural(line.files, 'foto', 'fotos')} ·{' '}
          {plural(line.copies, 'copia', 'copias')}
        </div>
        <div className="sub num">{formatMoney(line.totalCents)}</div>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          aria-label={`Quitar el tamaño ${service.name}`}
          onClick={onRemoveSize}
        >
          Quitar
        </Button>
      </div>
      <div className="grp-body">
        <div
          className={`drop ${over ? 'drop--over' : ''} ${entries.length ? 'drop--compact' : ''}`.trim()}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {!entries.length && <Icon name="upload" />}
          <div>
            <strong>
              {entries.length ? (
                'Agregar más fotos'
              ) : (
                <>
                  <span className="desk-only">Arrastrá tus fotos acá</span>
                  <span className="mob-only">Agregar fotos</span>
                </>
              )}
            </strong>
            <div className="hint">JPG, PNG, HEIC o TIFF</div>
          </div>
          <div className="drop-actions">
            <Button
              variant="primary"
              icon="image"
              onClick={() => input.current?.click()}
            >
              <span className="mob-only">Elegir de la galería</span>
              <span className="desk-only">Elegir fotos</span>
              <span className="sr-only"> de {service.name}</span>
            </Button>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept={FILE_INPUT_ACCEPT}
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              onAdd(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
        {entries.length > 0 && (
          <ul className="ph-grid" aria-label={`Fotos en ${service.name}`}>
            {entries.map((entry) => (
              <li className="ph-card" key={entry.id}>
                <div className="ph-thumb">
                  <div className="ph-frame">
                    <Thumb file={entry.file} />
                  </div>
                  <button
                    type="button"
                    className="ph-remove"
                    aria-label={`Quitar ${entry.file.name}`}
                    onClick={() => onRemove(entry.id)}
                  >
                    <span>
                      <Icon name="x" />
                    </span>
                  </button>
                </div>
                <div className="ph-body">
                  <div className="ph-name">
                    <span>{entry.file.name}</span>
                    <span>{formatSize(entry.file.size)}</span>
                  </div>
                  <CopiesStepper
                    label={entry.file.name}
                    value={entry.copies}
                    onChange={(copies) => onCopies(entry.id, copies)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Summary({
  lines,
  total,
  missing,
  onConfirm,
}: {
  lines: OrderLine[];
  total: number;
  missing: string[];
  onConfirm: () => void;
}) {
  return (
    <div className="sum on-dark">
      <div className="sum-in">
        <h2>Resumen</h2>
        {lines.length > 0 && (
          <ul className="sum-lines">
            {lines.map((line) => (
              <li className="sum-line" key={line.service.id}>
                <span className="sz">{line.service.name}</span>
                <span className="pr num">{formatMoney(line.totalCents)}</span>
                <span className="cp">
                  {plural(line.copies, 'copia', 'copias')} ·{' '}
                  {plural(line.files, 'foto', 'fotos')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="sum-total">
          <span className="lbl">TOTAL</span>
          <span className="amt num" aria-live="polite">
            {formatMoney(total)}
          </span>
        </div>
        {missing.length > 0 && (
          <div className="sum-missing" role="alert">
            <strong>Para confirmar falta:</strong>
            <span>{missing.join(' · ')}</span>
          </div>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          onClick={onConfirm}
          icon="check"
        >
          Confirmar pedido
        </Button>
        <p className="fine">
          <Icon name="info" />
          <span>{paymentNote}</span>
        </p>
      </div>
    </div>
  );
}

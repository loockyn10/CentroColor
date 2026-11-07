import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Button, Icon, Sheet } from '@centrocolor/ui';
import {
  fetchCatalog,
  PublicOrderError,
  startOrder,
  submitOrder,
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
  uploadOutcome,
  paymentNote,
  PRINT_AFTER_PAYMENT,
  rememberOrder,
  resetClientKey,
  startBody,
  type CustomerForm,
  type OrderLine,
  type PhotoEntry,
} from './model';
import {
  addBlock,
  canAddBlock,
  catalogSizes,
  changeBlock,
  prettySize,
  removeBlock,
} from './order-blocks';
import {
  buildSubmitOptions,
  isIncompleteOrder,
  messageFor,
  sendEntries,
  type UploadProgress,
} from './order-submission';
import {
  CopiesStepper,
  plural,
  ServicePicker,
  Thumb,
  TransferPanel,
} from './parts';
import { PublicShell, useDocumentMeta } from './shell';
import './public-order.css';

type Phase = 'edit' | 'sending' | 'partial' | 'done';
type Progress = UploadProgress;

/** What the customer is doing with the size/paper picker: adding a block or changing one. */
type Picker = { mode: 'add' } | { mode: 'change'; serviceId: string } | null;

export function PrintOrderPortal() {
  useDocumentMeta('Imprimí tus fotos · CentroColor', false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Blocks of the order (one size on one paper each) in the order they were added.
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const [picker, setPicker] = useState<Picker>({ mode: 'add' });
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
  const session = useRef<{ started: StartedOrder } | null>(null);
  // Last upload attempt of each photo: a retry names it so the server never stores it twice.
  const attempts = useRef(new Map<string, string>());
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

  const sizes = useMemo(() => catalogSizes(catalog?.services ?? []), [catalog]);
  const lines = useMemo(
    () => deriveLines(catalog?.services ?? [], selected, entries),
    [catalog, selected, entries],
  );
  const total = orderTotal(lines);
  const missing = missingForConfirm(lines, selected, customer);

  /** The customer picked a size and paper: a new block, or the new place of an existing one. */
  function chooseService(serviceId: string) {
    if (picker?.mode === 'change') {
      const next = changeBlock(
        { selected, entries },
        picker.serviceId,
        serviceId,
      );
      setSelected(next.selected);
      setEntries(next.entries);
    } else setSelected((current) => addBlock(current, serviceId));
    setPicker(null);
    setNotice(null);
  }

  function dropBlock(id: string) {
    const hasPhotos = entries.some((x) => x.serviceId === id);
    if (hasPhotos && !window.confirm('¿Quitar este bloque y sus fotos?'))
      return;
    const next = removeBlock({ selected, entries }, id);
    setSelected(next.selected);
    setEntries(next.entries);
    if (!next.selected.length) setPicker({ mode: 'add' });
    else if (picker?.mode === 'change' && picker.serviceId === id)
      setPicker(null);
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

  const sendPhotos = (targets: PhotoEntry[]) =>
    sendEntries({
      started: session.current!.started,
      entries: targets,
      attempts: attempts.current,
      concurrency: 2,
      onProgress: patchProgress,
    });

  async function finish(sent: PhotoEntry[], acceptPartial = false) {
    const started = session.current!.started;
    // What the browser believes it sent to each size, the photos that make up the order in the
    // order shown and whether the customer chose to drop the ones that failed.
    const done = await submitOrder(
      started.uploadToken,
      buildSubmitOptions({
        started,
        selected,
        sent,
        attempts: attempts.current,
        acceptPartial,
      }),
    );
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

  /**
   * Confirms the order. If the server finds a size that lost photos, every photo is offered
   * again once: those that did arrive are acknowledged without uploading twice (the retry names
   * its previous attempt), the lost ones are sent now. Returns false when some photo still
   * fails, so the customer decides on the "partial" screen.
   */
  async function confirmSent(sent: PhotoEntry[]) {
    try {
      await finish(sent);
    } catch (error) {
      if (!isIncompleteOrder(error)) throw error;
      if (await sendPhotos(sent)) {
        setPhase('partial');
        return;
      }
      await finish(sent);
    }
  }

  async function confirm() {
    setSheet(false);
    if (missing.length) {
      setShowMissing(true);
      // Take the customer to the first thing that is missing.
      const target = missing[0]!.startsWith('elegí')
        ? 'tamanos'
        : missing[0]!.startsWith('agregá') || missing[0]!.startsWith('no hay')
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
      else await confirmSent(entries);
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
        const keep = selected.filter((x) => ids.has(x));
        setSelected(keep);
        setEntries((current) => current.filter((x) => ids.has(x.serviceId)));
        if (!keep.length) setPicker({ mode: 'add' });
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
      else await confirmSent(entries);
    } catch (error) {
      await handleFailure(error);
    }
  }

  async function skipFailed() {
    // Never confirm an empty order: without at least one received photo there is nothing to send.
    if (!uploadOutcome(entries, progress).canSendWithout) {
      setNotice(
        'Ninguna foto llegó todavía, así que no se puede enviar el pedido. Reintentá.',
      );
      return;
    }
    const kept = entries.filter((x) => progress[x.id]?.status === 'done');
    setEntries(kept);
    setPhase('sending');
    try {
      // The customer explicitly chose to send the order without the photos that failed.
      await finish(kept, true);
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
          <TransferPanel totalCents={result.totalCents} />
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
    const outcome = uploadOutcome(entries, progress);
    const done = outcome.done;
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
                <h2>
                  {outcome.none
                    ? 'No se pudo enviar ninguna foto'
                    : 'Algunas fotos no se pudieron enviar'}
                </h2>
                <p>
                  {outcome.none
                    ? 'Tu pedido todavía no se confirmó y tus fotos siguen acá. Reintentá en unos minutos; si el problema sigue, avisanos por WhatsApp.'
                    : `Llegaron ${done} de ${entries.length}. Podés reintentar las que faltan o enviar el pedido sólo con las que llegaron.`}
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
                {outcome.canSendWithout ? (
                  <Button onClick={() => void skipFailed()}>
                    Enviar sin esas fotos
                  </Button>
                ) : (
                  <Button onClick={() => setPhase('edit')}>
                    Volver a mi pedido
                  </Button>
                )}
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
              <h2 id="h-tam">Armá tu pedido</h2>
            </div>
            {lines.map((line, index) => (
              <PhotoGroup
                key={line.service.id}
                anchor={
                  line.files === 0 &&
                  !lines.slice(0, index).some((x) => x.files === 0)
                    ? 'fotos'
                    : undefined
                }
                line={line}
                entries={entries.filter((x) => x.serviceId === line.service.id)}
                onAdd={(files) => addFiles(line.service.id, files)}
                onCopies={(id, copies) => patchEntry(id, { copies })}
                onRemove={removeEntry}
                onRemoveBlock={() => dropBlock(line.service.id)}
                onChange={() =>
                  setPicker(
                    picker?.mode === 'change' &&
                      picker.serviceId === line.service.id
                      ? null
                      : { mode: 'change', serviceId: line.service.id },
                  )
                }
                picker={
                  picker?.mode === 'change' &&
                  picker.serviceId === line.service.id ? (
                    <ServicePicker
                      sizes={sizes}
                      selected={selected}
                      ownId={line.service.id}
                      onPick={chooseService}
                      onCancel={() => setPicker(null)}
                    />
                  ) : null
                }
              />
            ))}
            {picker?.mode === 'add' && (
              <section
                className="grp grp--pick"
                aria-label="Elegir tamaño y papel"
              >
                <div className="grp-body">
                  <ServicePicker
                    sizes={sizes}
                    selected={selected}
                    onPick={chooseService}
                    onCancel={selected.length ? () => setPicker(null) : null}
                  />
                </div>
              </section>
            )}
            {!picker && canAddBlock(sizes, selected) && (
              <Button
                className="add-block"
                variant="secondary"
                size="lg"
                block
                icon="plus"
                onClick={() => setPicker({ mode: 'add' })}
              >
                Agregar otro tamaño o papel
              </Button>
            )}
          </section>

          <section id="datos" aria-labelledby="h-datos">
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                2
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
                3
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

function PhotoGroup({
  line,
  entries,
  anchor,
  picker,
  onAdd,
  onCopies,
  onRemove,
  onRemoveBlock,
  onChange,
}: {
  line: OrderLine;
  entries: PhotoEntry[];
  /** DOM id, set on the first block still without photos so "confirm" can scroll to it. */
  anchor?: string;
  /** The size/paper picker while the customer changes this block. */
  picker: ReactNode;
  onAdd: (files: FileList | null) => void;
  onCopies: (id: string, copies: number) => void;
  onRemove: (id: string) => void;
  onRemoveBlock: () => void;
  onChange: () => void;
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
    <section
      id={anchor}
      className="grp"
      aria-label={`Fotos para ${service.name}`}
    >
      <div className="grp-head">
        <h3>{prettySize(service.name)}</h3>
        <div className="meta">
          {plural(line.files, 'foto', 'fotos')} ·{' '}
          {plural(line.copies, 'copia', 'copias')}
          {line.pricingAvailable !== false && line.copies > 0 && (
            <small className="unit">
              Precio por copia:{' '}
              <b className="num">{formatMoney(line.unitPriceCents)}</b>
            </small>
          )}
        </div>
        <div className="sub num" aria-label="Subtotal">
          <small>Subtotal</small> {formatMoney(line.totalCents)}
        </div>
        {line.pricingAvailable === false && (
          <p role="alert">No hay tarifa para esta cantidad de copias.</p>
        )}
        <div className="grp-tools">
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            aria-label={`Cambiar tamaño o papel de ${service.name}`}
            onClick={onChange}
          >
            Cambiar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            aria-label={`Quitar ${service.name} y sus fotos`}
            onClick={onRemoveBlock}
          >
            Quitar
          </Button>
        </div>
      </div>
      <div className="grp-body">
        {picker}
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
            {entries.map((entry, index) => (
              <li className="ph-card" key={entry.id}>
                <div className="ph-thumb">
                  <div className="ph-frame">
                    <Thumb file={entry.file} />
                  </div>
                  <span className="ph-num" aria-hidden="true">
                    Foto {index + 1}
                  </span>
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
                  <span className="ph-lbl">Copias</span>
                  <CopiesStepper
                    label={`Foto ${index + 1} (${entry.file.name})`}
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
                <span className="sz">{prettySize(line.service.name)}</span>
                <span className="pr num">{formatMoney(line.totalCents)}</span>
                <span className="cp">
                  {plural(line.copies, 'copia', 'copias')} ·{' '}
                  {plural(line.files, 'foto', 'fotos')}
                </span>
                {line.pricingAvailable !== false && line.copies > 0 && (
                  <span className="up">
                    Precio por copia:{' '}
                    <b className="num">{formatMoney(line.unitPriceCents)}</b>
                  </span>
                )}
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

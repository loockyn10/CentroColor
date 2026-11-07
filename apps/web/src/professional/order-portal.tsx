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
  deriveLines,
  formatMoney,
  formatSize,
  loadRememberedOrder,
  newClientKey,
  orderTotal,
  rememberOrder,
  uploadOutcome,
  FILE_INPUT_ACCEPT,
  type OrderLine,
  type PhotoEntry,
} from '../public-order/model';
import {
  addBlock,
  canAddBlock,
  catalogSizes,
  changeBlock,
  prettySize,
  removeBlock,
} from '../public-order/order-blocks';
import {
  buildSubmitOptions,
  errorCode,
  isIncompleteOrder,
  sendEntries,
  type UploadProgress,
} from '../public-order/order-submission';
import {
  CopiesStepper,
  plural,
  ServicePicker,
  TransferPanel,
} from '../public-order/parts';
import { PublicShell, useDocumentMeta } from '../public-order/shell';
import '../public-order/public-order.css';
import {
  fetchProfessionalCatalog,
  fetchProfessionalPublicCatalog,
  isSessionExpired,
  serverMessage,
  startProfessionalOrder,
  startProfessionalRequest,
  submitProfessionalOrder,
  submitProfessionalRequest,
  type PaymentTerms,
  type PortalCatalog,
  type ProfessionalStartedOrder,
  type ProfessionalSubmittedOrder,
  type RequestStarted,
  type RequestSubmitted,
} from './client';
import {
  ACCOUNT_LIMITS,
  applyCopiesToAll,
  classifyPickedFiles,
  describePick,
  loadProfessionalClientKey,
  loadProfessionalPhone,
  loadRequestClientKey,
  loadRequestContact,
  missingForProfessionalConfirm,
  missingForRequestConfirm,
  pickedFolderName,
  planAdditions,
  PRO_UPLOAD_CONCURRENCY,
  rememberProfessionalPhone,
  rememberRequestContact,
  REQUEST_LIMITS,
  resetProfessionalClientKey,
  resetRequestClientKey,
  startProfessionalBody,
  startRequestBody,
  summarizeProgress,
} from './model';
import { Thumbnail, VirtualList } from './virtual-list';
import './professional.css';

type Phase = 'edit' | 'sending' | 'partial' | 'done';
type Picker = { mode: 'add' } | { mode: 'change'; serviceId: string } | null;

const ROW = 60;

/** Directory selection is a non-standard but widely implemented input attribute. */
const supportsFolderInput = () =>
  typeof document !== 'undefined' &&
  'webkitdirectory' in document.createElement('input');

/**
 * Upload progress of hundreds of photos changes many times a second; React only repaints it a
 * few times a second so the page stays responsive.
 */
function useProgressStore() {
  const map = useRef(new Map<string, UploadProgress>());
  const timer = useRef<number | null>(null);
  const [, repaint] = useState(0);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    repaint((n) => n + 1);
  };
  return {
    map: map.current,
    set(id: string, value: UploadProgress) {
      map.current.set(id, value);
      // `done` / `failed` are repainted at once (they change the counters); percentages are throttled.
      if (value.status !== 'uploading') flush();
      else if (timer.current === null)
        timer.current = window.setTimeout(flush, 250);
    },
    reset(ids: string[]) {
      map.current.clear();
      for (const id of ids)
        map.current.set(id, { status: 'waiting', percent: 0 });
      flush();
    },
  };
}

/**
 * The professional order page, in two modes with the same screens:
 *  - `account`: a signed-in professional. The server decides their price list; prices are shown.
 *  - `request`: any visitor, no session. The server sends no price at all (there is nothing to
 *    hide with CSS) and the order is quoted afterwards by CentroColor.
 */
export function ProfessionalOrder({
  onSignOut,
  mode = 'account',
  onSignIn,
  initialNotice = null,
}: {
  onSignOut: () => void;
  mode?: 'account' | 'request';
  onSignIn?: () => void;
  /** A message to show first (for example why a signed-in account got the price-free form). */
  initialNotice?: string | null;
}) {
  useDocumentMeta('Portal profesional · CentroColor', true);
  const priced = mode === 'account';
  const limits = priced ? ACCOUNT_LIMITS : REQUEST_LIMITS;
  const [catalog, setCatalog] = useState<PortalCatalog | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const [picker, setPicker] = useState<Picker>({ mode: 'add' });
  const remembered0 = useMemo(loadRequestContact, []);
  const [phone, setPhone] = useState(() =>
    priced ? loadProfessionalPhone() : remembered0.phone,
  );
  const [name, setName] = useState(remembered0.name);
  const [email, setEmail] = useState(remembered0.email);
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [pickNotes, setPickNotes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ProfessionalSubmittedOrder | null>(null);
  const [requestResult, setRequestResult] = useState<RequestSubmitted | null>(
    null,
  );
  const [showMissing, setShowMissing] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const progress = useProgressStore();
  const session = useRef<{
    started: ProfessionalStartedOrder | RequestStarted;
  } | null>(null);
  // Last upload attempt of each photo: a retry names it so the server never stores it twice.
  const attempts = useRef(new Map<string, string>());
  const remembered = useMemo(() => loadRememberedOrder(), []);
  const folderInput = useMemo(supportsFolderInput, []);

  const fetchCatalog: () => Promise<PortalCatalog> = priced
    ? fetchProfessionalCatalog
    : fetchProfessionalPublicCatalog;
  const loadCatalog = () =>
    fetchCatalog()
      .then((value) => {
        setCatalog(value);
        setFatal(null);
        if (!phone && value.account?.phone) setPhone(value.account.phone);
        return value;
      })
      .catch((error) => {
        const code = errorCode(error);
        if (priced && isSessionExpired(error)) onSignOut();
        else setFatal(code ?? 'load_failed');
        setNotice(serverMessage(error));
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
  const byService = useMemo(() => {
    const groups = new Map<string, PhotoEntry[]>();
    for (const entry of entries)
      groups.set(entry.serviceId, [
        ...(groups.get(entry.serviceId) ?? []),
        entry,
      ]);
    return groups;
  }, [entries]);
  const total = orderTotal(lines);
  const missing = priced
    ? missingForProfessionalConfirm(lines, selected, phone)
    : missingForRequestConfirm(lines, selected, { name, phone, email });
  const terms: PaymentTerms = catalog?.account?.paymentTerms ?? 'prepaid';
  const stats = summarizeProgress(entries, progress.map);

  // Closing the tab while photos are in flight loses the whole shoot's upload.
  useEffect(() => {
    if (phase !== 'sending') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

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
    const count = byService.get(id)?.length ?? 0;
    if (count && !window.confirm(`¿Quitar este formato y sus ${count} fotos?`))
      return;
    const next = removeBlock({ selected, entries }, id);
    setSelected(next.selected);
    setEntries(next.entries);
    if (!next.selected.length) setPicker({ mode: 'add' });
    else if (picker?.mode === 'change' && picker.serviceId === id)
      setPicker(null);
  }

  /** A folder or a multiple selection for ONE format. */
  function addPicked(serviceId: string, list: FileList | null) {
    if (!list || !list.length) return;
    const files = Array.from(list);
    const picked = classifyPickedFiles(files, limits.bytes);
    const added = planAdditions(entries, serviceId, picked.accepted, {
      total: entries.length,
      max: limits.files,
    });
    setEntries((current) => [...current, ...added.entries]);
    setPickNotes((current) => ({
      ...current,
      [serviceId]: describePick(pickedFolderName(files), picked, added, limits),
    }));
    setNotice(null);
  }

  const patchEntry = (id: string, patch: Partial<PhotoEntry>) =>
    setEntries((current) =>
      current.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    );
  const removeEntry = (id: string) =>
    setEntries((current) => current.filter((x) => x.id !== id));

  function applyAll(serviceId: string, copies: number) {
    const count = byService.get(serviceId)?.length ?? 0;
    setEntries((current) => applyCopiesToAll(current, serviceId, copies));
    setPickNotes((current) => ({
      ...current,
      [serviceId]: `${plural(copies, 'copia aplicada', 'copias aplicadas')} a ${plural(count, 'foto', 'fotos')}.`,
    }));
  }

  const sendPhotos = (targets: PhotoEntry[]) =>
    sendEntries({
      started: session.current!.started,
      entries: targets,
      attempts: attempts.current,
      concurrency: PRO_UPLOAD_CONCURRENCY,
      onProgress: progress.set,
    });

  async function finish(sent: PhotoEntry[], acceptPartial = false) {
    const started = session.current!.started;
    const options = buildSubmitOptions({
      started,
      selected,
      sent,
      attempts: attempts.current,
      acceptPartial,
    });
    if (priced) {
      const done = await submitProfessionalOrder(started.uploadToken, options);
      rememberOrder({
        orderCode: done.orderCode,
        trackingToken: done.trackingToken,
        at: new Date().toISOString(),
      });
      resetProfessionalClientKey();
      setResult(done);
    } else {
      const done = await submitProfessionalRequest(
        started.uploadToken,
        options,
      );
      rememberOrder({
        orderCode: done.orderCode,
        trackingToken: done.trackingToken,
        at: new Date().toISOString(),
      });
      resetRequestClientKey();
      setRequestResult(done);
    }
    setPhase('done');
    window.scrollTo?.({ top: 0 });
  }

  /**
   * Confirms the order. If the server finds a size that lost photos, every photo is offered
   * again once (the ones that did arrive are acknowledged without uploading twice).
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
      const first = missing[0]!;
      const target = first.startsWith('elegí')
        ? 'formatos'
        : first.startsWith('agregá') || first.startsWith('no hay')
          ? 'fotos'
          : 'resumen';
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
    setOnlyFailed(false);
    setPhase('sending');
    progress.reset(entries.map((x) => x.id));
    try {
      const started = priced
        ? await startProfessionalOrder(
            startProfessionalBody(
              loadProfessionalClientKey(newClientKey),
              phone,
              notes,
              lines,
            ),
          )
        : await startProfessionalRequest(
            startRequestBody(
              loadRequestClientKey(newClientKey),
              { name, phone, email },
              notes,
              lines,
            ),
          );
      session.current = { started };
      if (priced) rememberProfessionalPhone(phone);
      else rememberRequestContact({ name, phone, email });
      const failed = await sendPhotos(entries);
      if (failed) setPhase('partial');
      else await confirmSent(entries);
    } catch (error) {
      await handleFailure(error);
    }
  }

  async function handleFailure(error: unknown) {
    const code = errorCode(error);
    if (priced && isSessionExpired(error)) {
      onSignOut();
      return;
    }
    if (
      code === 'account_inactive' ||
      code === 'no_professional_list' ||
      code === 'not_professional'
    ) {
      setFatal(code);
      setNotice(serverMessage(error));
      return;
    }
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
          : 'Un formato ya no está disponible. Revisá tu pedido.',
      );
    } else setNotice(serverMessage(error));
    setPhase('edit');
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  async function retryFailed() {
    // Only the photos that failed travel again; the others are never re-sent.
    const failed = entries.filter(
      (x) => progress.map.get(x.id)?.status === 'failed',
    );
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
    if (
      !uploadOutcome(entries, Object.fromEntries(progress.map)).canSendWithout
    ) {
      setNotice(
        'Ninguna foto llegó todavía, así que no se puede enviar el pedido. Reintentá.',
      );
      return;
    }
    const kept = entries.filter(
      (x) => progress.map.get(x.id)?.status === 'done',
    );
    setEntries(kept);
    setPhase('sending');
    try {
      await finish(kept, true);
    } catch (error) {
      await handleFailure(error);
    }
  }

  function startOver() {
    session.current = null;
    attempts.current.clear();
    progress.reset([]);
    setSelected([]);
    setEntries([]);
    setPickNotes({});
    setPicker({ mode: 'add' });
    setNotes('');
    setResult(null);
    setRequestResult(null);
    setPhase('edit');
    setNotice(null);
    window.scrollTo?.({ top: 0 });
  }

  const signOut = priced ? (
    <Button size="sm" icon="logout" onClick={onSignOut}>
      Salir
    </Button>
  ) : onSignIn ? (
    <Button size="sm" icon="user" onClick={onSignIn}>
      Ingresar con mi cuenta
    </Button>
  ) : null;

  /* ───────────────────────────── screens ───────────────────────────── */

  if (fatal && !catalog)
    return (
      <PublicShell
        homeHref="/profesionales"
        subtitle="Portal profesional"
        orderLink={false}
        actions={signOut}
      >
        <div className="pt-page">
          <section className="po-card po-center">
            <h2>
              {fatal === 'not_professional'
                ? 'Esta cuenta no tiene acceso profesional'
                : fatal === 'account_inactive'
                  ? 'Tu cuenta profesional no está activa'
                  : priced
                    ? 'No pudimos cargar tu lista de precios'
                    : 'No pudimos cargar el formulario'}
            </h2>
            <p>{notice}</p>
            {fatal === 'load_failed' && (
              <Button variant="primary" onClick={() => void loadCatalog()}>
                Reintentar
              </Button>
            )}
          </section>
        </div>
      </PublicShell>
    );
  if (!catalog)
    return (
      <PublicShell
        homeHref="/profesionales"
        subtitle="Portal profesional"
        orderLink={false}
        actions={signOut}
      >
        <p className="po-center pad" role="status">
          Cargando…
        </p>
      </PublicShell>
    );
  const { account } = catalog;
  const noList = priced && !account?.priceListUsable;
  const shellProps = {
    businessName: catalog.businessName,
    homeHref: '/profesionales',
    subtitle: 'Portal profesional',
    orderLink: false,
    actions: signOut,
  };
  if (!catalog.available || noList || !catalog.services.length)
    return (
      <PublicShell {...shellProps}>
        <div className="pt-page">
          <section className="po-card po-center">
            <h2>
              {!noList
                ? 'Los pedidos online no están disponibles por ahora'
                : 'Tu cuenta todavía no tiene lista de precios'}
            </h2>
            <p>
              {!noList
                ? 'Escribinos o pasá por el local y te atendemos enseguida.'
                : 'Escribinos para que la configuremos y puedas hacer pedidos desde acá.'}
            </p>
          </section>
        </div>
      </PublicShell>
    );

  if (phase === 'done' && requestResult)
    return (
      <PublicShell {...shellProps} orderLink={false}>
        <div className="pt-page" aria-live="polite">
          <div className="rcv-title">
            <span className="stamp" aria-hidden="true">
              <Icon name="check" />
            </span>
            <div>
              <h1>
                ¡Recibimos tus <span className="marker">fotografías</span>!
              </h1>
              <p className="frame-tag code">{requestResult.orderCode}</p>
            </div>
          </div>
          <section className="po-card">
            <ul className="order-lines">
              {requestResult.items.map((item) => (
                <li key={item.name}>
                  <span className="sz">{item.name}</span>
                  <span className="meta">
                    {plural(item.quantity, 'copia', 'copias')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <div className="callout" role="note">
            <Icon name="receipt" />
            <div>
              <strong>
                CentroColor revisará tu pedido y te confirmará el importe.
              </strong>
              <p>Podés seguir el estado con el link de abajo.</p>
            </div>
          </div>
          <div className="row-actions">
            <a
              className="btn btn--primary btn--lg"
              href={`/pedido/${requestResult.trackingToken}`}
            >
              <Icon name="receipt" /> Ver estado del pedido
            </a>
            <Button size="lg" icon="plus" onClick={startOver}>
              Hacer otro pedido
            </Button>
          </div>
        </div>
      </PublicShell>
    );

  if (phase === 'done' && result)
    return (
      <PublicShell {...shellProps} orderLink={false}>
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
          {result.paymentTerms === 'deferred' ? (
            <div className="callout" role="note">
              <Icon name="wallet" />
              <div>
                <strong>Pago pendiente</strong>
                <p>
                  Este pedido queda a tu cuenta, según tu acuerdo con
                  CentroColor. No hace falta transferir ahora.
                </p>
              </div>
            </div>
          ) : (
            <>
              <TransferPanel totalCents={result.totalCents} />
              <div className="callout" role="note">
                <Icon name="printer" />
                <div>
                  <strong>
                    La impresión se realiza una vez acreditado el pago.
                  </strong>
                </div>
              </div>
            </>
          )}
          <div className="callout callout--wa">
            <Icon name="chat" />
            <div>
              <strong>
                Te avisaremos por WhatsApp cuando tu pedido esté listo.
              </strong>
              <p className="mono">{phone}</p>
            </div>
          </div>
          <div className="row-actions">
            <a
              className="btn btn--primary btn--lg"
              href={`/pedido/${result.trackingToken}`}
            >
              <Icon name="receipt" /> Ver estado del pedido
            </a>
            <Button size="lg" icon="plus" onClick={startOver}>
              Hacer otro pedido
            </Button>
          </div>
        </div>
      </PublicShell>
    );

  if (phase === 'sending' || phase === 'partial') {
    const failedList = entries.filter(
      (x) => progress.map.get(x.id)?.status === 'failed',
    );
    const outcome = uploadOutcome(entries, Object.fromEntries(progress.map));
    const shown = onlyFailed ? failedList : entries;
    return (
      <PublicShell {...shellProps}>
        <div className="pt-page">
          <section className="po-card" aria-live="polite">
            {phase === 'sending' ? (
              <>
                <h2>Enviando tu pedido…</h2>
                <p>
                  {stats.done} de {stats.total} fotos enviadas
                  {stats.failed > 0 && ` · ${stats.failed} con error`}. No
                  cierres esta página hasta que termine.
                </p>
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
                    ? 'Tu pedido todavía no se confirmó y tus fotos siguen acá. Reintentá en unos minutos.'
                    : `Llegaron ${stats.done} de ${stats.total}. Reintentá sólo las que faltan o enviá el pedido con las que llegaron.`}
                </p>
              </>
            )}
            <progress
              max="100"
              value={stats.percent}
              aria-label="Progreso total"
            />
            <ul className="pro-counters" aria-label="Estado de las fotos">
              <li>
                <b className="num">{stats.done}</b> enviadas
              </li>
              <li>
                <b className="num">{stats.uploading}</b> en curso
              </li>
              <li>
                <b className="num">{stats.waiting}</b> en espera
              </li>
              <li data-bad={stats.failed > 0}>
                <b className="num">{stats.failed}</b> con error
              </li>
            </ul>
            {notice && <p className="po-error">{notice}</p>}
            {phase === 'partial' && (
              <div className="row-actions">
                <Button variant="primary" onClick={() => void retryFailed()}>
                  Reintentar las {failedList.length} que fallaron
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
            {failedList.length > 0 && (
              <label className="check pro-only-failed">
                <input
                  type="checkbox"
                  checked={onlyFailed}
                  onChange={(e) => setOnlyFailed(e.target.checked)}
                />
                <span>Ver sólo las que fallaron</span>
              </label>
            )}
            <VirtualList
              items={shown}
              rowHeight={ROW}
              maxHeight={ROW * 8}
              label="Fotos del pedido"
              getKey={(entry) => entry.id}
              renderRow={(entry) => {
                const state = progress.map.get(entry.id);
                return (
                  <div className="pro-row">
                    <Thumbnail file={entry.file} />
                    <span className="pro-name">
                      <span>{entry.file.name}</span>
                      <small>
                        {state?.status === 'done'
                          ? '✓ recibida'
                          : state?.status === 'failed'
                            ? state.error
                            : state?.status === 'uploading'
                              ? `${state.percent}%`
                              : 'en espera'}
                      </small>
                    </span>
                  </div>
                );
              }}
            />
          </section>
        </div>
      </PublicShell>
    );
  }

  const photoCount = lines.reduce((sum, line) => sum + line.files, 0);
  const copyCount = lines.reduce((sum, line) => sum + line.copies, 0);
  const summary = (
    <Summary
      priced={priced}
      lines={lines}
      total={total}
      missing={showMissing ? missing : []}
      terms={terms}
      name={name}
      email={email}
      phone={phone}
      notes={notes}
      onName={setName}
      onEmail={setEmail}
      onPhone={setPhone}
      onNotes={setNotes}
      onConfirm={() => void confirm()}
    />
  );

  return (
    <PublicShell
      {...shellProps}
      hero={
        <div className="pt-hero pro-hero">
          <div>
            {account ? (
              <>
                <h1>
                  Hola, <span className="marker">{account.customerName}</span>
                </h1>
                <p className="lede">
                  Lista <strong>{account.priceListName}</strong> ·{' '}
                  {terms === 'deferred'
                    ? 'pago posterior autorizado'
                    : 'pago por transferencia antes de imprimir'}
                </p>
              </>
            ) : (
              <>
                <h1>
                  Portal para <span className="marker">fotógrafos</span>
                </h1>
                <p className="lede">
                  Enviá tus fotografías y prepararemos tu presupuesto.
                </p>
              </>
            )}
          </div>
        </div>
      }
    >
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

          <section id="formatos" aria-labelledby="h-fmt">
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                1
              </span>
              <h2 id="h-fmt">Formatos y fotos</h2>
            </div>
            {lines.map((line, index) => (
              <Block
                key={line.service.id}
                anchor={
                  line.files === 0 &&
                  !lines.slice(0, index).some((x) => x.files === 0)
                    ? 'fotos'
                    : undefined
                }
                line={line}
                entries={byService.get(line.service.id) ?? []}
                folderInput={folderInput}
                note={pickNotes[line.service.id]}
                priced={priced}
                limits={limits}
                room={limits.files - entries.length}
                onPick={(files) => addPicked(line.service.id, files)}
                onApplyAll={(copies) => applyAll(line.service.id, copies)}
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
              <section className="grp grp--pick" aria-label="Elegir formato">
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
                Agregar otro formato o papel
              </Button>
            )}
          </section>

          <section
            className="narrow-only"
            aria-labelledby="h-conf"
            id="resumen"
          >
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                2
              </span>
              <h2 id="h-conf">Confirmá el pedido</h2>
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
            aria-label={
              priced
                ? `Ver resumen del pedido. Total ${formatMoney(total)}`
                : 'Ver resumen del pedido'
            }
          >
            <span className="lbl">{priced ? 'TOTAL' : 'TU PEDIDO'}</span>
            <span className="amt num">
              {priced
                ? formatMoney(total)
                : plural(photoCount, 'foto', 'fotos')}
            </span>
            <span className="cnt">
              {plural(copyCount, 'copia', 'copias')} ·{' '}
              {plural(photoCount, 'foto', 'fotos')}
              <Icon name="chevR" />
            </span>
          </button>
          <Button variant="primary" size="lg" onClick={() => void confirm()}>
            {priced ? 'Confirmar' : 'Enviar'}
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

/**
 * One format (size + paper): its photos, the folder/files pickers, "same copies for all" and a
 * windowed list so hundreds of photos never become hundreds of nodes.
 */
function Block({
  line,
  entries,
  anchor,
  picker,
  folderInput,
  note,
  room,
  priced,
  limits,
  onPick,
  onApplyAll,
  onCopies,
  onRemove,
  onRemoveBlock,
  onChange,
}: {
  line: OrderLine;
  entries: PhotoEntry[];
  anchor?: string;
  picker: ReactNode;
  folderInput: boolean;
  note?: string;
  room: number;
  priced: boolean;
  limits: { files: number; bytes: number };
  onPick: (files: FileList | null) => void;
  onApplyAll: (copies: number) => void;
  onCopies: (id: string, copies: number) => void;
  onRemove: (id: string) => void;
  onRemoveBlock: () => void;
  onChange: () => void;
}) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [all, setAll] = useState(1);
  const { service } = line;
  const full = room <= 0;
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    onPick(event.dataTransfer.files);
  };
  return (
    <section
      id={anchor}
      className="grp pro-block"
      aria-label={`Fotos para ${service.name}`}
    >
      <div className="grp-head">
        <h3>{prettySize(service.name)}</h3>
        <div className="meta">
          {plural(line.files, 'foto', 'fotos')} ·{' '}
          {plural(line.copies, 'copia', 'copias')}
          {priced && line.pricingAvailable !== false && line.copies > 0 && (
            <small className="unit">
              Precio por copia:{' '}
              <b className="num">{formatMoney(line.unitPriceCents)}</b>
            </small>
          )}
        </div>
        {priced && (
          <div className="sub num" aria-label="Subtotal">
            <small>Subtotal</small> {formatMoney(line.totalCents)}
          </div>
        )}
        {priced && line.pricingAvailable === false && line.copies > 0 && (
          <p role="alert">No hay tarifa para esta cantidad de copias.</p>
        )}
        <div className="grp-tools">
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            aria-label={`Cambiar formato o papel de ${service.name}`}
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
          className={`pro-pick ${over ? 'pro-pick--over' : ''}`.trim()}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <div className="pro-pick-actions">
            <Button
              variant="primary"
              icon="image"
              disabled={full}
              onClick={() => files.current?.click()}
            >
              Seleccionar fotografías
              <span className="sr-only"> de {service.name}</span>
            </Button>
            {folderInput ? (
              <Button
                variant="primary"
                icon="folder"
                disabled={full}
                onClick={() => folder.current?.click()}
              >
                Seleccionar carpeta
                <span className="sr-only"> de {service.name}</span>
              </Button>
            ) : null}
          </div>
          <p className="hint">
            {folderInput
              ? 'Elegí la carpeta exportada desde Lightroom (se suman todas las fotos que tenga) o arrastrá tus archivos acá.'
              : 'Tu navegador no permite elegir carpetas: seleccioná todas las fotos juntas (Ctrl/Cmd + A) o arrastralas acá.'}{' '}
            JPG, PNG, HEIC o TIFF, hasta {limits.bytes / 1024 / 1024} MB cada
            una.
          </p>
          <input
            ref={files}
            type="file"
            multiple
            accept={FILE_INPUT_ACCEPT}
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              onPick(event.target.files);
              event.target.value = '';
            }}
          />
          {folderInput && (
            <input
              ref={folder}
              type="file"
              multiple
              {...{ webkitdirectory: '', directory: '' }}
              hidden
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                onPick(event.target.files);
                event.target.value = '';
              }}
            />
          )}
        </div>
        <p className="pro-note" role="status">
          {note}
        </p>
        {entries.length > 0 && (
          <>
            <div
              className="pro-all"
              role="group"
              aria-label="Copias para todas"
            >
              <span className="pro-all-label">
                <strong>Copias para todas</strong>
                <small>Después podés cambiar cada foto.</small>
              </span>
              <CopiesStepper
                value={all}
                label={`todas las fotos de ${service.name}`}
                onChange={setAll}
              />
              <Button onClick={() => onApplyAll(all)}>
                Aplicar {plural(all, 'copia', 'copias')} a las {entries.length}{' '}
                fotos
              </Button>
            </div>
            <VirtualList
              items={entries}
              rowHeight={ROW}
              maxHeight={ROW * 7}
              label={`Fotos en ${service.name}`}
              getKey={(entry) => entry.id}
              renderRow={(entry, index) => (
                <div className="pro-row">
                  <span className="pro-index num">{index + 1}</span>
                  <Thumbnail file={entry.file} />
                  <span className="pro-name">
                    <span title={entry.file.name}>{entry.file.name}</span>
                    <small>{formatSize(entry.file.size)}</small>
                  </span>
                  <CopiesStepper
                    label={`foto ${index + 1} (${entry.file.name})`}
                    value={entry.copies}
                    onChange={(copies) => onCopies(entry.id, copies)}
                  />
                  <button
                    type="button"
                    className="pro-remove"
                    aria-label={`Quitar ${entry.file.name}`}
                    onClick={() => onRemove(entry.id)}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              )}
            />
          </>
        )}
      </div>
    </section>
  );
}

function Summary({
  priced,
  lines,
  total,
  missing,
  terms,
  name,
  email,
  phone,
  notes,
  onName,
  onEmail,
  onPhone,
  onNotes,
  onConfirm,
}: {
  priced: boolean;
  lines: OrderLine[];
  total: number;
  missing: string[];
  terms: PaymentTerms;
  name: string;
  email: string;
  phone: string;
  notes: string;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onNotes: (value: string) => void;
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
                {priced && (
                  <span className="pr num">{formatMoney(line.totalCents)}</span>
                )}
                <span className="cp">
                  {plural(line.copies, 'copia', 'copias')} ·{' '}
                  {plural(line.files, 'foto', 'fotos')}
                </span>
                {priced &&
                  line.pricingAvailable !== false &&
                  line.copies > 0 && (
                    <span className="up">
                      Precio por copia:{' '}
                      <b className="num">{formatMoney(line.unitPriceCents)}</b>
                    </span>
                  )}
              </li>
            ))}
          </ul>
        )}
        {priced ? (
          <div className="sum-total">
            <span className="lbl">TOTAL</span>
            <span className="amt num" aria-live="polite">
              {formatMoney(total)}
            </span>
          </div>
        ) : (
          <p className="pro-quote-note">
            Enviá tus fotografías y prepararemos tu presupuesto.
          </p>
        )}
        {!priced && (
          <label className="field pro-field">
            <span>Tu nombre</span>
            <input
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              maxLength={80}
              onChange={(e) => onName(e.target.value)}
            />
          </label>
        )}
        <label className="field pro-field">
          <span>{priced ? 'WhatsApp para avisarte' : 'Teléfono'}</span>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="342 555 1234"
            value={phone}
            maxLength={30}
            onChange={(e) => onPhone(e.target.value)}
          />
        </label>
        {!priced && (
          <label className="field pro-field">
            <span>
              Correo electrónico <span className="opt">Opcional</span>
            </span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              maxLength={120}
              onChange={(e) => onEmail(e.target.value)}
            />
          </label>
        )}
        <label className="field pro-field">
          <span>
            Notas <span className="opt">Opcional</span>
          </span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
          />
        </label>
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
          {priced ? 'Confirmar pedido' : 'Enviar fotografías'}
        </Button>
        <p className="fine">
          <Icon name="info" />
          <span>
            {!priced
              ? 'CentroColor revisará tu pedido y te confirmará el importe.'
              : terms === 'deferred'
                ? 'El pedido queda a tu cuenta, según tu acuerdo con CentroColor.'
                : 'Se imprime una vez acreditada la transferencia.'}
          </span>
        </p>
      </div>
    </div>
  );
}

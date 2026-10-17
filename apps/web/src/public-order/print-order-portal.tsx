import { useEffect, useMemo, useRef, useState } from 'react';
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
  clampCopies,
  deriveLines,
  fileProblem,
  FILE_INPUT_ACCEPT,
  formatMoney,
  formatSize,
  lineLabel,
  loadClientKey,
  loadRememberedOrder,
  MAX_FILES_PER_ORDER,
  missingForConfirm,
  orderTotal,
  rememberOrder,
  resetClientKey,
  startBody,
  type CustomerForm,
  type PhotoEntry,
} from './model';
import { PublicShell, useDocumentMeta } from './shell';
import './public-order.css';

type Phase = 'edit' | 'sending' | 'partial' | 'done';
type Progress = {
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  percent: number;
  error?: string;
};

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return broken || !url ? (
    <span className="po-thumb po-thumb-empty" aria-hidden="true">
      🖼
    </span>
  ) : (
    <img
      className="po-thumb"
      src={url}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

const messageFor = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'No se pudo completar la operación. Reintentá.';

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
  }

  async function confirm() {
    if (missing.length) {
      setShowMissing(true);
      // Take the customer to the first thing that is missing.
      const target = missing[0]!.startsWith('elegí')
        ? 'po-step-1'
        : missing[0]!.startsWith('agregá')
          ? 'po-step-2'
          : 'po-step-3';
      document
        .getElementById(target)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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
        <section className="po-card po-center">
          <h2>No pudimos cargar la lista de precios</h2>
          <p>{loadError}</p>
          <button className="po-primary" onClick={() => void loadCatalog()}>
            Reintentar
          </button>
        </section>
      </PublicShell>
    );
  if (!catalog)
    return (
      <PublicShell>
        <p className="po-center" role="status">
          Cargando…
        </p>
      </PublicShell>
    );
  if (!catalog.available || !catalog.services.length)
    return (
      <PublicShell businessName={catalog.businessName}>
        <section className="po-card po-center">
          <h2>Los pedidos online no están disponibles por ahora</h2>
          <p>Podés acercarte al local y te atendemos enseguida.</p>
        </section>
      </PublicShell>
    );

  if (phase === 'done' && result)
    return (
      <PublicShell businessName={catalog.businessName}>
        <section className="po-card po-done" aria-live="polite">
          <div className="po-check" aria-hidden="true">
            ✓
          </div>
          <h2>PEDIDO RECIBIDO</h2>
          <dl className="po-facts">
            <dt>Pedido</dt>
            <dd>{result.orderCode}</dd>
            <dt>Estado</dt>
            <dd>Recibido</dd>
          </dl>
          <ul className="po-summary">
            {result.items.map((item) => (
              <li key={item.name}>
                <span>
                  {item.name} · {item.quantity}{' '}
                  {item.quantity === 1 ? 'copia' : 'copias'}
                </span>
                <b>{formatMoney(item.totalCents)}</b>
              </li>
            ))}
            <li className="po-total">
              <span>TOTAL</span>
              <b>{formatMoney(result.totalCents)}</b>
            </li>
          </ul>
          <p>
            {customer.whatsappOptIn
              ? 'Te avisaremos por WhatsApp cuando esté listo para retirar.'
              : 'Guardá el link de seguimiento para ver cuándo está listo.'}
          </p>
          <a className="po-primary" href={`/pedido/${result.trackingToken}`}>
            Ver estado del pedido
          </a>
          <small>El pago se realiza en el local al retirar.</small>
        </section>
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
        <section className="po-card" aria-live="polite">
          {phase === 'sending' ? (
            <>
              <h2>Enviando tu pedido…</h2>
              <p>
                {done} de {entries.length} fotos enviadas. No cierres esta
                página hasta que termine.
              </p>
              <progress max="100" value={percent} aria-label="Progreso total" />
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
            <div className="po-actions">
              <button className="po-primary" onClick={() => void retryFailed()}>
                Reintentar ({failed.length})
              </button>
              <button
                className="po-secondary"
                onClick={() => void skipFailed()}
              >
                Enviar sin esas fotos
              </button>
            </div>
          )}
        </section>
      </PublicShell>
    );
  }

  return (
    <PublicShell businessName={catalog.businessName}>
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

      <section className="po-card" aria-labelledby="po-step-1">
        <h2 id="po-step-1">
          <span className="po-step">1</span> ¿Qué querés imprimir?
        </h2>
        <p className="po-hint">Podés elegir más de un tamaño.</p>
        <div className="po-sizes">
          {catalog.services.map((service) => {
            const on = selected.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                className={`po-size ${on ? 'po-size-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleService(service.id)}
              >
                <strong>{service.name}</strong>
                {service.description && <small>{service.description}</small>}
                <span className="po-price">
                  {formatMoney(service.unitPriceCents)} c/u
                </span>
                {on && (
                  <span className="po-mark" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {!lines.length && (
        <section className="po-card po-pending" aria-labelledby="po-step-2">
          <h2 id="po-step-2">
            <span className="po-step">2</span> Subí tus fotos
          </h2>
          <p className="po-hint">
            Primero elegí el tamaño y después agregás las fotos.
          </p>
        </section>
      )}
      {!!lines.length && (
        <section className="po-card" aria-labelledby="po-step-2">
          <h2 id="po-step-2">
            <span className="po-step">2</span> Subí tus fotos
          </h2>
          <p className="po-hint">
            Elegí las fotos de cada tamaño y cuántas copias querés de cada una.
          </p>
          {lines.map((line) => (
            <div className="po-group" key={line.service.id}>
              <header>
                <h3>{line.service.name}</h3>
                <span>{formatMoney(line.service.unitPriceCents)} c/u</span>
              </header>
              <label className="po-add">
                <input
                  type="file"
                  multiple
                  accept={FILE_INPUT_ACCEPT}
                  onChange={(event) => {
                    addFiles(line.service.id, event.target.files);
                    event.target.value = '';
                  }}
                />
                + Agregar fotos de {line.service.name}
              </label>
              <ul className="po-photos">
                {entries
                  .filter((x) => x.serviceId === line.service.id)
                  .map((entry) => (
                    <li key={entry.id}>
                      <Thumb file={entry.file} />
                      <div className="po-photo-info">
                        <strong>{entry.file.name}</strong>
                        <small>{formatSize(entry.file.size)}</small>
                      </div>
                      <div
                        className="po-stepper"
                        role="group"
                        aria-label={`Copias de ${entry.file.name}`}
                      >
                        <button
                          type="button"
                          aria-label="Menos copias"
                          disabled={entry.copies <= 1}
                          onClick={() =>
                            patchEntry(entry.id, {
                              copies: clampCopies(entry.copies - 1),
                            })
                          }
                        >
                          −
                        </button>
                        <output>{entry.copies}</output>
                        <button
                          type="button"
                          aria-label="Más copias"
                          onClick={() =>
                            patchEntry(entry.id, {
                              copies: clampCopies(entry.copies + 1),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="po-remove"
                        aria-label={`Quitar ${entry.file.name}`}
                        onClick={() => removeEntry(entry.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
              {line.files > 0 && <p className="po-line">{lineLabel(line)}</p>}
            </div>
          ))}
        </section>
      )}

      <section className="po-card" aria-labelledby="po-step-3">
        <h2 id="po-step-3">
          <span className="po-step">3</span> Tus datos
        </h2>
        <label className="po-field">
          Nombre *
          <input
            autoComplete="name"
            value={customer.name}
            maxLength={80}
            onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
          />
        </label>
        <label className="po-field">
          WhatsApp *
          <input
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
        <label className="po-field">
          Email (opcional)
          <input
            type="email"
            autoComplete="email"
            value={customer.email}
            maxLength={120}
            onChange={(e) =>
              setCustomer({ ...customer, email: e.target.value })
            }
          />
        </label>
        <label className="po-field">
          Notas (opcional)
          <textarea
            rows={2}
            maxLength={500}
            value={customer.notes}
            onChange={(e) =>
              setCustomer({ ...customer, notes: e.target.value })
            }
          />
        </label>
        <label className="po-consent">
          <input
            type="checkbox"
            checked={customer.whatsappOptIn}
            onChange={(e) =>
              setCustomer({ ...customer, whatsappOptIn: e.target.checked })
            }
          />
          <span>
            Quiero recibir por WhatsApp avisos relacionados con este pedido.
            <small>
              Sólo te escribimos por este pedido. No enviamos promociones.
            </small>
          </span>
        </label>
      </section>

      <section className="po-card" aria-labelledby="po-step-4">
        <h2 id="po-step-4">
          <span className="po-step">4</span> Confirmá tu pedido
        </h2>
        {lines.length ? (
          <ul className="po-summary">
            {lines.map((line) => (
              <li key={line.service.id}>
                <span>
                  {line.service.name} · {line.copies}{' '}
                  {line.copies === 1 ? 'copia' : 'copias'}
                </span>
                <b>{formatMoney(line.totalCents)}</b>
              </li>
            ))}
            <li className="po-total">
              <span>TOTAL</span>
              <b>{formatMoney(total)}</b>
            </li>
          </ul>
        ) : (
          <p className="po-hint">Todavía no elegiste ningún tamaño.</p>
        )}
        {customer.name.trim() && (
          <p className="po-hint">
            {customer.name.trim()}
            {customer.phone.trim() ? ` · ${customer.phone.trim()}` : ''}
          </p>
        )}
        <small className="po-hint">
          El pago se realiza en el local al retirar tu pedido.
        </small>
      </section>

      <div className="po-bar">
        <div>
          <small>TOTAL</small>
          <strong>{formatMoney(total)}</strong>
          {showMissing && missing.length > 0 && (
            <small className="po-missing" role="alert">
              Falta: {missing.join(', ')}.
            </small>
          )}
        </div>
        <button className="po-primary" onClick={() => void confirm()}>
          Confirmar pedido
        </button>
      </div>
    </PublicShell>
  );
}

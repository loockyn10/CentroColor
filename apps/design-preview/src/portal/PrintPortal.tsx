import { useRef, useState, type DragEvent } from 'react';
import { Icon } from '../icons';
import { navigate } from '../router';
import { useStore } from '../store';
import {
  Badge,
  Button,
  Field,
  PrintFrame,
  Progress,
  Sheet,
  Stepper,
  useToast,
} from '../ui';
import { ars, plural, PRINT_SIZES, type PrintSize } from '../data';
import { samplePhoto } from '../photos';
import { PortalShell } from './PortalShell';
import {
  MISSING_LABEL,
  MISSING_TARGET,
  addFiles,
  addSamples,
  loadDemoOrder,
  missing,
  orderLines,
  orderTotals,
  removePhoto,
  resetDraft,
  setCopies,
  setDraft,
  toggleSize,
  useDraft,
  type Missing,
  type OrderLine,
  type PhotoEntry,
} from './draft';

const dims = (s: PrintSize) =>
  `${String(s.wCm).replace('.', ',')} × ${String(s.hCm).replace('.', ',')} cm`;
const bytes = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

const HOW = [
  { icon: 'grid', label: 'Elegí el tamaño' },
  { icon: 'upload', label: 'Subí tus fotos' },
  { icon: 'wallet', label: 'Transferí' },
  { icon: 'store', label: 'Retirá en el local' },
] as const;

export function PrintPortal() {
  const d = useDraft();
  const { placeOrder } = useStore();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const lines = orderLines(d);
  const totals = orderTotals(lines);
  const miss = missing(d);

  const goTo = (m: Missing) => {
    const el = document.getElementById(MISSING_TARGET[m]);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (m === 'name' || m === 'phone') {
      window.setTimeout(
        () =>
          document
            .querySelector<HTMLInputElement>(`[name="${m}"]`)
            ?.focus({ preventScroll: true }),
        350,
      );
    }
  };

  const confirm = () => {
    setSheet(false);
    if (miss.length) {
      setTouched(true);
      toast(`Falta ${MISSING_LABEL[miss[0]]}`, 'alert');
      window.setTimeout(() => goTo(miss[0]), 60);
      return;
    }
    setSubmitting(true);
    window.setTimeout(() => {
      placeOrder({
        customer: d.name.trim(),
        phone: `+54 9 ${d.phone.trim()}`,
        email: d.email.trim(),
        notes: d.notes.trim(),
        lines: lines.map((l) => ({
          label: l.size.name,
          qty: l.photos,
          copies: l.copies,
          price: l.total,
        })),
        total: totals.total,
        files: totals.photos,
      });
      resetDraft();
      setSubmitting(false);
      navigate('/imprimir/recibido');
    }, 1100);
  };

  const summary = (
    <Summary
      lines={lines}
      totals={totals}
      miss={miss}
      showMissing={touched || totals.total > 0}
      submitting={submitting}
      onConfirm={confirm}
    />
  );

  const hero = (
    <div className="pt-hero">
      <div>
        <h1 style={{ marginTop: 10 }}>
          Imprimí <span className="marker">tus fotos</span>
        </h1>
        <p className="lede">
          Elegí el tamaño, subí tus fotos y pasá a retirarlas por el local.
        </p>
        <div className="actions">
          <a className="btn btn--dark btn--lg" href="#tamanos">
            Empezar <Icon name="chevD" />
          </a>
          <Button
            size="lg"
            icon="sparkle"
            onClick={() => {
              loadDemoOrder();
              toast('Pedido de ejemplo cargado: 22 copias, $18.500', 'sparkle');
            }}
          >
            Probar con un pedido de ejemplo
          </Button>
        </div>
      </div>
      <ul className="how how-row" aria-label="Cómo funciona">
        {HOW.map((h, i) => (
          <li key={h.label}>
            <span className="ico">
              <Icon name={h.icon} />
            </span>
            <span>
              {i + 1}. {h.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <PortalShell hero={hero}>
      <div className="pt-main">
        <div className="pt-flow">
          {/* 1 · Tamaños */}
          <section
            id="tamanos"
            aria-labelledby="h-tam"
            style={{ scrollMarginTop: 12 }}
          >
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                1
              </span>
              <h2 id="h-tam">Elegí el tamaño</h2>
            </div>
            <div className="sizes">
              {PRINT_SIZES.map((s, i) => (
                <SizeCard
                  key={s.id}
                  size={s}
                  photo={samplePhoto(i === 5 ? 3 : i * 2)}
                  selected={d.sizes.includes(s.id)}
                  onToggle={() => {
                    const has = d.photos.some((p) => p.sizeId === s.id);
                    if (d.sizes.includes(s.id) && has) {
                      toast(`Quitaste ${s.name} y sus fotos`, 'trash');
                    }
                    toggleSize(s.id);
                  }}
                />
              ))}
            </div>
          </section>

          {/* 2 · Fotos */}
          <section
            id="fotos"
            aria-labelledby="h-fotos"
            style={{ scrollMarginTop: 12 }}
          >
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                2
              </span>
              <h2 id="h-fotos">Subí tus fotos</h2>
            </div>
            {d.sizes.length === 0 ? (
              <div className="empty-box">
                <Icon name="image" size={38} />
                <strong>Primero elegí un tamaño</strong>
              </div>
            ) : (
              PRINT_SIZES.filter((s) => d.sizes.includes(s.id)).map((s) => (
                <PhotoGroup
                  key={s.id}
                  size={s}
                  photos={d.photos.filter((p) => p.sizeId === s.id)}
                />
              ))
            )}
          </section>

          {/* 3 · Datos */}
          <section
            id="datos"
            aria-labelledby="h-datos"
            style={{ scrollMarginTop: 12 }}
          >
            <div className="pt-step">
              <span className="pt-num" aria-hidden="true">
                3
              </span>
              <h2 id="h-datos">Tus datos</h2>
            </div>
            <form
              className="cust"
              onSubmit={(e) => e.preventDefault()}
              noValidate
            >
              <Field
                label="Nombre"
                error={
                  touched && d.name.trim().length < 2
                    ? 'Escribí tu nombre.'
                    : undefined
                }
              >
                {(id, desc) => (
                  <input
                    id={id}
                    name="name"
                    className="input"
                    autoComplete="name"
                    placeholder="María González"
                    value={d.name}
                    aria-describedby={desc}
                    aria-invalid={touched && d.name.trim().length < 2}
                    onChange={(e) => setDraft({ name: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="WhatsApp"
                error={
                  touched && d.phone.replace(/\D/g, '').length < 8
                    ? 'Ingresá un número válido, con código de área.'
                    : undefined
                }
              >
                {(id, desc) => (
                  <div className="input-group">
                    <span className="prefix" aria-hidden="true">
                      +54 9
                    </span>
                    <input
                      id={id}
                      name="phone"
                      className="input"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="3496 41-2231"
                      value={d.phone}
                      aria-describedby={desc}
                      aria-invalid={
                        touched && d.phone.replace(/\D/g, '').length < 8
                      }
                      onChange={(e) => setDraft({ phone: e.target.value })}
                    />
                  </div>
                )}
              </Field>
              <Field label="Email" optional>
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="tuemail@ejemplo.com"
                    value={d.email}
                    onChange={(e) => setDraft({ email: e.target.value })}
                  />
                )}
              </Field>
              <div className="wide">
                <Field label="Notas" optional>
                  {(id) => (
                    <textarea
                      id={id}
                      className="textarea"
                      rows={3}
                      placeholder="Papel mate, recortes, dedicatorias…"
                      value={d.notes}
                      onChange={(e) => setDraft({ notes: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </form>
          </section>

          {/* 4 · Confirmar (solo en pantallas angostas: en desktop está el resumen lateral) */}
          <section className="narrow-only" aria-labelledby="h-conf">
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

      {d.sizes.length > 0 && (
        <div className="pt-bar on-dark">
          <button
            type="button"
            className="sum-open"
            onClick={() => setSheet(true)}
            aria-label={`Ver resumen del pedido. Total ${ars(totals.total)}`}
          >
            <span className="lbl">TOTAL</span>
            <span className="amt num">{ars(totals.total)}</span>
            <span className="cnt">
              {plural(totals.copies, 'copia', 'copias')}
              <Icon name="chevR" />
            </span>
          </button>
          <Button
            variant="primary"
            size="lg"
            onClick={confirm}
            disabled={submitting}
            icon={submitting ? 'refresh' : undefined}
          >
            {submitting ? 'Enviando…' : 'Confirmar'}
          </Button>
        </div>
      )}

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Tu pedido"
        variant="side"
      >
        {summary}
      </Sheet>
    </PortalShell>
  );
}

// ───────────────────────── Tamaño ─────────────────────────

function SizeCard({
  size,
  photo,
  selected,
  onToggle,
}: {
  size: PrintSize;
  photo: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="size-card" data-selected={selected}>
      <div className="size-stage">
        <span className="dim">{dims(size)}</span>
        <PrintFrame
          wCm={size.wCm}
          hCm={size.hCm}
          src={photo}
          polaroid={size.polaroid}
          label={`Proporción real de ${size.name}: ${dims(size)}`}
        />
      </div>
      <div className="size-body">
        <h3>{size.name}</h3>
        <p className="tag">{size.tagline}</p>
        {size.badge && (
          <div>
            <Badge tone="ink" icon="sparkle">
              {size.badge}
            </Badge>
          </div>
        )}
        <div className="size-price">
          <b className="num">{ars(size.price)}</b>
          <small>c/u</small>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--block"
          aria-pressed={selected}
          onClick={onToggle}
        >
          <span className="btn-unit">
            {selected ? <Icon name="check" /> : <Icon name="plus" />}
            {selected ? 'Elegido' : 'Elegir'}
          </span>
          <span className="sr-only"> tamaño {size.name}</span>
        </button>
      </div>
    </article>
  );
}

// ───────────────────────── Fotos ─────────────────────────

function PhotoGroup({
  size,
  photos,
}: {
  size: PrintSize;
  photos: PhotoEntry[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const toast = useToast();
  const copies = photos
    .filter((p) => !p.error)
    .reduce((n, p) => n + p.copies, 0);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      addFiles(size.id, files);
      toast(
        `${plural(files.length, 'foto agregada', 'fotos agregadas')} a ${size.name}`,
        'image',
      );
    }
  };

  return (
    <section className="grp" aria-label={`Fotos para ${size.name}`}>
      <div className="grp-head">
        <h3>{size.name}</h3>
        <div className="meta">
          {plural(photos.length, 'foto', 'fotos')} ·{' '}
          {plural(copies, 'copia', 'copias')}
        </div>
        <div className="sub num">{ars(copies * size.price)}</div>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          aria-label={`Quitar el tamaño ${size.name}`}
          onClick={() => toggleSize(size.id)}
        >
          Quitar
        </Button>
      </div>
      <div className="grp-body">
        <div
          className={`drop ${over ? 'drop--over' : ''} ${photos.length ? 'drop--compact' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {!photos.length && <Icon name="upload" />}
          <div>
            <strong>
              {photos.length ? (
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
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="sparkle"
              onClick={() => addSamples(size.id, 3)}
            >
              Usar fotos de ejemplo
            </Button>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,.heic,.heif,.tif,.tiff"
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) addFiles(size.id, files);
              e.target.value = '';
            }}
          />
        </div>
        {photos.length > 0 && (
          <ul className="ph-grid" aria-label={`Fotos en ${size.name}`}>
            {photos.map((p) => (
              <PhotoCard key={p.id} p={p} size={size} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PhotoCard({ p, size }: { p: PhotoEntry; size: PrintSize }) {
  const done = p.progress >= 100;
  const ext = p.name.split('.').pop();
  return (
    <li className="ph-card" data-error={!!p.error}>
      <div className={`ph-thumb ${size.polaroid ? 'ph-thumb--pola' : ''}`}>
        <div className="ph-frame">
          {p.src ? (
            <img src={p.src} alt={`Vista previa de ${p.name}`} />
          ) : (
            <div className="ph-fallback">
              <span>
                <Icon name="image" size={34} />
                <br />
                {ext}
              </span>
            </div>
          )}
        </div>
        {size.polaroid && !p.error && (
          <span className="pola-caption" aria-hidden="true">
            Tu frase acá…
          </span>
        )}
        {done && !p.error && (
          <span className="ph-done">
            <Icon name="check" /> Subida
          </span>
        )}
        {!done && !p.error && (
          <div className="ph-over">
            <span>Subiendo… {Math.round(p.progress)}%</span>
            <Progress value={p.progress} />
          </div>
        )}
        <button
          type="button"
          className="ph-remove"
          aria-label={`Quitar ${p.name}`}
          onClick={() => removePhoto(p.id)}
        >
          <span>
            <Icon name="x" />
          </span>
        </button>
      </div>
      <div className="ph-body">
        <div className="ph-name">
          <span>{p.name}</span>
          <span>{bytes(p.bytes)}</span>
        </div>
        {p.error ? (
          <p className="ph-error">
            <Icon name="alert" /> {p.error}
          </p>
        ) : (
          <Stepper
            label={p.name}
            value={p.copies}
            onChange={(v) => setCopies(p.id, v)}
          />
        )}
        {size.polaroid && !p.error && (
          <button type="button" className="pola-slot" disabled>
            <Icon name="sparkle" /> Personalizar · muy pronto
          </button>
        )}
      </div>
    </li>
  );
}

// ───────────────────────── Resumen ─────────────────────────

function Summary({
  lines,
  totals,
  miss,
  showMissing,
  submitting,
  onConfirm,
}: {
  lines: OrderLine[];
  totals: { total: number; copies: number; photos: number };
  miss: Missing[];
  showMissing: boolean;
  submitting: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="sum on-dark">
      <div className="sum-in">
        <h2>Resumen</h2>
        {lines.length ? (
          <ul className="sum-lines">
            {lines.map((l) => (
              <li className="sum-line" key={l.size.id}>
                <span className="sz">{l.size.name}</span>
                <span className="pr num">{ars(l.total)}</span>
                <span className="cp">
                  {plural(l.copies, 'copia', 'copias')} ·{' '}
                  {plural(l.photos, 'foto', 'fotos')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="sum-total">
          <span className="lbl">TOTAL</span>
          <span className="amt num" aria-live="polite">
            {ars(totals.total)}
          </span>
        </div>
        {showMissing && miss.length > 0 && (
          <div className="sum-missing" role="status">
            <strong>Para confirmar falta:</strong>
            <span>{miss.map((m) => MISSING_LABEL[m]).join(' · ')}</span>
          </div>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          onClick={onConfirm}
          disabled={submitting}
          icon={submitting ? 'refresh' : 'check'}
        >
          {submitting ? 'Enviando pedido…' : 'Confirmar pedido'}
        </Button>
        <p className="fine">
          <Icon name="info" />
          <span>Se imprime una vez acreditada la transferencia.</span>
        </p>
      </div>
    </div>
  );
}

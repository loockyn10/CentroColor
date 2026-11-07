import { useEffect, useState } from 'react';
import { Button, Icon } from '@centrocolor/ui';
import {
  BANK_ALIAS,
  clampCopies,
  formatMoney,
  MAX_COPIES,
  MIN_COPIES,
  type CatalogService,
} from './model';
import { freePapers, prettySize, type SizeOption } from './order-blocks';

/** Preview of a picked photo (object URL, revoked on unmount). Falls back to an icon. */
export function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return broken || !url ? (
    <span className="po-thumb po-thumb-empty" aria-hidden="true">
      <Icon name="image" size={34} />
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

/**
 * A print drawn with the real proportion of its size (width × height). The scale is compressed
 * on purpose so small sizes stay visible next to large ones; it is not 1:1 between sizes.
 */
export function PrintFrame({
  widthMm,
  heightMm,
  label,
}: {
  widthMm: number | null;
  heightMm: number | null;
  label: string;
}) {
  const w = (widthMm ?? 100) / 10;
  const h = (heightMm ?? 150) / 10;
  const portrait = Math.max(w, h);
  const long = 76 + (portrait - 10) * 2.4;
  const ratio = w / h;
  const height = ratio <= 1 ? long : long / ratio;
  const width = ratio <= 1 ? long * ratio : long;
  return (
    <span
      className="print"
      role="img"
      aria-label={label}
      style={{
        width: `calc(var(--ps, 1) * ${width.toFixed(1)}px)`,
        height: `calc(var(--ps, 1) * ${height.toFixed(1)}px)`,
      }}
    />
  );
}

export function CopiesStepper({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  // Mientras se escribe se conserva el texto tal cual (incluso vacío); el valor válido se envía
  // apenas existe y al salir del campo se normaliza.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = (next: number) => {
    setDraft(null);
    onChange(clampCopies(next));
  };
  return (
    <div className="stepper" role="group" aria-label={`Copias de ${label}`}>
      <button
        type="button"
        aria-label="Menos copias"
        disabled={value <= MIN_COPIES}
        onClick={() => commit(value - 1)}
      >
        <Icon name="minus" />
      </button>
      <input
        className="stepper-input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={`Cantidad de copias de ${label}`}
        value={shown}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const text = event.target.value.replace(/\D/g, '').slice(0, 3);
          const n = Number(text);
          if (!text || n < MIN_COPIES) return setDraft(text);
          const next = clampCopies(n);
          setDraft(next === n ? text : String(next));
          if (next !== value) onChange(next);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            commit(value + 1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            commit(value - 1);
          }
        }}
      />
      <button
        type="button"
        aria-label="Más copias"
        disabled={value >= MAX_COPIES}
        onClick={() => commit(value + 1)}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const dimensions = (size: {
  widthMm: number | null;
  heightMm: number | null;
}) =>
  size.widthMm && size.heightMm
    ? `${size.widthMm / 10} × ${size.heightMm / 10} cm`.replaceAll('.', ',')
    : null;

/** Price note of a catalog entry: where its first tier starts, when it is not at one copy. */
export const priceNote = (service: CatalogService) =>
  service.tiers?.[0] && service.tiers[0].minQuantity > 1
    ? ` desde ${service.tiers[0].minQuantity} copias`
    : '';

/**
 * Size → paper, one question at a time. Only what the catalog offers is shown; a size on a paper
 * already in the order is disabled, so the order never gets two identical blocks.
 */
export function ServicePicker({
  sizes,
  selected,
  ownId,
  onPick,
  onCancel,
}: {
  sizes: SizeOption[];
  selected: string[];
  ownId?: string;
  onPick: (serviceId: string) => void;
  onCancel: (() => void) | null;
}) {
  const [sizeKey, setSizeKey] = useState<string | null>(null);
  const size = sizes.find((x) => x.key === sizeKey) ?? null;

  if (size)
    return (
      <div className="pick" role="group" aria-label={`Papel para ${size.name}`}>
        <div className="pick-head">
          <button
            type="button"
            className="pick-back"
            onClick={() => setSizeKey(null)}
          >
            <Icon name="chevL" /> Cambiar tamaño
          </button>
          <h3>¿Qué papel preferís?</h3>
          <p className="pick-chosen">{prettySize(size.name)}</p>
        </div>
        <div className="pick-grid pick-grid--papers">
          {size.papers.map((paper) => {
            const taken =
              paper.service.id !== ownId && selected.includes(paper.service.id);
            return (
              <button
                key={paper.service.id}
                type="button"
                className="pick-btn"
                disabled={taken}
                aria-pressed={paper.service.id === ownId}
                onClick={() => onPick(paper.service.id)}
              >
                <strong>{paper.label}</strong>
                <b className="num">
                  {formatMoney(paper.service.unitPriceCents)}
                </b>
                <small>
                  {taken
                    ? 'Ya está en tu pedido'
                    : `c/u${priceNote(paper.service)}`}
                </small>
              </button>
            );
          })}
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    );

  return (
    <div className="pick" role="group" aria-label="Tamaño">
      <div className="pick-head">
        <h3>¿Qué tamaño querés imprimir?</h3>
      </div>
      <div className="pick-grid">
        {sizes.map((option) => {
          const free = freePapers(option, selected, ownId);
          const cheapest = Math.min(
            ...option.papers.map((x) => x.service.unitPriceCents),
          );
          const dims = dimensions(option);
          return (
            <button
              key={option.key}
              type="button"
              className="pick-btn"
              disabled={!free.length}
              onClick={() =>
                option.papers.length === 1
                  ? onPick(option.papers[0]!.service.id)
                  : setSizeKey(option.key)
              }
            >
              <strong>{prettySize(option.name)}</strong>
              {dims && <small>{dims}</small>}
              <span className="pick-price">
                {free.length ? (
                  <>
                    {option.papers.length > 1 && 'desde '}
                    <b className="num">{formatMoney(cheapest)}</b> c/u
                  </>
                ) : (
                  'Ya está en tu pedido'
                )}
              </span>
            </button>
          );
        })}
      </div>
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      )}
    </div>
  );
}

/**
 * «Total a transferir» + alias + pasos, shown once an order that is paid BEFORE printing is
 * received (/imprimir and professionals without a pay-later authorization).
 */
export function TransferPanel({ totalCents }: { totalCents: number }) {
  const [copied, setCopied] = useState<'alias' | 'amount' | null>(null);
  async function copy(text: string, key: 'alias' | 'amount') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* el portapapeles puede no estar disponible: igual se confirma visualmente */
    }
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2200);
  }
  return (
    <section className="xfer on-dark" aria-labelledby="h-xfer">
      <div className="xfer-in">
        <div>
          <h2 id="h-xfer" className="lbl">
            Total a transferir
          </h2>
          <div className="amount num">{formatMoney(totalCents)}</div>
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
              Transferí <strong>{formatMoney(totalCents)}</strong> al alias de
              arriba.{' '}
              <button
                type="button"
                className="btn btn--ghost btn--sm on-dark po-copy-amount"
                onClick={() => void copy(String(totalCents / 100), 'amount')}
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
  );
}

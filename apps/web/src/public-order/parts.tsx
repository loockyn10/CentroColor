import { useEffect, useState } from 'react';
import { Icon } from '@centrocolor/ui';
import { clampCopies, MAX_COPIES, MIN_COPIES } from './model';

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
  return (
    <div className="stepper" role="group" aria-label={`Copias de ${label}`}>
      <button
        type="button"
        aria-label="Menos copias"
        disabled={value <= MIN_COPIES}
        onClick={() => onChange(clampCopies(value - 1))}
      >
        <Icon name="minus" />
      </button>
      <output aria-live="polite" aria-label={`${value} copias`}>
        {value}
      </output>
      <button
        type="button"
        aria-label="Más copias"
        disabled={value >= MAX_COPIES}
        onClick={() => onChange(clampCopies(value + 1))}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

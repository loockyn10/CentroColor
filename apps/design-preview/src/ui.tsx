import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';
import { Link } from './router';
import { STATUS_META, type JobStatus, type Tone } from './data';

// ───────────────────────── Logo ─────────────────────────
// El logo real es cuadrado (1024×1024, circular con fondo transparente): se muestra siempre
// con width = height para no deformarlo. Para tamaños chicos se usan derivados nítidos.

export function Logo({
  size = 64,
  className = '',
  decorative = false,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const src =
    size <= 96
      ? '/brand/centrocolor-logo-192.png'
      : size <= 256
        ? '/brand/centrocolor-logo-512.png'
        : '/brand/centrocolor-logo-1024.png';
  return (
    <img
      className={`logo ${className}`}
      src={src}
      srcSet={
        size <= 96
          ? '/brand/centrocolor-logo-192.png 1x, /brand/centrocolor-logo-512.png 2x'
          : undefined
      }
      width={size}
      height={size}
      alt={decorative ? '' : 'CentroColor · Laboratorio fotográfico Digital'}
      style={{ width: size, height: size }}
      decoding="async"
    />
  );
}

export function FilmStrip({
  tone = 'yellow',
  thin = false,
}: {
  tone?: 'yellow' | 'cream' | 'dark';
  thin?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`film ${tone === 'cream' ? 'film--cream' : ''} ${tone === 'dark' ? 'film--dark' : ''} ${thin ? 'film--thin' : ''}`}
    />
  );
}

// ───────────────────────── Botones ─────────────────────────

type BtnProps = {
  variant?: 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const btnClass = (
  variant: string,
  size: string,
  block: boolean,
  extra?: string,
) =>
  [
    'btn',
    variant !== 'secondary' && `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    extra,
  ]
    .filter(Boolean)
    .join(' ');

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  icon,
  iconAfter,
  className,
  children,
  type = 'button',
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={btnClass(variant, size, block, className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconAfter && <Icon name={iconAfter} />}
    </button>
  );
}

export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  block = false,
  icon,
  iconAfter,
  className,
  children,
}: Omit<BtnProps, 'type' | 'onClick'> & { to: string }) {
  return (
    <Link to={to} className={btnClass(variant, size, block, className)}>
      {icon && <Icon name={icon} />}
      {children}
      {iconAfter && <Icon name={iconAfter} />}
    </Link>
  );
}

// ───────────────────────── Badges ─────────────────────────

export function Badge({
  tone = 'neutral',
  icon,
  large,
  dashed,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  large?: boolean;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`badge ${tone !== 'neutral' ? `badge--${tone}` : ''} ${large ? 'badge--lg' : ''} ${dashed ? 'badge--dashed' : ''}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

export function StatusBadge({
  status,
  audience = 'internal',
  large,
}: {
  status: JobStatus;
  audience?: 'internal' | 'public';
  large?: boolean;
}) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} icon={m.icon} large={large}>
      {audience === 'public' ? m.public : m.internal}
    </Badge>
  );
}

// ───────────────────────── Controles ─────────────────────────

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
  small,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  small?: boolean;
}) {
  return (
    <div
      className={`stepper ${small ? 'stepper--sm' : ''}`}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        aria-label={`Menos copias de ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Icon name="minus" />
      </button>
      <output
        aria-live="polite"
        aria-label={`${value} ${value === 1 ? 'copia' : 'copias'}`}
      >
        {value}
      </output>
      <button
        type="button"
        aria-label={`Más copias de ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  pressed,
  onClick,
  count,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

export function Field({
  label,
  optional,
  hint,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
        {optional && <span className="opt">Opcional</span>}
      </label>
      {children(id, describedBy)}
      {error ? (
        <span className="err" id={`${id}-e`} role="alert">
          <Icon name="alert" size={18} /> {error}
        </span>
      ) : (
        hint && (
          <span className="hint" id={`${id}-h`}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export function Progress({
  value,
  yellow,
}: {
  value: number;
  yellow?: boolean;
}) {
  return (
    <div
      className={`progress ${yellow ? 'progress--y' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

// ───────────────────────── Sheet / Drawer ─────────────────────────

export function Sheet({
  open,
  onClose,
  title,
  variant = 'side',
  children,
  footer,
  eyebrow,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  variant?: 'side' | 'modal';
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={`sheet sheet--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && <div className="frame-tag">{eyebrow}</div>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <Button variant="ghost" aria-label="Cerrar" onClick={onClose}>
            <Icon name="x" />
          </Button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

// ───────────────────────── Toasts ─────────────────────────

interface ToastItem {
  id: number;
  text: string;
  icon: IconName;
}
const ToastCtx = createContext<(text: string, icon?: IconName) => void>(
  () => {},
);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const push = useCallback((text: string, icon: IconName = 'check') => {
    const id = ++counter.current;
    setItems((x) => [...x.slice(-2), { id, text, icon }]);
    window.setTimeout(
      () => setItems((x) => x.filter((i) => i.id !== id)),
      3600,
    );
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <Icon name={t.icon} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ───────────────────────── Varios ─────────────────────────

export function Empty({
  icon = 'image',
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/**
 * Marco con la proporción real de una impresión (10×15, 20×30…).
 * La altura usa una escala comprimida (no es 1:1 entre tamaños) para que las chicas se vean.
 */
export function PrintFrame({
  wCm,
  hCm,
  src,
  polaroid,
  label,
}: {
  wCm: number;
  hCm: number;
  src: string;
  polaroid?: boolean;
  label?: string;
}) {
  const h = 80 + (hCm - 10) * 2.6; // px a escala 1
  const w = (h * wCm) / hCm;
  const k = 'var(--ps, 1)';
  return (
    <div
      className="print"
      role="img"
      aria-label={label ?? `Proporción ${wCm} por ${hCm} centímetros`}
      style={{
        width: `calc(${k} * ${w.toFixed(1)}px)`,
        height: `calc(${k} * ${h.toFixed(1)}px)`,
        padding: polaroid
          ? `calc(${k} * ${(w * 0.06).toFixed(1)}px) calc(${k} * ${(w * 0.06).toFixed(1)}px) calc(${k} * ${(h * 0.2).toFixed(1)}px)`
          : undefined,
        flex: 'none',
      }}
    >
      <img
        src={src}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}

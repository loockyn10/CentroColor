import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

// El logo real es cuadrado y circular: se muestra siempre con width = height.
const logo192 = new URL(
  './assets/brand/centrocolor-logo-192.png',
  import.meta.url,
).href;
const logo512 = new URL(
  './assets/brand/centrocolor-logo-512.png',
  import.meta.url,
).href;

export function Logo({
  size = 64,
  className = '',
  decorative = false,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      className={`logo ${className}`.trim()}
      src={size <= 96 ? logo192 : logo512}
      srcSet={size <= 96 ? `${logo192} 1x, ${logo512} 2x` : undefined}
      width={size}
      height={size}
      alt={decorative ? '' : 'CentroColor · Laboratorio fotográfico Digital'}
      decoding="async"
    />
  );
}

export function FilmStrip({
  tone = 'yellow',
}: {
  tone?: 'yellow' | 'cream' | 'dark';
}) {
  return (
    <div
      aria-hidden="true"
      className={`film ${tone === 'cream' ? 'film--cream' : ''} ${tone === 'dark' ? 'film--dark' : ''}`.trim()}
    />
  );
}

// ───────────────────────── Botones ─────────────────────────

export type ButtonVariant =
  'primary' | 'secondary' | 'dark' | 'ghost' | 'danger';
type ButtonProps = {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const buttonClass = (
  variant: ButtonVariant = 'secondary',
  size: 'sm' | 'md' | 'lg' = 'md',
  block = false,
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
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, block, className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconAfter && <Icon name={iconAfter} />}
    </button>
  );
}

// ───────────────────────── Superficies y cabeceras ─────────────────────────

export function Card({
  children,
  className = '',
}: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

/**
 * Cabecera de página del panel. `eyebrow` se acepta por compatibilidad pero no se muestra:
 * la navegación ya orienta (DESIGN-02). `description` sólo debe usarse si ayuda a decidir.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {actions && <div className="page-actions">{actions}</div>}
      {description && <p className="page-description">{description}</p>}
    </header>
  );
}

export type Tone =
  'neutral' | 'yellow' | 'amber' | 'red' | 'green' | 'blue' | 'ink' | 'dark';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span
      className={`badge ${tone !== 'neutral' ? `badge--${tone}` : ''}`.trim()}
    >
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

/** Estado principal en una línea: «URGENTE · EN PROCESO». Sólo el primero lleva tono. */
export function StateLine({
  parts,
}: {
  parts: Array<{ text: string; tone?: 'alert' | 'warn' | 'ok' }>;
}) {
  return (
    <span className="state-line">
      {parts.map((part) => (
        <span
          key={part.text}
          className={part.tone ? `tone-${part.tone}` : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'warn' | 'alert';
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {hint && <span className="s">{hint}</span>}
    </>
  );
  const className = `kpi ${tone ? `kpi--${tone}` : ''}`.trim();
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function EmptyState({
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
      <Icon name={icon} size={32} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Notice({
  tone,
  icon = 'info',
  children,
}: {
  tone?: 'warn' | 'alert';
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div
      className={`notice ${tone ? `notice--${tone}` : ''}`.trim()}
      role={tone === 'alert' ? 'alert' : undefined}
    >
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

// ───────────────────────── Controles ─────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  pressed,
  onClick,
  count,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

/** Pestañas de módulo: ver `AppShell`, que las pinta a partir de la navegación. */
export function Tabs({
  label,
  items,
  activeId,
  onSelect,
}: {
  label: string;
  items: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="subnav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={activeId === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

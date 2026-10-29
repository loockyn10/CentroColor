import {
  useContext,
  useLayoutEffect,
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { PageTabsContext } from './page-tabs';
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
 * Cabecera de página del panel: título, acción primaria a la derecha y, si el módulo tiene
 * pestañas, las pestañas debajo del título (el shell las entrega por contexto; el H1 pasa a ser
 * el nombre del módulo para no repetir la pestaña activa). `eyebrow` se acepta por compatibilidad
 * pero no se muestra. `description` sólo debe usarse si ayuda a decidir.
 */
export function PageHeader({
  title,
  description,
  actions,
  primaryAction,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /** Acciones secundarias (menor peso). */
  actions?: ReactNode;
  /** La única acción primaria de la pantalla: va última, a la derecha. */
  primaryAction?: ReactNode;
}) {
  const tabs = useContext(PageTabsContext);
  const hasTabs = Boolean(tabs?.tabs);
  const claim = tabs?.claim;
  useLayoutEffect(() => {
    if (!hasTabs || !claim) return;
    claim(true);
    return () => claim(false);
  }, [hasTabs, claim]);
  return (
    <>
      <header
        className={`page-head ${hasTabs ? 'page-head--tabbed' : ''}`.trim()}
      >
        <h1>{hasTabs && tabs ? tabs.moduleLabel : title}</h1>
        {(actions || primaryAction) && (
          <div className="page-actions">
            {actions}
            {primaryAction}
          </div>
        )}
        {description && <p className="page-description">{description}</p>}
      </header>
      {hasTabs && tabs?.tabs}
    </>
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

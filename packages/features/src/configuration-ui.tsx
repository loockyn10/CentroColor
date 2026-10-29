import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Icon,
  StatusBadge,
  type StatusTone,
} from '@centrocolor/ui';
import { money } from './format';

export function MoneyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <span className="money-input">
        <span aria-hidden="true">$</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      </span>
    </label>
  );
}

// ───────── Gramática de Precios: familias, detalle, secciones y filas ─────────

/** Cobertura de precios de una familia: «N de M con precio» y su estado. */
export function priceCoverage(priced: number, total: number) {
  const tone: StatusTone =
    total === 0
      ? 'neutral'
      : priced === 0
        ? 'neutral'
        : priced === total
          ? 'ok'
          : 'progress';
  const label =
    total === 0
      ? 'Sin elementos'
      : priced === 0
        ? 'Sin precios'
        : priced === total
          ? 'Completa'
          : 'Parcial';
  return {
    tone,
    label,
    text: total === 0 ? 'Sin elementos' : `${priced} de ${total} con precio`,
  };
}

/** Tarjeta de familia de precios: toda la tarjeta es el botón; sin «Configurar» por tarjeta. */
export function PriceFamilyCard({
  title,
  summary,
  detail,
  status,
  onOpen,
  disabled = false,
  external = false,
}: {
  title: string;
  summary: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  onOpen?: () => void;
  disabled?: boolean;
  /** Abre otra pantalla de Configuración en lugar de un detalle de Precios. */
  external?: boolean;
}) {
  const body = (
    <>
      <span className="price-family__top">
        <h3>{title}</h3>
        {status}
      </span>
      <strong className="price-family__summary">{summary}</strong>
      {detail && <span className="price-family__detail">{detail}</span>}
      {!disabled && (
        <Icon
          name={external ? 'link' : 'chevR'}
          size={20}
          className="price-family__go"
        />
      )}
    </>
  );
  return disabled || !onOpen ? (
    <div className="price-family price-family--disabled">{body}</div>
  ) : (
    <button type="button" className="price-family" onClick={onOpen}>
      {body}
    </button>
  );
}

/** Detalle de una familia: volver, título, lista activa y acciones secundarias. */
export function PriceFamilyDetail({
  title,
  listName,
  onBack,
  actions,
  children,
}: {
  title: string;
  listName: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="price-detail" aria-label={title}>
      <div className="price-detail__head">
        <Button variant="ghost" icon="chevL" onClick={onBack}>
          Precios
        </Button>
        <div className="price-detail__title">
          <h2>{title}</h2>
          <span className="price-list-chip">Lista: {listName}</span>
        </div>
        {actions && <div className="price-detail__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Bloque de un detalle: título, una pista opcional de una línea y la acción de alta. */
export function PriceSection({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="price-section">
      <div className="section-head">
        <div>
          <h3>{title}</h3>
          {hint && <p className="meta">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="rows">{children}</div>
    </Card>
  );
}

export interface PriceValueSpec {
  /** Siempre con unidad: «Precio por m²», «Precio por copia», «Operador», … */
  label: string;
  cents: number | null;
}

/** Fila de precio: identidad, valores con su unidad, estado y una sola acción («Editar»). */
export function PriceRow({
  title,
  meta,
  values,
  inactive = false,
  onEdit,
}: {
  title: string;
  meta?: ReactNode;
  values: PriceValueSpec[];
  inactive?: boolean;
  onEdit?: () => void;
}) {
  const unpriced = values.every((value) => value.cents === null);
  return (
    <div className="price-row">
      <div className="price-row__id">
        <strong>{title}</strong>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <div className="price-row__values">
        {values.map((value) => (
          <span className="config-value" key={value.label}>
            <small>{value.label}</small>
            <strong>{value.cents === null ? '—' : money(value.cents)}</strong>
          </span>
        ))}
      </div>
      <div className="price-row__state">
        {inactive && <StatusBadge tone="closed">Inactivo</StatusBadge>}
        {unpriced && <StatusBadge>Sin precio</StatusBadge>}
      </div>
      {onEdit && (
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
      )}
    </div>
  );
}

// ───────── Catálogos de Configuración (Productos, Recursos, Tipos, Materiales) ─────────

/** Secciones de un catálogo: mismo bloque que usa Precios (título, pista y alta). */
export const CatalogSection = PriceSection;

/**
 * Fila de catálogo: identidad, datos con rótulo, estado Activo/Inactivo y una sola acción
 * («Editar»). Crear y editar siempre abren un `FormDrawer`.
 */
export function CatalogRow({
  title,
  meta,
  values,
  active,
  onEdit,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  values?: Array<{ label: string; value: ReactNode }>;
  /** Omitir cuando el elemento no tiene estado propio. */
  active?: boolean;
  onEdit?: () => void;
  /** Acción propia en lugar de «Editar» (p. ej. activar/desactivar). */
  actions?: ReactNode;
}) {
  return (
    <div className="price-row">
      <div className="price-row__id">
        <strong>{title}</strong>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {values && values.length > 0 && (
        <div className="price-row__values">
          {values.map((value) => (
            <span className="config-value" key={value.label}>
              <small>{value.label}</small>
              <strong>{value.value}</strong>
            </span>
          ))}
        </div>
      )}
      {active !== undefined && (
        <div className="price-row__state">
          <StatusBadge tone={active ? 'ok' : 'closed'}>
            {active ? 'Activo' : 'Inactivo'}
          </StatusBadge>
        </div>
      )}
      {actions}
      {onEdit && (
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
      )}
    </div>
  );
}

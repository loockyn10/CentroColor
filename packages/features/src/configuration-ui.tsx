import type { ReactNode } from 'react';
import { Badge, Button, Card } from '@centrocolor/ui';

export function ConfigurationSection({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="config-section">
      <div className="config-section-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          {title && <h2>{title}</h2>}
          {description && <p className="meta">{description}</p>}
        </div>
        {actions && <div className="config-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function ConfigurationCard({
  title,
  summary,
  detail,
  actionLabel = 'Configurar',
  onAction,
  disabled = false,
  status,
  actions,
}: {
  title: string;
  summary: ReactNode;
  detail?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card className="config-card">
      <div className="config-card__body">
        <div className="config-card__title">
          <h2>{title}</h2>
          {status}
        </div>
        <strong className="config-card__summary">{summary}</strong>
        {detail && <p className="meta">{detail}</p>}
      </div>
      {actions ?? (
        <Button
          variant={disabled ? 'ghost' : 'secondary'}
          disabled={disabled || !onAction}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </Card>
  );
}

export function ConfigurationDetailHeader({
  title,
  listName,
  description,
  onBack,
}: {
  title: string;
  listName: string;
  description?: ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="config-detail-heading">
      <Button variant="ghost" onClick={onBack}>
        ← Precios
      </Button>
      <div>
        <span className="eyebrow">PRECIOS POR FAMILIA</span>
        <h2>{title}</h2>
        {description && <p className="meta">{description}</p>}
        <span className="config-list-context">Lista: {listName}</span>
      </div>
    </div>
  );
}

export function ConfigurationStatus({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? 'green' : 'neutral'}>
      {active ? 'Activo' : 'Inactivo'}
    </Badge>
  );
}

export function ConfigurationRow({
  title,
  meta,
  values,
  active,
  onEdit,
  onToggle,
}: {
  title: string;
  meta?: ReactNode;
  values: ReactNode;
  active: boolean;
  onEdit?: () => void;
  onToggle?: () => void;
}) {
  return (
    <div className="config-row">
      <div className="config-row__identity">
        <strong>{title}</strong>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <div className="config-row__values">{values}</div>
      <ConfigurationStatus active={active} />
      {(onEdit || onToggle) && (
        <div className="config-actions">
          {onEdit && (
            <Button variant="ghost" onClick={onEdit}>
              Editar
            </Button>
          )}
          {onToggle && (
            <Button variant="ghost" onClick={onToggle}>
              {active ? 'Desactivar' : 'Activar'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

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

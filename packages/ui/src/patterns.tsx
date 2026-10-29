import { useId, type FormEvent, type ReactNode } from 'react';
import { Button } from './primitives';
import { Sheet } from './sheet';
import { InlineMessage } from './feedback';

/** Fila de filtros de una pantalla: búsqueda + filtros (chips/segmentado) + control de vista. */
export function FilterBar({
  search,
  children,
  end,
  label = 'Filtros',
}: {
  search?: ReactNode;
  children?: ReactNode;
  end?: ReactNode;
  label?: string;
}) {
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      {search && <div className="filter-bar__search">{search}</div>}
      {children && <div className="filter-bar__filters">{children}</div>}
      {end && <div className="filter-bar__end">{end}</div>}
    </div>
  );
}

/**
 * Fila de lista con slots fijos (identidad · detalle · fecha · estado · acción) sobre `.oprow`.
 * Con `onClick` toda la fila es un botón.
 */
export function EntityRow({
  who,
  what,
  when,
  state,
  actions,
  flag,
  onClick,
  className = '',
}: {
  who: ReactNode;
  what?: ReactNode;
  when?: ReactNode;
  state?: ReactNode;
  actions?: ReactNode;
  flag?: 'alert' | 'warn' | 'ok';
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <span className="who">{who}</span>
      <span className="what">{what}</span>
      <span className="when">{when}</span>
      <span className="when">{state}</span>
      {actions && <span className="act">{actions}</span>}
    </>
  );
  const cls = `oprow entity-row ${className}`.trim();
  return onClick ? (
    <button type="button" className={cls} data-flag={flag} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls} data-flag={flag}>
      {content}
    </div>
  );
}

/**
 * Alta o edición bajo demanda: hoja lateral con pie fijo (Cancelar · Guardar). El formulario
 * envuelve cuerpo y pie, de modo que Enter envía.
 */
export function FormDrawer({
  open,
  onClose,
  title,
  onSubmit,
  submitLabel = 'Guardar',
  busy = false,
  error,
  disabled = false,
  size = 'md',
  footerStart,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'md' | 'lg';
  /** Contenido fijo a la izquierda del pie (totales, resumen). */
  footerStart?: ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  disabled?: boolean;
  children: ReactNode;
}) {
  const formId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      variant="side"
      size={size}
      footer={
        <>
          {footerStart && (
            <div className="sheet-foot__start">{footerStart}</div>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={busy || disabled}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className="form-drawer" onSubmit={submit}>
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {children}
      </form>
    </Sheet>
  );
}

/** Confirmación de una acción con consecuencia (reemplaza a `window.confirm`). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Volver',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      variant="modal"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="confirm-body">{children}</div>}
    </Sheet>
  );
}

/**
 * Integración técnica (Google Drive, WhatsApp): título, estado, datos de conexión y acciones.
 * Es configuración, no un módulo operativo: sin acciones primarias del día a día.
 */
export function IntegrationCard({
  title,
  status,
  details,
  children,
  actions,
}: {
  title: string;
  status?: ReactNode;
  details?: Array<{ label: string; value: ReactNode }>;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="integration-card">
      <header className="integration-card__head">
        <h2>{title}</h2>
        {status}
      </header>
      {details && details.length > 0 && (
        <dl className="integration-card__details">
          {details.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      {actions && <div className="integration-card__actions">{actions}</div>}
    </section>
  );
}

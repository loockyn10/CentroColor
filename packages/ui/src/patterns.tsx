import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './primitives';
import { Sheet } from './sheet';
import { InlineMessage } from './feedback';
import { Select } from './select';
import { DatePicker } from './date-picker';

/**
 * Fila de filtros de una pantalla: búsqueda + filtros (selectores, fechas, chips) + control de
 * vista. Es el único patrón de filtros: nunca recibe `min-width` fijos, hace wrap y en pantallas
 * angostas reparte los filtros de a dos por fila sin desbordar el viewport.
 *
 * `onClear` agrega «Limpiar» (sólo visible con `dirty`): restablece todos los filtros de una vez.
 */
export function FilterBar({
  search,
  children,
  end,
  label = 'Filtros',
  onClear,
  dirty = false,
}: {
  search?: ReactNode;
  children?: ReactNode;
  end?: ReactNode;
  label?: string;
  onClear?: () => void;
  /** Hay algún filtro distinto del valor por defecto. */
  dirty?: boolean;
}) {
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      {search && <div className="filter-bar__search">{search}</div>}
      {(children || (onClear && dirty)) && (
        <div className="filter-bar__filters">
          {children}
          {onClear && dirty && (
            <Button
              variant="ghost"
              size="sm"
              icon="x"
              className="filter-bar__clear"
              onClick={onClear}
            >
              Limpiar
            </Button>
          )}
        </div>
      )}
      {end && <div className="filter-bar__end">{end}</div>}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Filtro desplegable: «Categoría: Todas». `allValue` es el valor sin filtrar (por defecto `''`);
 * la primera opción siempre es «Todas…» para volver a ver todo.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  allValue = '',
}: {
  /** Rótulo corto, también nombre accesible («Categoría», «Estado»). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Texto de la opción sin filtro («Todas», «Todos los estados»). */
  allLabel: string;
  allValue?: string;
}) {
  return (
    <Select
      size="sm"
      prefix={label}
      label={label}
      value={value}
      onChange={onChange}
      options={[{ value: allValue, label: allLabel }, ...options]}
      // «Estado: Todos» en el disparador; «Todos los estados» sólo en la lista.
      renderValue={(option) =>
        option.value === allValue
          ? (allLabel.split(' ')[0] ?? allLabel)
          : option.label
      }
      className="filter-control"
    />
  );
}

/** Filtro de fecha («Desde», «Hasta») con el calendario propio. */
export function FilterDate({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <DatePicker
      size="sm"
      prefix={label}
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      className="filter-control"
    />
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
 * Confirmación de eliminación. Para el usuario «Eliminar» es eliminar: el elemento desaparece de
 * los listados y sólo se recupera desde Configuración → Papelera. El texto nunca menciona la
 * implementación (marcas de borrado, claves, sincronización).
 *
 * `what` lleva el artículo («este producto», «esta categoría»); `listName` es el listado de donde
 * desaparece («Productos»).
 */
export function DeleteDialog({
  open,
  what,
  listName,
  gender = 'm',
  note,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  what: string;
  listName: string;
  gender?: 'm' | 'f';
  /** Aclaración opcional y breve (p. ej. lo que sigue viéndose en el historial). */
  note?: ReactNode;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={`¿Eliminar ${what}?`}
      confirmLabel="Eliminar"
      cancelLabel="Cancelar"
      destructive
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        Dejará de aparecer en {listName}. Podés restaurar
        {gender === 'f' ? 'la' : 'lo'} desde Configuración → Papelera.
      </p>
      {note && <p className="meta">{note}</p>}
    </ConfirmDialog>
  );
}

/**
 * Acción «Eliminar» de un catálogo: botón destructivo + confirmación corta (`DeleteDialog`). Es el
 * único camino de eliminación visible; `onDelete` envía el elemento a la Papelera y el padre
 * recarga su listado (el elemento desaparece de él). Un error se muestra dentro del diálogo.
 */
export function DeleteAction({
  label,
  what,
  listName,
  gender = 'm',
  note,
  disabled = false,
  size = 'md',
  variant = 'danger',
  onDelete,
}: {
  /** Texto del botón: «Eliminar producto». */
  label: string;
  size?: 'sm' | 'md';
  /** `ghost` para acciones dentro de una fila; `danger` para el pie de un formulario. */
  variant?: 'danger' | 'ghost';
  /** Con artículo: «este producto». */
  what: string;
  listName: string;
  gender?: 'm' | 'f';
  note?: ReactNode;
  disabled?: boolean;
  onDelete: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setError(null);
  };
  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon="trash"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <DeleteDialog
        open={open}
        what={what}
        listName={listName}
        gender={gender}
        busy={busy}
        note={
          <>
            {note}
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
          </>
        }
        onCancel={close}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await onDelete();
            setOpen(false);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : 'No se pudo eliminar. Probá de nuevo.',
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
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

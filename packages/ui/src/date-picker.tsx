import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from './icons';
import { Popover } from './popover';
import {
  addMonthsKey,
  buildMonthGrid,
  clampKey,
  dateForKey,
  clampTimePart,
  describeDateKey,
  formatDateKey,
  formatDateTimeKey,
  isDisabledKey,
  joinDateTime,
  monthTitle,
  parseDateKey,
  splitDateTime,
  stepTimePart,
  todayKey,
  weekdayShort,
  type TimeParts,
} from './date-utils';

function Calendar({
  value,
  min,
  max,
  onPick,
  onClear,
  onClose,
  footerExtra,
}: {
  value: string;
  min?: string;
  max?: string;
  onPick: (key: string) => void;
  onClear?: () => void;
  onClose: () => void;
  footerExtra?: ReactNode;
}) {
  const today = todayKey();
  const start = parseDateKey(value) ? value : clampKey(today, min, max);
  const [focused, setFocused] = useState(start);
  const parts = parseDateKey(focused)!;
  const cells = buildMonthGrid(parts.year, parts.month);
  const gridRef = useRef<HTMLDivElement>(null);

  // El foco entra al día activo al abrir y lo sigue al navegar con el teclado.
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      ?.focus({ preventScroll: true });
  }, [focused]);

  const move = (key: string, shift: boolean) => {
    const target = dateForKey(focused, key, shift);
    if (!target) return false;
    setFocused(clampKey(target, min, max));
    return true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      // El calendario es un diálogo: Tab recorre sus controles sin escapar a la página.
      const root = event.currentTarget;
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input:not([disabled])',
        ),
      ];
      event.stopPropagation();
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? items[(at <= 0 ? items.length : at) - 1]
        : items[(at + 1) % items.length];
      event.preventDefault();
      next?.focus();
      return;
    }
    if (move(event.key, event.shiftKey)) event.preventDefault();
  };

  return (
    <div
      className="calendar"
      role="dialog"
      aria-label="Elegir fecha"
      onKeyDown={onKeyDown}
    >
      <div className="calendar__head">
        <button
          type="button"
          className="calendar__nav"
          aria-label="Mes anterior"
          onClick={() => setFocused(addMonthsKey(focused, -1))}
        >
          <Icon name="chevL" size={20} />
        </button>
        <strong className="calendar__title" aria-live="polite">
          {monthTitle(parts.year, parts.month)}
        </strong>
        <button
          type="button"
          className="calendar__nav"
          aria-label="Mes siguiente"
          onClick={() => setFocused(addMonthsKey(focused, 1))}
        >
          <Icon name="chevR" size={20} />
        </button>
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={monthTitle(parts.year, parts.month)}
        className="calendar__grid"
      >
        <div role="row" className="calendar__row">
          {weekdayShort.map((day) => (
            <span key={day} role="columnheader" className="calendar__dow">
              {day}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div role="row" className="calendar__row" key={week}>
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const disabled = isDisabledKey(cell.key, min, max);
              const isSelected = cell.key === value;
              return (
                <span role="gridcell" key={cell.key} aria-selected={isSelected}>
                  <button
                    type="button"
                    className="calendar__day"
                    tabIndex={cell.key === focused ? 0 : -1}
                    disabled={disabled}
                    aria-label={describeDateKey(cell.key)}
                    aria-current={cell.key === today ? 'date' : undefined}
                    data-outside={!cell.inMonth || undefined}
                    data-selected={isSelected || undefined}
                    data-today={cell.key === today || undefined}
                    onClick={() => onPick(cell.key)}
                  >
                    {cell.day}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="calendar__foot">
        <button
          type="button"
          className="calendar__action"
          disabled={isDisabledKey(today, min, max)}
          onClick={() => onPick(today)}
        >
          Hoy
        </button>
        {onClear && (
          <button type="button" className="calendar__action" onClick={onClear}>
            Limpiar
          </button>
        )}
        {footerExtra}
      </div>
    </div>
  );
}

interface FieldProps {
  /** Nombre accesible cuando no está dentro de un `<label>`. */
  label?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  /** Rótulo corto dentro del disparador («Desde», «Hasta»): útil en filtros compactos. */
  prefix?: string;
  size?: 'md' | 'sm';
  id?: string;
  className?: string;
}

/**
 * Selector de fecha propio (reemplaza a `<input type="date">`). Mismo formato que el nativo:
 * `value` y `onChange` usan `YYYY-MM-DD`; el usuario ve `dd/mm/aaaa` y un calendario con los
 * colores de la marca. Sin `required`, el calendario ofrece «Limpiar».
 */
export function DatePicker({
  value,
  onChange,
  label,
  min,
  max,
  disabled = false,
  required = false,
  invalid = false,
  placeholder = 'dd/mm/aaaa',
  prefix,
  size = 'md',
  id,
  className = '',
}: FieldProps & { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const display = formatDateKey(value);
  return (
    <div
      className={`cc-select datefield ${size === 'sm' ? 'cc-select--sm' : ''} ${className}`.trim()}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="cc-select__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          label || prefix
            ? `${label ?? prefix}${display ? `: ${display}` : ''}`
            : undefined
        }
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {prefix && <span className="cc-select__prefix">{prefix}</span>}
        <span
          className={`cc-select__value ${display ? '' : 'cc-select__value--placeholder'}`.trim()}
        >
          {display || placeholder}
        </span>
        <Icon name="calendar" size={18} className="cc-select__chevron" />
      </button>
      {required && (
        <input
          className="cc-select__required"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => undefined}
        />
      )}
      <Popover
        anchorRef={triggerRef}
        open={open}
        onDismiss={() => setOpen(false)}
        minWidth={304}
        desiredHeight={400}
        className="calendar-pop"
      >
        <Calendar
          value={value}
          min={min}
          max={max}
          onPick={(key) => {
            onChange(key);
            close();
          }}
          onClear={
            required
              ? undefined
              : () => {
                  onChange('');
                  close();
                }
          }
          onClose={close}
        />
      </Popover>
    </div>
  );
}

function TimeInputs({
  value,
  onChange,
  disabled,
}: {
  value: TimeParts | null;
  onChange: (time: TimeParts) => void;
  disabled?: boolean;
}) {
  const current = value ?? { hour: 0, minute: 0 };
  const field = (kind: 'hour' | 'minute', labelText: string, size: number) => (
    <input
      className="timefield__part"
      inputMode="numeric"
      autoComplete="off"
      maxLength={2}
      aria-label={labelText}
      disabled={disabled}
      value={String(current[kind]).padStart(2, '0')}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(-2);
        onChange({
          ...current,
          [kind]: clampTimePart(Number(digits || 0), size - 1),
        });
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const step = kind === 'minute' ? 5 : 1;
          onChange({
            ...current,
            [kind]: stepTimePart(
              current[kind],
              event.key === 'ArrowUp' ? step : -step,
              size,
            ),
          });
        }
      }}
    />
  );
  return (
    <div className="timefield" role="group" aria-label="Hora">
      {field('hour', 'Hora', 24)}
      <span aria-hidden="true">:</span>
      {field('minute', 'Minutos', 60)}
    </div>
  );
}

/**
 * Fecha y hora (reemplaza a `<input type="datetime-local">`). `value` usa `YYYY-MM-DDTHH:mm`.
 * La hora se edita con campos numéricos propios (↑/↓ ajustan; los minutos van de a 5).
 */
export function DateTimePicker({
  value,
  onChange,
  label,
  min,
  max,
  disabled = false,
  required = false,
  invalid = false,
  placeholder = 'dd/mm/aaaa hh:mm',
  prefix,
  size = 'md',
  id,
  className = '',
}: FieldProps & { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { date, time } = splitDateTime(value);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const display = formatDateTimeKey(value);
  return (
    <div
      className={`cc-select datefield ${size === 'sm' ? 'cc-select--sm' : ''} ${className}`.trim()}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="cc-select__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          label || prefix
            ? `${label ?? prefix}${display ? `: ${display}` : ''}`
            : undefined
        }
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {prefix && <span className="cc-select__prefix">{prefix}</span>}
        <span
          className={`cc-select__value ${display ? '' : 'cc-select__value--placeholder'}`.trim()}
        >
          {display || placeholder}
        </span>
        <Icon name="calendar" size={18} className="cc-select__chevron" />
      </button>
      {required && (
        <input
          className="cc-select__required"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => undefined}
        />
      )}
      <Popover
        anchorRef={triggerRef}
        open={open}
        onDismiss={() => setOpen(false)}
        minWidth={304}
        desiredHeight={470}
        className="calendar-pop"
      >
        <Calendar
          value={date}
          min={min ? splitDateTime(min).date : undefined}
          max={max ? splitDateTime(max).date : undefined}
          onPick={(key) =>
            onChange(joinDateTime(key, time ?? { hour: 9, minute: 0 }))
          }
          onClear={
            required
              ? undefined
              : () => {
                  onChange('');
                  close();
                }
          }
          onClose={close}
          footerExtra={
            <div className="calendar__time">
              <TimeInputs
                value={time}
                disabled={!date}
                onChange={(next) => date && onChange(joinDateTime(date, next))}
              />
              <button
                type="button"
                className="calendar__action calendar__action--primary"
                onClick={close}
              >
                Listo
              </button>
            </div>
          }
        />
      </Popover>
    </div>
  );
}

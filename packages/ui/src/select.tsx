import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from './icons';
import { Popover } from './popover';
import {
  initialActive,
  moveActive,
  typeahead,
  type ListKey,
  type SelectOption,
} from './select-logic';

export type { SelectOption } from './select-logic';

type OptionProps = {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
};

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean')
    return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node))
    return textOf((node.props as { children?: ReactNode }).children);
  return '';
};

/**
 * Convierte `<option>` (como en un `<select>` nativo) a opciones. Admite fragmentos y listas, de
 * modo que `{items.map(... <option/>)}` sigue funcionando al migrar un `<select>`.
 */
export function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const visit = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ReactElement<OptionProps>;
      if (element.type === Fragment) {
        visit(element.props.children);
      } else if (element.type === 'option') {
        const label = textOf(element.props.children);
        out.push({
          value: String(element.props.value ?? label),
          label,
          disabled: element.props.disabled,
        });
      }
    });
  };
  visit(children);
  return out;
}

/**
 * Selector propio de CentroColor (reemplaza al `<select>` nativo, cuya lista abierta pertenece al
 * sistema operativo). Patrón WAI-ARIA «select-only combobox»: el foco se queda en el disparador y
 * la opción activa se anuncia con `aria-activedescendant`.
 *
 * Teclado: ↓/↑/Enter/Espacio abren · ↓/↑/Inicio/Fin/RePág/AvPág mueven · Enter/Espacio eligen ·
 * Escape cierra (sin cerrar la hoja que lo contiene) · letras saltan a la opción · Tab cierra.
 *
 * API: `value` + `onChange(value)`; las opciones pueden ir como `options` o como `<option>`.
 */
export function Select({
  value,
  onChange,
  options: optionsProp,
  children,
  label,
  placeholder = 'Elegir…',
  disabled = false,
  required = false,
  invalid = false,
  autoFocus = false,
  renderValue,
  prefix,
  size = 'md',
  id,
  name,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  children?: ReactNode;
  /** Nombre accesible cuando el control no está dentro de un `<label>`. */
  label?: string;
  /** Texto cuando el valor no coincide con ninguna opción. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Texto del disparador para la opción elegida (por defecto, su etiqueta). */
  renderValue?: (option: SelectOption) => string;
  /** Rótulo corto dentro del disparador («Categoría», «Estado»): útil en filtros compactos. */
  prefix?: string;
  size?: 'md' | 'sm';
  id?: string;
  name?: string;
  className?: string;
}) {
  const options = useMemo(
    () => optionsProp ?? optionsFromChildren(children),
    [optionsProp, children],
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', timer: 0 });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const selected = options.find((option) => option.value === value);

  const openList = (to?: 'first' | 'last') => {
    if (disabled) return;
    const start =
      to === 'first'
        ? moveActive(options, -1, 'ArrowDown')
        : to === 'last'
          ? moveActive(options, options.length, 'ArrowUp')
          : initialActive(options, value);
    setActive(start);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Mantiene visible la opción activa dentro de la lista con desplazamiento.
  useEffect(() => {
    if (!open || active < 0) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const key = event.key;
    if (disabled) return;
    if (!open) {
      if (
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'Enter' ||
        key === ' '
      ) {
        event.preventDefault();
        openList(key === 'ArrowUp' ? 'last' : undefined);
        return;
      }
      if (key === 'Home' || key === 'End') {
        event.preventDefault();
        openList(key === 'Home' ? 'first' : 'last');
        return;
      }
    } else {
      switch (key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Home':
        case 'End':
        case 'PageDown':
        case 'PageUp':
          event.preventDefault();
          setActive((current) => moveActive(options, current, key as ListKey));
          return;
        case 'Enter':
        case ' ':
          event.preventDefault();
          choose(active);
          return;
        case 'Escape':
          // No debe cerrar también la hoja o el diálogo que contiene al selector.
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        case 'Tab':
          close();
          return;
      }
    }
    if (
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      key !== ' '
    ) {
      window.clearTimeout(typed.current.timer);
      typed.current.text += key;
      typed.current.timer = window.setTimeout(() => {
        typed.current.text = '';
      }, 700);
      if (!open) openList();
      setActive((current) => typeahead(options, typed.current.text, current));
    }
  };

  return (
    <div
      className={`cc-select ${size === 'sm' ? 'cc-select--sm' : ''} ${className}`.trim()}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className="cc-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && active >= 0 ? optionId(active) : undefined
        }
        aria-label={
          label ?? (prefix ? `${prefix}: ${selected?.label ?? ''}` : undefined)
        }
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {prefix && <span className="cc-select__prefix">{prefix}</span>}
        <span
          className={`cc-select__value ${selected ? '' : 'cc-select__value--placeholder'}`.trim()}
        >
          {selected ? (renderValue?.(selected) ?? selected.label) : placeholder}
        </span>
        <Icon name="chevD" size={18} className="cc-select__chevron" />
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {required && (
        <input
          className="cc-select__required"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={selected ? value : ''}
          onChange={() => undefined}
        />
      )}
      <Popover
        anchorRef={triggerRef}
        open={open}
        onDismiss={close}
        minWidth={180}
        desiredHeight={Math.min(options.length, 8) * 44 + 16}
        className="cc-select__pop"
      >
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="cc-select__list"
        >
          {options.map((option, index) => (
            <div
              key={`${option.value}-${index}`}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={index === active || undefined}
              className="cc-select__option"
              // El disparador conserva el foco: sin esto el clic lo movería a la lista.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => !option.disabled && setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={18} />}
            </div>
          ))}
          {options.length === 0 && (
            <div className="cc-select__empty">No hay opciones</div>
          )}
        </div>
      </Popover>
    </div>
  );
}

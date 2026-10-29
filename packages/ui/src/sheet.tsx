import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './primitives';
import { Icon } from './icons';

/** Hojas abiertas, de la más antigua a la más nueva: sólo la última atiende teclado y foco. */
const openSheets: HTMLElement[] = [];

/**
 * Hoja de diálogo: modal (centrado en tablet/escritorio) o lateral. En móvil sube desde abajo.
 * Atrapa el foco, cierra con Esc y devuelve el foco al elemento que la abrió.
 */
export function Sheet({
  open,
  onClose,
  title,
  variant = 'modal',
  size = 'md',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  variant?: 'side' | 'modal';
  /** `lg`: hoja lateral ancha para editores con varias secciones. */
  size?: 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const self = ref.current;
    if (self) openSheets.push(self);
    const onKey = (event: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== self) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = self ? openSheets.indexOf(self) : -1;
      if (at >= 0) openSheets.splice(at, 1);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={`sheet sheet--${variant} ${size === 'lg' ? 'sheet--lg' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

export interface PopoverPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

const GAP = 4;
const MARGIN = 8;

/** Calcula dónde dibujar el panel: debajo del disparador o, si no cabe, encima. */
export function placePopover(
  anchor: DOMRect,
  viewport: { width: number; height: number },
  desiredHeight: number,
  minWidth = 0,
): PopoverPosition {
  const width = Math.min(
    Math.max(anchor.width, minWidth),
    viewport.width - MARGIN * 2,
  );
  const left = Math.min(
    Math.max(MARGIN, anchor.left),
    Math.max(MARGIN, viewport.width - width - MARGIN),
  );
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  if (below >= Math.min(desiredHeight, 220) || below >= above) {
    return {
      top: anchor.bottom + GAP,
      left,
      width,
      maxHeight: Math.max(120, below),
    };
  }
  return {
    bottom: viewport.height - anchor.top + GAP,
    left,
    width,
    maxHeight: Math.max(120, above),
  };
}

/**
 * Panel flotante anclado a un disparador (lista del Select, calendario del DatePicker). Se pinta
 * en `document.body` con posición fija, de modo que ninguna hoja o tarjeta con `overflow` lo
 * recorta. En pantallas angostas pasa a ser una hoja inferior con telón (ver `.popover` en CSS).
 */
export function Popover({
  anchorRef,
  open,
  onDismiss,
  minWidth,
  desiredHeight = 320,
  className = '',
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Clic fuera, desplazamiento de la página o Escape gestionado por el hijo. */
  onDismiss: () => void;
  minWidth?: number;
  desiredHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setPosition(
      placePopover(
        anchor.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        desiredHeight,
        minWidth,
      ),
    );
  }, [anchorRef, desiredHeight, minWidth]);

  useLayoutEffect(() => {
    if (open) measure();
    else setPosition(null);
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      // Desplazar la lista interna no debe cerrar ni mover nada.
      const target = event.target as Node | null;
      if (target && target instanceof Element && target.closest('.popover'))
        return;
      measure();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const el = target instanceof Element ? target : target.parentElement;
      if (el?.closest('.popover')) return;
      if (anchorRef.current?.contains(target)) return;
      onDismiss();
      // El clic que cierra el panel no debe activar lo que hay debajo (otra hoja, un botón).
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      document.addEventListener('click', swallow, {
        capture: true,
        once: true,
      });
      window.setTimeout(
        () => document.removeEventListener('click', swallow, true),
        400,
      );
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, measure, onDismiss, anchorRef]);

  if (!open || !position || typeof document === 'undefined') return null;
  const style = {
    '--pop-top': position.top !== undefined ? `${position.top}px` : 'auto',
    '--pop-bottom':
      position.bottom !== undefined ? `${position.bottom}px` : 'auto',
    '--pop-left': `${position.left}px`,
    '--pop-width': `${position.width}px`,
    '--pop-max': `${position.maxHeight}px`,
  } as CSSProperties;
  return createPortal(
    <>
      <div className="popover-scrim" aria-hidden="true" onClick={onDismiss} />
      <div className={`popover ${className}`.trim()} style={style}>
        {children}
      </div>
    </>,
    document.body,
  );
}

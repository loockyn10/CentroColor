import { useEffect, useRef } from 'react';
import { Icon } from './icons';
import { NavHistory, browserHistoryPort, type NavEntry } from './nav-history';

let activeNav: NavHistory | null = null;

/**
 * Sincroniza el módulo activo con el historial del navegador (una vez, en la raíz de la app).
 * Atrás vuelve al módulo anterior o cierra la capa abierta; nunca saca al usuario de la app
 * mientras haya algo a lo que volver dentro de ella.
 */
export function useHistoryNavigation(
  activeId: string,
  navigate: (id: string) => void,
) {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const first = useRef(activeId);
  useEffect(() => {
    const nav = new NavHistory(browserHistoryPort());
    nav.start(first.current, (id) => navigateRef.current(id));
    activeNav = nav;
    return () => {
      nav.stopListening();
      if (activeNav === nav) activeNav = null;
    };
  }, []);
  useEffect(() => {
    activeNav?.pushModule(activeId);
  }, [activeId]);
}

/**
 * Mientras `active` sea verdadero, el botón Atrás del navegador (o el gesto del teléfono) llama
 * a `onBack` en lugar de salir de la aplicación. Lo usan `PageHeader` (con `onBack`) y `Sheet`.
 */
export function useBackLayer(active: boolean, onBack: () => void) {
  const callback = useRef(onBack);
  callback.current = onBack;
  const held = useRef<{ entry: NavEntry; timer?: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const nav = activeNav;
    if (!nav) return;
    let layer = held.current;
    if (layer && layer.timer !== undefined) {
      // Re-ejecución inmediata del efecto (StrictMode, cambio de clave): se reutiliza la entrada.
      window.clearTimeout(layer.timer);
      layer.timer = undefined;
    } else {
      layer = { entry: nav.pushLayer(() => callback.current()) };
      held.current = layer;
    }
    const mine = layer;
    return () => {
      mine.timer = window.setTimeout(() => {
        nav.releaseLayer(mine.entry);
        if (held.current === mine) held.current = null;
      }, 0);
    };
  }, [active]);
}

/**
 * «← Volver»: la forma evidente de regresar al contexto anterior cuando una pantalla reemplaza a
 * otra (listado → detalle → edición). Para hojas y diálogos se usa la «✕» de `Sheet`.
 * `label` nombra el destino sólo para lectores de pantalla («Volver a Ventas»).
 */
export function BackButton({
  onClick,
  label,
  className = '',
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`back-button ${className}`.trim()}
      aria-label={label ? `Volver a ${label}` : undefined}
      onClick={onClick}
    >
      <Icon name="chevL" size={20} />
      <span>Volver</span>
    </button>
  );
}

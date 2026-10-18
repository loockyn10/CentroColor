import { useEffect } from 'react';
import { loadRememberedOrder } from './model';

/**
 * /imprimir/recibido is the address shown right after confirming an order. If the page is
 * reloaded the in-memory confirmation is gone, so the visitor goes to the tracking page of the
 * order this browser last placed (or back to the order form when there is none).
 */
export function ReceivedRedirect() {
  useEffect(() => {
    const last = loadRememberedOrder();
    window.location.replace(
      last ? `/pedido/${encodeURIComponent(last.trackingToken)}` : '/imprimir',
    );
  }, []);
  return (
    <p role="status" style={{ padding: 24 }}>
      Cargando…
    </p>
  );
}

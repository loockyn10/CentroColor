import { useCallback, useEffect, useState } from 'react';
import { PublicOrderError, trackOrder, type TrackedOrder } from './client';
import {
  formatMoney,
  trackingHeadline,
  trackingNote,
  trackingStepIndex,
  trackingSteps,
} from './model';
import { PublicShell, useDocumentMeta } from './shell';
import './public-order.css';

const REFRESH_MS = 60_000;

/**
 * /pedido/:token — read-only status of one order. The token is a tracking capability: it
 * cannot add or change files, and the page never shows internal data (ids, notes, costs,
 * storage, other customers).
 */
export function OrderTracking({ token }: { token: string }) {
  useDocumentMeta('Estado de tu pedido · CentroColor', true);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<{
    message: string;
    invalid: boolean;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setOrder(await trackOrder(token));
      setError(null);
    } catch (cause) {
      const invalid =
        cause instanceof PublicOrderError &&
        ['link_invalid', 'link_revoked', 'link_expired'].includes(
          cause.code ?? '',
        );
      setError({
        invalid,
        message: invalid
          ? 'Este link no es válido o ya venció. Si tenés dudas, escribinos.'
          : cause instanceof Error
            ? cause.message
            : 'No se pudo consultar el pedido.',
      });
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!order)
    return (
      <PublicShell>
        {error ? (
          <section className="po-card po-center">
            <h2>No pudimos mostrar el pedido</h2>
            <p>{error.message}</p>
            {!error.invalid && (
              <button className="po-primary" onClick={() => void load()}>
                Reintentar
              </button>
            )}
          </section>
        ) : (
          <p className="po-center" role="status">
            Cargando…
          </p>
        )}
      </PublicShell>
    );

  const index = trackingStepIndex(order.status);
  return (
    <PublicShell businessName={order.businessName}>
      <section
        className={`po-card po-track po-track-${order.status}`}
        aria-live="polite"
      >
        <small className="po-hint">Pedido</small>
        <h2 className="po-code">{order.orderCode}</h2>
        <p className="po-headline">{trackingHeadline(order.status)}</p>
        {order.status !== 'cancelled' && (
          <ol className="po-steps" aria-label="Avance del pedido">
            {trackingSteps.map((step, i) => (
              <li
                key={step.status}
                className={
                  i < index ? 'po-step-done' : i === index ? 'po-step-now' : ''
                }
                aria-current={i === index ? 'step' : undefined}
              >
                <span>{i < index ? '✓' : i + 1}</span>
                {step.label}
              </li>
            ))}
          </ol>
        )}
        <p>{trackingNote(order.status)}</p>
        {error && !error.invalid && (
          <p className="po-error">
            No pudimos actualizar el estado. Mostramos el último dato conocido.
          </p>
        )}
        <dl className="po-facts">
          <dt>Fecha</dt>
          <dd>
            {new Date(order.createdAt).toLocaleDateString('es-AR', {
              dateStyle: 'long',
            })}
          </dd>
        </dl>
        <ul className="po-summary">
          {order.items.map((item) => (
            <li key={item.name}>
              <span>
                {item.name} · {item.quantity}{' '}
                {item.quantity === 1 ? 'copia' : 'copias'}
              </span>
              <b>{formatMoney(item.totalCents)}</b>
            </li>
          ))}
          <li className="po-total">
            <span>TOTAL</span>
            <b>{formatMoney(order.totalCents)}</b>
          </li>
        </ul>
        <button
          className="po-secondary"
          disabled={refreshing}
          onClick={() => void load()}
        >
          {refreshing ? 'Actualizando…' : 'Actualizar estado'}
        </button>
        <small className="po-hint">
          El pago se realiza en el local al retirar.
        </small>
      </section>
    </PublicShell>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Button, Icon, type IconName } from '@centrocolor/ui';
import { PublicOrderError, trackOrder, type TrackedOrder } from './client';
import {
  formatMoney,
  paymentNote,
  trackingHeadline,
  trackingNote,
  trackingStepIndex,
  trackingSteps,
  type TrackedStatus,
} from './model';
import { PublicShell, useDocumentMeta } from './shell';
import './public-order.css';

const REFRESH_MS = 60_000;

const stepIcon: Record<TrackedStatus, IconName> = {
  received: 'receipt',
  in_progress: 'printer',
  ready: 'check',
  delivered: 'store',
  cancelled: 'x',
};

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
        <div className="pt-page">
          {error ? (
            <section className="po-card po-center">
              <h2>No pudimos mostrar el pedido</h2>
              <p>{error.message}</p>
              {!error.invalid && (
                <Button variant="primary" onClick={() => void load()}>
                  Reintentar
                </Button>
              )}
            </section>
          ) : (
            <p className="po-center pad" role="status">
              Cargando…
            </p>
          )}
        </div>
      </PublicShell>
    );

  const index = trackingStepIndex(order.status);
  const ready = order.status === 'ready';
  return (
    <PublicShell businessName={order.businessName}>
      <div className="pt-page" aria-live="polite">
        <div className="state-head">
          <p className="frame-tag">{order.orderCode}</p>
          {!ready && <h1>{trackingHeadline(order.status)}</h1>}
        </div>

        {ready && (
          <section className="ready" aria-label="Tu pedido está listo">
            <div className="ready-in">
              <span className="stamp" aria-hidden="true">
                <Icon name="check" />
              </span>
              <h2>{trackingHeadline(order.status)}</h2>
              <p>{trackingNote(order.status)}</p>
            </div>
          </section>
        )}

        {order.status !== 'cancelled' && (
          <section className="po-card" aria-label="Avance del pedido">
            <ol className="tl tl--h">
              {trackingSteps.map((step, i) => {
                const state =
                  i < index ? 'done' : i === index ? 'current' : 'todo';
                return (
                  <li
                    key={step.status}
                    data-s={state}
                    aria-current={i === index ? 'step' : undefined}
                  >
                    <span className="node">
                      <Icon
                        name={
                          state === 'done' ? 'check' : stepIcon[step.status]
                        }
                      />
                    </span>
                    <span className="txt">
                      <strong>{step.label}</strong>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {!ready && <p className="state-note">{trackingNote(order.status)}</p>}
        {error && !error.invalid && (
          <p className="po-error">
            No pudimos actualizar el estado. Mostramos el último dato conocido.
          </p>
        )}

        <section className="po-card">
          <p className="meta">
            {new Date(order.createdAt).toLocaleDateString('es-AR', {
              dateStyle: 'long',
            })}
          </p>
          <ul className="order-lines">
            {order.items.map((item) => (
              <li key={item.name}>
                <span className="sz">{item.name}</span>
                <span className="meta">
                  {item.quantity} {item.quantity === 1 ? 'copia' : 'copias'}
                </span>
                <b className="num">{formatMoney(item.totalCents)}</b>
              </li>
            ))}
          </ul>
          <p className="order-total">
            <span>TOTAL</span>
            <b className="num">{formatMoney(order.totalCents)}</b>
          </p>
          <p className="fine">
            <Icon name="info" />
            <span>{paymentNote}</span>
          </p>
        </section>

        <div className="row-actions">
          <Button
            icon="refresh"
            disabled={refreshing}
            onClick={() => void load()}
          >
            {refreshing ? 'Actualizando…' : 'Actualizar estado'}
          </Button>
        </div>
      </div>
    </PublicShell>
  );
}

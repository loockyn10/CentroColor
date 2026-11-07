import { useEffect, type ReactNode } from 'react';
import { FilmStrip, Icon, Logo } from '@centrocolor/ui';
import { loadRememberedOrder } from './model';
import './public-order.css';

/** Title and robots policy for a public page. Tracking pages must never be indexed. */
export function useDocumentMeta(title: string, noindex: boolean) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    if (noindex) document.head.appendChild(meta);
    return () => {
      document.title = previous;
      if (noindex) meta.remove();
    };
  }, [title, noindex]);
}

/**
 * Storefront chrome: brand header over the yellow band (optionally with the hero), film strip
 * and footer. No administrative navigation. «Mi pedido» only appears when this browser has
 * already placed an order.
 */
export function PublicShell({
  children,
  businessName,
  hero,
  orderLink = true,
  homeHref = '/imprimir',
  subtitle = 'Laboratorio fotográfico',
  actions,
}: {
  children: ReactNode;
  businessName?: string;
  hero?: ReactNode;
  /** «Mi pedido» (sólo si este navegador ya hizo un pedido). Se oculta en el link de subida. */
  orderLink?: boolean;
  /** Where the brand leads: `/imprimir`, or `/profesionales` for the professional portal. */
  homeHref?: string;
  subtitle?: string;
  /** Extra header actions (e.g. «Salir» in the professional portal). */
  actions?: ReactNode;
}) {
  const name = businessName || 'CentroColor';
  const last =
    !orderLink || typeof window === 'undefined' ? null : loadRememberedOrder();
  return (
    <div className="portal">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div className="pt-top on-yellow">
        <header className="pt-head">
          <a
            className="pt-brand"
            href={homeHref}
            aria-label={`${name}, inicio`}
          >
            <Logo size={60} decorative />
            <span>
              <strong>{name}</strong>
              <small>{subtitle}</small>
            </span>
          </a>
          {(last || actions) && (
            <nav className="pt-nav" aria-label="Accesos">
              {last && (
                <a
                  className="btn btn--sm"
                  href={`/pedido/${last.trackingToken}`}
                >
                  <Icon name="receipt" />
                  <span>Mi pedido</span>
                </a>
              )}
              {actions}
            </nav>
          )}
        </header>
        {hero}
      </div>
      <FilmStrip tone="yellow" />
      <main id="contenido">{children}</main>
      <footer className="pt-foot on-dark">
        <div className="pt-foot-in">
          <Logo size={56} decorative />
          <strong>{name} · Revelado e impresión de fotos</strong>
          <a className="pt-foot-link" href="/privacidad">
            Política de privacidad
          </a>
        </div>
      </footer>
    </div>
  );
}

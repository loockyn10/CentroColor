import type { ReactNode } from 'react';
import { Link } from '../router';
import { Icon } from '../icons';
import { FilmStrip, Logo } from '../ui';
import { STORE } from '../data';

/** Cabecera + cinta de película + pie. Sin navegación administrativa. */
export function PortalShell({
  children,
  hero,
  nav = true,
}: {
  children: ReactNode;
  hero?: ReactNode;
  nav?: boolean;
}) {
  return (
    <div className="portal">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div className="preview-strip">
        <span>Design preview · datos simulados</span>
        <span>
          <Link to="/">Índice</Link> · <Link to="/panel">Panel interno</Link>
        </span>
      </div>
      <div className="pt-top on-yellow">
        <header className="pt-head">
          <Link
            to="/imprimir"
            className="pt-brand"
            aria-label="CentroColor, inicio"
          >
            <Logo size={60} />
            <span>
              <strong>CentroColor</strong>
              <small>Laboratorio fotográfico</small>
            </span>
          </Link>
          {nav && (
            <nav className="pt-nav" aria-label="Accesos">
              <Link to="/pedido/demo" className="btn btn--sm">
                <Icon name="receipt" />
                <span className="label-long">Seguir mi pedido</span>
                <span className="label-short">Mi pedido</span>
              </Link>
            </nav>
          )}
        </header>
        {hero}
      </div>
      <FilmStrip tone="yellow" />
      <main id="contenido">{children}</main>
      <footer className="pt-foot on-dark">
        <div className="pt-foot-in">
          <Logo size={64} />
          <div>
            <strong>CentroColor · {STORE.tagline}</strong>
            <p>
              {STORE.address} · {STORE.hours}
            </p>
            <p>WhatsApp {STORE.whatsapp}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

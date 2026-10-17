import { Icon } from '../icons';
import { Link, navigate } from '../router';
import { Button, FilmStrip, Logo } from '../ui';

/** Pantalla de acceso SIMULADA: no valida ni envía nada. No ingreses credenciales reales. */
export function Login() {
  return (
    <div className="login">
      <aside className="login-art on-yellow" aria-hidden="false">
        <div className="login-art-in">
          <Logo size={260} className="login-logo" />
          <h1>
            Fotografía, <span className="marker">laboratorio</span> y
            marquetería.
          </h1>
          <p>El panel de trabajo de CentroColor.</p>
        </div>
        <FilmStrip tone="dark" />
      </aside>
      <main className="login-form">
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            navigate('/panel');
          }}
        >
          <Link to="/" className="frame-tag">
            Design preview · acceso simulado
          </Link>
          <h2>Ingresá a tu cuenta</h2>
          <div className="field">
            <label htmlFor="em">Email</label>
            <input
              id="em"
              className="input"
              type="email"
              autoComplete="off"
              placeholder="nombre@centrocolor.example"
            />
          </div>
          <div className="field">
            <label htmlFor="pw">Contraseña</label>
            <input
              id="pw"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="••••••••"
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            block
            type="submit"
            iconAfter="chevR"
          >
            Entrar al panel
          </Button>
          <div className="notice">
            <Icon name="info" />
            <span>
              Es una maqueta: el botón entra directo al panel sin validar nada.
              No escribas credenciales reales.
            </span>
          </div>
          <Link to="/imprimir" className="btn btn--ghost btn--block">
            <Icon name="globe" /> Ver el portal público
          </Link>
        </form>
      </main>
    </div>
  );
}

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@centrocolor/ui';
import { getSupabaseClient } from '../cloud-config';
import { describeWebAuthError } from '../auth-errors';
import { PublicShell, useDocumentMeta } from '../public-order/shell';
import '../public-order/public-order.css';
import { passwordProblem, parseAuthHash, PASSWORD_MIN_LENGTH } from './model';
import { ProfessionalOrder } from './order-portal';
import './professional.css';

type Stage = 'loading' | 'login' | 'set-password' | 'ready' | 'error';

/**
 * /profesionales. Identification comes first: nothing about prices or orders is requested before
 * a signed-in session exists, and the server then decides whether that user is a professional.
 * The session is the same Supabase one the panel uses, but a professional has no membership, so
 * the panel shows them "sin acceso" and its tables return nothing.
 */
export function ProfessionalPortal() {
  useDocumentMeta('Portal profesional · CentroColor', true);
  const [stage, setStage] = useState<Stage>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let client: SupabaseClient;
    try {
      client = getSupabaseClient();
    } catch (cause) {
      setMessage(describeWebAuthError(cause, 'configuration'));
      setStage('error');
      return;
    }
    const subscription = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && live) setStage('login');
    });
    void (async () => {
      try {
        // An invitation or password-reset e-mail lands here with the session in the fragment.
        const link = parseAuthHash(window.location.hash);
        if (link) {
          window.history.replaceState(null, '', window.location.pathname);
          if (link.error || !link.accessToken || !link.refreshToken) {
            if (live) {
              setMessage(
                'El enlace venció o ya se usó. Pedí uno nuevo desde «Olvidé mi contraseña».',
              );
              setStage('login');
            }
            return;
          }
          const { error } = await client.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
          if (!live) return;
          if (error) {
            setMessage(describeWebAuthError(error, 'authentication'));
            setStage('login');
          } else
            setStage(
              link.type === 'invite' || link.type === 'recovery'
                ? 'set-password'
                : 'ready',
            );
          return;
        }
        const { data } = await client.auth.getSession();
        if (live) setStage(data.session ? 'ready' : 'login');
      } catch (cause) {
        if (live) {
          setMessage(describeWebAuthError(cause, 'authentication'));
          setStage('error');
        }
      }
    })();
    return () => {
      live = false;
      subscription.data.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await getSupabaseClient().auth.signOut({ scope: 'local' });
    } catch {
      /* the local session is dropped either way */
    }
    setMessage(null);
    setStage('login');
  };

  if (stage === 'ready')
    return <ProfessionalOrder onSignOut={() => void signOut()} />;

  return (
    <PublicShell
      homeHref="/profesionales"
      subtitle="Portal profesional"
      orderLink={false}
    >
      <div className="pt-page">
        {stage === 'loading' && (
          <p className="po-center pad" role="status">
            Cargando…
          </p>
        )}
        {stage === 'error' && (
          <section className="po-card po-center">
            <h2>No pudimos abrir el portal</h2>
            <p>{message}</p>
          </section>
        )}
        {stage === 'login' && (
          <Login
            notice={message}
            onSignedIn={() => {
              setMessage(null);
              setStage('ready');
            }}
          />
        )}
        {stage === 'set-password' && (
          <SetPassword onDone={() => setStage('ready')} />
        )}
      </div>
    </PublicShell>
  );
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="po-card pro-auth">
    <h1>{title}</h1>
    {children}
  </section>
);

function Login({
  notice,
  onSignedIn,
}: {
  notice: string | null;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { error: failure } =
        await getSupabaseClient().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
      if (failure) setError(describeWebAuthError(failure, 'authentication'));
      else onSignedIn();
    } catch (cause) {
      setError(describeWebAuthError(cause, 'authentication'));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Escribí tu e-mail y volvé a tocar «Olvidé mi contraseña».');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/profesionales`,
      });
    } catch {
      /* the answer is the same whether or not the address exists */
    }
    setInfo(
      'Si ese e-mail tiene una cuenta, te enviamos un enlace para elegir una contraseña nueva.',
    );
    setBusy(false);
  }

  return (
    <Card title="Ingresá a tu cuenta">
      <p>Portal para fotógrafos profesionales y clientes con convenio.</p>
      <form
        className="pro-form"
        onSubmit={(event) => void signIn(event)}
        noValidate
      >
        <label className="field">
          <span>E-mail</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {(error ?? notice) && (
          <p className="po-error" role="alert">
            {error ?? notice}
          </p>
        )}
        {info && <p role="status">{info}</p>}
        <Button
          variant="primary"
          size="lg"
          block
          type="submit"
          disabled={busy || !email.trim() || !password}
        >
          Ingresar
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => void forgot()}
        >
          Olvidé mi contraseña
        </Button>
      </form>
      <p className="fine">
        ¿Todavía no tenés acceso? Pedíselo a CentroColor: lo habilitamos con tu
        e-mail.
      </p>
    </Card>
  );
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await getSupabaseClient().auth.updateUser({
        password,
      });
      if (failure)
        setError('No pudimos guardar la contraseña. Probá con otra.');
      else onDone();
    } catch {
      setError('No pudimos guardar la contraseña. Revisá tu conexión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Elegí tu contraseña">
      <p>La vas a usar para ingresar al portal profesional.</p>
      <form
        className="pro-form"
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <label className="field">
          <span>Contraseña nueva</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Repetila</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        {error && (
          <p className="po-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" size="lg" block type="submit" disabled={busy}>
          Guardar y entrar
        </Button>
      </form>
    </Card>
  );
}

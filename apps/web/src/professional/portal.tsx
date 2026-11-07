import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@centrocolor/ui';
import { getSupabaseClient } from '../cloud-config';
import { describeWebAuthError } from '../auth-errors';
import { PublicShell, useDocumentMeta } from '../public-order/shell';
import '../public-order/public-order.css';
import { passwordProblem, parseAuthHash, PASSWORD_MIN_LENGTH } from './model';
import { errorCode } from '../public-order/order-submission';
import { fetchProfessionalCatalog, isSessionExpired } from './client';
import { ProfessionalOrder } from './order-portal';
import './professional.css';

type Stage =
  'loading' | 'login' | 'set-password' | 'account' | 'request' | 'error';

/**
 * /profesionales is PUBLIC: anyone lands directly on the order form, with no session, invitation or
 * account, and sees no price (the server never sends one to them). An optional professional login is
 * kept for people with an account: only after the server confirms that the signed-in user IS an
 * active professional does the page switch to their own price list. Any other session (a CentroColor
 * administrator, a user without a professional account) gets the same price-free form: being signed
 * in never grants professional access.
 */
export function ProfessionalPortal() {
  useDocumentMeta('Portal profesional · CentroColor', true);
  const [stage, setStage] = useState<Stage>('loading');
  const [message, setMessage] = useState<string | null>(null);

  /** Asks the server which kind of visitor the current session is. */
  async function resolveStage(): Promise<'account' | 'request'> {
    try {
      await fetchProfessionalCatalog();
      return 'account';
    } catch (error) {
      if (isSessionExpired(error)) {
        try {
          await getSupabaseClient().auth.signOut({ scope: 'local' });
        } catch {
          /* the local session is dropped either way */
        }
        return 'request';
      }
      const code = errorCode(error);
      if (code === 'not_professional' || code === 'account_inactive')
        return 'request';
      throw error;
    }
  }

  async function proceed(afterLogin: boolean) {
    try {
      const next = await resolveStage();
      if (next === 'request' && afterLogin)
        setMessage(
          'Esa cuenta no tiene acceso profesional. Podés enviar tus fotografías igual, sin iniciar sesión.',
        );
      else setMessage(null);
      setStage(next);
    } catch (cause) {
      setMessage(describeWebAuthError(cause, 'authentication'));
      setStage('error');
    }
  }

  useEffect(() => {
    let live = true;
    let client: SupabaseClient | null = null;
    try {
      client = getSupabaseClient();
    } catch {
      // Without Supabase configured the public form cannot work either, but the page still opens.
      setStage('request');
      return;
    }
    const subscription = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && live)
        setStage((current) => (current === 'account' ? 'request' : current));
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
          } else if (link.type === 'invite' || link.type === 'recovery')
            setStage('set-password');
          else await proceed(false);
          return;
        }
        const { data } = await client.auth.getSession();
        if (!live) return;
        if (data.session) await proceed(false);
        else setStage('request');
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
    setStage('request');
  };

  if (stage === 'account')
    return (
      <ProfessionalOrder mode="account" onSignOut={() => void signOut()} />
    );
  if (stage === 'request')
    return (
      <ProfessionalOrder
        key="request"
        mode="request"
        initialNotice={message}
        onSignOut={() => void signOut()}
        onSignIn={() => {
          setMessage(null);
          setStage('login');
        }}
      />
    );

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
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reintentar
            </Button>
            <Button variant="ghost" onClick={() => setStage('request')}>
              Enviar fotografías sin iniciar sesión
            </Button>
          </section>
        )}
        {stage === 'login' && (
          <Login
            notice={message}
            onSignedIn={() => {
              setMessage(null);
              setStage('loading');
              void proceed(true);
            }}
            onSkip={() => {
              setMessage(null);
              setStage('request');
            }}
          />
        )}
        {stage === 'set-password' && (
          <SetPassword
            onDone={() => {
              setStage('loading');
              void proceed(true);
            }}
          />
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
  onSkip,
}: {
  notice: string | null;
  onSignedIn: () => void;
  onSkip: () => void;
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
      <p>
        Con tu cuenta profesional o de convenio ves tus precios. Si todavía no
        tenés una, no hace falta: podés enviar tus fotografías igual.
      </p>
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
        <Button variant="secondary" type="button" onClick={onSkip}>
          Enviar fotografías sin iniciar sesión
        </Button>
      </form>
      <p className="fine">
        ¿Querés una cuenta con tus precios? Pedíselo a CentroColor: la
        habilitamos con tu e-mail.
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

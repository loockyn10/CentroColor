import {
  createContext,
  useContext,
  useState,
  type FormEvent,
  type PropsWithChildren,
} from 'react';
import type { BusinessContext } from '@centrocolor/application';
import { Card, PageHeader } from '@centrocolor/ui';

const Context = createContext<BusinessContext | null>(null);

export function BusinessContextProvider({
  context,
  children,
}: PropsWithChildren<{ context: BusinessContext }>) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useBusinessContext(): BusinessContext {
  const context = useContext(Context);
  if (!context) throw new Error('BusinessContext is unavailable');
  return context;
}

export function LoginPage({
  onLogin,
  busy,
  error,
  offlineAvailable,
  onUseOffline,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  busy: boolean;
  error: string | null;
  offlineAvailable?: boolean;
  onUseOffline?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onLogin(email.trim(), password);
  }
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">C</span>
        <strong>CentroColor</strong>
      </div>
      <Card className="auth-card">
        <PageHeader
          eyebrow="ACCESO"
          title="Iniciar sesión"
          description="Ingresá con tu cuenta de CentroColor."
        />
        <form onSubmit={submit} className="auth-form">
          <label>
            Correo electrónico
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>
        {offlineAvailable && (
          <p className="auth-hint">
            El acceso offline usa el último contexto validado en este equipo.
          </p>
        )}
        {offlineAvailable && onUseOffline && (
          <button type="button" className="auth-link" onClick={onUseOffline}>
            Continuar en modo offline
          </button>
        )}
      </Card>
    </div>
  );
}

export function AuthStatePage({
  title,
  message,
  onLogout,
}: {
  title: string;
  message: string;
  onLogout?: () => void;
}) {
  return (
    <div className="auth-page">
      <Card className="auth-card">
        <PageHeader eyebrow="CENTROCOLOR" title={title} description={message} />
        {onLogout && (
          <button className="auth-submit" onClick={onLogout}>
            Cerrar sesión
          </button>
        )}
      </Card>
    </div>
  );
}

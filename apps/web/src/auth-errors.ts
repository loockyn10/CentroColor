import { SupabaseConfigurationError } from './supabase-config';

export type AuthStage = 'configuration' | 'authentication' | 'membership';

function errorDetails(error: unknown): {
  name?: string;
  status?: number;
  code?: string;
} {
  if (!error || typeof error !== 'object') return {};
  const value = error as { name?: unknown; status?: unknown; code?: unknown };
  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
    code: typeof value.code === 'string' ? value.code : undefined,
  };
}

export function describeWebAuthError(error: unknown, stage: AuthStage): string {
  if (error instanceof SupabaseConfigurationError) return error.message;
  const { name, status, code } = errorDetails(error);
  if (stage === 'authentication' && status === 400) {
    return 'No se pudo iniciar sesión. Revisá el correo y la contraseña.';
  }
  if (stage === 'authentication' && status === 429) {
    return 'Demasiados intentos. Esperá unos minutos y volvé a probar.';
  }
  if (name === 'AuthRetryableFetchError') {
    return 'No se pudo contactar a Supabase. Revisá la conexión e intentá de nuevo.';
  }
  if (stage === 'membership' || code === '42501') {
    return 'No se pudo consultar el acceso asignado. Contactá a un administrador.';
  }
  if (stage === 'configuration') {
    return 'No se pudo inicializar Supabase. Revisá la configuración del build Web.';
  }
  return 'Ocurrió un error inesperado al iniciar sesión. Intentá de nuevo.';
}

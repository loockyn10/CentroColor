export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigurationError';
  }
}

export function parseSupabaseConfig(
  rawUrl: string | undefined,
  rawPublishableKey: string | undefined,
): { url: string; publishableKey: string } {
  const url = rawUrl?.trim();
  const publishableKey = rawPublishableKey?.trim();
  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError(
      'Falta configurar VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el build Web.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SupabaseConfigurationError(
      'VITE_SUPABASE_URL no es una URL válida. Revisá el valor configurado para el build Web.',
    );
  }
  if (
    (parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname)
      )) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new SupabaseConfigurationError(
      'VITE_SUPABASE_URL debe ser la URL HTTPS del proyecto Supabase (HTTP solo en localhost).',
    );
  }
  if (
    !publishableKey.startsWith('sb_publishable_') ||
    /\s/.test(publishableKey) ||
    publishableKey === 'sb_publishable_'
  ) {
    throw new SupabaseConfigurationError(
      'VITE_SUPABASE_PUBLISHABLE_KEY debe contener una clave pública sb_publishable_ válida.',
    );
  }
  return { url, publishableKey };
}

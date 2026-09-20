import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    throw new Error(
      'Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY',
    );
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' &&
    !(
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(parsed.hostname)
    )
  ) {
    throw new Error('VITE_SUPABASE_URL debe usar HTTPS, excepto localhost');
  }
  client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

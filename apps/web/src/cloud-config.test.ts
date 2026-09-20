import { afterEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

import { getSupabaseClient } from './cloud-config';
import {
  parseSupabaseConfig,
  SupabaseConfigurationError,
} from './supabase-config';

afterEach(() => vi.unstubAllEnvs());

describe('Web Supabase configuration', () => {
  it('rejects missing, malformed and non-publishable values before creating a client', () => {
    expect(() => parseSupabaseConfig(undefined, undefined)).toThrow(
      SupabaseConfigurationError,
    );
    expect(() =>
      parseSupabaseConfig('not-a-url', 'sb_publishable_test'),
    ).toThrow('VITE_SUPABASE_URL no es una URL válida');
    expect(() =>
      parseSupabaseConfig(
        'VITE_SUPABASE_URL=https://example.supabase.co',
        'sb_publishable_test',
      ),
    ).toThrow('VITE_SUPABASE_URL no es una URL válida');
    expect(() =>
      parseSupabaseConfig('https://example.supabase.co', 'sb_secret_test'),
    ).toThrow('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(() =>
      parseSupabaseConfig(
        'https://example.supabase.co',
        'sb_publishable_part1\npart2',
      ),
    ).toThrow('VITE_SUPABASE_PUBLISHABLE_KEY');
    vi.stubEnv('VITE_SUPABASE_URL', 'not-a-url');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    expect(() => getSupabaseClient()).toThrow(SupabaseConfigurationError);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('passes Vite values to createClient without changing the public key', () => {
    const url = 'https://example.supabase.co';
    const key = 'sb_publishable_test_public_value';
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key);
    getSupabaseClient();
    expect(createClientMock).toHaveBeenCalledWith(
      url,
      key,
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: true }),
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { describeWebAuthError } from './auth-errors';
import { SupabaseConfigurationError } from './supabase-config';

describe('Web login errors', () => {
  it('shows a configuration error instead of calling it a network failure', () => {
    expect(
      describeWebAuthError(
        new SupabaseConfigurationError('Falta configuración'),
        'configuration',
      ),
    ).toBe('Falta configuración');
  });
  it('distinguishes credentials, network, membership and unexpected failures', () => {
    expect(describeWebAuthError({ status: 400 }, 'authentication')).toMatch(
      /correo y la contraseña/,
    );
    expect(
      describeWebAuthError(
        { name: 'AuthRetryableFetchError' },
        'authentication',
      ),
    ).toMatch(/contactar a Supabase/);
    expect(describeWebAuthError({ code: '42501' }, 'membership')).toMatch(
      /acceso asignado/,
    );
    expect(
      describeWebAuthError(new TypeError('before request'), 'authentication'),
    ).toMatch(/error inesperado/);
  });
});

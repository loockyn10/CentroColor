import { describe, expect, it } from 'vitest';
import {
  googleCredentials,
  inspectIntakeConfig,
  intakeConfig,
  type GetEnv,
} from './config';
import { ENV } from './test-support';

const env =
  (overrides: Record<string, string | undefined> = {}): GetEnv =>
  (name) =>
    ({ ...ENV, ...overrides })[name];

describe('validación de secrets del módulo de archivos', () => {
  it('acepta la configuración documentada y normaliza la URL pública', () => {
    expect(intakeConfig(env())).toEqual({
      webBaseUrl: 'https://centro-color-web.vercel.app',
      signingSecret: ENV.PHOTO_UPLOAD_SIGNING_SECRET,
      linkDays: 14,
      maxBytes: 2147483648,
    });
    expect(
      intakeConfig(
        env({ PUBLIC_WEB_URL: 'https://centro-color-web.vercel.app/' }),
      ).webBaseUrl,
    ).toBe('https://centro-color-web.vercel.app');
  });

  it('PUBLIC_WEB_URL cae a WEB_APP_URL y los opcionales tienen defaults', () => {
    const config = intakeConfig(
      env({
        PUBLIC_WEB_URL: undefined,
        PHOTO_UPLOAD_LINK_DAYS: undefined,
        PHOTO_UPLOAD_MAX_BYTES: undefined,
      }),
    );
    expect(config.webBaseUrl).toBe('https://centro-color-web.vercel.app');
    expect(config.linkDays).toBe(14);
    expect(config.maxBytes).toBe(2 * 1024 ** 3);
  });

  it.each([
    ['PHOTO_UPLOAD_SIGNING_SECRET', undefined, 'missing'],
    ['PHOTO_UPLOAD_SIGNING_SECRET', 'corto', 'invalid'],
    [
      'PHOTO_UPLOAD_SIGNING_SECRET',
      'REEMPLAZAR-POR-32-BYTES-ALEATORIOS-O-MAS',
      'invalid',
    ],
    ['PUBLIC_WEB_URL', 'centro-color-web.vercel.app', 'invalid'],
    ['PUBLIC_WEB_URL', 'http://centro-color-web.vercel.app', 'invalid'],
    ['PUBLIC_WEB_URL', 'https://x.app/?a=b', 'invalid'],
    ['PHOTO_UPLOAD_LINK_DAYS', 'dos', 'invalid'],
    ['PHOTO_UPLOAD_LINK_DAYS', '0', 'invalid'],
    ['PHOTO_UPLOAD_LINK_DAYS', '365', 'invalid'],
    ['PHOTO_UPLOAD_MAX_BYTES', '2GB', 'invalid'],
    ['PHOTO_UPLOAD_MAX_BYTES', '-5', 'invalid'],
    ['PHOTO_UPLOAD_MAX_BYTES', '1.5', 'invalid'],
  ])('%s=%s -> %s', (name, value, reason) => {
    const overrides: Record<string, string | undefined> = { [name]: value };
    if (name === 'PUBLIC_WEB_URL') overrides.WEB_APP_URL = undefined;
    const { problems, config } = inspectIntakeConfig(env(overrides));
    expect(config).toBeNull();
    expect(problems).toEqual([{ name, reason }]);
  });

  it('el error enumera nombres pero jamás valores', () => {
    try {
      intakeConfig(env({ PHOTO_UPLOAD_MAX_BYTES: 'secreto-raro-123' }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        status: 500,
        code: 'server_misconfigured',
      });
      expect((error as Error).message).toContain('PHOTO_UPLOAD_MAX_BYTES');
      expect((error as Error).message).not.toContain('secreto-raro-123');
    }
  });

  it('localhost se admite por http para desarrollo', () => {
    expect(
      intakeConfig(env({ PUBLIC_WEB_URL: 'http://localhost:5173' })).webBaseUrl,
    ).toBe('http://localhost:5173');
  });

  it('credenciales de Google: exige client id y secret', () => {
    expect(googleCredentials(env())).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    expect(() =>
      googleCredentials(env({ GOOGLE_DRIVE_CLIENT_SECRET: undefined })),
    ).toThrowError(/GOOGLE_DRIVE_CLIENT_SECRET/);
  });
});

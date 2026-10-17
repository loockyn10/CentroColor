import { describe, expect, it } from 'vitest';
import {
  describeNotificationFailure,
  latestNotification,
  type PhotoJobNotification,
} from './whatsapp';

const notice = (
  id: string,
  createdAt: string,
  patch: Partial<PhotoJobNotification> = {},
): PhotoJobNotification => ({
  id,
  status: 'sent',
  triggerKind: 'auto',
  attemptCount: 1,
  lastError: null,
  lastErrorCode: null,
  sentAt: null,
  createdAt,
  ...patch,
});

describe('avisos de WhatsApp en la ficha del trabajo', () => {
  it('el aviso vigente es el más reciente (un reenvío reemplaza al automático en pantalla)', () => {
    const auto = notice('a', '2026-10-18T10:00:00Z');
    const resend = notice('b', '2026-10-18T11:00:00Z', {
      triggerKind: 'manual_resend',
    });
    expect(latestNotification([resend, auto])?.id).toBe('b');
    expect(latestNotification([])).toBeNull();
  });

  it('explica los fallos conocidos con un texto útil y sin secretos', () => {
    expect(
      describeNotificationFailure({
        lastError: 'x',
        lastErrorCode: 'integration_not_configured',
      }),
    ).toMatch(/Configuración → Integraciones/);
    expect(
      describeNotificationFailure({
        lastError: 'x',
        lastErrorCode: 'token_invalid',
      }),
    ).toMatch(/token/i);
    expect(
      describeNotificationFailure({
        lastError: 'x',
        lastErrorCode: 'template_not_found',
      }),
    ).toMatch(/plantilla/i);
  });

  it('para un código desconocido usa el mensaje del servidor o uno genérico', () => {
    expect(
      describeNotificationFailure({
        lastError: 'Meta rechazó la solicitud (código 999).',
        lastErrorCode: 'meta_error',
      }),
    ).toBe('Meta rechazó la solicitud (código 999).');
    expect(
      describeNotificationFailure({ lastError: null, lastErrorCode: null }),
    ).toBe('No se pudo enviar el aviso.');
  });
});

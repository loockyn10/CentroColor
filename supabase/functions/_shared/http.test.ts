import { describe, expect, it, vi } from 'vitest';
import { DatabaseError } from './diagnostics';
import { ApiError, GENERIC_ERROR_MESSAGE, body, errorResponse } from './http';

describe('errorResponse', () => {
  it('ApiError conserva status, código y mensaje curado', async () => {
    const response = errorResponse(
      new ApiError(
        'Google Drive no está conectado.',
        409,
        'drive_not_connected',
      ),
      { requestId: 'r1' },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Google Drive no está conectado.',
      code: 'drive_not_connected',
      requestId: 'r1',
    });
  });

  it('un error de base de datos se loguea completo pero el cliente sólo ve un mensaje genérico', async () => {
    const logger = vi.fn();
    const response = errorResponse(
      new DatabaseError('photo_jobs.get', {
        code: '42501',
        message: 'permission denied for table photo_jobs',
      }),
      { requestId: 'r2', logger, context: 'ctx' },
    );
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toEqual({
      error: GENERIC_ERROR_MESSAGE,
      code: 'database_error',
      requestId: 'r2',
    });
    expect(JSON.stringify(payload)).not.toContain('photo_jobs');
    expect(logger).toHaveBeenCalledWith(
      'error',
      'ctx_database_error',
      expect.objectContaining({
        operation: 'photo_jobs.get',
        databaseError: expect.objectContaining({ code: '42501' }),
      }),
    );
  });

  it('un error inesperado (incluido un objeto plano de PostgREST) es 500 genérico y queda logueado', async () => {
    const logger = vi.fn();
    for (const cause of [
      new TypeError('boom'),
      { code: '42P01', message: 'x' },
    ]) {
      const response = errorResponse(cause, { logger });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        code: 'internal_error',
        error: GENERIC_ERROR_MESSAGE,
      });
    }
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it('ya no deduce 403 por palabras del mensaje', async () => {
    const response = errorResponse(
      new Error('Este link fue revocado por autorización'),
    );
    expect(response.status).toBe(500);
  });

  it('un body que no es JSON objeto responde 400 invalid_request', async () => {
    for (const raw of ['', 'no json', '[]', 'null', '"x"'])
      await expect(
        body(new Request('https://x.test', { method: 'POST', body: raw })),
      ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  EdgeFunctionError,
  invokeEdgeFunction,
  toEdgeFunctionError,
} from './edge-functions';

const httpError = (status: number, body: unknown) => {
  const error = new Error('Edge Function returned a non-2xx status code');
  error.name = 'FunctionsHttpError';
  Object.assign(error, {
    context: new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    ),
  });
  return error;
};
const failure = 'No se pudo generar el link del cliente';

describe('toEdgeFunctionError', () => {
  it('extrae el mensaje JSON de FunctionsHttpError en vez de "non-2xx status code"', async () => {
    const error = await toEdgeFunctionError(
      httpError(409, {
        error: 'Google Drive no está conectado.',
        code: 'drive_not_connected',
      }),
      failure,
    );
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect(error.message).toBe(
      'No se pudo generar el link del cliente: Google Drive no está conectado.',
    );
    expect(error).toMatchObject({ status: 409, code: 'drive_not_connected' });
  });

  it('401 pide iniciar sesión de nuevo (JWT vencido en el gateway)', async () => {
    const error = await toEdgeFunctionError(
      httpError(401, { code: 401, message: 'Invalid JWT' }),
      failure,
    );
    expect(error.message).toBe(
      `${failure}: tu sesión venció. Volvé a iniciar sesión.`,
    );
  });

  it('5xx agrega la referencia para correlacionar con los logs', async () => {
    const error = await toEdgeFunctionError(
      httpError(500, {
        error: 'No se pudo completar la operación.',
        requestId: 'abcdef12-3456',
      }),
      failure,
    );
    expect(error.message).toBe(
      `${failure}: No se pudo completar la operación. (ref. abcdef12)`,
    );
  });

  it('cuerpos no JSON, vacíos o sin error no rompen ni muestran HTML', async () => {
    expect(
      (await toEdgeFunctionError(httpError(502, ''), failure)).message,
    ).toBe(`${failure}: error interno del servidor.`);
    expect(
      (await toEdgeFunctionError(httpError(403, '{}'), failure)).message,
    ).toBe(`${failure}: no tenés permisos para esta acción.`);
    expect(
      (await toEdgeFunctionError(httpError(404, 'not found'), failure)).message,
    ).toBe(`${failure}: not found`);
  });

  it('errores de red y de relay tienen mensajes propios', async () => {
    const fetchError = Object.assign(new Error('Failed to send'), {
      name: 'FunctionsFetchError',
    });
    const relay = Object.assign(new Error('relay'), {
      name: 'FunctionsRelayError',
    });
    expect((await toEdgeFunctionError(fetchError, failure)).message).toContain(
      'Revisá tu conexión',
    );
    expect((await toEdgeFunctionError(relay, failure)).message).toContain(
      'no está disponible',
    );
    expect(
      (await toEdgeFunctionError(new Error('interno raro'), failure)).message,
    ).toBe(`${failure}.`);
  });
});

describe('invokeEdgeFunction', () => {
  it('devuelve data y propaga el body exacto', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { ok: true }, error: null });
    await expect(
      invokeEdgeFunction({ functions: { invoke } }, 'fn', { a: 1 }, failure),
    ).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('fn', { body: { a: 1 } });
  });

  it('lanza el error con mensaje útil si la función responde non-2xx o 200 con error', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: httpError(422, {
        error: 'Sin servicios.',
        code: 'no_uploadable_items',
      }),
    });
    await expect(
      invokeEdgeFunction({ functions: { invoke } }, 'fn', {}, failure),
    ).rejects.toThrow(`${failure}: Sin servicios.`);
    const soft = vi
      .fn()
      .mockResolvedValue({ data: { error: 'Algo falló.' }, error: null });
    await expect(
      invokeEdgeFunction({ functions: { invoke: soft } }, 'fn', {}, failure),
    ).rejects.toThrow(`${failure}: Algo falló.`);
  });

  it('si invoke lanza (red), también se traduce', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('x'), { name: 'FunctionsFetchError' }),
      );
    await expect(
      invokeEdgeFunction({ functions: { invoke } }, 'fn', {}, failure),
    ).rejects.toThrow('Revisá tu conexión');
  });
});

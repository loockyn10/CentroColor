import { describe, expect, it } from 'vitest';
import { publicRoute } from './public-routes';
import { PanelShell } from '@centrocolor/features';
import { PhotoUploadPortal } from './photo-upload-portal';
import { PrintOrderPortal } from './public-order/print-order-portal';
import { OrderTracking } from './public-order/order-tracking';
import { ReceivedRedirect } from './public-order/received-redirect';

describe('rutas públicas: sin login y sin shell administrativo', () => {
  it('/imprimir, /imprimir/recibido, /pedido/:token y /enviar/:token se resuelven antes del acceso', () => {
    expect(publicRoute('/imprimir')?.type).toBe(PrintOrderPortal);
    expect(publicRoute('/imprimir/')?.type).toBe(PrintOrderPortal);
    expect(publicRoute('/imprimir/recibido')?.type).toBe(ReceivedRedirect);
    expect(publicRoute('/pedido/abc123')?.type).toBe(OrderTracking);
    expect(publicRoute('/pedido/abc123')?.props.token).toBe('abc123');
    expect(publicRoute('/enviar/tok-1')?.type).toBe(PhotoUploadPortal);
  });

  it('el escáner global vive sólo en PanelShell: ninguna ruta pública lo monta', () => {
    for (const path of [
      '/imprimir',
      '/imprimir/recibido',
      '/pedido/t',
      '/enviar/t',
    ])
      expect(publicRoute(path)?.type).not.toBe(PanelShell);
  });

  it('el token se decodifica y nada administrativo es público', () => {
    expect(publicRoute('/pedido/a%20b')?.props.token).toBe('a b');
    for (const path of ['/', '/panel', '/clientes', '/pedido', '/imprimir/x'])
      expect(publicRoute(path)).toBeNull();
  });
});

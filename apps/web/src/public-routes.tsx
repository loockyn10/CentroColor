import { PhotoUploadPortal } from './photo-upload-portal';
import { PrintOrderPortal } from './public-order/print-order-portal';
import { OrderTracking } from './public-order/order-tracking';
import { ReceivedRedirect } from './public-order/received-redirect';

/**
 * Public routes are resolved before the administrative gate: no login, no Business
 * context, no navigation. Everything else is the authenticated application.
 */
export function publicRoute(pathname: string) {
  const upload = pathname.match(/^\/enviar\/([^/]+)\/?$/);
  if (upload)
    return <PhotoUploadPortal token={decodeURIComponent(upload[1]!)} />;
  if (/^\/imprimir\/?$/.test(pathname)) return <PrintOrderPortal />;
  if (/^\/imprimir\/recibido\/?$/.test(pathname)) return <ReceivedRedirect />;
  const tracking = pathname.match(/^\/pedido\/([^/]+)\/?$/);
  if (tracking)
    return <OrderTracking token={decodeURIComponent(tracking[1]!)} />;
  return null;
}

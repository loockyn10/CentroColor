// Transport of the professional portal. Unlike /imprimir these calls carry the signed-in user's
// JWT: the server answers only to an active professional account and decides the price list,
// the customer and the payment terms from it. Uploading photos reuses the token-based functions
// of the public portal (`uploadPhoto`), since the token is minted for one professional order.
import { getSupabaseClient } from '../cloud-config';
import { invokeEdgeFunction } from '../edge-functions';
import type {
  Catalog,
  StartedOrder,
  SubmitOptions,
  SubmittedOrder,
} from '../public-order/client';

export type PaymentTerms = 'prepaid' | 'deferred';

export type ProfessionalAccount = {
  customerName: string;
  priceListName: string | null;
  /** False when the customer has no Profesional/convenio list yet: nothing can be priced. */
  priceListUsable: boolean;
  paymentTerms: PaymentTerms;
  /** The customer's own WhatsApp, to pre-fill the field. */
  phone: string | null;
};

export type ProfessionalCatalog = Catalog & { account: ProfessionalAccount };
export type ProfessionalStartedOrder = StartedOrder & {
  paymentTerms: PaymentTerms;
};
export type ProfessionalSubmittedOrder = SubmittedOrder & {
  paymentTerms: PaymentTerms;
};

const invoke = <T>(
  name: string,
  body: Record<string, unknown>,
  failure: string,
) => invokeEdgeFunction<T>(getSupabaseClient(), name, body, failure);

export const fetchProfessionalCatalog = () =>
  invoke<ProfessionalCatalog>(
    'professional-catalog',
    {},
    'No pudimos cargar tu lista de precios',
  );

export const startProfessionalOrder = (body: Record<string, unknown>) =>
  invoke<ProfessionalStartedOrder>(
    'professional-order-start',
    body,
    'No pudimos iniciar el pedido',
  );

export const submitProfessionalOrder = (
  token: string,
  options: SubmitOptions = {},
) =>
  invoke<ProfessionalSubmittedOrder>(
    'professional-order-submit',
    { token, ...options },
    'No pudimos confirmar el pedido',
  );

/** The server's own wording, without the "No pudimos…:" prefix the generic invoker adds. */
export function serverMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const at = message.indexOf(': ');
  return at > 0 && /^No pudimos/.test(message)
    ? message.slice(at + 2).replace(/^./, (c) => c.toUpperCase())
    : message || 'No se pudo completar la operación. Reintentá.';
}

/**
 * The session is no longer valid: the function answered 401 with its own code, or the gateway
 * rejected an expired JWT (401 without a code). Either way the person must sign in again.
 */
export const isSessionExpired = (error: unknown) =>
  (error as { code?: string | null } | null)?.code === 'unauthorized' ||
  (error as { status?: number | null } | null)?.status === 401;

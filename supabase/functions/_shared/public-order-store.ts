// Persistence contract for the public self-service order functions.
// The Supabase implementation lives in public-order-store-supabase.ts; tests use an
// in-memory one (public-order-test-support.ts).

export type PublicServiceRow = {
  id: string;
  name: string;
  description: string | null;
  width_mm: number | null;
  height_mm: number | null;
  unit_price_cents: number;
  sort_order: number;
  variant_id?: string;
  photo_service_id?: string;
  /** Paper of the variant (`glossy` = Brillo, `matte` = Mate), straight from the catalog. */
  paper?: 'glossy' | 'matte';
  tiers?: Array<{
    min_quantity: number;
    max_quantity: number | null;
    unit_price_cents: number;
  }>;
};

/** A size/paper of the anonymous professional request: what to order, never what it costs. */
export type RequestServiceRow = {
  id: string;
  name: string;
  description: string | null;
  width_mm: number | null;
  height_mm: number | null;
  sort_order: number;
  variant_id: string;
  photo_service_id: string;
  paper: 'glossy' | 'matte';
};

export type StartRequestArgs = {
  business_id: string;
  client_key: string;
  customer_name: string;
  phone_e164: string;
  phone_display: string;
  email: string | null;
  notes: string | null;
  ip_hash: string;
  items: { service_id: string; variant_id: string; quantity: number }[];
  token_hash: string;
  link_expires_at: string;
};

/** What an anonymous request start answers. There is no money anywhere in it. */
export type StartedRequest =
  | {
      status: 'draft';
      order_id: string;
      job_id: string;
      link_id: string;
      customer_id: string;
      items: {
        item_id: string;
        service_id: string | null;
        name: string;
        quantity: number;
      }[];
    }
  | { status: 'submitted'; order_id: string; job_id: string };

export type StartOrderArgs = {
  business_id: string;
  client_key: string;
  customer_name: string;
  phone_e164: string;
  phone_display: string;
  email: string | null;
  notes: string | null;
  whatsapp_opt_in: boolean;
  ip_hash: string;
  items: {
    service_id: string;
    quantity: number;
    expected_unit_price_cents: number;
    variant_id?: string;
  }[];
  token_hash: string;
  link_expires_at: string;
};

export type OrderItemSnapshot = {
  item_id: string;
  service_id: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
};

export type StartedOrder =
  | {
      status: 'draft';
      order_id: string;
      job_id: string;
      link_id: string;
      customer_id: string;
      items: OrderItemSnapshot[];
      total_cents: number;
    }
  | { status: 'submitted'; order_id: string; job_id: string };

/** The account behind a verified professional JWT and the price list the server authorizes. */
export type ProfessionalContext = {
  account_id: string;
  business_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  allow_deferred_payment: boolean;
  price_list_id: string | null;
  price_list_name: string | null;
  price_list_kind: 'public' | 'professional' | 'custom' | null;
  /** False when the Customer has no list or only the public one: the portal must not price. */
  price_list_usable: boolean;
};

export type PaymentTerms = 'prepaid' | 'deferred';

export type StartProfessionalOrderArgs = {
  account_id: string;
  client_key: string;
  whatsapp_e164: string;
  notes: string | null;
  ip_hash: string;
  items: StartOrderArgs['items'];
  token_hash: string;
  link_expires_at: string;
};

export type ConfirmOrderArgs = {
  business_id: string;
  job_id: string;
  upload_link_id: string;
  tracking_token_hash: string;
  tracking_expires_at: string;
};

export type ConfirmedOrder = {
  already_submitted: boolean;
  order_id: string;
  items: Omit<OrderItemSnapshot, 'item_id' | 'service_id'>[];
  total_cents: number;
};

export type PublicOrderRow = {
  id: string;
  business_id: string;
  photo_job_id: string;
  status: 'draft' | 'submitted' | 'abandoned';
  submitted_at: string | null;
  created_at: string;
  /** Set only on professional orders. */
  professional_account_id?: string | null;
  payment_terms?: PaymentTerms | null;
  /** Which public page placed the order. */
  portal?: 'imprimir' | 'profesionales';
};

/** An order sent from /profesionales without an account: quoted by staff, never priced here. */
export const isAnonymousProfessionalRequest = (
  order: Pick<PublicOrderRow, 'portal' | 'professional_account_id'>,
) => order.portal === 'profesionales' && !order.professional_account_id;

export type TrackingRow = {
  job_status: 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  job_created_at: string;
  /** `pending_quote`: no amount has been confirmed yet. */
  quote_status?: 'quoted' | 'pending_quote';
  items: { name: string; quantity: number; total_cents: number }[];
};

/** A business rule enforced inside a database function (`cc_error:<code>`). */
export class OrderRuleError extends Error {
  constructor(readonly code: string) {
    super(`public order rule: ${code}`);
  }
}

export interface PublicOrderStore {
  resolveBusiness(slug: string): Promise<{ id: string; name: string } | null>;
  /** Active + public + direct-order services, ordered for display. */
  listPublicServices(businessId: string): Promise<PublicServiceRow[]>;
  /** Same filter as the list, restricted to the ids asked for. */
  getPublicServices(
    businessId: string,
    ids: string[],
  ): Promise<PublicServiceRow[]>;
  countOrdersSince(
    businessId: string,
    sinceIso: string,
    filter?: { ipHash?: string; phoneE164?: string },
  ): Promise<number>;
  startOrder(args: StartOrderArgs): Promise<StartedOrder>;
  confirmOrder(args: ConfirmOrderArgs): Promise<ConfirmedOrder>;
  getOrderByJob(
    businessId: string,
    jobId: string,
  ): Promise<PublicOrderRow | null>;
  getTracking(businessId: string, jobId: string): Promise<TrackingRow | null>;
  getBusinessName(businessId: string): Promise<string>;

  /* ── professional portal ── */
  /** The active account of a verified user, or null. Never throws for "not a professional". */
  getProfessionalContext(userId: string): Promise<ProfessionalContext | null>;
  /** Catalog with the tiers of the account's own list (never the public one). */
  listProfessionalServices(
    businessId: string,
    priceListId: string,
  ): Promise<PublicServiceRow[]>;
  countProfessionalOrdersSince(
    accountId: string,
    sinceIso: string,
  ): Promise<number>;
  startProfessionalOrder(
    args: StartProfessionalOrderArgs,
  ): Promise<StartedOrder & { payment_terms?: PaymentTerms }>;

  /* ── professional portal without an account ── */
  /** Sizes and papers a request may ask for. No price, tier or list is ever read. */
  listRequestServices(businessId: string): Promise<RequestServiceRow[]>;
  /** Requests (not calls: a retry of the same order does not count) of the anonymous portal. */
  countRequestsSince(
    businessId: string,
    sinceIso: string,
    filter?: { ipHash?: string; phoneE164?: string; excludeClientKey?: string },
  ): Promise<number>;
  startRequest(args: StartRequestArgs): Promise<StartedRequest>;
}

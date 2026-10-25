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
  tiers?: Array<{
    min_quantity: number;
    max_quantity: number | null;
    unit_price_cents: number;
  }>;
};

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
};

export type TrackingRow = {
  job_status: 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  job_created_at: string;
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
}

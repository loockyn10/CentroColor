/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client boundary. */
import { DatabaseError } from './diagnostics.ts';
import {
  OrderRuleError,
  type ConfirmedOrder,
  type ProfessionalContext,
  type PublicOrderRow,
  type PublicOrderStore,
  type PublicServiceRow,
  type RequestServiceRow,
  type StartedOrder,
  type StartedRequest,
  type TrackingRow,
} from './public-order-store.ts';
import { run, type ServiceDb } from './store-supabase.ts';

const toService = (x: any): PublicServiceRow => ({
  id: x.id,
  name: x.name,
  description: x.description ?? null,
  width_mm: x.width_mm ?? null,
  height_mm: x.height_mm ?? null,
  unit_price_cents: Number(x.tiers[0].unit_price_cents),
  sort_order: x.sort_order,
  variant_id: x.variant_id,
  photo_service_id: x.photo_service_id,
  ...(x.paper === 'glossy' || x.paper === 'matte' ? { paper: x.paper } : {}),
  tiers: x.tiers.map((tier: any) => ({
    min_quantity: Number(tier.min_quantity),
    max_quantity: tier.max_quantity === null ? null : Number(tier.max_quantity),
    unit_price_cents: Number(tier.unit_price_cents),
  })),
});

/** Runs a SQL function; `cc_error:<code>` exceptions are business rules, the rest are database faults. */
export async function rpc(
  db: ServiceDb,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = (await db.rpc(name, args)) as {
    data: any;
    error: { message?: string } | null;
  };
  if (error) {
    const rule = /cc_error:([a-z_]+)/.exec(error.message ?? '');
    if (rule) throw new OrderRuleError(rule[1]!);
    throw new DatabaseError(name, error);
  }
  return data;
}

const toRequestService = (x: any): RequestServiceRow => ({
  id: x.id,
  name: x.name,
  description: x.description ?? null,
  width_mm: x.width_mm ?? null,
  height_mm: x.height_mm ?? null,
  sort_order: x.sort_order,
  variant_id: x.variant_id,
  photo_service_id: x.photo_service_id,
  paper: x.paper,
});

const withTiers = (data: unknown) =>
  ((data ?? []) as any[])
    .filter((x) => Array.isArray(x.tiers) && x.tiers.length > 0)
    .map(toService);

export function createPublicOrderStore(db: ServiceDb): PublicOrderStore {
  const listCatalog = async (businessId: string) =>
    withTiers(
      await rpc(db, 'cc_public_lab_catalog', { p_business_id: businessId }),
    );
  return {
    async resolveBusiness(slug) {
      const { data } = await run(
        'businesses.get_by_slug',
        db.from('businesses').select('id,name').eq('slug', slug).maybeSingle(),
      );
      return data ? { id: data.id as string, name: data.name as string } : null;
    },
    async getBusinessName(businessId) {
      const { data } = await run(
        'businesses.get_name',
        db.from('businesses').select('name').eq('id', businessId).maybeSingle(),
      );
      return String(data?.name ?? '');
    },
    async listPublicServices(businessId) {
      return listCatalog(businessId);
    },
    async getPublicServices(businessId, ids) {
      if (!ids.length) return [];
      const requested = new Set(ids);
      return (await listCatalog(businessId)).filter((x) => requested.has(x.id));
    },
    async countOrdersSince(businessId, sinceIso, filter = {}) {
      let query = db
        .from('public_photo_orders')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('created_at', sinceIso);
      if (filter.ipHash) query = query.eq('client_ip_hash', filter.ipHash);
      if (filter.phoneE164) query = query.eq('whatsapp_e164', filter.phoneE164);
      const { count } = await run('public_photo_orders.count_recent', query);
      return count ?? 0;
    },
    async startOrder(args) {
      const data = await rpc(db, 'cc_public_order_start', {
        p_business_id: args.business_id,
        p_client_key: args.client_key,
        p_customer_name: args.customer_name,
        p_phone_e164: args.phone_e164,
        p_phone_display: args.phone_display,
        p_email: args.email,
        p_notes: args.notes,
        p_whatsapp_opt_in: args.whatsapp_opt_in,
        p_ip_hash: args.ip_hash,
        p_items: args.items,
        p_token_hash: args.token_hash,
        p_link_expires_at: args.link_expires_at,
      });
      return data as StartedOrder;
    },
    async confirmOrder(args) {
      const data = await rpc(db, 'cc_public_order_confirm', {
        p_business_id: args.business_id,
        p_job_id: args.job_id,
        p_upload_link_id: args.upload_link_id,
        p_tracking_token_hash: args.tracking_token_hash,
        p_tracking_expires_at: args.tracking_expires_at,
      });
      return data as ConfirmedOrder;
    },
    async getOrderByJob(businessId, jobId) {
      const { data } = await run(
        'public_photo_orders.get_by_job',
        db
          .from('public_photo_orders')
          .select(
            'id,business_id,photo_job_id,status,submitted_at,created_at,professional_account_id,payment_terms,portal',
          )
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .maybeSingle(),
      );
      return (data as PublicOrderRow | null) ?? null;
    },
    async getTracking(businessId, jobId) {
      const { data: job } = await run(
        'photo_jobs.get_tracking',
        db
          .from('photo_jobs')
          .select('status,created_at,quote_status')
          .eq('business_id', businessId)
          .eq('id', jobId)
          .maybeSingle(),
      );
      if (!job) return null;
      const { data: items } = await run(
        'photo_job_items.list_tracking',
        db
          .from('photo_job_items')
          .select('service_name_snapshot,quantity,total_cents')
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .eq('is_active', true)
          .order('created_at', { ascending: true }),
      );
      return {
        job_status: job.status,
        job_created_at: job.created_at,
        quote_status: job.quote_status ?? 'quoted',
        items: ((items ?? []) as any[]).map((x) => ({
          name: x.service_name_snapshot as string,
          quantity: Number(x.quantity),
          total_cents: Number(x.total_cents),
        })),
      } satisfies TrackingRow;
    },
    async getProfessionalContext(userId) {
      const data = await rpc(db, 'cc_professional_context', {
        p_user_id: userId,
      });
      return (data as ProfessionalContext | null) ?? null;
    },
    async listProfessionalServices(businessId, priceListId) {
      return withTiers(
        await rpc(db, 'cc_professional_lab_catalog', {
          p_business_id: businessId,
          p_price_list_id: priceListId,
        }),
      );
    },
    async countProfessionalOrdersSince(accountId, sinceIso) {
      const { count } = await run(
        'public_photo_orders.count_professional',
        db
          .from('public_photo_orders')
          .select('id', { count: 'exact', head: true })
          .eq('professional_account_id', accountId)
          .gte('created_at', sinceIso),
      );
      return count ?? 0;
    },
    async startProfessionalOrder(args) {
      const data = await rpc(db, 'cc_professional_order_start', {
        p_account_id: args.account_id,
        p_client_key: args.client_key,
        p_whatsapp_e164: args.whatsapp_e164,
        p_notes: args.notes,
        p_ip_hash: args.ip_hash,
        p_items: args.items,
        p_token_hash: args.token_hash,
        p_link_expires_at: args.link_expires_at,
      });
      return data as StartedOrder & { payment_terms?: 'prepaid' | 'deferred' };
    },
    async listRequestServices(businessId) {
      const data = await rpc(db, 'cc_professional_public_catalog', {
        p_business_id: businessId,
      });
      return ((data ?? []) as any[]).map(toRequestService);
    },
    async countRequestsSince(businessId, sinceIso, filter = {}) {
      let query = db
        .from('public_photo_orders')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('portal', 'profesionales')
        .is('professional_account_id', null)
        .gte('created_at', sinceIso);
      if (filter.ipHash) query = query.eq('client_ip_hash', filter.ipHash);
      if (filter.phoneE164) query = query.eq('whatsapp_e164', filter.phoneE164);
      if (filter.excludeClientKey)
        query = query.neq('client_key', filter.excludeClientKey);
      const { count } = await run('public_photo_orders.count_requests', query);
      return count ?? 0;
    },
    async startRequest(args) {
      const data = await rpc(db, 'cc_professional_request_start', {
        p_business_id: args.business_id,
        p_client_key: args.client_key,
        p_customer_name: args.customer_name,
        p_phone_e164: args.phone_e164,
        p_phone_display: args.phone_display,
        p_email: args.email,
        p_notes: args.notes,
        p_ip_hash: args.ip_hash,
        p_items: args.items,
        p_token_hash: args.token_hash,
        p_link_expires_at: args.link_expires_at,
      });
      return data as StartedRequest;
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase row mapping stays at this boundary. */
import type { WorkPaymentRepository } from '@centrocolor/application';
import {
  workAccountTotals,
  type CustomerWorkAccount,
  type WorkAccount,
  type WorkPayment,
  type WorkPaymentSourceType,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';
const c = (): any => getSupabaseClient();
const payment = (r: any): WorkPayment => ({
  id: r.id,
  businessId: r.business_id,
  branchId: r.branch_id,
  customerId: r.customer_id,
  sourceType: r.source_type,
  eventId: r.event_id,
  frameJobId: r.frame_job_id,
  photoJobId: r.photo_job_id,
  paymentKind: r.payment_kind,
  paymentMethod: r.payment_method,
  amountCents: r.amount_cents,
  occurredAt: r.occurred_at,
  notes: r.notes,
  status: r.status,
  createdBy: r.created_by,
  voidedAt: r.voided_at,
  voidedBy: r.voided_by,
  voidReason: r.void_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const payload = (x: WorkPayment) => ({
  id: x.id,
  business_id: x.businessId,
  branch_id: x.branchId,
  customer_id: x.customerId,
  source_type: x.sourceType,
  event_id: x.eventId,
  frame_job_id: x.frameJobId,
  photo_job_id: x.photoJobId,
  payment_kind: x.paymentKind,
  payment_method: x.paymentMethod,
  amount_cents: x.amountCents,
  occurred_at: x.occurredAt,
  notes: x.notes,
  created_by: x.createdBy,
  created_at: x.createdAt,
});
const idColumn = (t: WorkPaymentSourceType) =>
  t === 'event'
    ? 'event_id'
    : t === 'frame_job'
      ? 'frame_job_id'
      : 'photo_job_id';
export class SupabaseWorkPaymentRepository implements WorkPaymentRepository {
  async getAccount(b: string, t: WorkPaymentSourceType, id: string) {
    let customerId = '',
      sourceStatus = '',
      description = '',
      totalCents = 0;
    if (t === 'event') {
      const [source, services, reservations] = await Promise.all([
        c()
          .from('events')
          .select('customer_id,status,title')
          .eq('business_id', b)
          .eq('id', id)
          .maybeSingle(),
        c()
          .from('event_service_items')
          .select('total_cents')
          .eq('business_id', b)
          .eq('event_id', id)
          .eq('is_active', true),
        c()
          .from('resource_reservations')
          .select('price_cents')
          .eq('business_id', b)
          .eq('event_id', id)
          .eq('is_active', true),
      ]);
      if (source.error) throw source.error;
      if (!source.data) return null;
      if (services.error) throw services.error;
      if (reservations.error) throw reservations.error;
      customerId = source.data.customer_id;
      sourceStatus = source.data.status;
      description = source.data.title;
      totalCents =
        (services.data ?? []).reduce(
          (s: number, x: any) => s + x.total_cents,
          0,
        ) +
        (reservations.data ?? []).reduce(
          (s: number, x: any) => s + x.price_cents,
          0,
        );
    } else if (t === 'frame_job') {
      const source = await c()
        .from('frame_jobs')
        .select('customer_id,status,quote_id')
        .eq('business_id', b)
        .eq('id', id)
        .maybeSingle();
      if (source.error) throw source.error;
      if (!source.data) return null;
      const quote = await c()
        .from('frame_quotes')
        .select('total_cents,width_mm,height_mm')
        .eq('business_id', b)
        .eq('id', source.data.quote_id)
        .single();
      if (quote.error) throw quote.error;
      customerId = source.data.customer_id;
      sourceStatus = source.data.status;
      description = `Marquetería ${quote.data.width_mm / 10}×${quote.data.height_mm / 10} cm`;
      totalCents = quote.data.total_cents;
    } else {
      const [source, items] = await Promise.all([
        c()
          .from('photo_jobs')
          .select('customer_id,status')
          .eq('business_id', b)
          .eq('id', id)
          .maybeSingle(),
        c()
          .from('photo_job_items')
          .select('service_name_snapshot,total_cents')
          .eq('business_id', b)
          .eq('photo_job_id', id)
          .eq('is_active', true),
      ]);
      if (source.error) throw source.error;
      if (!source.data) return null;
      if (items.error) throw items.error;
      customerId = source.data.customer_id;
      sourceStatus = source.data.status;
      description =
        (items.data ?? [])
          .map((x: any) => x.service_name_snapshot)
          .join(', ') || 'Trabajo fotográfico';
      totalCents = (items.data ?? []).reduce(
        (s: number, x: any) => s + x.total_cents,
        0,
      );
    }
    const result = await c()
      .from('work_payments')
      .select('*')
      .eq('business_id', b)
      .eq(idColumn(t), id)
      .order('occurred_at', { ascending: false });
    if (result.error) throw result.error;
    const payments = (result.data ?? []).map(payment);
    return {
      sourceType: t,
      sourceId: id,
      customerId,
      sourceStatus,
      description,
      payments,
      conflictPaymentIds: [],
      ...workAccountTotals(totalCents, payments),
    } satisfies WorkAccount;
  }
  private async sourceIds(
    b: string,
    column: string,
    value: string,
    active = false,
  ) {
    const status = active;
    const [e, f, p] = await Promise.all([
      c()
        .from('events')
        .select('id,status')
        .eq('business_id', b)
        .eq(column, value),
      c()
        .from('frame_jobs')
        .select('id,status')
        .eq('business_id', b)
        .eq(column, value),
      c()
        .from('photo_jobs')
        .select('id,status')
        .eq('business_id', b)
        .eq(column, value),
    ]);
    for (const r of [e, f, p]) if (r.error) throw r.error;
    return [
      ...(e.data ?? [])
        .filter((x: any) => !status || x.status !== 'cancelled')
        .map((x: any) => ['event', x.id] as const),
      ...(f.data ?? [])
        .filter((x: any) => !status || x.status !== 'cancelled')
        .map((x: any) => ['frame_job', x.id] as const),
      ...(p.data ?? [])
        .filter((x: any) => !status || x.status !== 'cancelled')
        .map((x: any) => ['photo_job', x.id] as const),
    ];
  }
  async getCustomerAccount(
    b: string,
    customerId: string,
  ): Promise<CustomerWorkAccount> {
    const ids = await this.sourceIds(b, 'customer_id', customerId);
    const all = (
      await Promise.all(ids.map(([t, id]) => this.getAccount(b, t, id)))
    ).filter(Boolean) as WorkAccount[];
    const sources = all.filter(
      (x) => x.balanceCents > 0 || x.sourceStatus === 'cancelled',
    );
    return {
      customerId,
      sources,
      recentPayments: all
        .flatMap((x) => x.payments)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 20),
      balanceCents: sources
        .filter((x) => x.sourceStatus !== 'cancelled')
        .reduce((s, x) => s + Math.max(0, x.balanceCents), 0),
    };
  }
  async listOutstanding(b: string, branch: string) {
    const ids = await this.sourceIds(b, 'branch_id', branch, true);
    const rows = (
      await Promise.all(ids.map(([t, id]) => this.getAccount(b, t, id)))
    ).filter(Boolean) as WorkAccount[];
    return rows.filter((x) => x.balanceCents > 0);
  }
  async post(x: WorkPayment) {
    const r = await c().rpc('post_work_payment', { p_payment: payload(x) });
    if (r.error) throw r.error;
    return payment(r.data);
  }
  async void(
    b: string,
    id: string,
    _actor: string,
    reason: string,
    occurredAt = new Date().toISOString(),
  ) {
    const r = await c().rpc('void_work_payment', {
      p_business_id: b,
      p_payment_id: id,
      p_reason: reason,
      p_voided_at: occurredAt,
    });
    if (r.error) throw r.error;
    return payment(r.data);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase mapping stays at this boundary. */
import type {
  PendingWorkPayment,
  WorkPaymentCursor,
  WorkPaymentSyncCloudPort,
} from '@centrocolor/application';
import type { WorkPayment } from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';
export const cloudWorkPayment = (r: any): WorkPayment => ({
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
export const workPaymentPayload = (x: WorkPayment) => ({
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
export class CloudWorkPaymentSyncAdapter implements WorkPaymentSyncCloudPort {
  async push(change: PendingWorkPayment) {
    const c: any = getSupabaseClient();
    const x = change.payment;
    if (x.status === 'voided') {
      const existing = await c
        .from('work_payments')
        .select('id')
        .eq('business_id', x.businessId)
        .eq('id', x.id)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) return x;
    }
    const result =
      x.status === 'voided'
        ? await c.rpc('void_work_payment', {
            p_business_id: x.businessId,
            p_payment_id: x.id,
            p_reason: x.voidReason,
            p_voided_at: x.voidedAt,
          })
        : await c.rpc('post_work_payment', {
            p_payment: workPaymentPayload(x),
          });
    if (result.error) throw result.error;
    return cloudWorkPayment(result.data);
  }
  async pull(b: string, after: WorkPaymentCursor | null, limit: number) {
    const c: any = getSupabaseClient();
    let q = c
      .from('work_payments')
      .select('*')
      .eq('business_id', b)
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (after)
      q = q.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(cloudWorkPayment);
  }
}

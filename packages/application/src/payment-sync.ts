import type { WorkPayment } from '@centrocolor/domain';

export interface WorkPaymentCursor {
  updatedAt: string;
  id: string;
}
export interface PendingWorkPayment {
  outboxId: string;
  payment: WorkPayment;
  localRevision: number;
}
export interface WorkPaymentSyncLocalPort {
  pending(businessId: string, limit: number): Promise<PendingWorkPayment[]>;
  pendingFor(
    businessId: string,
    id: string,
  ): Promise<PendingWorkPayment | null>;
  acknowledge(change: PendingWorkPayment, cloud: WorkPayment): Promise<void>;
  fail(
    change: PendingWorkPayment,
    message: string,
    conflict?: boolean,
  ): Promise<void>;
  applyRemote(payment: WorkPayment): Promise<boolean>;
  cursor(businessId: string): Promise<WorkPaymentCursor | null>;
  advanceCursor(businessId: string, cursor: WorkPaymentCursor): Promise<void>;
}
export interface WorkPaymentSyncCloudPort {
  push(change: PendingWorkPayment): Promise<WorkPayment>;
  pull(
    businessId: string,
    after: WorkPaymentCursor | null,
    limit: number,
  ): Promise<WorkPayment[]>;
}
export async function syncWorkPayments(
  businessId: string,
  local: WorkPaymentSyncLocalPort,
  cloud: WorkPaymentSyncCloudPort,
) {
  const result = { pushed: 0, pulled: 0, conflicts: 0 };
  for (const change of await local.pending(businessId, 100)) {
    try {
      const remote = await cloud.push(change);
      await local.acknowledge(change, remote);
      result.pushed++;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'No se pudo sincronizar el pago.';
      const conflict = /saldo|sobrepago|devoluci|conflict/i.test(message);
      await local.fail(change, message, conflict);
      if (conflict) result.conflicts++;
      else throw cause;
    }
  }
  let cursor = await local.cursor(businessId);
  for (const payment of await cloud.pull(businessId, cursor, 100)) {
    const next = { updatedAt: payment.updatedAt, id: payment.id };
    if (
      cursor &&
      (next.updatedAt < cursor.updatedAt ||
        (next.updatedAt === cursor.updatedAt && next.id <= cursor.id))
    )
      throw new Error('Cursor de pagos no creciente.');
    const pending = await local.pendingFor(businessId, payment.id);
    if (!pending && (await local.applyRemote(payment))) result.pulled++;
    else if (pending) await local.acknowledge(pending, payment);
    await local.advanceCursor(businessId, next);
    cursor = next;
  }
  return result;
}

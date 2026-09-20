import type { Customer } from '@centrocolor/domain';

export interface CustomerCursor {
  updatedAt: string;
  id: string;
}

export interface PendingCustomerChange {
  outboxId: string;
  customer: Customer;
  cloudUpdatedAt: string | null;
  localRevision: number;
}

export interface CustomerSyncLocalPort {
  pending(businessId: string, limit: number): Promise<PendingCustomerChange[]>;
  acknowledge(change: PendingCustomerChange, cloud: Customer): Promise<void>;
  fail(change: PendingCustomerChange, message: string): Promise<void>;
  conflict(change: PendingCustomerChange, cloud: Customer): Promise<void>;
  pendingForCustomer(
    businessId: string,
    customerId: string,
  ): Promise<PendingCustomerChange | null>;
  /** False when a local write won the race and now has an outbox entry. */
  applyRemote(customer: Customer): Promise<boolean>;
  cursor(businessId: string): Promise<CustomerCursor | null>;
  advanceCursor(businessId: string, cursor: CustomerCursor): Promise<void>;
}

export type CustomerPushResult =
  | { kind: 'pushed'; customer: Customer }
  | { kind: 'conflict'; customer: Customer };

export interface CustomerSyncCloudPort {
  push(change: PendingCustomerChange): Promise<CustomerPushResult>;
  pull(
    businessId: string,
    after: CustomerCursor | null,
    limit: number,
  ): Promise<Customer[]>;
}

export interface CustomerSyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

const pageSize = 100;
const cycleLimit = 1000;

function compareCursor(a: CustomerCursor, b: CustomerCursor): number {
  const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (time !== 0) return time;
  // PostgreSQL may distinguish microseconds within one JS millisecond.
  const fractionA = (a.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  const fractionB = (b.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  if (fractionA !== fractionB) return fractionA < fractionB ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

export async function syncCustomers(
  businessId: string,
  local: CustomerSyncLocalPort,
  cloud: CustomerSyncCloudPort,
): Promise<CustomerSyncResult> {
  const result: CustomerSyncResult = { pushed: 0, pulled: 0, conflicts: 0 };
  let processed = 0;
  while (processed < cycleLimit) {
    const pending = await local.pending(
      businessId,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (pending.length === 0) break;
    for (const change of pending) {
      if (change.customer.businessId !== businessId)
        throw new Error('El cambio pendiente pertenece a otro negocio.');
      try {
        const response = await cloud.push(change);
        if (response.customer.businessId !== businessId)
          throw new Error('Cloud devolvió un cliente de otro negocio.');
        if (response.kind === 'conflict') {
          await local.conflict(change, response.customer);
          result.conflicts++;
        } else {
          await local.acknowledge(change, response.customer);
          result.pushed++;
        }
      } catch (error) {
        await local.fail(
          change,
          error instanceof Error ? error.message : 'Fallo desconocido de Cloud',
        );
        throw error;
      }
      processed++;
    }
    if (pending.length < pageSize) break;
  }

  let cursor = await local.cursor(businessId);
  processed = 0;
  while (processed < cycleLimit) {
    const page = await cloud.pull(
      businessId,
      cursor,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (page.length === 0) break;
    for (const customer of page) {
      if (customer.businessId !== businessId)
        throw new Error('Cloud devolvió un cliente de otro negocio.');
      const next = { updatedAt: customer.updatedAt, id: customer.id };
      if (cursor && compareCursor(next, cursor) <= 0)
        throw new Error('Cloud devolvió un cursor de clientes no creciente.');
      const pending = await local.pendingForCustomer(businessId, customer.id);
      if (pending) {
        if (pending.cloudUpdatedAt !== customer.updatedAt) {
          await local.conflict(pending, customer);
          result.conflicts++;
        }
      } else {
        if (await local.applyRemote(customer)) {
          result.pulled++;
        } else {
          const raced = await local.pendingForCustomer(businessId, customer.id);
          if (!raced)
            throw new Error('No se pudo aplicar el cliente Cloud en SQLite.');
          if (raced.cloudUpdatedAt !== customer.updatedAt) {
            await local.conflict(raced, customer);
            result.conflicts++;
          }
        }
      }
      await local.advanceCursor(businessId, next);
      cursor = next;
      processed++;
    }
    if (page.length < pageSize) break;
  }
  return result;
}

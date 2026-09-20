import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CustomerCursor,
  CustomerPushResult,
  CustomerSyncCloudPort,
  PendingCustomerChange,
} from '@centrocolor/application';
import type { Customer } from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

type Row = {
  id: string;
  business_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  document_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: Row): Customer {
  return {
    id: row.id,
    businessId: row.business_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    documentNumber: row.document_number,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fields(customer: Customer) {
  return {
    full_name: customer.fullName,
    phone: customer.phone,
    email: customer.email,
    document_number: customer.documentNumber,
    notes: customer.notes,
    is_active: customer.isActive,
  };
}

function sameDetails(a: Customer, b: Customer): boolean {
  return (
    a.id === b.id &&
    a.businessId === b.businessId &&
    a.fullName === b.fullName &&
    a.phone === b.phone &&
    a.email === b.email &&
    a.documentNumber === b.documentNumber &&
    a.notes === b.notes &&
    a.isActive === b.isActive
  );
}

export class CloudCustomerSyncAdapter implements CustomerSyncCloudPort {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async get(businessId: string, id: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as Row) : null;
  }

  async push(change: PendingCustomerChange): Promise<CustomerPushResult> {
    const { customer, cloudUpdatedAt } = change;
    if (cloudUpdatedAt === null) {
      const { data, error } = await this.client
        .from('customers')
        .insert({
          id: customer.id,
          business_id: customer.businessId,
          ...fields(customer),
          created_at: customer.createdAt,
        })
        .select('*')
        .single();
      if (!error) return { kind: 'pushed', customer: fromRow(data as Row) };
      if (error.code !== '23505') throw error;
    } else {
      const { data, error } = await this.client
        .from('customers')
        .update(fields(customer))
        .eq('business_id', customer.businessId)
        .eq('id', customer.id)
        .eq('updated_at', cloudUpdatedAt)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (data) return { kind: 'pushed', customer: fromRow(data as Row) };
    }
    const remote = await this.get(customer.businessId, customer.id);
    if (!remote)
      throw new Error('No se pudo verificar la versión Cloud del cliente.');
    // A prior push may have committed before its local acknowledgement.
    return sameDetails(remote, customer)
      ? { kind: 'pushed', customer: remote }
      : { kind: 'conflict', customer: remote };
  }

  async pull(
    businessId: string,
    after: CustomerCursor | null,
    limit: number,
  ): Promise<Customer[]> {
    let query = this.client
      .from('customers')
      .select('*')
      .eq('business_id', businessId);
    if (after) {
      query = query.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    }
    const { data, error } = await query
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (error) throw error;
    return (data as Row[]).map(fromRow);
  }
}

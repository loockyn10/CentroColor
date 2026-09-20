import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerRepository } from '@centrocolor/application';
import type { Customer, CustomerDetails } from '@centrocolor/domain';
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

function detailsToRow(details: CustomerDetails) {
  return {
    full_name: details.fullName,
    phone: details.phone,
    email: details.email,
    document_number: details.documentNumber,
    notes: details.notes,
  };
}

export class SupabaseCustomerRepository implements CustomerRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(businessId: string, limit: number): Promise<Customer[]> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('full_name')
      .limit(limit);
    if (error) throw error;
    return (data as Row[]).map(fromRow);
  }

  async search(
    businessId: string,
    query: string,
    limit: number,
  ): Promise<Customer[]> {
    // PostgREST parses OR expressions, so strip its delimiters from user input.
    const term = query.replace(/[%,()"\\]/g, '').trim();
    if (!term) return this.list(businessId, limit);
    const filter = ['full_name', 'phone', 'email', 'document_number']
      .map((column) => `${column}.ilike.%${term}%`)
      .join(',');
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .or(filter)
      .order('is_active', { ascending: false })
      .order('full_name')
      .limit(limit);
    if (error) throw error;
    return (data as Row[]).map(fromRow);
  }

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

  async create(customer: Customer): Promise<Customer> {
    const { data, error } = await this.client
      .from('customers')
      .insert({
        id: customer.id,
        business_id: customer.businessId,
        ...detailsToRow(customer),
        is_active: customer.isActive,
        created_at: customer.createdAt,
        updated_at: customer.updatedAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromRow(data as Row);
  }

  async update(
    businessId: string,
    id: string,
    details: CustomerDetails,
  ): Promise<Customer> {
    const { data, error } = await this.client
      .from('customers')
      .update(detailsToRow(details))
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromRow(data as Row);
  }

  async setActive(
    businessId: string,
    id: string,
    isActive: boolean,
  ): Promise<Customer> {
    const { data, error } = await this.client
      .from('customers')
      .update({ is_active: isActive })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromRow(data as Row);
  }
}

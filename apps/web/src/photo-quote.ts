/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are mapped at this boundary. */
import type {
  PhotoJobQuoteRepository,
  QuotePriceListOption,
} from '@centrocolor/application';
import { getSupabaseClient } from './cloud-config';

/**
 * Quoting a request that arrived without an amount. The amount is computed in the database by
 * `quote_photo_job` (owner/admin only) from the chosen price list; this adapter cannot send a price.
 */
export class SupabasePhotoJobQuoteRepository implements PhotoJobQuoteRepository {
  async listPriceLists(businessId: string): Promise<QuotePriceListOption[]> {
    const { data, error } = await getSupabaseClient()
      .from('price_lists')
      .select('id,name,kind')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('kind')
      .order('name');
    if (error) throw error;
    return (data ?? []).map((x: any) => ({
      id: x.id,
      name: x.name,
      kind: x.kind,
    }));
  }

  async quoteJob(input: {
    businessId: string;
    jobId: string;
    priceListId: string;
    customerId: string | null;
  }) {
    const { data, error } = await getSupabaseClient().rpc('quote_photo_job', {
      p_business_id: input.businessId,
      p_job_id: input.jobId,
      p_price_list_id: input.priceListId,
      p_customer_id: input.customerId,
    });
    if (error) throw new Error(error.message);
    const result = data as { total_cents: number; price_list_name: string };
    return {
      totalCents: Number(result.total_cents),
      priceListName: result.price_list_name,
    };
  }
}

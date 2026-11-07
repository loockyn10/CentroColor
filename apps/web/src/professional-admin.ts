// Owner/admin management of professional accounts (Edge Function `professional-admin`).
import { getSupabaseClient } from './cloud-config';
import { invokeEdgeFunction } from './edge-functions';

export type ProfessionalAccountView = {
  id: string;
  email: string | null;
  customerId: string;
  customerName: string;
  priceListName: string | null;
  priceListKind: 'public' | 'professional' | 'custom' | null;
  /** False when the customer lost its Profesional/convenio list: the account cannot order. */
  priceListUsable: boolean;
  allowDeferredPayment: boolean;
  isActive: boolean;
};

export type ProfessionalAdminAction = 'list' | 'link' | 'update';

/**
 * Body sent to `professional-admin`. The keys are the contract with
 * supabase/functions/_shared/professional-admin-handler.ts (ProfessionalAdminPayload); a
 * contract test runs these builders through the real handler.
 */
export const professionalAdminBody = (
  action: ProfessionalAdminAction,
  businessId: string,
  input: {
    email?: string;
    customerId?: string;
    allowDeferredPayment?: boolean;
    accountId?: string;
    isActive?: boolean;
  } = {},
) => ({ action, businessId, ...input });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Edge response mapping boundary.
const mapAccount = (x: any): ProfessionalAccountView => ({
  id: x.id,
  email: x.email ?? null,
  customerId: x.customer_id,
  customerName: x.customer_name,
  priceListName: x.price_list_name ?? null,
  priceListKind: x.price_list_kind ?? null,
  priceListUsable: Boolean(x.price_list_usable),
  allowDeferredPayment: Boolean(x.allow_deferred_payment),
  isActive: Boolean(x.is_active),
});

export class SupabaseProfessionalAdminRepository {
  private async invoke(
    action: ProfessionalAdminAction,
    businessId: string,
    failure: string,
    input?: Parameters<typeof professionalAdminBody>[2],
  ) {
    const data = await invokeEdgeFunction(
      getSupabaseClient(),
      'professional-admin',
      professionalAdminBody(action, businessId, input),
      failure,
    );
    return {
      accounts: ((data.accounts ?? []) as unknown[]).map(mapAccount),
      invited: Boolean(data.invited),
    };
  }
  async list(businessId: string) {
    return (
      await this.invoke(
        'list',
        businessId,
        'No se pudieron cargar las cuentas profesionales',
      )
    ).accounts;
  }
  link(
    businessId: string,
    input: { email: string; customerId: string; allowDeferredPayment: boolean },
  ) {
    return this.invoke(
      'link',
      businessId,
      'No se pudo dar acceso al profesional',
      input,
    );
  }
  async update(
    businessId: string,
    accountId: string,
    patch: { isActive?: boolean; allowDeferredPayment?: boolean },
  ) {
    return (
      await this.invoke(
        'update',
        businessId,
        'No se pudo actualizar la cuenta',
        { accountId, ...patch },
      )
    ).accounts;
  }
}

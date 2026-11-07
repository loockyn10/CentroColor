// Owner/admin management of professional accounts: link an Auth user to an existing Customer,
// allow or revoke "pay later", deactivate. Same admin chain as the other admin functions
// (JWT → membership → owner/admin) before anything privileged happens.
import { intakeConfig, type GetEnv } from './config.ts';
import { consoleLogger, type Logger } from './diagnostics.ts';
import { ApiError, body, errorResponse, json, preflight } from './http.ts';
import { rpc } from './public-order-store-supabase.ts';
import { OrderRuleError } from './public-order-store.ts';
import type { ServiceDb } from './store-supabase.ts';

export const PROFESSIONAL_ADMIN_ACTIONS = ['list', 'link', 'update'] as const;
export type ProfessionalAdminAction =
  (typeof PROFESSIONAL_ADMIN_ACTIONS)[number];

/** Request body contract shared with apps/web (professional-admin.ts). */
export type ProfessionalAdminPayload = {
  action: ProfessionalAdminAction;
  businessId: string;
  /** link: the professional's sign-in e-mail. */
  email?: string;
  /** link: the existing Customer (whose price list prices the account). */
  customerId?: string;
  /** link / update. */
  allowDeferredPayment?: boolean;
  /** update. */
  accountId?: string;
  isActive?: boolean;
};

export type ProfessionalAccountView = {
  id: string;
  email: string | null;
  customer_id: string;
  customer_name: string;
  price_list_name: string | null;
  price_list_kind: 'public' | 'professional' | 'custom' | null;
  price_list_usable: boolean;
  allow_deferred_payment: boolean;
  is_active: boolean;
  created_at: string;
};

export interface ProfessionalAdminStore {
  list(businessId: string): Promise<ProfessionalAccountView[]>;
  /** Throws OrderRuleError(customer_not_found | price_list_required). */
  checkCustomer(businessId: string, customerId: string): Promise<void>;
  findUserByEmail(email: string): Promise<string | null>;
  link(args: {
    businessId: string;
    userId: string;
    customerId: string;
    allowDeferred: boolean;
    createdBy: string;
  }): Promise<string>;
  update(args: {
    businessId: string;
    accountId: string;
    isActive?: boolean;
    allowDeferred?: boolean;
  }): Promise<void>;
}

export function createProfessionalAdminStore(
  db: ServiceDb,
): ProfessionalAdminStore {
  return {
    async list(businessId) {
      return ((await rpc(db, 'cc_professional_list', {
        p_business_id: businessId,
      })) ?? []) as ProfessionalAccountView[];
    },
    async checkCustomer(businessId, customerId) {
      await rpc(db, 'cc_professional_check_customer', {
        p_business_id: businessId,
        p_customer_id: customerId,
      });
    },
    async findUserByEmail(email) {
      return ((await rpc(db, 'cc_auth_user_by_email', { p_email: email })) ??
        null) as string | null;
    },
    async link(args) {
      return (await rpc(db, 'cc_professional_link', {
        p_business_id: args.businessId,
        p_user_id: args.userId,
        p_customer_id: args.customerId,
        p_allow_deferred: args.allowDeferred,
        p_created_by: args.createdBy,
      })) as string;
    },
    async update(args) {
      await rpc(db, 'cc_professional_update', {
        p_business_id: args.businessId,
        p_account_id: args.accountId,
        p_is_active: args.isActive ?? null,
        p_allow_deferred: args.allowDeferred ?? null,
      });
    },
  };
}

export type ProfessionalAdminDeps = {
  authenticate(
    request: Request,
    businessId: string,
  ): Promise<{ user: { id: string }; membership: { role: string } }>;
  /** Step 5: only now the service-role backed store is created. */
  store(): ProfessionalAdminStore;
  /** Sends the invitation e-mail and returns the new Auth user id. */
  inviteUser(email: string, redirectTo: string): Promise<string>;
  getEnv: GetEnv;
  logger?: Logger;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ruleToApiError = (code: string) => {
  switch (code) {
    case 'customer_not_found':
      return new ApiError('No encontramos ese cliente.', 404, code);
    case 'price_list_required':
      return new ApiError(
        'Primero asignale al cliente una lista de precios Profesional o de convenio (Clientes → Editar).',
        409,
        code,
      );
    case 'user_is_member':
      return new ApiError(
        'Ese e-mail pertenece a una persona del equipo de CentroColor. Usá otro e-mail para el acceso profesional.',
        409,
        code,
      );
    case 'already_linked':
      return new ApiError(
        'Ese e-mail ya está vinculado a otro cliente profesional.',
        409,
        code,
      );
    case 'account_not_found':
      return new ApiError('No encontramos esa cuenta.', 404, code);
    default:
      return new ApiError('La solicitud no es válida.', 400, 'invalid_request');
  }
};

function parsePayload(input: Partial<ProfessionalAdminPayload>) {
  if (
    !PROFESSIONAL_ADMIN_ACTIONS.includes(
      input.action as ProfessionalAdminAction,
    )
  )
    throw new ApiError(
      'La acción solicitada no es válida.',
      400,
      'invalid_action',
    );
  if (typeof input.businessId !== 'string' || !UUID.test(input.businessId))
    throw new ApiError('Falta el negocio.', 400, 'invalid_business');
  if (input.action === 'link') {
    if (typeof input.email !== 'string' || !EMAIL.test(input.email.trim()))
      throw new ApiError('Revisá el e-mail.', 400, 'invalid_email');
    if (typeof input.customerId !== 'string' || !UUID.test(input.customerId))
      throw new ApiError('Elegí un cliente.', 400, 'invalid_customer');
  }
  if (input.action === 'update') {
    if (typeof input.accountId !== 'string' || !UUID.test(input.accountId))
      throw new ApiError('Falta la cuenta.', 400, 'invalid_account');
    if (
      (input.isActive !== undefined && typeof input.isActive !== 'boolean') ||
      (input.allowDeferredPayment !== undefined &&
        typeof input.allowDeferredPayment !== 'boolean')
    )
      throw new ApiError('La solicitud no es válida.', 400, 'invalid_request');
  }
  if (
    input.allowDeferredPayment !== undefined &&
    typeof input.allowDeferredPayment !== 'boolean'
  )
    throw new ApiError('La solicitud no es válida.', 400, 'invalid_request');
  return input as ProfessionalAdminPayload;
}

export async function handleProfessionalAdmin(
  request: Request,
  deps: ProfessionalAdminDeps,
) {
  if (request.method === 'OPTIONS') return preflight();
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  try {
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    const input = parsePayload(
      await body<Partial<ProfessionalAdminPayload>>(request),
    );
    if (!request.headers.get('Authorization'))
      throw new ApiError('Autorización requerida.', 401, 'unauthorized');
    const { user, membership } = await deps.authenticate(
      request,
      input.businessId,
    );
    logger('info', 'professional_admin_authorized', {
      requestId,
      action: input.action,
      userId: user.id,
      businessId: input.businessId,
      role: membership.role,
    });
    const store = deps.store();
    try {
      if (input.action === 'list')
        return json({ accounts: await store.list(input.businessId) });

      if (input.action === 'update') {
        await store.update({
          businessId: input.businessId,
          accountId: input.accountId!,
          isActive: input.isActive,
          allowDeferred: input.allowDeferredPayment,
        });
        return json({ accounts: await store.list(input.businessId) });
      }

      // link: validate the customer BEFORE inviting anybody, so a refused link sends no e-mail.
      const email = input.email!.trim().toLowerCase();
      await store.checkCustomer(input.businessId, input.customerId!);
      let userId = await store.findUserByEmail(email);
      let invited = false;
      if (!userId) {
        userId = await deps.inviteUser(
          email,
          `${intakeConfig(deps.getEnv).webBaseUrl}/profesionales`,
        );
        invited = true;
      }
      await store.link({
        businessId: input.businessId,
        userId,
        customerId: input.customerId!,
        allowDeferred: input.allowDeferredPayment === true,
        createdBy: user.id,
      });
      logger('info', 'professional_account_linked', {
        requestId,
        businessId: input.businessId,
        customerId: input.customerId,
        invited,
      });
      return json({ accounts: await store.list(input.businessId), invited });
    } catch (cause) {
      if (cause instanceof OrderRuleError) throw ruleToApiError(cause.code);
      throw cause;
    }
  } catch (cause) {
    return errorResponse(cause, {
      requestId,
      logger,
      context: 'professional_admin',
    });
  }
}

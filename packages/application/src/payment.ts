import {
  normalizeWorkPayment,
  requireVoidReason,
  type CustomerWorkAccount,
  type WorkAccount,
  type WorkPayment,
  type WorkPaymentKind,
  type WorkPaymentMethod,
  type WorkPaymentSourceType,
} from '@centrocolor/domain';

export interface WorkPaymentRepository {
  getAccount(
    businessId: string,
    sourceType: WorkPaymentSourceType,
    sourceId: string,
  ): Promise<WorkAccount | null>;
  getCustomerAccount(
    businessId: string,
    customerId: string,
  ): Promise<CustomerWorkAccount>;
  listOutstanding(businessId: string, branchId: string): Promise<WorkAccount[]>;
  post(payment: WorkPayment): Promise<WorkPayment>;
  void(
    businessId: string,
    paymentId: string,
    actorId: string,
    reason: string,
    occurredAt?: string,
  ): Promise<WorkPayment>;
}

export async function postWorkPayment(
  repository: WorkPaymentRepository,
  input: {
    businessId: string;
    branchId: string;
    customerId: string;
    sourceType: WorkPaymentSourceType;
    sourceId: string;
    paymentKind: WorkPaymentKind;
    paymentMethod: WorkPaymentMethod;
    amountCents: number;
    occurredAt: string;
    notes: string | null;
    createdBy: string;
  },
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  const payment = normalizeWorkPayment({
    id: options.id ?? crypto.randomUUID(),
    businessId: input.businessId,
    branchId: input.branchId,
    customerId: input.customerId,
    sourceType: input.sourceType,
    eventId: input.sourceType === 'event' ? input.sourceId : null,
    frameJobId: input.sourceType === 'frame_job' ? input.sourceId : null,
    photoJobId: input.sourceType === 'photo_job' ? input.sourceId : null,
    paymentKind: input.paymentKind,
    paymentMethod: input.paymentMethod,
    amountCents: input.amountCents,
    occurredAt: input.occurredAt,
    notes: input.notes,
    status: 'posted',
    createdBy: input.createdBy,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  });
  return repository.post(payment);
}

export const voidWorkPayment = (
  repository: WorkPaymentRepository,
  businessId: string,
  paymentId: string,
  actorId: string,
  reason: string,
) => repository.void(businessId, paymentId, actorId, requireVoidReason(reason));

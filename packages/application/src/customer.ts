import {
  normalizeCustomerDetails,
  type Customer,
  type CustomerDetails,
} from '@centrocolor/domain';

export interface CustomerRepository {
  list(businessId: string, limit: number): Promise<Customer[]>;
  search(businessId: string, query: string, limit: number): Promise<Customer[]>;
  get(businessId: string, id: string): Promise<Customer | null>;
  create(customer: Customer): Promise<Customer>;
  update(
    businessId: string,
    id: string,
    details: CustomerDetails,
  ): Promise<Customer>;
  setActive(
    businessId: string,
    id: string,
    isActive: boolean,
  ): Promise<Customer>;
}

export const customerListLimit = 100;

export function listCustomers(
  repository: CustomerRepository,
  businessId: string,
) {
  return repository.list(businessId, customerListLimit);
}

export function searchCustomers(
  repository: CustomerRepository,
  businessId: string,
  query: string,
) {
  const term = query.trim();
  return term
    ? repository.search(businessId, term, customerListLimit)
    : listCustomers(repository, businessId);
}

export function getCustomer(
  repository: CustomerRepository,
  businessId: string,
  id: string,
) {
  return repository.get(businessId, id);
}

export function createCustomer(
  repository: CustomerRepository,
  businessId: string,
  details: CustomerDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.create({
    id: options.id ?? crypto.randomUUID(),
    businessId,
    ...normalizeCustomerDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateCustomer(
  repository: CustomerRepository,
  businessId: string,
  id: string,
  details: CustomerDetails,
) {
  return repository.update(businessId, id, normalizeCustomerDetails(details));
}

export function deactivateCustomer(
  repository: CustomerRepository,
  businessId: string,
  id: string,
) {
  return repository.setActive(businessId, id, false);
}

export function reactivateCustomer(
  repository: CustomerRepository,
  businessId: string,
  id: string,
) {
  return repository.setActive(businessId, id, true);
}

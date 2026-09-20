import { describe, expect, it } from 'vitest';
import type { Customer, CustomerDetails } from '@centrocolor/domain';
import {
  createCustomer,
  deactivateCustomer,
  getCustomer,
  reactivateCustomer,
  searchCustomers,
  updateCustomer,
  type CustomerRepository,
} from './customer';

class MemoryCustomers implements CustomerRepository {
  private rows: Customer[] = [];

  async list(businessId: string, limit: number) {
    return this.rows
      .filter((row) => row.businessId === businessId)
      .slice(0, limit);
  }
  async search(businessId: string, query: string, limit: number) {
    const term = query.toLowerCase();
    return this.rows
      .filter((row) => row.businessId === businessId)
      .filter((row) =>
        [row.fullName, row.phone, row.email, row.documentNumber].some((value) =>
          value?.toLowerCase().includes(term),
        ),
      )
      .slice(0, limit);
  }
  async get(businessId: string, id: string) {
    return (
      this.rows.find((row) => row.businessId === businessId && row.id === id) ??
      null
    );
  }
  async create(customer: Customer) {
    this.rows.push(customer);
    return customer;
  }
  async update(businessId: string, id: string, details: CustomerDetails) {
    const row = await this.get(businessId, id);
    if (!row) throw new Error('Not found');
    Object.assign(row, details, { updatedAt: 'later' });
    return row;
  }
  async setActive(businessId: string, id: string, isActive: boolean) {
    const row = await this.get(businessId, id);
    if (!row) throw new Error('Not found');
    row.isActive = isActive;
    return row;
  }
}

const details: CustomerDetails = {
  fullName: 'Ana Pérez',
  phone: '+54 11 1234',
  email: 'ana@example.com',
  documentNumber: '12345678',
  notes: null,
};

describe('customer use cases', () => {
  it('generates a UUID and UTC timestamps for an offline create', async () => {
    const repository = new MemoryCustomers();
    const customer = await createCustomer(repository, 'business-a', details);
    expect(customer.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(customer.createdAt).toMatch(/Z$/);
    expect(customer.updatedAt).toBe(customer.createdAt);
  });

  it('creates, searches, updates and toggles within one business', async () => {
    const repository = new MemoryCustomers();
    const customer = await createCustomer(repository, 'business-a', details, {
      id: 'customer-id',
      now: '2026-09-20T00:00:00.000Z',
    });
    expect(customer.businessId).toBe('business-a');
    expect(customer.isActive).toBe(true);
    expect(await getCustomer(repository, 'business-b', customer.id)).toBeNull();
    expect(
      (await searchCustomers(repository, 'business-a', '12345678'))[0]?.id,
    ).toBe(customer.id);
    expect(await searchCustomers(repository, 'business-b', 'Ana')).toEqual([]);
    expect(
      (
        await updateCustomer(repository, 'business-a', customer.id, {
          ...details,
          fullName: 'Ana P.',
        })
      ).fullName,
    ).toBe('Ana P.');
    expect(
      (await deactivateCustomer(repository, 'business-a', customer.id))
        .isActive,
    ).toBe(false);
    expect(
      (await reactivateCustomer(repository, 'business-a', customer.id))
        .isActive,
    ).toBe(true);
    await expect(
      updateCustomer(repository, 'business-b', customer.id, details),
    ).rejects.toThrow('Not found');
  });
});

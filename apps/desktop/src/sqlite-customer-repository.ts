import Database from '@tauri-apps/plugin-sql';
import type { CustomerRepository } from '@centrocolor/application';
import type { Customer, CustomerDetails } from '@centrocolor/domain';

type Row = {
  id: string;
  business_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  document_number: string | null;
  notes: string | null;
  is_active: number;
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
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function database() {
  return Database.load('sqlite:centrocolor.db');
}

export class SQLiteCustomerRepository implements CustomerRepository {
  async list(businessId: string, limit: number): Promise<Customer[]> {
    const db = await database();
    const rows = await db.select<Row[]>(
      'SELECT * FROM customers WHERE business_id = ? ORDER BY is_active DESC, full_name COLLATE NOCASE, id LIMIT ?',
      [businessId, limit],
    );
    return rows.map(fromRow);
  }

  async search(
    businessId: string,
    query: string,
    limit: number,
  ): Promise<Customer[]> {
    const db = await database();
    const term = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.select<Row[]>(
      `SELECT * FROM customers WHERE business_id = ? AND
       (full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR
        email LIKE ? ESCAPE '\\' OR document_number LIKE ? ESCAPE '\\')
       ORDER BY is_active DESC, full_name COLLATE NOCASE, id LIMIT ?`,
      [businessId, term, term, term, term, limit],
    );
    return rows.map(fromRow);
  }

  async get(businessId: string, id: string): Promise<Customer | null> {
    const db = await database();
    const rows = await db.select<Row[]>(
      'SELECT * FROM customers WHERE business_id = ? AND id = ?',
      [businessId, id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async create(customer: Customer): Promise<Customer> {
    const db = await database();
    await db.execute(
      `INSERT INTO customers
       (id, business_id, full_name, phone, email, document_number, notes, is_active, created_at, updated_at, sync_origin, local_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 1)`,
      [
        customer.id,
        customer.businessId,
        customer.fullName,
        customer.phone,
        customer.email,
        customer.documentNumber,
        customer.notes,
        customer.isActive ? 1 : 0,
        customer.createdAt,
        customer.updatedAt,
      ],
    );
    return customer;
  }

  async update(
    businessId: string,
    id: string,
    details: CustomerDetails,
  ): Promise<Customer> {
    const db = await database();
    const result = await db.execute(
      `UPDATE customers SET full_name = ?, phone = ?, email = ?, document_number = ?,
       notes = ?, updated_at = ?, sync_origin = 'local',
       local_revision = local_revision + 1 WHERE business_id = ? AND id = ?`,
      [
        details.fullName,
        details.phone,
        details.email,
        details.documentNumber,
        details.notes,
        new Date().toISOString(),
        businessId,
        id,
      ],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el cliente.');
    return (await this.get(businessId, id))!;
  }

  async setActive(
    businessId: string,
    id: string,
    isActive: boolean,
  ): Promise<Customer> {
    const db = await database();
    const result = await db.execute(
      "UPDATE customers SET is_active = ?, updated_at = ?, sync_origin = 'local', local_revision = local_revision + 1 WHERE business_id = ? AND id = ?",
      [isActive ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el cliente.');
    return (await this.get(businessId, id))!;
  }
}

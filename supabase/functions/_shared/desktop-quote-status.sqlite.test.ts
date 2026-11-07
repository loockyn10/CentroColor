// Migración SQLite 0021 (pedidos «pendientes de presupuestar») contra un SQLite real: se aplican
// TODAS las migraciones de Desktop, en orden, y se prueban los triggers que sostienen la regla
// «un pedido sin importe no se cobra, no se termina y no se le pone un precio a mano».
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../../apps/desktop/src-tauri/migrations');
const NOW = '2026-11-08T10:00:00.000Z';
const B = 'b0000000-0000-4000-8000-000000000001';
const BR = 'b0000000-0000-4000-8000-000000000002';
const C = 'b0000000-0000-4000-8000-000000000003';
const U = 'b0000000-0000-4000-8000-000000000004';
const JOB = 'b0000000-0000-4000-8000-000000000010';
const ITEM = 'b0000000-0000-4000-8000-000000000011';

let db: DatabaseSync;
const message = (work: () => unknown) => {
  try {
    work();
    return null;
  } catch (cause) {
    return (cause as Error).message;
  }
};

function job(id: string, quoteStatus: string, origin = 'remote') {
  db.prepare(
    `INSERT INTO photo_jobs(id,business_id,branch_id,customer_id,status,priority,created_by,created_at,updated_at,sync_origin,quote_status)
     VALUES(?,?,?,?,'received','normal',?,?,?,?,?)`,
  ).run(id, B, BR, C, U, NOW, NOW, origin, quoteStatus);
}
function item(id: string, jobId: string, unit: number, origin = 'remote') {
  db.prepare(
    `INSERT INTO photo_job_items(id,business_id,photo_job_id,service_name_snapshot,quantity,unit_price_cents,total_cents,is_active,created_at,updated_at,sync_origin)
     VALUES(?,?,?,'10x15 · Brillo',3,?,?,1,?,?,?)`,
  ).run(id, B, jobId, unit, unit * 3, NOW, NOW, origin);
}
const payment = (jobId: string, amount = 100) =>
  db
    .prepare(
      `INSERT INTO work_payments(id,business_id,branch_id,customer_id,source_type,photo_job_id,payment_kind,payment_method,amount_cents,occurred_at,created_by,created_at,updated_at)
       VALUES(?,?,?,?,'photo_job',?,'payment','cash',?,?,?,?,?)`,
    )
    .run(crypto.randomUUID(), B, BR, C, jobId, amount, NOW, U, NOW, NOW);

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync(DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(resolve(DIR, file), 'utf8'));
  db.prepare(
    `INSERT INTO businesses(id,name,slug,created_at,updated_at) VALUES(?,'CentroColor','centrocolor',?,?)`,
  ).run(B, NOW, NOW);
  db.prepare(
    `INSERT INTO branches(id,business_id,name,created_at,updated_at) VALUES(?,?,'Central',?,?)`,
  ).run(BR, B, NOW, NOW);
  db.prepare(
    `INSERT INTO customers(id,business_id,full_name,created_at,updated_at) VALUES(?,?,'Lucía',?,?)`,
  ).run(C, B, NOW, NOW);
  // The signed-in operator of this device: local writes are only accepted inside this context.
  db.prepare(
    `INSERT INTO authorized_context(slot,user_id,display_name,business_id,business_name,branch_id,branch_name,role,last_cloud_validation_at)
     VALUES(1,?,'Dueña',?,'CentroColor',?,'Central','owner',?)`,
  ).run(U, B, BR, NOW);
});

describe('SQLite 0021: pedido pendiente de presupuestar', () => {
  it('los pedidos existentes y los de Desktop nacen presupuestados', () => {
    db.prepare(
      `INSERT INTO photo_jobs(id,business_id,branch_id,customer_id,status,priority,created_by,created_at,updated_at)
       VALUES(?,?,?,?,'received','normal',?,?,?)`,
    ).run(JOB, B, BR, C, U, NOW, NOW);
    expect(db.prepare(`SELECT quote_status q FROM photo_jobs`).get()).toEqual({
      q: 'quoted',
    });
    expect(
      message(() =>
        db.prepare(`UPDATE photo_jobs SET quote_status='nonsense'`).run(),
      ),
    ).toMatch(/CHECK/);
  });

  it('no registra pagos sobre un pedido pendiente, pero sí sobre uno presupuestado', () => {
    job(JOB, 'pending_quote');
    item(ITEM, JOB, 0);
    expect(message(() => payment(JOB))).toMatch(/pendiente de presupuestar/);
    expect(db.prepare(`SELECT count(*) n FROM work_payments`).get()).toEqual({
      n: 0,
    });
    // Presupuestado (llega de la nube): ya admite pagos hasta el total.
    db.prepare(`UPDATE photo_jobs SET quote_status='quoted' WHERE id=?`).run(
      JOB,
    );
    db.prepare(
      `UPDATE photo_job_items SET unit_price_cents=30000,total_cents=90000 WHERE id=?`,
    ).run(ITEM);
    expect(message(() => payment(JOB, 100))).toBeNull();
  });

  it('un cambio local no le pone importe a un pedido pendiente; el que llega de la nube sí', () => {
    job(JOB, 'pending_quote');
    item(ITEM, JOB, 0);
    const edit = (origin: string) =>
      db
        .prepare(
          `UPDATE photo_job_items SET unit_price_cents=30000,total_cents=90000,sync_origin=? WHERE id=?`,
        )
        .run(origin, ITEM);
    expect(message(() => edit('local'))).toMatch(/pendiente de presupuestar/);
    expect(message(() => edit('remote'))).toBeNull();
  });

  it('no se marca listo ni entregado desde Desktop mientras está pendiente', () => {
    job(JOB, 'pending_quote');
    const setStatus = (status: string, origin = 'local') =>
      db
        .prepare(`UPDATE photo_jobs SET status=?,sync_origin=? WHERE id=?`)
        .run(status, origin, JOB);
    expect(message(() => setStatus('ready'))).toMatch(
      /pendiente de presupuestar/,
    );
    expect(message(() => setStatus('delivered'))).toMatch(
      /pendiente de presupuestar/,
    );
    // En proceso sí: el laboratorio puede empezar mientras se presupuesta.
    expect(message(() => setStatus('in_progress'))).toBeNull();
    // Lo que llega de la nube (por ejemplo, un pedido ya cobrado y entregado) no se bloquea.
    expect(message(() => setStatus('ready', 'remote'))).toBeNull();
  });
});

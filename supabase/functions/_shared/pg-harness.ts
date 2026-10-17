// Real PostgreSQL (PGlite) loaded with the project's migrations. Test-only: it is only
// imported by *.test.ts and never by an Edge Function.
//
// Supabase pieces that do not exist in a bare Postgres are replaced by minimal stand-ins
// (auth.users/auth.uid(), Vault, roles). Everything else — tables, constraints, triggers,
// RLS policies, grants and RPC bodies — is the shipped SQL, executed unmodified.
import { PGlite, types } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationsDir = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
);

const PRELUDE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text, description text, secret text not null
);
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into vault.secrets(secret, name, description) values (new_secret, new_name, new_description) returning id into v;
  return v;
end $$;
create schema extensions;
`;

export const sqlMigrations = () =>
  readdirSync(migrationsDir)
    .filter((x) => x.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(migrationsDir + name, 'utf8').replace(
        /create extension if not exists supabase_vault with schema vault;/gi,
        '',
      ),
    }));

export type Db = PGlite;

export async function createDatabase(options: { upTo?: string } = {}) {
  // PostgREST returns timestamps as ISO strings with microseconds: keep them as such, so
  // optimistic-concurrency comparisons (`updated_at = <value read earlier>`) behave as in Supabase.
  const db = new PGlite({
    parsers: {
      [types.TIMESTAMPTZ]: (value: string) =>
        value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'),
    },
  });
  await db.exec(PRELUDE);
  for (const migration of sqlMigrations()) {
    if (options.upTo && migration.name > options.upTo) break;
    try {
      await db.exec(migration.sql);
    } catch (cause) {
      throw new Error(
        `Migración ${migration.name} falló: ${(cause as Error).message}`,
        { cause },
      );
    }
  }
  return db;
}

/** Runs `work` as a database role, with an optional authenticated user id (auth.uid()). */
export async function asRole<T>(
  db: Db,
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId ?? '',
  ]);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export const IDS = {
  business: '11111111-1111-4111-8111-111111111111',
  otherBusiness: '22222222-2222-4222-8222-222222222222',
  branch: '33333333-3333-4333-8333-333333333333',
  otherBranch: '44444444-4444-4444-8444-444444444444',
  owner: '55555555-5555-4555-8555-555555555555',
  staff: '66666666-6666-4666-8666-666666666666',
  outsider: '77777777-7777-4777-8777-777777777777',
  svc10x15: 'a0000000-0000-4000-8000-000000000015',
  svc13x18: 'a0000000-0000-4000-8000-000000000018',
  svc20x30: 'a0000000-0000-4000-8000-000000000030',
  svcPrivate: 'a0000000-0000-4000-8000-0000000000ff',
  svcOtherBusiness: 'b0000000-0000-4000-8000-000000000015',
} as const;

/** One Business with owner + staff, one branch and a public price list. */
export async function seedWorld(db: Db) {
  await db.exec(`
    insert into auth.users(id, email) values
      ('${IDS.owner}', 'owner@example.com'),
      ('${IDS.staff}', 'staff@example.com'),
      ('${IDS.outsider}', 'outsider@example.com');
    insert into public.businesses(id, name, slug) values
      ('${IDS.business}', 'CentroColor', 'centrocolor'),
      ('${IDS.otherBusiness}', 'Otro Negocio', 'otro');
    insert into public.branches(id, business_id, name) values
      ('${IDS.branch}', '${IDS.business}', 'Sucursal principal'),
      ('${IDS.otherBranch}', '${IDS.otherBusiness}', 'Otra');
    insert into public.business_memberships(business_id, user_id, role) values
      ('${IDS.business}', '${IDS.owner}', 'owner'),
      ('${IDS.business}', '${IDS.staff}', 'staff'),
      ('${IDS.otherBusiness}', '${IDS.outsider}', 'owner');
    insert into public.photo_services(id, business_id, name, service_type, width_mm, height_mm,
      default_unit_price_cents, workflow_route, requires_customer_files, is_public, public_name,
      public_description, public_sort_order, public_order_enabled) values
      ('${IDS.svc10x15}', '${IDS.business}', 'Impresión 10x15 brillante', 'print', 100, 150, 50000, 'lab', true, true, '10x15', 'Papel brillante', 1, true),
      ('${IDS.svc13x18}', '${IDS.business}', '13x18', 'print', 130, 180, 80000, 'lab', true, true, null, null, 2, true),
      ('${IDS.svc20x30}', '${IDS.business}', '20x30', 'enlargement', 200, 300, 250000, 'lab', true, true, null, null, 3, true),
      ('${IDS.svcPrivate}', '${IDS.business}', 'Restauración', 'restoration', null, null, 900000, 'editing', true, false, null, null, 9, false),
      ('${IDS.svcOtherBusiness}', '${IDS.otherBusiness}', '10x15', 'print', 100, 150, 1, 'lab', true, true, null, null, 1, true);
  `);
}

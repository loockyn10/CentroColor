// Structural contract between the Edge Functions and the SQL that was actually shipped.
//
// Typecheck, unit tests and build all passed while every service-role query failed in
// production with "permission denied" (42501), because nothing compared what the code
// touches with what the migrations grant. This test does that comparison.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const functionsDir = fileURLToPath(new URL('../', import.meta.url));
const migrationsDir = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
);

type Privileges = {
  select: boolean;
  insert: boolean;
  delete: boolean;
  update: boolean | Set<string>;
};
type TableAccess = Record<string, Set<string>>; // table -> operations used

const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, '');

const migrations = readdirSync(migrationsDir)
  .filter((x) => x.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    sql: stripSqlComments(readFileSync(migrationsDir + name, 'utf8')),
  }));
const allSql = migrations.map((x) => x.sql).join('\n');

function grantsFor(role: string) {
  const grants = new Map<string, Privileges>();
  const statement = /grant\s+([^;]+?)\s+on\s+([^;]+?)\s+to\s+([^;]+?);/gi;
  for (const match of allSql.matchAll(statement)) {
    const roles = match[3]!.split(',').map((x) => x.trim().toLowerCase());
    if (!roles.includes(role)) continue;
    const privilegeText = match[1]!.toLowerCase();
    if (privilegeText.startsWith('execute')) continue;
    const tables = match[2]!
      .replace(/\s+/g, ' ')
      .split(',')
      .map((x) => x.trim().replace(/^(table\s+)?public\./, ''));
    for (const table of tables) {
      const current =
        grants.get(table) ??
        ({
          select: false,
          insert: false,
          delete: false,
          update: false,
        } as Privileges);
      for (const p of privilegeText.matchAll(
        /(select|insert|update|delete|all)(?:\s*\(([^)]*)\))?/g,
      )) {
        const kind = p[1]!;
        const columns = p[2]?.split(',').map((x) => x.trim());
        if (kind === 'all') {
          current.select = current.insert = current.delete = true;
          current.update = true;
        } else if (kind === 'update') {
          if (columns) {
            current.update =
              current.update === true
                ? true
                : new Set([
                    ...(current.update || new Set<string>()),
                    ...columns,
                  ]);
          } else current.update = true;
        } else current[kind as 'select' | 'insert' | 'delete'] = true;
      }
      grants.set(table, current);
    }
  }
  return grants;
}

const serviceGrants = grantsFor('service_role');

function balanced(source: string, openIndex: number) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return '';
}

/** Top-level keys of an object literal such as `{ a: 1, b, c: fn(x, y) }`. */
function objectKeys(literal: string) {
  const body = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys: string[] = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    const property = current.trim();
    if (property) keys.push(property.split(':')[0]!.trim());
    current = '';
  };
  for (const char of body) {
    if ('({['.includes(char)) depth += 1;
    if (')}]'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) flush();
    else current += char;
  }
  flush();
  return keys;
}

/** Tables and operations performed through a service-role client in one source file. */
function serviceAccess(source: string) {
  const access: TableAccess = {};
  const updateColumns: Record<string, Set<string>> = {};
  const rpcs = new Set<string>();
  for (const match of source.matchAll(
    /\b(?:db|service)\s*\.\s*from\(\s*'([a-z_]+)'\s*\)/g,
  )) {
    const table = match[1]!;
    const statement = source.slice(match.index!).split(';')[0]!;
    const chain = statement.slice(match[0].length);
    const ops = (access[table] ??= new Set());
    const methods = [
      ...chain.matchAll(/\.(select|insert|update|upsert|delete)\s*\(/g),
    ];
    for (const m of methods) {
      const method = m[1]!;
      if (method === 'upsert') {
        ops.add('insert');
        ops.add('update');
      } else ops.add(method);
      if (method === 'update') {
        const payload = balanced(chain, m.index! + m[0].length - 1);
        const keys = (updateColumns[table] ??= new Set());
        for (const key of objectKeys(payload)) keys.add(key);
      }
    }
    // `.insert(...).select()` / `.update(...).select()` read the row back: needs SELECT.
    if (
      /\.(insert|update|upsert)\s*\(/.test(chain) &&
      /\.select\s*\(/.test(chain)
    )
      ops.add('select');
    if (/\.eq\(|\.in\(|\.is\(|\.neq\(|\.gte\(/.test(chain)) ops.add('select');
  }
  for (const match of source.matchAll(
    /\b(?:db|service)\s*\.\s*rpc\(\s*'([a-z_]+)'/g,
  ))
    rpcs.add(match[1]!);
  return { access, updateColumns, rpcs };
}

const sources = [
  '_shared/store-supabase.ts',
  'google-drive-oauth-start/index.ts',
  'google-drive-oauth-callback/index.ts',
].map((file) => ({
  file,
  ...serviceAccess(readFileSync(functionsDir + file, 'utf8')),
}));

describe('service_role: lo que las Edge Functions usan está otorgado en migraciones', () => {
  it('el análisis estático encuentra las tablas del módulo (sanidad del propio test)', () => {
    const tables = new Set(sources.flatMap((x) => Object.keys(x.access)));
    for (const table of [
      'google_drive_integrations',
      'google_oauth_states',
      'photo_jobs',
      'photo_job_items',
      'photo_services',
      'customers',
      'businesses',
      'photo_job_upload_links',
      'photo_job_files',
      'photo_job_drive_folders',
    ])
      expect(tables, table).toContain(table);
  });

  for (const source of sources) {
    for (const [table, operations] of Object.entries(source.access)) {
      it(`${source.file} → ${table}: ${[...operations].sort().join(', ')}`, () => {
        const grant = serviceGrants.get(table);
        expect(
          grant,
          `service_role no tiene ningún GRANT sobre ${table}`,
        ).toBeDefined();
        for (const operation of operations) {
          if (operation === 'update') {
            expect(grant!.update, `UPDATE en ${table}`).toBeTruthy();
            if (grant!.update !== true) {
              for (const column of source.updateColumns[table] ?? [])
                expect(
                  (grant!.update as Set<string>).has(column),
                  `UPDATE de ${table}.${column} no está otorgado`,
                ).toBe(true);
            }
          } else
            expect(
              grant![operation as 'select' | 'insert' | 'delete'],
              `${operation.toUpperCase()} en ${table}`,
            ).toBe(true);
        }
      });
    }
  }

  it('toda RPC invocada con service_role tiene GRANT EXECUTE a service_role', () => {
    const rpcs = new Set(sources.flatMap((x) => [...x.rpcs]));
    expect(rpcs.size).toBeGreaterThan(0);
    for (const rpc of rpcs)
      expect(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\s*\\([^)]*\\)\\s+to\\s+service_role`,
          'i',
        ).test(allSql),
        `falta GRANT EXECUTE ${rpc}`,
      ).toBe(true);
  });

  it('las funciones SECURITY DEFINER fijan search_path y no se exponen a anon/authenticated', () => {
    const definers = [
      ...allSql.matchAll(
        /create\s+function\s+(public\.cc_[a-z_]+)\s*\(([^)]*)\)[\s\S]*?(?=\$\$;)/gi,
      ),
    ];
    expect(definers.length).toBeGreaterThanOrEqual(4);
    for (const definer of definers) {
      expect(definer[0], definer[1]).toMatch(/security\s+definer/i);
      expect(definer[0], definer[1]).toMatch(/set\s+search_path\s*=\s*''/i);
      expect(allSql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+${definer[1]!.replace('.', '\\.')}\\s*\\([^)]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ),
      );
    }
  });
});

describe('RLS y exposición de las tablas del Sprint 13', () => {
  const intakeTables = [
    'google_drive_integrations',
    'google_oauth_states',
    'photo_job_upload_links',
    'photo_job_files',
    'photo_job_drive_folders',
  ];

  it('todas tienen RLS habilitado', () => {
    for (const table of intakeTables)
      expect(allSql, table).toMatch(
        new RegExp(
          `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
          'i',
        ),
      );
  });

  it('anon no recibe ningún privilegio sobre tablas de intake ni de Drive', () => {
    const anon = grantsFor('anon');
    for (const table of intakeTables)
      expect(anon.has(table), table).toBe(false);
  });

  it('authenticated sólo lee: sin INSERT/UPDATE/DELETE sobre tablas server-owned', () => {
    const authenticated = grantsFor('authenticated');
    for (const table of intakeTables) {
      const grant = authenticated.get(table);
      if (!grant) continue;
      expect(grant.insert, table).toBe(false);
      expect(grant.update, table).toBe(false);
      expect(grant.delete, table).toBe(false);
    }
    // El estado OAuth y el mapa de carpetas nunca son legibles por el cliente.
    expect(authenticated.has('google_oauth_states')).toBe(false);
    expect(authenticated.has('photo_job_drive_folders')).toBe(false);
  });

  it('service_role no tiene DELETE sobre las tablas de intake (se revoca/cierra, no se borra)', () => {
    for (const table of intakeTables)
      expect(serviceGrants.get(table)?.delete ?? false, table).toBe(false);
  });
});

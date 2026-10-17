/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// A supabase-js–shaped query builder that runs on PGlite as the `service_role` database
// role. It lets the REAL store implementations (store-supabase.ts,
// public-order-store-supabase.ts, whatsapp-store-supabase.ts) run unmodified against the real
// migrations, so wrong column names, missing GRANTs and RPC argument mismatches fail in the
// tests instead of in production. Test-only: never imported by an Edge Function.
import { asRole, type Db } from './pg-harness';
import type { ServiceDb } from './store-supabase';

type Filter = { sql: (index: number) => string; values: unknown[] };
export type Actor = {
  role: 'service_role' | 'authenticated';
  userId: string | null;
};
type Result = { data: any; error: any; count?: number | null };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (value: string) => {
  if (!IDENT.test(value)) throw new Error(`identificador inválido: ${value}`);
  return value;
};

/** PostgREST returns ISO strings for timestamps; PGlite returns Date objects. */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}

function toError(cause: any) {
  return {
    code: cause?.code ?? 'unknown',
    message: cause?.message ?? String(cause),
    details: cause?.detail ?? null,
    hint: cause?.hint ?? null,
  };
}

class Query implements PromiseLike<Result> {
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private columns = '*';
  private head = false;
  private count = false;
  private payload: Record<string, unknown> = {};
  private conflict: string | null = null;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private max: number | null = null;
  private mode: 'many' | 'maybe' | 'single' = 'many';
  private returning = false;

  constructor(
    private readonly db: Db,
    private readonly table: string,
    private readonly actor: Actor,
  ) {}

  select(columns = '*', options: { count?: string; head?: boolean } = {}) {
    if (this.operation === 'select') {
      this.columns = columns;
      this.head = Boolean(options.head);
      this.count = Boolean(options.count);
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  insert(row: Record<string, unknown>) {
    this.operation = 'insert';
    this.payload = row;
    return this;
  }
  update(patch: Record<string, unknown>) {
    this.operation = 'update';
    this.payload = patch;
    return this;
  }
  upsert(row: Record<string, unknown>, options: { onConflict?: string } = {}) {
    this.operation = 'upsert';
    this.payload = row;
    this.conflict = options.onConflict ?? null;
    return this;
  }
  private where(
    column: string,
    make: (i: number) => string,
    ...values: unknown[]
  ) {
    ident(column);
    this.filters.push({ sql: (i) => make(i), values });
    return this;
  }
  eq(column: string, value: unknown) {
    return value === null
      ? this.where(column, () => `${ident(column)} is null`)
      : this.where(column, (i) => `${column} = $${i}`, value);
  }
  neq(column: string, value: unknown) {
    return this.where(column, (i) => `${column} <> $${i}`, value);
  }
  is(column: string, value: null) {
    void value;
    return this.where(column, () => `${column} is null`);
  }
  in(column: string, values: unknown[]) {
    return this.where(column, (i) => `${column} = any($${i})`, values);
  }
  gte(column: string, value: unknown) {
    return this.where(column, (i) => `${column} >= $${i}`, value);
  }
  /** PostgREST `or=(a.gt.1,and(b.eq.2,c.gt.3))` — the cursor pagination syntax of the sync code. */
  or(expression: string) {
    const operators: Record<string, string> = {
      eq: '=',
      neq: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
    };
    const values: unknown[] = [];
    const split = (text: string) => {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const char of text) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
          parts.push(current);
          current = '';
        } else current += char;
      }
      if (current) parts.push(current);
      return parts;
    };
    const term = (text: string, base: number): string => {
      const group = /^(and|or)\((.*)\)$/.exec(text);
      if (group)
        return `(${split(group[2]!)
          .map((part) => term(part, base))
          .join(` ${group[1]} `)})`;
      const [column, operator, ...rest] = text.split('.');
      values.push(rest.join('.'));
      return `${ident(column!)} ${operators[operator!]!} $${base + values.length}`;
    };
    const parts = split(expression);
    this.filters.push({
      sql: (index) => {
        values.length = 0;
        return `(${parts.map((part) => term(part, index - 1)).join(' or ')})`;
      },
      get values() {
        return values;
      },
    });
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push(
      `${ident(column)} ${options.ascending === false ? 'desc' : 'asc'}`,
    );
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }

  private build() {
    const table = `public.${ident(this.table)}`;
    const values: unknown[] = [];
    const whereSql = () => {
      if (!this.filters.length) return '';
      const parts = this.filters.map((f) => {
        const index = values.length + 1;
        const text = f.sql(index); // may compute f.values (or filters do)
        values.push(...f.values);
        return text;
      });
      return ` where ${parts.join(' and ')}`;
    };
    const cols = this.columns
      .split(',')
      .map((x) => (x.trim() === '*' ? '*' : ident(x.trim())))
      .join(', ');
    if (this.operation === 'select') {
      const head = this.head ? 'count(*)::int as n' : cols;
      let sql = `select ${head} from ${table}${whereSql()}`;
      if (this.orders.length) sql += ` order by ${this.orders.join(', ')}`;
      if (this.max !== null) sql += ` limit ${Number(this.max)}`;
      return { sql, values };
    }
    const keys = Object.keys(this.payload).map(ident);
    const returning = this.returning ? ` returning ${cols}` : '';
    if (this.operation === 'insert' || this.operation === 'upsert') {
      keys.forEach((k) => values.push(this.payload[k]));
      let sql = `insert into ${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`;
      if (this.operation === 'upsert') {
        const target = (this.conflict ?? 'id')
          .split(',')
          .map((x) => ident(x.trim()));
        const updates = keys
          .filter((k) => !target.includes(k))
          .map((k) => `${k} = excluded.${k}`);
        sql += ` on conflict (${target.join(', ')}) do update set ${updates.join(', ')}`;
      }
      return { sql: sql + returning, values };
    }
    const sets = keys.map((k) => {
      values.push(this.payload[k]);
      return `${k} = $${values.length}`;
    });
    return {
      sql: `update ${table} set ${sets.join(', ')}${whereSql()}${returning}`,
      values,
    };
  }

  private async execute(): Promise<Result> {
    try {
      const { sql, values } = this.build();
      const result = await asRole(
        this.db,
        this.actor.role,
        this.actor.userId,
        () => this.db.query<any>(sql, values),
      );
      const rows = normalize(result.rows) as any[];
      if (this.operation === 'select' && this.head)
        return { data: null, error: null, count: rows[0]?.n ?? 0 };
      const hasData = this.operation === 'select' || this.returning;
      if (!hasData) return { data: null, error: null };
      if (this.mode === 'many') return { data: rows, error: null };
      if (rows.length > 1)
        return {
          data: null,
          error: { code: 'PGRST116', message: 'multiple rows' },
        };
      if (this.mode === 'single' && rows.length === 0)
        return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      return { data: rows[0] ?? null, error: null };
    } catch (cause) {
      return { data: null, error: toError(cause) };
    }
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createPgServiceDb(
  db: Db,
  actor: Actor = { role: 'service_role', userId: null },
): ServiceDb {
  return {
    from: (table: string) => new Query(db, table, actor),
    async rpc(name: string, args: Record<string, unknown>) {
      try {
        ident(name);
        const keys = Object.keys(args).map(ident);
        // supabase-js sends JSON: arrays of objects / objects are jsonb parameters.
        const values = keys.map((k) => {
          const value = args[k];
          const structured =
            (Array.isArray(value) &&
              value.some((x) => x !== null && typeof x === 'object')) ||
            (value !== null &&
              typeof value === 'object' &&
              !Array.isArray(value));
          return structured ? JSON.stringify(value) : value;
        });
        const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
        const meta = await db.query<{ proretset: boolean; typname: string }>(
          `select p.proretset, t.typname from pg_proc p join pg_type t on t.oid = p.prorettype
           where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
          [name],
        );
        const { proretset, typname } = meta.rows[0]!;
        const result = await asRole(db, actor.role, actor.userId, () =>
          db.query<any>(`select * from ${call}`, values),
        );
        const rows = normalize(result.rows) as any[];
        if (proretset) return { data: rows, error: null };
        if (typname === 'void') return { data: null, error: null };
        const first = rows[0] ? Object.values(rows[0])[0] : null;
        return { data: first ?? null, error: null };
      } catch (cause) {
        return { data: null, error: toError(cause) };
      }
    },
  };
}

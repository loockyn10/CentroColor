/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// A complete backend for integration tests: the real migrations on PGlite, the real store
// implementations (through pg-service-db), the real Drive gateway against an emulated Google
// and the real handlers. Only the network edges (Google, Meta) are doubles.
import { vi } from 'vitest';
import { createFakeGoogle } from './fake-google';
import { createDriveGateway } from './google-drive';
import { createPublicOrderStore } from './public-order-store-supabase';
import { createPhotoIntakeStore } from './store-supabase';
import { createWhatsAppStore } from './whatsapp-store-supabase';
import { createMetaClient } from './meta-client';
import { createPgServiceDb } from './pg-service-db';
import { IDS, asRole, createDatabase, seedWorld, type Db } from './pg-harness';
import type { PublicOrderDeps } from './public-order-handlers';
import type { PublicDeps } from './upload-handlers';
import { ENV } from './test-support';

export const WORLD_ENV: Record<string, string> = {
  ...ENV,
  WHATSAPP_DISPATCH_SECRET: 'dispatch-secret-0123456789abcdef',
  WHATSAPP_APP_SECRET: 'meta-app-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token-0123456789',
};
export const worldEnv = (name: string) => WORLD_ENV[name];

export type MetaCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
};

/** Scripted Meta Graph API: queue responses, inspect what was sent. */
export function createFakeMeta() {
  const calls: MetaCall[] = [];
  const queue: (Response | Error)[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    if (String(input).includes('/messages'))
      return json({
        messaging_product: 'whatsapp',
        messages: [{ id: `wamid.${calls.length}` }],
      });
    return json({});
  }) as typeof fetch;
  return {
    fetcher,
    calls,
    reply: (body: unknown, status = 200) => queue.push(json(body, status)),
    fail: (cause: Error) => queue.push(cause),
  };
}

export async function createWorld() {
  const db = await createDatabase();
  await seedWorld(db);
  const secret = (
    await db.query<{ id: string }>(
      `select vault.create_secret('google-refresh-token', 'google-test', '') id`,
    )
  ).rows[0]!.id;
  await db.query(
    `insert into public.google_drive_integrations(business_id, root_folder_id, refresh_token_secret_id, connected_by, status)
     values ($1, 'root-folder', $2, $3, 'connected')`,
    [IDS.business, secret, IDS.owner],
  );
  const service = createPgServiceDb(db);
  const intake = createPhotoIntakeStore(service);
  const orders = createPublicOrderStore(service);
  const whatsapp = createWhatsAppStore(service);
  const google = createFakeGoogle();
  const logger = vi.fn();
  const drive = createDriveGateway({
    store: intake,
    getEnv: worldEnv,
    fetcher: google.fetcher,
    logger,
  });
  const meta = createFakeMeta();
  const metaClient = createMetaClient({
    fetcher: meta.fetcher,
    apiVersion: 'v22.0',
    timeoutMs: 1000,
  });
  let clock = Date.now();
  const now = () => clock;
  const orderDeps: PublicOrderDeps = {
    intake,
    orders,
    drive,
    getEnv: worldEnv,
    now,
    logger,
  };
  const uploadDeps: PublicDeps = {
    store: intake,
    drive,
    getEnv: worldEnv,
    now,
    logger,
  };
  return {
    db,
    intake,
    orders,
    whatsapp,
    google,
    drive,
    meta,
    metaClient,
    logger,
    orderDeps,
    uploadDeps,
    now,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
export type World = Awaited<ReturnType<typeof createWorld>>;

export const authenticatedCount = (db: Db, userId: string, table: string) =>
  asRole(db, 'authenticated', userId, async () =>
    Number(
      (await db.query<any>(`select count(*)::int n from public.${table}`))
        .rows[0].n,
    ),
  );

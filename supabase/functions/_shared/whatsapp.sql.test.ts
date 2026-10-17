/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Sprint 14 notification SQL on a real PostgreSQL (PGlite): the ready trigger, its
// idempotency, the sender operations and the secrecy of the access token.
import { beforeEach, describe, expect, it } from 'vitest';
import { IDS, asRole, createDatabase, seedWorld, type Db } from './pg-harness';
import {
  configureWhatsApp,
  notifications,
  setStatus,
  submittedOrder,
} from './pg-order-fixtures';

let db: Db;
const asService = async <T = any>(sql: string, args: unknown[] = []) =>
  asRole(
    db,
    'service_role',
    null,
    async () => (await db.query<T>(sql, args)).rows,
  );
const claim = (ids: string[] | null, limit = 10) =>
  asService(`select * from public.cc_claim_notifications($1::uuid[], $2)`, [
    ids,
    limit,
  ]);
const finishOk = (id: string, messageId = 'wamid.1') =>
  asService(`select public.cc_finish_notification($1, true, $2, null, null)`, [
    id,
    messageId,
  ]);
const finishFail = (id: string, code: string, text: string) =>
  asService(`select public.cc_finish_notification($1, false, null, $2, $3)`, [
    id,
    code,
    text,
  ]);
const retry = (businessId: string, id: string) =>
  asService(`select public.cc_retry_notification($1, $2, $3)`, [
    businessId,
    id,
    IDS.staff,
  ]);
const resend = (jobId: string) =>
  asService(`select public.cc_resend_ready_notification($1, $2, $3) id`, [
    IDS.business,
    jobId,
    IDS.staff,
  ]);

beforeEach(async () => {
  db = await createDatabase();
  await seedWorld(db);
});

describe('transición a ready → como máximo un aviso automático', () => {
  it('in_progress → ready con opt-in e integración encola exactamente un aviso pending', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'in_progress');
    expect(await notifications(db, jobId)).toEqual([]);
    await setStatus(db, jobId, 'ready');
    const rows = await notifications(db, jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      trigger_kind: 'auto',
      destination: '+5493425551234',
      idempotency_key: `photo_job:${jobId}:ready:whatsapp`,
      attempt_count: 0,
    });
  });

  it('ready → in_progress → ready NO genera un segundo aviso automático', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready');
    await setStatus(db, jobId, 'in_progress');
    await setStatus(db, jobId, 'ready');
    expect(await notifications(db, jobId)).toHaveLength(1);
  });

  it('actualizar un job que ya está ready (sin cambiar de estado) no encola nada', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready');
    await db.query(
      `update public.photo_jobs set notes='x', status='ready' where id=$1`,
      [jobId],
    );
    expect(await notifications(db, jobId)).toHaveLength(1);
  });

  it('sin consentimiento no se encola ningún aviso', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db, { optIn: false });
    await setStatus(db, jobId, 'ready');
    expect(await notifications(db, jobId)).toEqual([]);
  });

  it('un job manual (sin pedido web) nunca encola avisos', async () => {
    await configureWhatsApp(db);
    await db.query(
      `insert into public.customers(id,business_id,full_name,phone) values ('c0000000-0000-4000-8000-000000000001',$1,'Manual','+54 9 342 555 1234')`,
      [IDS.business],
    );
    await db.query(
      `insert into public.photo_jobs(id,business_id,branch_id,customer_id,status,created_by) values ('d0000000-0000-4000-8000-000000000001',$1,$2,'c0000000-0000-4000-8000-000000000001','received',$3)`,
      [IDS.business, IDS.branch, IDS.owner],
    );
    await setStatus(db, 'd0000000-0000-4000-8000-000000000001', 'ready');
    expect(await notifications(db)).toEqual([]);
  });

  it('sin integración configurada el job queda ready y el aviso queda failed (reintentable)', async () => {
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready');
    expect(
      (
        await db.query<any>(
          `select status from public.photo_jobs where id=$1`,
          [jobId],
        )
      ).rows[0].status,
    ).toBe('ready');
    const rows = await notifications(db, jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      last_error_code: 'integration_not_configured',
    });
  });

  it('un error al encolar jamás impide cambiar el estado del trabajo', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await db.exec(
      `alter table public.outbound_notifications add constraint force_fail check (false) not valid`,
    );
    await setStatus(db, jobId, 'ready');
    expect(
      (
        await db.query<any>(
          `select status from public.photo_jobs where id=$1`,
          [jobId],
        )
      ).rows[0].status,
    ).toBe('ready');
    expect(await notifications(db, jobId)).toEqual([]);
  });

  it('el cambio hecho por un miembro autenticado (Web o sync de Desktop) dispara el mismo aviso', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await asRole(db, 'authenticated', IDS.staff, () =>
      db.query(`update public.photo_jobs set status='ready' where id=$1`, [
        jobId,
      ]),
    );
    expect(await notifications(db, jobId)).toHaveLength(1);
    // Desktop vuelve a empujar el mismo estado más tarde: sigue habiendo uno solo.
    await asRole(db, 'authenticated', IDS.staff, () =>
      db.query(
        `update public.photo_jobs set status='ready', priority='urgent' where id=$1`,
        [jobId],
      ),
    );
    expect(await notifications(db, jobId)).toHaveLength(1);
  });

  it('el wake-up nunca falla aunque pg_net no exista', async () => {
    await configureWhatsApp(db);
    await db.query(
      `select vault.create_secret('https://x.supabase.co/functions/v1/whatsapp-dispatch','whatsapp_dispatch_url','')`,
    );
    await db.query(
      `select vault.create_secret('s3cret','whatsapp_dispatch_secret','')`,
    );
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready'); // net.http_post no existe en este Postgres
    expect(await notifications(db, jobId)).toHaveLength(1);
  });
});

describe('operaciones del emisor', () => {
  async function pending() {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready');
    return { jobId, id: (await notifications(db, jobId))[0].id as string };
  }

  it('claim pasa a sending una sola vez y no entrega la misma fila a dos emisores', async () => {
    const { id } = await pending();
    const first = await claim([id]);
    const second = await claim([id]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: 'sending', attempt_count: 1 });
    expect(second).toEqual([]);
  });

  it('finish ok guarda el id de Meta como sent (no delivered) y deja auditoría', async () => {
    const { id, jobId } = await pending();
    await claim([id]);
    await finishOk(id, 'wamid.ABC');
    expect((await notifications(db, jobId))[0]).toMatchObject({
      status: 'sent',
      provider_message_id: 'wamid.ABC',
    });
    const events = (
      await db.query<any>(
        `select kind from public.outbound_notification_events where notification_id=$1 order by id`,
        [id],
      )
    ).rows.map((x) => x.kind);
    expect(events).toEqual(['queued', 'attempt', 'sent']);
  });

  it('un fallo queda failed con código y se puede reintentar (misma fila, con auditoría)', async () => {
    const { id, jobId } = await pending();
    await claim([id]);
    await finishFail(id, 'template_not_found', 'La plantilla no existe');
    expect((await notifications(db, jobId))[0]).toMatchObject({
      status: 'failed',
      last_error_code: 'template_not_found',
    });
    await retry(IDS.business, id);
    const [again] = await claim([id]);
    expect(again).toMatchObject({ status: 'sending', attempt_count: 2 });
    expect(await notifications(db, jobId)).toHaveLength(1);
    const events = (
      await db.query<any>(
        `select kind, actor_id from public.outbound_notification_events where notification_id=$1 order by id`,
        [id],
      )
    ).rows;
    expect(events.map((x) => x.kind)).toEqual([
      'queued',
      'attempt',
      'failed',
      'retry_requested',
      'attempt',
    ]);
    expect(events[3].actor_id).toBe(IDS.staff);
  });

  it('no se puede reintentar lo que no falló ni lo de otro negocio', async () => {
    const { id } = await pending();
    await expect(retry(IDS.business, id)).rejects.toThrow(
      'cc_error:not_retryable',
    );
    await claim([id]);
    await finishFail(id, 'x', 'y');
    await expect(retry(IDS.otherBusiness, id)).rejects.toThrow(
      'cc_error:not_retryable',
    );
  });

  it('reenvío manual: fila nueva con su propia clave y auditoría, sin tocar la automática', async () => {
    const { id, jobId } = await pending();
    await claim([id]);
    await finishOk(id);
    const [{ id: newId }] = await resend(jobId);
    const rows = await notifications(db, jobId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: 'sent', trigger_kind: 'auto' });
    expect(rows[1]).toMatchObject({
      id: newId,
      status: 'pending',
      trigger_kind: 'manual_resend',
    });
    expect(rows[1].idempotency_key).toMatch(
      new RegExp(`^photo_job:${jobId}:ready:whatsapp:resend:`),
    );
    expect(rows[1].idempotency_key).not.toBe(rows[0].idempotency_key);
    // La automática sigue siendo única aunque el job vuelva a ready.
    await setStatus(db, jobId, 'in_progress');
    await setStatus(db, jobId, 'ready');
    expect(
      (await notifications(db, jobId)).filter((x) => x.trigger_kind === 'auto'),
    ).toHaveLength(1);
  });

  it('el reenvío exige job ready y no se acumula mientras hay uno en curso', async () => {
    const { id, jobId } = await pending();
    await expect(resend(jobId)).rejects.toThrow('cc_error:already_in_flight');
    await claim([id]);
    await finishOk(id);
    await setStatus(db, jobId, 'delivered');
    await expect(resend(jobId)).rejects.toThrow('cc_error:job_not_ready');
  });

  it('un envío interrumpido (sending viejo) se marca failed, nunca se reenvía solo', async () => {
    const { id, jobId } = await pending();
    await claim([id]);
    await db.query(
      `update public.outbound_notifications set updated_at = now() - interval '1 hour' where id=$1`,
      [id],
    );
    expect(await claim(null)).toEqual([]);
    expect((await notifications(db, jobId))[0]).toMatchObject({
      status: 'failed',
      last_error_code: 'interrupted',
    });
  });
});

describe('recibos de Meta (webhook)', () => {
  async function sent() {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready');
    const [row] = await notifications(db, jobId);
    await claim([row.id]);
    await finishOk(row.id, 'wamid.W1');
    return { jobId, id: row.id as string };
  }
  const apply = async (
    status: string,
    code: string | null = null,
    error: string | null = null,
    id = 'wamid.W1',
  ) =>
    (
      await asService(
        `select public.cc_apply_whatsapp_status($1, $2, now(), $3, $4) ok`,
        [id, status, code, error],
      )
    )[0].ok as boolean;

  it('sent → delivered → read sólo avanza; un delivered tardío no retrocede un read', async () => {
    const { jobId } = await sent();
    expect(await apply('delivered')).toBe(true);
    expect((await notifications(db, jobId))[0].status).toBe('delivered');
    expect(await apply('read')).toBe(true);
    expect(await apply('delivered')).toBe(false);
    expect((await notifications(db, jobId))[0].status).toBe('read');
  });

  it('failed de Meta marca failed con su código; un id desconocido no hace nada', async () => {
    const { jobId } = await sent();
    expect(await apply('failed', '131026', 'Message undeliverable')).toBe(true);
    expect((await notifications(db, jobId))[0]).toMatchObject({
      status: 'failed',
      last_error_code: '131026',
    });
    expect(await apply('delivered', null, null, 'wamid.NOPE')).toBe(false);
  });

  it('la aceptación por la API NO es entrega: sin recibo queda sent y sin delivered_at', async () => {
    const { jobId } = await sent();
    const row = (await notifications(db, jobId))[0];
    expect(row.status).toBe('sent');
    expect(
      (
        await db.query<any>(
          `select delivered_at from public.outbound_notifications where id=$1`,
          [row.id],
        )
      ).rows[0].delivered_at,
    ).toBeNull();
  });
});

describe('el token de acceso nunca está en PostgreSQL en claro ni al alcance de los clientes', () => {
  it('la integración guarda sólo el id del secreto de Vault', async () => {
    const secret = await configureWhatsApp(db);
    const row = (
      await db.query<any>(`select * from public.whatsapp_integrations`)
    ).rows[0];
    expect(row.access_token_secret_id).toBe(secret);
    expect(JSON.stringify(row)).not.toContain('EAAB-secret-token');
  });

  it('authenticated y anon no pueden leer la integración ni ejecutar las funciones de Vault', async () => {
    await configureWhatsApp(db);
    for (const role of ['authenticated', 'anon'] as const) {
      await expect(
        asRole(db, role, IDS.owner, () =>
          db.query(`select * from public.whatsapp_integrations`),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(db, role, IDS.owner, () =>
          db.query(`select public.cc_read_whatsapp_token(gen_random_uuid())`),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('service_role lee el token por la función; desconectar destruye el secreto y conserva la fila', async () => {
    const secret = await configureWhatsApp(db);
    const [{ t }] = await asService(
      `select public.cc_read_whatsapp_token($1) t`,
      [secret],
    );
    expect(t).toBe('EAAB-secret-token');
    const [{ done }] = await asService(
      `select public.cc_disconnect_whatsapp_integration($1) done`,
      [IDS.business],
    );
    expect(done).toBe(true);
    expect(
      (
        await db.query<any>(
          `select count(*)::int n from vault.secrets where id=$1`,
          [secret],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await db.query<any>(`select status from public.whatsapp_integrations`))
        .rows[0].status,
    ).toBe('disconnected');
  });

  it('reconfigurar reemplaza el secreto anterior', async () => {
    const first = await configureWhatsApp(db);
    const second = await configureWhatsApp(db);
    expect(second).not.toBe(first);
    expect(
      (
        await db.query<any>(
          `select count(*)::int n from vault.secrets where id=$1`,
          [first],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('los miembros leen los avisos y su auditoría, pero no pueden escribirlos ni borrarlos', async () => {
    await configureWhatsApp(db);
    const { jobId } = await submittedOrder(db);
    await setStatus(db, jobId, 'ready');
    const seen = await asRole(db, 'authenticated', IDS.staff, async () => ({
      n: (
        await db.query<any>(
          `select count(*)::int n from public.outbound_notifications`,
        )
      ).rows[0].n,
      e: (
        await db.query<any>(
          `select count(*)::int n from public.outbound_notification_events`,
        )
      ).rows[0].n,
    }));
    expect(seen).toEqual({ n: 1, e: 1 });
    await expect(
      asRole(db, 'authenticated', IDS.staff, () =>
        db.query(`update public.outbound_notifications set status='sent'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'authenticated', IDS.staff, () =>
        db.query(`delete from public.outbound_notifications`),
      ),
    ).rejects.toThrow(/permission denied/);
    const outsider = await asRole(
      db,
      'authenticated',
      IDS.outsider,
      async () =>
        (
          await db.query<any>(
            `select count(*)::int n from public.outbound_notifications`,
          )
        ).rows[0].n,
    );
    expect(outsider).toBe(0);
  });
});

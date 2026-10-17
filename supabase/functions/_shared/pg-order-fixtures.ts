/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Fixtures on top of the PGlite harness: a confirmed public order, built through the real RPCs.
import { IDS, asRole, type Db } from './pg-harness';

export const LATER = '2099-01-01T00:00:00Z';

export async function submittedOrder(
  db: Db,
  options: {
    key?: string;
    optIn?: boolean;
    phone?: string;
    display?: string;
    name?: string;
    copies?: number;
  } = {},
) {
  const key = options.key ?? 'client-key-aaaaaaaaaaaa';
  const started = await asRole(db, 'service_role', null, async () => {
    const result = await db.query<{ r: any }>(
      `select public.cc_public_order_start($1,$2,$3,$4,$5,null,null,$6,'iphash',$7::jsonb,$8,$9) r`,
      [
        IDS.business,
        key,
        options.name ?? 'María García',
        options.phone ?? '+5493425551234',
        options.display ?? '+54 9 342 555 1234',
        options.optIn ?? true,
        JSON.stringify([
          {
            service_id: IDS.svc10x15,
            quantity: 1,
            expected_unit_price_cents: 50000,
          },
        ]),
        `upload-${key}`,
        LATER,
      ],
    );
    return result.rows[0]!.r;
  });
  await db.query(
    `insert into public.photo_job_files(business_id, photo_job_id, photo_job_item_id, drive_file_id, drive_folder_id,
       original_filename, stored_filename, size_bytes, copies, workflow_route, status)
     values ($1,$2,$3,$4,'folder','a.jpg','x-a.jpg',10,$5,'lab','uploaded')`,
    [
      IDS.business,
      started.job_id,
      started.items[0].item_id,
      `drive-${key}`,
      options.copies ?? 2,
    ],
  );
  await asRole(db, 'service_role', null, () =>
    db.query(`select public.cc_public_order_confirm($1,$2,$3,$4,$5)`, [
      IDS.business,
      started.job_id,
      started.link_id,
      `track-${key}`,
      LATER,
    ]),
  );
  return {
    jobId: started.job_id as string,
    orderId: started.order_id as string,
    customerId: started.customer_id as string,
  };
}

export const setStatus = (db: Db, jobId: string, status: string) =>
  db.query(`update public.photo_jobs set status=$2 where id=$1`, [
    jobId,
    status,
  ]);

export const notifications = async (db: Db, jobId?: string) =>
  (
    await db.query<any>(
      `select id, status, trigger_kind, idempotency_key, destination, attempt_count, last_error_code, provider_message_id
       from public.outbound_notifications ${jobId ? 'where photo_job_id = $1' : ''} order by created_at, id`,
      jobId ? [jobId] : [],
    )
  ).rows;

export async function configureWhatsApp(db: Db) {
  const secret = (
    await db.query<{ id: string }>(
      `select vault.create_secret('EAAB-secret-token', 'wa-test', '') id`,
    )
  ).rows[0]!.id;
  await asRole(db, 'service_role', null, () =>
    db.query(
      `select public.cc_save_whatsapp_integration($1,'1234567890','9876543210','pedido_listo','es_AR',$2,$3)`,
      [IDS.business, secret, IDS.owner],
    ),
  );
  return secret;
}

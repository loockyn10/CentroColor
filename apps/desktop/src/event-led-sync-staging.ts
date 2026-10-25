import Database from '@tauri-apps/plugin-sql';

/** A new offline LED event reaches Cloud as quoted while its FK children are uploaded.
 * The desired blocking status survives an interrupted sync in SQLite. */
export async function stageNewLedEvents(businessId: string) {
  const db = await Database.load('sqlite:centrocolor.db');
  await db.execute(
    `INSERT OR IGNORE INTO event_led_sync_intents(business_id,event_id,target_status)
    SELECT e.business_id,e.id,e.status FROM events e
    WHERE e.business_id=? AND e.cloud_updated_at IS NULL AND e.status IN('reserved','completed')
      AND EXISTS(SELECT 1 FROM led_panel_reservations r WHERE r.business_id=e.business_id
        AND r.event_id=e.id AND r.is_active=1)`,
    [businessId],
  );
  await db.execute(
    `UPDATE events SET status='quoted',updated_at=?,sync_origin='local',local_revision=local_revision+1
    WHERE business_id=? AND status IN('reserved','completed')
      AND id IN(SELECT event_id FROM event_led_sync_intents WHERE business_id=?)`,
    [new Date().toISOString(), businessId, businessId],
  );
}

export async function restoreLedEventStatuses(businessId: string) {
  const db = await Database.load('sqlite:centrocolor.db');
  const rows = await db.select<{ event_id: string; target_status: string }[]>(
    'SELECT event_id,target_status FROM event_led_sync_intents WHERE business_id=? ORDER BY event_id',
    [businessId],
  );
  for (const row of rows)
    await db.execute(
      `UPDATE events SET status=?,updated_at=?,sync_origin='local',local_revision=local_revision+1
    WHERE business_id=? AND id=? AND status='quoted'`,
      [row.target_status, new Date().toISOString(), businessId, row.event_id],
    );
}

export async function clearSyncedLedIntents(businessId: string) {
  const db = await Database.load('sqlite:centrocolor.db');
  await db.execute(
    `DELETE FROM event_led_sync_intents WHERE business_id=?
    AND NOT EXISTS(SELECT 1 FROM event_sync_outbox o WHERE o.business_id=event_led_sync_intents.business_id
      AND o.entity_type='event' AND o.entity_id=event_led_sync_intents.event_id)`,
    [businessId],
  );
}

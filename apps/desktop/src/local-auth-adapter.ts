import Database from '@tauri-apps/plugin-sql';
import type { BusinessContext } from '@centrocolor/application';
import { parseBusinessRole } from '@centrocolor/domain';

type Row = {
  user_id: string;
  display_name: string;
  business_id: string;
  business_name: string;
  branch_id: string;
  branch_name: string;
  role: string;
  last_cloud_validation_at: string;
};

async function database() {
  return Database.load('sqlite:centrocolor.db');
}

export async function loadOfflineContext(): Promise<BusinessContext | null> {
  const db = await database();
  const rows = await db.select<Row[]>(
    'SELECT * FROM authorized_context WHERE slot = 1',
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    profile: { id: row.user_id, displayName: row.display_name },
    businessId: row.business_id,
    businessName: row.business_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    deviceId: null,
    role: parseBusinessRole(row.role),
    authorization: 'offline-authenticated',
    lastCloudValidationAt: row.last_cloud_validation_at,
  };
}

export async function saveAuthorizedContext(
  context: BusinessContext,
): Promise<void> {
  if (
    context.authorization !== 'cloud-validated' ||
    !context.branchId ||
    !context.branchName
  ) {
    throw new Error('Only a cloud-validated branch context can be cached');
  }
  const db = await database();
  await db.execute(
    'INSERT OR REPLACE INTO authorized_context (slot, user_id, display_name, business_id, business_name, branch_id, branch_name, role, last_cloud_validation_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      context.userId,
      context.profile.displayName,
      context.businessId,
      context.businessName,
      context.branchId,
      context.branchName,
      context.role,
      context.lastCloudValidationAt,
    ],
  );
}

export async function clearAuthorizedContext(): Promise<void> {
  const db = await database();
  await db.execute('DELETE FROM authorized_context WHERE slot = 1');
}

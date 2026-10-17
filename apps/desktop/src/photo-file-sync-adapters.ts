/* eslint-disable @typescript-eslint/no-explicit-any -- persistence boundary */
import Database from '@tauri-apps/plugin-sql';
import type {
  PhotoFileCursor,
  PhotoFileSyncCloudPort,
  PhotoFileSyncLocalPort,
} from '@centrocolor/application';
import type { PhotoJobFile } from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

const decode = (x: any): PhotoJobFile => ({
  id: x.id,
  businessId: x.business_id,
  photoJobId: x.photo_job_id,
  photoJobItemId: x.photo_job_item_id,
  driveFileId: x.drive_file_id,
  driveFolderId: x.drive_folder_id,
  originalFilename: x.original_filename,
  storedFilename: x.stored_filename,
  mimeType: x.mime_type,
  sizeBytes: x.size_bytes,
  copies: x.copies,
  workflowRoute: x.workflow_route,
  status: x.status,
  uploadedAt: x.uploaded_at,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
export class CloudPhotoFileSyncAdapter implements PhotoFileSyncCloudPort {
  async pull(businessId: string, after: PhotoFileCursor | null, limit: number) {
    let query: any = getSupabaseClient()
      .from('photo_job_files')
      .select('*')
      .eq('business_id', businessId)
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (after)
      query = query.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(decode);
  }
}
export class SQLitePhotoFileSyncAdapter implements PhotoFileSyncLocalPort {
  private db() {
    return Database.load('sqlite:centrocolor.db');
  }
  async cursor(businessId: string) {
    const rows = await (
      await this.db()
    ).select<any[]>(
      'SELECT updated_at,entity_id FROM photo_file_sync_cursor WHERE business_id=?',
      [businessId],
    );
    return rows[0]
      ? { updatedAt: rows[0].updated_at, id: rows[0].entity_id }
      : null;
  }
  async apply(x: PhotoJobFile) {
    await (
      await this.db()
    ).execute(
      `INSERT INTO photo_job_files(id,business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,original_filename,stored_filename,mime_type,size_bytes,copies,workflow_route,status,uploaded_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET drive_folder_id=excluded.drive_folder_id,original_filename=excluded.original_filename,stored_filename=excluded.stored_filename,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,copies=excluded.copies,workflow_route=excluded.workflow_route,status=excluded.status,uploaded_at=excluded.uploaded_at,updated_at=excluded.updated_at`,
      [
        x.id,
        x.businessId,
        x.photoJobId,
        x.photoJobItemId,
        x.driveFileId,
        x.driveFolderId,
        x.originalFilename,
        x.storedFilename,
        x.mimeType,
        x.sizeBytes,
        x.copies,
        x.workflowRoute,
        x.status,
        x.uploadedAt,
        x.createdAt,
        x.updatedAt,
      ],
    );
  }
  async advance(businessId: string, cursor: PhotoFileCursor) {
    await (
      await this.db()
    ).execute(
      `INSERT INTO photo_file_sync_cursor VALUES(?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET updated_at=excluded.updated_at,entity_id=excluded.entity_id,last_success_at=excluded.last_success_at`,
      [businessId, cursor.updatedAt, cursor.id, new Date().toISOString()],
    );
  }
}

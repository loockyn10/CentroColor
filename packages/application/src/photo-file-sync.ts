import type { PhotoJobFile } from '@centrocolor/domain';

export interface PhotoFileCursor {
  updatedAt: string;
  id: string;
}
export interface PhotoFileSyncLocalPort {
  cursor(businessId: string): Promise<PhotoFileCursor | null>;
  apply(file: PhotoJobFile): Promise<void>;
  advance(businessId: string, cursor: PhotoFileCursor): Promise<void>;
}
export interface PhotoFileSyncCloudPort {
  pull(
    businessId: string,
    after: PhotoFileCursor | null,
    limit: number,
  ): Promise<PhotoJobFile[]>;
}
export async function syncPhotoFiles(
  businessId: string,
  local: PhotoFileSyncLocalPort,
  cloud: PhotoFileSyncCloudPort,
) {
  let cursor = await local.cursor(businessId);
  let pulled = 0;
  for (const file of await cloud.pull(businessId, cursor, 200)) {
    const next = { updatedAt: file.updatedAt, id: file.id };
    if (
      cursor &&
      (next.updatedAt < cursor.updatedAt ||
        (next.updatedAt === cursor.updatedAt && next.id <= cursor.id))
    )
      throw new Error('Cursor de archivos fotográficos no creciente.');
    await local.apply(file);
    await local.advance(businessId, next);
    cursor = next;
    pulled++;
  }
  return { pulled };
}

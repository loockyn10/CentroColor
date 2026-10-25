/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite rows are mapped at this boundary. */
import Database from '@tauri-apps/plugin-sql';
import type {
  PhotoJobListQuery,
  PhotoRepository,
} from '@centrocolor/application';
import type {
  PhotoJob,
  PhotoJobItem,
  PhotoJobStatus,
  PhotoJobFile,
  PhotoService,
} from '@centrocolor/domain';
const db = () => Database.load('sqlite:centrocolor.db');
const service = (x: any): PhotoService => ({
  id: x.id,
  businessId: x.business_id,
  code: x.code,
  name: x.name,
  serviceType: x.service_type,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  defaultUnitPriceCents: x.default_unit_price_cents,
  workflowRoute: x.workflow_route,
  requiresCustomerFiles: x.requires_customer_files === 1,
  isPublic: x.is_public === 1,
  publicName: x.public_name ?? null,
  publicDescription: x.public_description ?? null,
  publicSortOrder: x.public_sort_order ?? 0,
  publicOrderEnabled: x.public_order_enabled === 1,
  isActive: x.is_active === 1,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const job = (x: any): PhotoJob => ({
  id: x.id,
  businessId: x.business_id,
  branchId: x.branch_id,
  customerId: x.customer_id,
  status: x.status,
  priority: x.priority,
  promisedAt: x.promised_at,
  notes: x.notes,
  sourceAppointmentId: x.source_appointment_id,
  sourceEventId: x.source_event_id,
  fileIntakeStatus: x.file_intake_status,
  driveFolderId: x.drive_folder_id,
  driveEditedFolderId: x.drive_edited_folder_id,
  sourceChannel: x.source_channel ?? 'manual',
  createdBy: x.created_by,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const file = (x: any): PhotoJobFile => ({
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
const item = (x: any): PhotoJobItem => ({
  id: x.id,
  businessId: x.business_id,
  photoJobId: x.photo_job_id,
  photoServiceId: x.photo_service_id,
  labVariantId: x.lab_variant_id ?? null,
  priceListId: x.price_list_id ?? null,
  serviceNameSnapshot: x.service_name_snapshot,
  quantity: x.quantity,
  unitPriceCents: x.unit_price_cents,
  totalCents: x.total_cents,
  notes: x.notes,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  isActive: x.is_active === 1,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});

export class SQLitePhotoRepository implements PhotoRepository {
  async listServices(b: string, all = false) {
    return (
      await (
        await db()
      ).select<any[]>(
        `SELECT * FROM photo_services WHERE business_id=? ${all ? '' : 'AND is_active=1'} ORDER BY is_active DESC,name`,
        [b],
      )
    ).map(service);
  }
  async createService(x: PhotoService) {
    await (
      await db()
    ).execute(
      `INSERT INTO photo_services(id,business_id,code,name,service_type,width_mm,height_mm,default_unit_price_cents,workflow_route,requires_customer_files,is_public,public_name,public_description,public_sort_order,public_order_enabled,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        x.id,
        x.businessId,
        x.code,
        x.name,
        x.serviceType,
        x.widthMm,
        x.heightMm,
        x.defaultUnitPriceCents,
        x.workflowRoute,
        x.requiresCustomerFiles ? 1 : 0,
        x.isPublic ? 1 : 0,
        x.publicName,
        x.publicDescription,
        x.publicSortOrder,
        x.publicOrderEnabled ? 1 : 0,
        x.isActive ? 1 : 0,
        x.createdAt,
        x.updatedAt,
      ],
    );
    return x;
  }
  async updateService(b: string, id: string, x: any) {
    await (
      await db()
    ).execute(
      `UPDATE photo_services SET code=?,name=?,service_type=?,width_mm=?,height_mm=?,default_unit_price_cents=?,workflow_route=?,requires_customer_files=?,is_public=?,public_name=?,public_description=?,public_sort_order=?,public_order_enabled=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        x.code,
        x.name,
        x.serviceType,
        x.widthMm,
        x.heightMm,
        x.defaultUnitPriceCents,
        x.workflowRoute,
        x.requiresCustomerFiles ? 1 : 0,
        x.isPublic ? 1 : 0,
        x.publicName,
        x.publicDescription,
        x.publicSortOrder,
        x.publicOrderEnabled ? 1 : 0,
        new Date().toISOString(),
        b,
        id,
      ],
    );
    const found = (await this.listServices(b, true)).find((v) => v.id === id);
    if (!found) throw new Error('No se encontró el servicio.');
    return found;
  }
  async setServiceActive(b: string, id: string, active: boolean) {
    await (
      await db()
    ).execute(
      `UPDATE photo_services SET is_active=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [active ? 1 : 0, new Date().toISOString(), b, id],
    );
    const found = (await this.listServices(b, true)).find((v) => v.id === id);
    if (!found) throw new Error('No se encontró el servicio.');
    return found;
  }
  async listJobs(b: string, branch: string, query: PhotoJobListQuery = {}) {
    const args: any[] = [b, branch];
    let where = '';
    if (query.statuses?.length) {
      where += ` AND j.status IN (${query.statuses.map(() => '?').join(',')})`;
      args.push(...query.statuses);
    }
    if (query.urgentOnly) {
      where += " AND j.priority='urgent'";
    }
    if (query.search?.trim()) {
      where += ` AND (lower(c.full_name) LIKE ? OR lower(coalesce(c.phone,'')) LIKE ? OR lower(coalesce(j.notes,'')) LIKE ? OR EXISTS(SELECT 1 FROM photo_job_items si WHERE si.business_id=j.business_id AND si.photo_job_id=j.id AND lower(si.service_name_snapshot) LIKE ?))`;
      const q = `%${query.search.trim().toLowerCase()}%`;
      args.push(q, q, q, q);
    }
    args.push(query.limit ?? 200);
    const rows = await (
      await db()
    ).select<any[]>(
      `SELECT j.*,c.full_name customer_name,c.phone customer_phone,coalesce((SELECT group_concat(i.quantity||' × '||i.service_name_snapshot,', ') FROM photo_job_items i WHERE i.business_id=j.business_id AND i.photo_job_id=j.id AND i.is_active=1),'') item_summary,coalesce((SELECT sum(i.total_cents) FROM photo_job_items i WHERE i.business_id=j.business_id AND i.photo_job_id=j.id AND i.is_active=1),0) total_cents FROM photo_jobs j JOIN customers c ON c.business_id=j.business_id AND c.id=j.customer_id WHERE j.business_id=? AND j.branch_id=?${where} ORDER BY CASE j.priority WHEN 'urgent' THEN 0 ELSE 1 END,CASE WHEN j.promised_at IS NOT NULL AND j.promised_at < datetime('now') AND j.status NOT IN('delivered','cancelled') THEN 0 ELSE 1 END,j.promised_at IS NULL,j.promised_at,j.created_at LIMIT ?`,
      args,
    );
    return rows.map((x) => ({
      job: job(x),
      customerName: x.customer_name,
      customerPhone: x.customer_phone,
      itemSummary: x.item_summary,
      totalCents: x.total_cents,
    }));
  }
  async getJob(b: string, id: string) {
    const d = await db();
    const rows = await d.select<any[]>(
      `SELECT j.*,c.full_name customer_name,c.phone customer_phone FROM photo_jobs j JOIN customers c ON c.business_id=j.business_id AND c.id=j.customer_id WHERE j.business_id=? AND j.id=?`,
      [b, id],
    );
    if (!rows[0]) return null;
    const items = await d.select<any[]>(
      `SELECT * FROM photo_job_items WHERE business_id=? AND photo_job_id=? ORDER BY created_at,id`,
      [b, id],
    );
    const files = await d.select<any[]>(
      `SELECT * FROM photo_job_files WHERE business_id=? AND photo_job_id=? ORDER BY created_at,id`,
      [b, id],
    );
    return {
      job: job(rows[0]),
      items: items.map(item),
      files: files.map(file),
      customerName: rows[0].customer_name,
      customerPhone: rows[0].customer_phone,
    };
  }
  async saveJob(x: PhotoJob, items: PhotoJobItem[]) {
    const d = await db();
    await d.execute(
      `INSERT INTO photo_jobs(id,business_id,branch_id,customer_id,status,priority,promised_at,notes,source_appointment_id,source_event_id,file_intake_status,drive_folder_id,drive_edited_folder_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        x.id,
        x.businessId,
        x.branchId,
        x.customerId,
        x.status,
        x.priority,
        x.promisedAt,
        x.notes,
        x.sourceAppointmentId,
        x.sourceEventId,
        x.fileIntakeStatus,
        x.driveFolderId,
        x.driveEditedFolderId,
        x.createdBy,
        x.createdAt,
        x.updatedAt,
      ],
    );
    for (const i of items)
      await d.execute(
        `INSERT INTO photo_job_items(id,business_id,photo_job_id,photo_service_id,lab_variant_id,price_list_id,service_name_snapshot,quantity,unit_price_cents,total_cents,notes,width_mm,height_mm,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          i.id,
          i.businessId,
          i.photoJobId,
          i.photoServiceId,
          i.labVariantId ?? null,
          i.priceListId ?? null,
          i.serviceNameSnapshot,
          i.quantity,
          i.unitPriceCents,
          i.totalCents,
          i.notes,
          i.widthMm,
          i.heightMm,
          i.isActive ? 1 : 0,
          i.createdAt,
          i.updatedAt,
        ],
      );
    return (await this.getJob(x.businessId, x.id))!;
  }
  async updateJob(x: PhotoJob, items: PhotoJobItem[]) {
    const d = await db();
    const now = new Date().toISOString();
    await d.execute(
      `UPDATE photo_jobs SET customer_id=?,status=?,priority=?,promised_at=?,notes=?,source_appointment_id=?,source_event_id=?,file_intake_status=?,drive_folder_id=?,drive_edited_folder_id=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        x.customerId,
        x.status,
        x.priority,
        x.promisedAt,
        x.notes,
        x.sourceAppointmentId,
        x.sourceEventId,
        x.fileIntakeStatus,
        x.driveFolderId,
        x.driveEditedFolderId,
        now,
        x.businessId,
        x.id,
      ],
    );
    for (const i of items)
      await d.execute(
        `INSERT INTO photo_job_items(id,business_id,photo_job_id,photo_service_id,lab_variant_id,price_list_id,service_name_snapshot,quantity,unit_price_cents,total_cents,notes,width_mm,height_mm,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET photo_service_id=excluded.photo_service_id,lab_variant_id=excluded.lab_variant_id,price_list_id=excluded.price_list_id,service_name_snapshot=excluded.service_name_snapshot,quantity=excluded.quantity,unit_price_cents=excluded.unit_price_cents,total_cents=excluded.total_cents,notes=excluded.notes,width_mm=excluded.width_mm,height_mm=excluded.height_mm,is_active=excluded.is_active,updated_at=excluded.updated_at,sync_origin='local',local_revision=photo_job_items.local_revision+1`,
        [
          i.id,
          i.businessId,
          i.photoJobId,
          i.photoServiceId,
          i.labVariantId ?? null,
          i.priceListId ?? null,
          i.serviceNameSnapshot,
          i.quantity,
          i.unitPriceCents,
          i.totalCents,
          i.notes,
          i.widthMm,
          i.heightMm,
          i.isActive ? 1 : 0,
          i.createdAt,
          now,
        ],
      );
    return (await this.getJob(x.businessId, x.id))!;
  }
  async setJobStatus(b: string, id: string, status: PhotoJobStatus) {
    const d = await db();
    await d.execute(
      `UPDATE photo_jobs SET status=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [status, new Date().toISOString(), b, id],
    );
    const r = await d.select<any[]>(
      `SELECT * FROM photo_jobs WHERE business_id=? AND id=?`,
      [b, id],
    );
    if (!r[0]) throw new Error('No se encontró el trabajo.');
    return job(r[0]);
  }
  async setFileIntakeStatus(
    b: string,
    id: string,
    status: PhotoJob['fileIntakeStatus'],
  ) {
    const d = await db();
    await d.execute(
      `UPDATE photo_jobs SET file_intake_status=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [status, new Date().toISOString(), b, id],
    );
    const rows = await d.select<any[]>(
      `SELECT * FROM photo_jobs WHERE business_id=? AND id=?`,
      [b, id],
    );
    if (!rows[0]) throw new Error('No se encontró el trabajo.');
    return job(rows[0]);
  }
}

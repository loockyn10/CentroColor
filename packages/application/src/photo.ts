import {
  comparePhotoProductionQueue,
  normalizePhotoJobDetails,
  normalizePhotoJobItemDetails,
  normalizePhotoServiceDetails,
  photoJobTotal,
  type PhotoJob,
  type PhotoJobItem,
  type PhotoJobPriority,
  type PhotoJobStatus,
  type PhotoJobFile,
  type PhotoService,
  type PhotoServiceDetails,
} from '@centrocolor/domain';

export interface PhotoJobSummary {
  job: PhotoJob;
  customerName: string;
  customerPhone: string | null;
  itemSummary: string;
  totalCents: number;
}
export interface PhotoJobBundle {
  job: PhotoJob;
  items: PhotoJobItem[];
  files: PhotoJobFile[];
  customerName: string;
  customerPhone: string | null;
}
export interface PhotoJobListQuery {
  statuses?: PhotoJobStatus[];
  urgentOnly?: boolean;
  search?: string;
  limit?: number;
}
export interface PhotoRepository {
  listServices(
    businessId: string,
    includeInactive?: boolean,
  ): Promise<PhotoService[]>;
  createService(value: PhotoService): Promise<PhotoService>;
  updateService(
    businessId: string,
    id: string,
    value: PhotoServiceDetails,
  ): Promise<PhotoService>;
  setServiceActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<PhotoService>;
  listJobs(
    businessId: string,
    branchId: string,
    query?: PhotoJobListQuery,
  ): Promise<PhotoJobSummary[]>;
  getJob(businessId: string, id: string): Promise<PhotoJobBundle | null>;
  saveJob(job: PhotoJob, items: PhotoJobItem[]): Promise<PhotoJobBundle>;
  updateJob(job: PhotoJob, items: PhotoJobItem[]): Promise<PhotoJobBundle>;
  setJobStatus(
    businessId: string,
    id: string,
    status: PhotoJobStatus,
  ): Promise<PhotoJob>;
  setFileIntakeStatus?(
    businessId: string,
    id: string,
    status: PhotoJob['fileIntakeStatus'],
  ): Promise<PhotoJob>;
}

export interface GoogleDriveIntegrationView {
  status: 'connected' | 'disconnected' | 'error' | 'reconnect_required';
  googleAccountEmail: string | null;
  rootFolderId: string | null;
  connectedAt: string | null;
}

export interface UploadLinkView {
  id: string;
  url: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  submittedAt: string | null;
}

export interface PhotoFileIntakeAdminRepository {
  getDriveIntegration(businessId: string): Promise<GoogleDriveIntegrationView>;
  startDriveConnection(businessId: string): Promise<string>;
  disconnectDrive(businessId: string): Promise<void>;
  createUploadLink(photoJobId: string): Promise<UploadLinkView>;
  getUploadLink(photoJobId: string): Promise<UploadLinkView | null>;
  revokeUploadLink(photoJobId: string): Promise<void>;
  openDriveFolder(folderId: string): void;
}

export function createPhotoService(
  repository: PhotoRepository,
  businessId: string,
  details: PhotoServiceDetails,
  now = new Date().toISOString(),
) {
  return repository.createService({
    id: crypto.randomUUID(),
    businessId,
    ...normalizePhotoServiceDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function buildPhotoJob(
  input: {
    businessId: string;
    branchId: string;
    customerId: string;
    priority?: PhotoJobPriority;
    promisedAt: string | null;
    notes: string | null;
    sourceAppointmentId?: string | null;
    sourceEventId?: string | null;
    fileIntakeStatus?: PhotoJob['fileIntakeStatus'];
    createdBy: string;
    items: Array<
      Pick<
        PhotoJobItem,
        | 'photoServiceId'
        | 'labVariantId'
        | 'priceListId'
        | 'serviceNameSnapshot'
        | 'quantity'
        | 'unitPriceCents'
        | 'notes'
        | 'widthMm'
        | 'heightMm'
      >
    >;
  },
  now = new Date().toISOString(),
) {
  if (!input.items.length) throw new Error('Agregá al menos un servicio.');
  const id = crypto.randomUUID();
  const normalizedJob = normalizePhotoJobDetails({
    customerId: input.customerId,
    status: 'received',
    priority: input.priority ?? 'normal',
    promisedAt: input.promisedAt,
    notes: input.notes,
    sourceAppointmentId: input.sourceAppointmentId ?? null,
    sourceEventId: input.sourceEventId ?? null,
  });
  const job: PhotoJob = {
    id,
    businessId: input.businessId,
    branchId: input.branchId,
    ...normalizedJob,
    fileIntakeStatus: input.fileIntakeStatus ?? 'not_requested',
    driveFolderId: null,
    driveEditedFolderId: null,
    sourceChannel: 'manual',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const items = input.items.map((item) => ({
    id: crypto.randomUUID(),
    businessId: input.businessId,
    photoJobId: id,
    ...normalizePhotoJobItemDetails({ ...item, isActive: true }),
    createdAt: now,
    updatedAt: now,
  }));
  photoJobTotal(items);
  return { job, items };
}

export function sortPhotoProductionQueue(
  rows: PhotoJobSummary[],
  now = new Date(),
) {
  return [...rows].sort((a, b) =>
    comparePhotoProductionQueue(a.job, b.job, now),
  );
}

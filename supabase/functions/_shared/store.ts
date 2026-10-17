// Persistence contract used by the photo intake Edge Functions.
// The Supabase implementation lives in store-supabase.ts; tests use an in-memory one.

export type WorkflowRoute = 'none' | 'lab' | 'editing' | 'other';
export type IntakeStatus =
  | 'not_required'
  | 'not_requested'
  | 'awaiting_files'
  | 'receiving'
  | 'submitted';
export type FileStatus =
  'pending' | 'uploading' | 'uploaded' | 'failed' | 'removed';

export type DriveIntegrationRow = {
  business_id: string;
  status: 'connected' | 'disconnected' | 'error' | 'reconnect_required';
  google_account_email: string | null;
  root_folder_id: string;
  refresh_token_secret_id: string;
  connected_at: string | null;
};

export type JobRow = {
  id: string;
  business_id: string;
  status: string;
  file_intake_status: IntakeStatus;
};

export type JobItemRow = {
  id: string;
  is_active: boolean;
  service_name_snapshot: string;
  quantity: number;
  width_mm: number | null;
  height_mm: number | null;
  workflow_route: WorkflowRoute | null;
  requires_customer_files: boolean;
};

export type JobContextRow = JobRow & {
  source_channel: 'manual' | 'public_web' | 'future_gmail';
  /** Public self-service order not confirmed yet: invisible to every client role. */
  is_draft: boolean;
  created_at: string;
  drive_folder_id: string | null;
  drive_edited_folder_id: string | null;
  customer_name: string;
  business_name: string;
  items: JobItemRow[];
};

export type LinkPurpose = 'upload' | 'tracking';

export type UploadLinkRow = {
  id: string;
  /** `upload` mutates files; `tracking` can only read the order status. */
  purpose: LinkPurpose;
  business_id: string;
  photo_job_id: string;
  expires_at: string | null;
  revoked_at: string | null;
  submitted_at: string | null;
  created_at: string;
};

export type NewUploadLink = {
  business_id: string;
  photo_job_id: string;
  token_hash: string;
  /** Null for links issued to anonymous customers. */
  created_by: string | null;
  expires_at: string;
  purpose?: LinkPurpose;
  /** Tracking links are born closed to uploads. */
  submitted_at?: string | null;
};

export type FileRow = {
  id: string;
  business_id: string;
  photo_job_id: string;
  photo_job_item_id: string | null;
  drive_file_id: string;
  drive_folder_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string | null;
  size_bytes: number;
  copies: number;
  workflow_route: WorkflowRoute;
  status: FileStatus;
  uploaded_at: string | null;
  created_at: string;
};

export type NewFile = Omit<
  FileRow,
  'id' | 'uploaded_at' | 'created_at' | 'status'
> & { status: 'pending' };

export interface PhotoIntakeStore {
  // Drive integration and Vault.
  getIntegration(businessId: string): Promise<DriveIntegrationRow | null>;
  markIntegrationStatus(
    businessId: string,
    status: DriveIntegrationRow['status'],
  ): Promise<void>;
  markIntegrationDisconnected(businessId: string): Promise<void>;
  readRefreshToken(secretId: string): Promise<string | null>;
  deleteRefreshToken(secretId: string): Promise<void>;
  getFolderId(
    businessId: string,
    jobId: string,
    key: string,
  ): Promise<string | null>;
  saveFolderId(
    businessId: string,
    jobId: string,
    key: string,
    driveFolderId: string,
  ): Promise<void>;
  setJobFolders(
    businessId: string,
    jobId: string,
    rootFolderId: string,
    editedFolderId: string | null,
  ): Promise<void>;

  // Jobs.
  getJob(businessId: string, jobId: string): Promise<JobRow | null>;
  getJobContext(
    businessId: string,
    jobId: string,
  ): Promise<JobContextRow | null>;
  setIntakeStatus(
    businessId: string,
    jobId: string,
    status: IntakeStatus,
  ): Promise<void>;

  // Upload links.
  getLinkByHash(tokenHash: string): Promise<UploadLinkRow | null>;
  /** Latest `upload` link (tracking links are never offered to the admin as upload links). */
  getLatestLink(
    businessId: string,
    jobId: string,
  ): Promise<UploadLinkRow | null>;
  insertLink(link: NewUploadLink): Promise<UploadLinkRow>;
  /** Revokes active `upload` links only: tracking links must survive an upload re-issue. */
  revokeActiveLinks(
    businessId: string,
    jobId: string,
    exceptLinkId?: string,
  ): Promise<void>;
  markLinkSubmitted(linkId: string): Promise<void>;

  // Files.
  countFiles(
    businessId: string,
    jobId: string,
    statuses: FileStatus[],
  ): Promise<number>;
  countFilesCreatedSince(
    businessId: string,
    jobId: string,
    sinceIso: string,
  ): Promise<number>;
  getFile(
    businessId: string,
    jobId: string,
    fileId: string,
  ): Promise<FileRow | null>;
  listFiles(
    businessId: string,
    jobId: string,
    status: FileStatus,
  ): Promise<FileRow[]>;
  insertFile(file: NewFile): Promise<FileRow>;
  /** Moves a file between states only if it is currently in one of `from`. Returns whether a row changed. */
  transitionFile(
    businessId: string,
    jobId: string,
    fileId: string,
    from: FileStatus[],
    to: FileStatus,
    patch?: { mime_type?: string | null; uploaded_at?: string },
  ): Promise<boolean>;
}

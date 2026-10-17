/* eslint-disable @typescript-eslint/no-explicit-any -- Edge response mapping boundary. */
import type {
  GoogleDriveIntegrationView,
  PhotoFileIntakeAdminRepository,
  UploadLinkView,
} from '@centrocolor/application';
import { getSupabaseClient } from './cloud-config';

const mapIntegration = (x: any): GoogleDriveIntegrationView => ({
  status: x.status,
  googleAccountEmail: x.google_account_email,
  rootFolderId: x.root_folder_id,
  connectedAt: x.connected_at,
});
const mapLink = (x: any): UploadLinkView => ({
  id: x.id,
  url: x.url,
  expiresAt: x.expires_at,
  revokedAt: x.revoked_at,
  submittedAt: x.submitted_at,
});

export class SupabasePhotoFileIntakeAdminRepository implements PhotoFileIntakeAdminRepository {
  private async invoke(
    action: string,
    businessId: string,
    photoJobId?: string,
  ) {
    const { data, error } = await getSupabaseClient().functions.invoke(
      'photo-file-admin',
      {
        body: { action, businessId, photoJobId },
      },
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async getDriveIntegration(businessId: string) {
    return mapIntegration(await this.invoke('status', businessId));
  }
  async startDriveConnection(businessId: string) {
    const { data, error } = await getSupabaseClient().functions.invoke(
      'google-drive-oauth-start',
      { body: { businessId } },
    );
    if (error) throw error;
    return data.url as string;
  }
  async disconnectDrive(businessId: string) {
    await this.invoke('disconnect', businessId);
  }
  async createUploadLink(photoJobId: string) {
    const businessId = await this.businessForJob(photoJobId);
    return mapLink(await this.invoke('create_link', businessId, photoJobId));
  }
  async getUploadLink(photoJobId: string) {
    const businessId = await this.businessForJob(photoJobId);
    const data = await this.invoke('get_link', businessId, photoJobId);
    return data ? mapLink(data) : null;
  }
  async revokeUploadLink(photoJobId: string) {
    const businessId = await this.businessForJob(photoJobId);
    await this.invoke('revoke_link', businessId, photoJobId);
  }
  openDriveFolder(folderId: string) {
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }
  private async businessForJob(photoJobId: string) {
    const { data, error } = await getSupabaseClient()
      .from('photo_jobs')
      .select('business_id')
      .eq('id', photoJobId)
      .single();
    if (error) throw error;
    return data.business_id as string;
  }
}

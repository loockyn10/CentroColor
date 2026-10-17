/* eslint-disable @typescript-eslint/no-explicit-any -- Edge response mapping boundary. */
import type {
  GoogleDriveIntegrationView,
  PhotoFileIntakeAdminRepository,
  UploadLinkView,
} from '@centrocolor/application';
import { getSupabaseClient } from './cloud-config';
import { EdgeFunctionError, invokeEdgeFunction } from './edge-functions';

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

export type PhotoFileAdminAction =
  'status' | 'create_link' | 'get_link' | 'revoke_link' | 'disconnect';

/**
 * Body sent to `photo-file-admin`. The keys are the contract with
 * supabase/functions/_shared/photo-file-admin-handler.ts (PhotoFileAdminPayload);
 * a contract test keeps both sides aligned.
 */
export const photoFileAdminBody = (
  action: PhotoFileAdminAction,
  businessId: string,
  photoJobId?: string,
) => ({ action, businessId, photoJobId });

export class SupabasePhotoFileIntakeAdminRepository implements PhotoFileIntakeAdminRepository {
  private invoke(
    action: PhotoFileAdminAction,
    businessId: string,
    failure: string,
    photoJobId?: string,
  ) {
    return invokeEdgeFunction(
      getSupabaseClient(),
      'photo-file-admin',
      photoFileAdminBody(action, businessId, photoJobId),
      failure,
    );
  }
  async getDriveIntegration(businessId: string) {
    return mapIntegration(
      await this.invoke(
        'status',
        businessId,
        'No se pudo consultar Google Drive',
      ),
    );
  }
  async startDriveConnection(businessId: string) {
    const data = await invokeEdgeFunction(
      getSupabaseClient(),
      'google-drive-oauth-start',
      { businessId },
      'No se pudo iniciar la conexión con Google Drive',
    );
    if (typeof data?.url !== 'string')
      throw new EdgeFunctionError(
        'No se pudo iniciar la conexión con Google Drive.',
      );
    return data.url as string;
  }
  async disconnectDrive(businessId: string) {
    await this.invoke(
      'disconnect',
      businessId,
      'No se pudo desconectar Google Drive',
    );
  }
  async createUploadLink(photoJobId: string) {
    const failure = 'No se pudo generar el link del cliente';
    const businessId = await this.businessForJob(photoJobId, failure);
    return mapLink(
      await this.invoke('create_link', businessId, failure, photoJobId),
    );
  }
  async getUploadLink(photoJobId: string) {
    const failure = 'No se pudo consultar el link del cliente';
    const businessId = await this.businessForJob(photoJobId, failure);
    const data = await this.invoke('get_link', businessId, failure, photoJobId);
    return data ? mapLink(data) : null;
  }
  async revokeUploadLink(photoJobId: string) {
    const failure = 'No se pudo revocar el link del cliente';
    const businessId = await this.businessForJob(photoJobId, failure);
    await this.invoke('revoke_link', businessId, failure, photoJobId);
  }
  openDriveFolder(folderId: string) {
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }
  private async businessForJob(photoJobId: string, failure: string) {
    const { data, error } = await getSupabaseClient()
      .from('photo_jobs')
      .select('business_id')
      .eq('id', photoJobId)
      .single();
    if (error || !data)
      throw new EdgeFunctionError(
        `${failure}: no se encontró el trabajo fotográfico.`,
        null,
        null,
        null,
        { cause: error },
      );
    return data.business_id as string;
  }
}

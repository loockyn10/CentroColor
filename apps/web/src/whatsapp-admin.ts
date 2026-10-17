/* eslint-disable @typescript-eslint/no-explicit-any -- Edge response mapping boundary. */
import type {
  PhotoJobNotification,
  PhotoJobNotificationRepository,
  PhotoJobWhatsAppStatus,
  WhatsAppAdminRepository,
  WhatsAppConfigureInput,
  WhatsAppIntegrationView,
  WhatsAppTestResult,
} from '@centrocolor/application';
import { getSupabaseClient } from './cloud-config';
import { invokeEdgeFunction } from './edge-functions';

export type WhatsAppAdminAction =
  'status' | 'configure' | 'test' | 'disconnect';

/**
 * Body sent to `whatsapp-admin`. The keys are the contract with
 * supabase/functions/_shared/whatsapp-handlers.ts (WhatsAppAdminPayload); a contract test
 * runs these builders through the real handler.
 */
export const whatsappAdminBody = (
  action: WhatsAppAdminAction,
  businessId: string,
  input?: Partial<WhatsAppConfigureInput>,
) => ({
  action,
  businessId,
  phoneNumberId: input?.phoneNumberId,
  wabaId: input?.wabaId,
  templateName: input?.templateName,
  templateLanguage: input?.templateLanguage,
  accessToken: input?.accessToken || undefined,
});

/** Body sent to `whatsapp-send` (contract: WhatsAppSendPayload). */
export const whatsappSendBody = (
  action: 'retry' | 'resend' | 'process',
  businessId: string,
  ids: { notificationId?: string; photoJobId?: string },
) => ({ action, businessId, ...ids });

const mapIntegration = (x: any): WhatsAppIntegrationView => ({
  status: x.status,
  phoneNumberId: x.phoneNumberId ?? null,
  wabaId: x.wabaId ?? null,
  displayPhoneNumber: x.displayPhoneNumber ?? null,
  templateName: x.templateName ?? null,
  templateLanguage: x.templateLanguage ?? null,
  configuredAt: x.configuredAt ?? null,
  lastCheckedAt: x.lastCheckedAt ?? null,
  lastCheckError: x.lastCheckError ?? null,
});

export class SupabaseWhatsAppAdminRepository implements WhatsAppAdminRepository {
  private invoke(
    action: WhatsAppAdminAction,
    businessId: string,
    failure: string,
    input?: Partial<WhatsAppConfigureInput>,
  ) {
    return invokeEdgeFunction(
      getSupabaseClient(),
      'whatsapp-admin',
      whatsappAdminBody(action, businessId, input),
      failure,
    );
  }
  async getIntegration(businessId: string) {
    return mapIntegration(
      await this.invoke('status', businessId, 'No se pudo consultar WhatsApp'),
    );
  }
  async configure(businessId: string, input: WhatsAppConfigureInput) {
    return mapIntegration(
      await this.invoke(
        'configure',
        businessId,
        'No se pudo guardar la configuración de WhatsApp',
        input,
      ),
    );
  }
  async test(businessId: string): Promise<WhatsAppTestResult> {
    const data = await this.invoke(
      'test',
      businessId,
      'No se pudo probar la conexión con WhatsApp',
    );
    return {
      ok: Boolean(data.ok),
      code: data.code,
      message: data.message,
      displayPhoneNumber: data.displayPhoneNumber ?? null,
      template: data.template,
      integration: mapIntegration(data.integration),
    };
  }
  async disconnect(businessId: string) {
    return mapIntegration(
      await this.invoke(
        'disconnect',
        businessId,
        'No se pudo desconectar WhatsApp',
      ),
    );
  }
}

const mapNotification = (x: any): PhotoJobNotification => ({
  id: x.id,
  status: x.status,
  triggerKind: x.triggerKind ?? x.trigger_kind,
  attemptCount: x.attemptCount ?? x.attempt_count ?? 0,
  lastError: x.lastError ?? x.last_error ?? null,
  lastErrorCode: x.lastErrorCode ?? x.last_error_code ?? null,
  sentAt: x.sentAt ?? x.sent_at ?? null,
  createdAt: x.createdAt ?? x.created_at,
});

export class SupabasePhotoJobNotificationRepository implements PhotoJobNotificationRepository {
  async getStatus(
    businessId: string,
    photoJobId: string,
  ): Promise<PhotoJobWhatsAppStatus> {
    const client = getSupabaseClient();
    const [order, notices] = await Promise.all([
      client
        .from('public_photo_orders')
        .select('whatsapp_e164,whatsapp_opt_in,whatsapp_opt_in_at')
        .eq('business_id', businessId)
        .eq('photo_job_id', photoJobId)
        .maybeSingle(),
      client
        .from('outbound_notifications')
        .select(
          'id,status,trigger_kind,attempt_count,last_error,last_error_code,sent_at,created_at',
        )
        .eq('business_id', businessId)
        .eq('photo_job_id', photoJobId)
        .order('created_at', { ascending: true }),
    ]);
    if (order.error) throw order.error;
    if (notices.error) throw notices.error;
    return {
      consent:
        order.data?.whatsapp_opt_in && order.data.whatsapp_e164
          ? {
              phone: order.data.whatsapp_e164 as string,
              at: (order.data.whatsapp_opt_in_at as string | null) ?? null,
            }
          : null,
      notifications: (notices.data ?? []).map(mapNotification),
    };
  }
  private async send(
    action: 'retry' | 'resend' | 'process',
    businessId: string,
    ids: { notificationId?: string; photoJobId?: string },
    failure: string,
  ) {
    return invokeEdgeFunction(
      getSupabaseClient(),
      'whatsapp-send',
      whatsappSendBody(action, businessId, ids),
      failure,
    );
  }
  async retry(businessId: string, notificationId: string) {
    const data = await this.send(
      'retry',
      businessId,
      { notificationId },
      'No se pudo reintentar el aviso',
    );
    return mapNotification(data.notifications[0]);
  }
  async resend(businessId: string, photoJobId: string) {
    const data = await this.send(
      'resend',
      businessId,
      { photoJobId },
      'No se pudo reenviar el aviso',
    );
    return mapNotification(data.notifications[0]);
  }
  async wake(businessId: string, photoJobId: string) {
    try {
      await this.send(
        'process',
        businessId,
        { photoJobId },
        'No se pudo enviar el aviso',
      );
    } catch {
      // Best effort: the notice stays queued and can be retried from the job.
    }
  }
}

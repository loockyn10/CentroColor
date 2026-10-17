// Ports for the WhatsApp integration and the order notices. Only Web implements them: the
// messages are sent by the Cloud (Edge Functions), never by a device, so Desktop has no port
// and a job marked ready offline notifies the customer once it syncs.

export type WhatsAppIntegrationState =
  'not_configured' | 'configured' | 'error' | 'disconnected';

export interface WhatsAppIntegrationView {
  status: WhatsAppIntegrationState;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  configuredAt: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
}

export interface WhatsAppConfigureInput {
  phoneNumberId: string;
  wabaId: string;
  templateName: string;
  templateLanguage: string;
  /** Sent once; never read back. Leave empty to keep the stored token. */
  accessToken: string;
}

export interface WhatsAppTestResult {
  ok: boolean;
  code?: string;
  message?: string;
  displayPhoneNumber?: string | null;
  template?: { checked: boolean; found?: boolean; status?: string | null };
  integration: WhatsAppIntegrationView;
}

export interface WhatsAppAdminRepository {
  getIntegration(businessId: string): Promise<WhatsAppIntegrationView>;
  configure(
    businessId: string,
    input: WhatsAppConfigureInput,
  ): Promise<WhatsAppIntegrationView>;
  test(businessId: string): Promise<WhatsAppTestResult>;
  disconnect(businessId: string): Promise<WhatsAppIntegrationView>;
}

export type NotificationState =
  'pending' | 'sending' | 'sent' | 'failed' | 'delivered' | 'read';

export interface PhotoJobNotification {
  id: string;
  status: NotificationState;
  triggerKind: 'auto' | 'manual_resend';
  attemptCount: number;
  lastError: string | null;
  lastErrorCode: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** What the job screen needs to know about WhatsApp for one job. */
export interface PhotoJobWhatsAppStatus {
  /** The customer accepted order notices through the public order form. */
  consent: { phone: string; at: string | null } | null;
  notifications: PhotoJobNotification[];
}

export interface PhotoJobNotificationRepository {
  getStatus(
    businessId: string,
    photoJobId: string,
  ): Promise<PhotoJobWhatsAppStatus>;
  retry(
    businessId: string,
    notificationId: string,
  ): Promise<PhotoJobNotification>;
  resend(businessId: string, photoJobId: string): Promise<PhotoJobNotification>;
  /** Best-effort wake-up of the sender after the job became ready. Never throws. */
  wake(businessId: string, photoJobId: string): Promise<void>;
}

const ERROR_HINTS: Record<string, string> = {
  integration_not_configured:
    'WhatsApp no está configurado. Configuralo en Configuración → Integraciones y reintentá.',
  integration_error:
    'La conexión con WhatsApp necesita revisión. Probá la conexión en Configuración → Integraciones.',
  token_invalid:
    'El token de acceso de WhatsApp venció o es inválido. Cargá uno nuevo en Configuración.',
  token_missing:
    'Falta el token de WhatsApp. Cargalo de nuevo en Configuración.',
  template_not_found:
    'La plantilla no existe o no está aprobada en Meta con ese nombre e idioma.',
  template_unavailable: 'Meta pausó o deshabilitó la plantilla.',
  recipient_not_allowed:
    'El número no está en la lista de prueba de Meta (cuenta de prueba).',
  recipient_unreachable:
    'El número no tiene WhatsApp o no pudo recibir el mensaje.',
  rate_limited: 'Meta limitó los envíos. Reintentá en unos minutos.',
  meta_unavailable: 'Meta no está disponible. Reintentá más tarde.',
  timeout: 'Meta no respondió. Verificá con el cliente antes de reintentar.',
  network_error: 'No se pudo contactar a Meta. Reintentá más tarde.',
  interrupted: 'El envío quedó interrumpido. Reintentá.',
};

/** Short, human explanation of a failed notice for the job screen. */
export function describeNotificationFailure(
  notification: Pick<PhotoJobNotification, 'lastError' | 'lastErrorCode'>,
) {
  return (
    (notification.lastErrorCode && ERROR_HINTS[notification.lastErrorCode]) ||
    notification.lastError ||
    'No se pudo enviar el aviso.'
  );
}

/**
 * Which notice describes the job today: the newest one. A manual resend supersedes the
 * automatic notice in the UI, while the automatic one stays in the history.
 */
export function latestNotification(
  notifications: PhotoJobNotification[],
): PhotoJobNotification | null {
  return (
    [...notifications]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null
  );
}

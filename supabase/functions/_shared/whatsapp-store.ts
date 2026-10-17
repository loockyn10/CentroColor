// Persistence contract for the WhatsApp functions.
// The Supabase implementation lives in whatsapp-store-supabase.ts; tests use an in-memory one.

export type IntegrationStatus = 'configured' | 'error' | 'disconnected';

export type WhatsAppIntegrationRow = {
  business_id: string;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  /** Reference to a Vault secret. The token itself is only readable through readToken(). */
  access_token_secret_id: string;
  status: IntegrationStatus;
  template_name: string;
  template_language: string;
  configured_at: string;
  last_checked_at: string | null;
  last_check_error: string | null;
};

export type NotificationStatus =
  'pending' | 'sending' | 'sent' | 'failed' | 'delivered' | 'read';

export type NotificationRow = {
  id: string;
  business_id: string;
  customer_id: string | null;
  photo_job_id: string | null;
  channel: 'whatsapp';
  event_type: 'photo_job_ready';
  destination: string;
  status: NotificationStatus;
  provider_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  last_error_code: string | null;
  trigger_kind: 'auto' | 'manual_resend';
  sent_at: string | null;
  created_at: string;
};

export type SendContext = { customer_first_name: string; order_code: string };

export type SaveIntegration = {
  business_id: string;
  phone_number_id: string;
  waba_id: string | null;
  template_name: string;
  template_language: string;
  secret_id: string;
  actor: string;
};

export type FinishResult =
  | { ok: true; messageId: string }
  | { ok: false; code: string; message: string };

export interface WhatsAppStore {
  getIntegration(businessId: string): Promise<WhatsAppIntegrationRow | null>;
  storeToken(token: string, name: string): Promise<string>;
  readToken(secretId: string): Promise<string | null>;
  deleteToken(secretId: string): Promise<void>;
  saveIntegration(value: SaveIntegration): Promise<void>;
  disconnect(businessId: string): Promise<boolean>;
  recordCheck(
    businessId: string,
    result: {
      status: IntegrationStatus;
      displayPhoneNumber: string | null;
      error: string | null;
    },
  ): Promise<void>;

  /** Atomically moves `pending` rows to `sending`; two senders never receive the same row. */
  claim(ids: string[] | null, limit: number): Promise<NotificationRow[]>;
  finish(id: string, result: FinishResult): Promise<void>;
  retry(businessId: string, id: string, actor: string): Promise<void>;
  resend(businessId: string, jobId: string, actor: string): Promise<string>;
  applyStatus(update: {
    messageId: string;
    status: 'delivered' | 'read' | 'failed';
    at: string | null;
    code: string | null;
    message: string | null;
  }): Promise<boolean>;
  listForJob(businessId: string, jobId: string): Promise<NotificationRow[]>;
  getNotification(
    businessId: string,
    id: string,
  ): Promise<NotificationRow | null>;
  getSendContext(
    businessId: string,
    jobId: string,
  ): Promise<SendContext | null>;
  /** Read-only link for the "Podés consultar el estado" URL of the message. */
  mintTrackingLink(link: {
    business_id: string;
    photo_job_id: string;
    token_hash: string;
    expires_at: string;
  }): Promise<void>;
}

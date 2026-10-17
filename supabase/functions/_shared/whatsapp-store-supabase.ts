/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client boundary. */
import { DatabaseError } from './diagnostics.ts';
import { OrderRuleError } from './public-order-store.ts';
import { run, type ServiceDb } from './store-supabase.ts';
import type {
  NotificationRow,
  WhatsAppIntegrationRow,
  WhatsAppStore,
} from './whatsapp-store.ts';

const integrationColumns =
  'business_id,phone_number_id,waba_id,display_phone_number,access_token_secret_id,status,template_name,template_language,configured_at,last_checked_at,last_check_error';
const notificationColumns =
  'id,business_id,customer_id,photo_job_id,channel,event_type,destination,status,provider_message_id,attempt_count,last_error,last_error_code,trigger_kind,sent_at,created_at';

async function rpc(db: ServiceDb, name: string, args: Record<string, unknown>) {
  const { data, error } = (await db.rpc(name, args)) as {
    data: any;
    error: { message?: string } | null;
  };
  if (error) {
    const rule = /cc_error:([a-z_]+)/.exec(error.message ?? '');
    if (rule) throw new OrderRuleError(rule[1]!);
    throw new DatabaseError(name, error);
  }
  return data;
}

export function createWhatsAppStore(db: ServiceDb): WhatsAppStore {
  return {
    async getIntegration(businessId) {
      const { data } = await run(
        'whatsapp_integrations.get',
        db
          .from('whatsapp_integrations')
          .select(integrationColumns)
          .eq('business_id', businessId)
          .maybeSingle(),
      );
      return (data as WhatsAppIntegrationRow | null) ?? null;
    },
    async storeToken(token, name) {
      const id = await rpc(db, 'cc_store_whatsapp_token', {
        p_token: token,
        p_name: name,
      });
      return String(id);
    },
    async readToken(secretId) {
      const data = await rpc(db, 'cc_read_whatsapp_token', {
        p_secret_id: secretId,
      });
      return typeof data === 'string' && data ? data : null;
    },
    async deleteToken(secretId) {
      await rpc(db, 'cc_delete_whatsapp_token', { p_secret_id: secretId });
    },
    async saveIntegration(value) {
      await rpc(db, 'cc_save_whatsapp_integration', {
        p_business_id: value.business_id,
        p_phone_number_id: value.phone_number_id,
        p_waba_id: value.waba_id,
        p_template_name: value.template_name,
        p_template_language: value.template_language,
        p_secret_id: value.secret_id,
        p_actor: value.actor,
      });
    },
    async disconnect(businessId) {
      return Boolean(
        await rpc(db, 'cc_disconnect_whatsapp_integration', {
          p_business_id: businessId,
        }),
      );
    },
    async recordCheck(businessId, result) {
      const now = new Date().toISOString();
      await run(
        'whatsapp_integrations.record_check',
        db
          .from('whatsapp_integrations')
          .update({
            status: result.status,
            display_phone_number: result.displayPhoneNumber,
            last_checked_at: now,
            last_check_error: result.error,
            updated_at: now,
          })
          .eq('business_id', businessId),
      );
    },

    async claim(ids, limit) {
      const data = await rpc(db, 'cc_claim_notifications', {
        p_ids: ids,
        p_limit: limit,
      });
      return ((data ?? []) as NotificationRow[]).map((x) => x);
    },
    async finish(id, result) {
      await rpc(db, 'cc_finish_notification', {
        p_id: id,
        p_ok: result.ok,
        p_provider_message_id: result.ok ? result.messageId : null,
        p_error_code: result.ok ? null : result.code,
        p_error: result.ok ? null : result.message,
      });
    },
    async retry(businessId, id, actor) {
      await rpc(db, 'cc_retry_notification', {
        p_business_id: businessId,
        p_id: id,
        p_actor: actor,
      });
    },
    async resend(businessId, jobId, actor) {
      return String(
        await rpc(db, 'cc_resend_ready_notification', {
          p_business_id: businessId,
          p_job_id: jobId,
          p_actor: actor,
        }),
      );
    },
    async applyStatus(update) {
      return Boolean(
        await rpc(db, 'cc_apply_whatsapp_status', {
          p_message_id: update.messageId,
          p_status: update.status,
          p_at: update.at,
          p_error_code: update.code,
          p_error: update.message,
        }),
      );
    },
    async listForJob(businessId, jobId) {
      const { data } = await run(
        'outbound_notifications.list_for_job',
        db
          .from('outbound_notifications')
          .select(notificationColumns)
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .order('created_at', { ascending: true }),
      );
      return (data ?? []) as NotificationRow[];
    },
    async getNotification(businessId, id) {
      const { data } = await run(
        'outbound_notifications.get',
        db
          .from('outbound_notifications')
          .select(notificationColumns)
          .eq('business_id', businessId)
          .eq('id', id)
          .maybeSingle(),
      );
      return (data as NotificationRow | null) ?? null;
    },
    async getSendContext(businessId, jobId) {
      const { data } = await run(
        'public_photo_orders.get_send_context',
        db
          .from('public_photo_orders')
          .select('customer_name')
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .maybeSingle(),
      );
      if (!data) return null;
      return {
        customer_first_name:
          String(data.customer_name).trim().split(/\s+/)[0] ?? '',
        order_code: `CC-${jobId.slice(0, 8).toUpperCase()}`,
      };
    },
    async mintTrackingLink(link) {
      await run(
        'photo_job_upload_links.insert_tracking',
        db.from('photo_job_upload_links').insert({
          business_id: link.business_id,
          photo_job_id: link.photo_job_id,
          token_hash: link.token_hash,
          created_by: null,
          expires_at: link.expires_at,
          purpose: 'tracking',
          submitted_at: new Date().toISOString(),
        }),
      );
    },
  };
}

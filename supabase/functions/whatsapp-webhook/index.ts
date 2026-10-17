import { handleWhatsAppWebhook } from '../_shared/whatsapp-handlers.ts';
import { whatsappWebhookDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handleWhatsAppWebhook(request, whatsappWebhookDeps()));

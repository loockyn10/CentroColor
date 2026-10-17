import { handleWhatsAppSend } from '../_shared/whatsapp-handlers.ts';
import { whatsappSendDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handleWhatsAppSend(request, whatsappSendDeps()));

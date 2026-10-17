import { handleWhatsAppAdmin } from '../_shared/whatsapp-handlers.ts';
import { whatsappAdminDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handleWhatsAppAdmin(request, whatsappAdminDeps()));

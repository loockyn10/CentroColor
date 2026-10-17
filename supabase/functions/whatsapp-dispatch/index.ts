import { handleWhatsAppDispatch } from '../_shared/whatsapp-handlers.ts';
import { whatsappDispatchDeps } from '../_shared/runtime.ts';

Deno.serve((request) =>
  handleWhatsAppDispatch(request, whatsappDispatchDeps()),
);

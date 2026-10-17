import { handlePublicOrderStart } from '../_shared/public-order-handlers.ts';
import { publicOrderDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handlePublicOrderStart(request, publicOrderDeps()));

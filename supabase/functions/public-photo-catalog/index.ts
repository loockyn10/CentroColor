import { handlePublicCatalog } from '../_shared/public-order-handlers.ts';
import { publicOrderDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handlePublicCatalog(request, publicOrderDeps()));

import { handleProfessionalCatalog } from '../_shared/professional-handlers.ts';
import { professionalDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handleProfessionalCatalog(request, professionalDeps()));

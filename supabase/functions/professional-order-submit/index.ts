import { handleProfessionalOrderSubmit } from '../_shared/professional-handlers.ts';
import { professionalDeps } from '../_shared/runtime.ts';

Deno.serve((request) =>
  handleProfessionalOrderSubmit(request, professionalDeps()),
);

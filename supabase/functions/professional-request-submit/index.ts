import { handleProfessionalRequestSubmit } from '../_shared/professional-request-handlers.ts';
import { publicOrderDeps } from '../_shared/runtime.ts';

Deno.serve((request) =>
  handleProfessionalRequestSubmit(request, publicOrderDeps()),
);

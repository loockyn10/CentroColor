import { handleProfessionalRequestStart } from '../_shared/professional-request-handlers.ts';
import { publicOrderDeps } from '../_shared/runtime.ts';

Deno.serve((request) =>
  handleProfessionalRequestStart(request, publicOrderDeps()),
);

import { handleProfessionalAdmin } from '../_shared/professional-admin-handler.ts';
import { professionalAdminDeps } from '../_shared/runtime.ts';

Deno.serve((request) =>
  handleProfessionalAdmin(request, professionalAdminDeps()),
);

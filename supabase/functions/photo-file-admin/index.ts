import { handlePhotoFileAdmin } from '../_shared/photo-file-admin-handler.ts';
import { adminDeps } from '../_shared/runtime.ts';

Deno.serve((request) => handlePhotoFileAdmin(request, adminDeps()));

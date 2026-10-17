import { publicDeps } from '../_shared/runtime.ts';
import { handleUploadFinalize } from '../_shared/upload-handlers.ts';

Deno.serve((request) => handleUploadFinalize(request, publicDeps()));

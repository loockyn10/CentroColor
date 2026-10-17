import { publicDeps } from '../_shared/runtime.ts';
import { handleUploadSession } from '../_shared/upload-handlers.ts';

Deno.serve((request) => handleUploadSession(request, publicDeps()));

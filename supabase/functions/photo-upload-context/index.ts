import { publicDeps } from '../_shared/runtime.ts';
import { handleUploadContext } from '../_shared/upload-handlers.ts';

Deno.serve((request) => handleUploadContext(request, publicDeps()));

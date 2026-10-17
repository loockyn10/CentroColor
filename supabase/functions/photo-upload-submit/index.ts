import { publicDeps } from '../_shared/runtime.ts';
import { handleUploadSubmit } from '../_shared/upload-handlers.ts';

Deno.serve((request) => handleUploadSubmit(request, publicDeps()));

// Wiring of the real (Deno) dependencies. Kept tiny on purpose: all behavior lives in
// handlers that receive their dependencies, so it can be tested without Deno/Supabase.
import { createDriveGateway } from './google-drive.ts';
import { createPhotoIntakeStore } from './store-supabase.ts';
import { authenticateAdmin, serviceClient } from './supabase.ts';
import type { AdminDeps } from './photo-file-admin-handler.ts';
import type { PublicDeps } from './upload-handlers.ts';

const getEnv = (name: string) => Deno.env.get(name);

function services() {
  const store = createPhotoIntakeStore(serviceClient());
  return { store, drive: createDriveGateway({ store, getEnv }) };
}

export const adminDeps = (): AdminDeps => ({
  authenticate: authenticateAdmin,
  services,
  getEnv,
});

export const publicDeps = (): PublicDeps => ({ ...services(), getEnv });

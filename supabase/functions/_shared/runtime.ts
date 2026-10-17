// Wiring of the real (Deno) dependencies. Kept tiny on purpose: all behavior lives in
// handlers that receive their dependencies, so it can be tested without Deno/Supabase.
import { whatsAppSettings } from './config.ts';
import { createDriveGateway } from './google-drive.ts';
import { createMetaClient } from './meta-client.ts';
import { createPublicOrderStore } from './public-order-store-supabase.ts';
import { createPhotoIntakeStore } from './store-supabase.ts';
import {
  authenticateAdmin,
  authenticateMember,
  serviceClient,
} from './supabase.ts';
import { createWhatsAppStore } from './whatsapp-store-supabase.ts';
import type { AdminDeps } from './photo-file-admin-handler.ts';
import type { PublicOrderDeps } from './public-order-handlers.ts';
import type { PublicDeps } from './upload-handlers.ts';
import type {
  WhatsAppAdminDeps,
  WhatsAppDispatchDeps,
  WhatsAppSendDeps,
  WhatsAppServices,
  WhatsAppWebhookDeps,
} from './whatsapp-handlers.ts';

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

export const publicOrderDeps = (): PublicOrderDeps => {
  const db = serviceClient();
  const intake = createPhotoIntakeStore(db);
  return {
    intake,
    orders: createPublicOrderStore(db),
    drive: createDriveGateway({ store: intake, getEnv }),
    getEnv,
  };
};

const whatsappServices = (): WhatsAppServices => ({
  store: createWhatsAppStore(serviceClient()),
  meta: createMetaClient({
    apiVersion: whatsAppSettings(getEnv).graphApiVersion,
  }),
});

export const whatsappAdminDeps = (): WhatsAppAdminDeps => ({
  authenticate: authenticateAdmin,
  services: whatsappServices,
  getEnv,
});
export const whatsappSendDeps = (): WhatsAppSendDeps => ({
  authenticate: authenticateMember,
  services: whatsappServices,
  getEnv,
});
export const whatsappDispatchDeps = (): WhatsAppDispatchDeps => ({
  services: whatsappServices,
  getEnv,
});
export const whatsappWebhookDeps = (): WhatsAppWebhookDeps => ({
  store: () => createWhatsAppStore(serviceClient()),
  getEnv,
});

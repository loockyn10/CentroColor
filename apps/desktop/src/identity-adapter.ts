import Database from '@tauri-apps/plugin-sql';
import {
  resolveAppContext,
  type AppContext,
  type BusinessRepository,
  type BranchRepository,
  type DeviceRepository,
} from '@centrocolor/application';
import {
  parseDeviceType,
  type Business,
  type Branch,
  type Device,
} from '@centrocolor/domain';

const databaseUrl = 'sqlite:centrocolor.db';
let contextPromise: Promise<AppContext> | undefined;

type MetaRow = { value: string };
type IdRow = { id: string };
type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};
type BranchRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};
type DeviceRow = {
  id: string;
  business_id: string;
  branch_id: string;
  name: string;
  device_type: string;
  installation_id: string;
  is_active: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

async function first<T>(
  db: Database,
  sql: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await db.select<T[]>(sql, values);
  return rows[0] ?? null;
}

async function getMeta(db: Database, key: string): Promise<string | null> {
  return (
    (
      await first<MetaRow>(db, 'SELECT value FROM app_meta WHERE key = ?', [
        key,
      ])
    )?.value ?? null
  );
}

async function setMetaOnce(
  db: Database,
  key: string,
  value: string,
): Promise<void> {
  await db.execute(
    'INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)',
    [key, value],
  );
}

function repositories(db: Database): {
  businesses: BusinessRepository;
  branches: BranchRepository;
  devices: DeviceRepository;
} {
  return {
    businesses: {
      async findById(id): Promise<Business | null> {
        const row = await first<BusinessRow>(
          db,
          'SELECT * FROM businesses WHERE id = ?',
          [id],
        );
        return (
          row && {
            id: row.id,
            name: row.name,
            slug: row.slug,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        );
      },
    },
    branches: {
      async findById(id): Promise<Branch | null> {
        const row = await first<BranchRow>(
          db,
          'SELECT * FROM branches WHERE id = ?',
          [id],
        );
        return (
          row && {
            id: row.id,
            businessId: row.business_id,
            name: row.name,
            isActive: row.is_active === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        );
      },
    },
    devices: {
      async findById(id): Promise<Device | null> {
        const row = await first<DeviceRow>(
          db,
          'SELECT * FROM devices WHERE id = ?',
          [id],
        );
        return (
          row && {
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            name: row.name,
            deviceType: parseDeviceType(row.device_type),
            installationId: row.installation_id,
            isActive: row.is_active === 1,
            lastSeenAt: row.last_seen_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        );
      },
    },
  };
}

async function bootstrap(): Promise<AppContext> {
  const db = await Database.load(databaseUrl);
  const existing = {
    businessId: await getMeta(db, 'current_business_id'),
    branchId: await getMeta(db, 'current_branch_id'),
    deviceId: await getMeta(db, 'current_device_id'),
  };
  if (existing.businessId && existing.branchId && existing.deviceId) {
    return resolveAppContext(
      {
        businessId: existing.businessId,
        branchId: existing.branchId,
        deviceId: existing.deviceId,
      },
      repositories(db),
    );
  }
  await setMetaOnce(db, 'installation_id', crypto.randomUUID());
  const installationId = await getMeta(db, 'installation_id');
  if (!installationId)
    throw new Error('Could not persist installation identity');

  // Temporary CentroColor bootstrap until onboarding exists. IDs are generated locally once.
  const now = new Date().toISOString();
  await db.execute(
    'INSERT OR IGNORE INTO businesses (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), 'CentroColor', 'centrocolor', now, now],
  );
  const business = await first<IdRow>(
    db,
    'SELECT id FROM businesses WHERE slug = ?',
    ['centrocolor'],
  );
  if (!business) throw new Error('Could not initialize local business');

  await db.execute(
    'INSERT OR IGNORE INTO branches (id, business_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), business.id, 'Sucursal principal', now, now],
  );
  const branch = await first<IdRow>(
    db,
    'SELECT id FROM branches WHERE business_id = ? AND name = ?',
    [business.id, 'Sucursal principal'],
  );
  if (!branch) throw new Error('Could not initialize local branch');

  await db.execute(
    'INSERT OR IGNORE INTO devices (id, business_id, branch_id, name, device_type, installation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      crypto.randomUUID(),
      business.id,
      branch.id,
      'Desktop CentroColor',
      'desktop',
      installationId,
      now,
      now,
    ],
  );
  const device = await first<IdRow>(
    db,
    'SELECT id FROM devices WHERE installation_id = ?',
    [installationId],
  );
  if (!device) throw new Error('Could not initialize local device');

  await setMetaOnce(db, 'current_business_id', business.id);
  await setMetaOnce(db, 'current_branch_id', branch.id);
  await setMetaOnce(db, 'current_device_id', device.id);
  const selected = {
    businessId: await getMeta(db, 'current_business_id'),
    branchId: await getMeta(db, 'current_branch_id'),
    deviceId: await getMeta(db, 'current_device_id'),
  };
  if (!selected.businessId || !selected.branchId || !selected.deviceId) {
    throw new Error('Local identity selection is incomplete');
  }
  return resolveAppContext(
    {
      businessId: selected.businessId,
      branchId: selected.branchId,
      deviceId: selected.deviceId,
    },
    repositories(db),
  );
}

/** Shared entry point for the current local business, branch and device. */
export function bootstrapLocalIdentity(): Promise<AppContext> {
  if (!contextPromise) {
    contextPromise = bootstrap().catch((error: unknown) => {
      contextPromise = undefined;
      throw error;
    });
  }
  return contextPromise;
}

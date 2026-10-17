import { describe, expect, it, vi } from 'vitest';
import { createFakeGoogle } from './fake-google';
import {
  createDriveGateway,
  escapeDriveQuery,
  sanitizeName,
} from './google-drive';
import {
  BUSINESS_A,
  ITEM_EDIT,
  ITEM_LAB,
  JOB_A,
  createFakeStore,
  getEnv,
  seedState,
} from './test-support';

function setup() {
  const state = seedState();
  const store = createFakeStore(state);
  const google = createFakeGoogle();
  const logger = vi.fn();
  const gateway = createDriveGateway({
    store,
    getEnv,
    fetcher: google.fetcher,
    logger,
  });
  return { state, store, google, gateway, logger };
}

const folderTree = (google: ReturnType<typeof createFakeGoogle>) => {
  const byId = new Map(google.files.map((x) => [x.id, x]));
  const path = (id: string): string => {
    const file = byId.get(id);
    if (!file) return id; // the CentroColor root created by OAuth
    return [...file.parents.map(path), file.name].join('/');
  };
  return google.files
    .filter((x) => x.mimeType === 'application/vnd.google-apps.folder')
    .map((x) => path(x.id))
    .sort();
};

describe('jerarquía de carpetas en Drive', () => {
  it('crea CentroColor/Trabajos/Año/Mes/Código - Cliente/{ruta}/Servicio', async () => {
    const { gateway, google } = setup();
    const lab = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    const editing = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_EDIT);
    expect(folderTree(google)).toEqual([
      'root-1111/Trabajos',
      'root-1111/Trabajos/2026',
      'root-1111/Trabajos/2026/Octubre',
      'root-1111/Trabajos/2026/Octubre/CC-AAAAAAAA - Maria Garcia',
      'root-1111/Trabajos/2026/Octubre/CC-AAAAAAAA - Maria Garcia/Editadas',
      'root-1111/Trabajos/2026/Octubre/CC-AAAAAAAA - Maria Garcia/Para editar',
      'root-1111/Trabajos/2026/Octubre/CC-AAAAAAAA - Maria Garcia/Para editar/Restauracion',
      'root-1111/Trabajos/2026/Octubre/CC-AAAAAAAA - Maria Garcia/Para imprimir',
      'root-1111/Trabajos/2026/Octubre/CC-AAAAAAAA - Maria Garcia/Para imprimir/Foto 10x15',
    ]);
    expect(lab.route).toBe('lab');
    expect(editing.route).toBe('editing');
    expect(lab.root).toBe(editing.root);
    expect(editing.edited).toBe(lab.edited);
  });

  it('es idempotente: repetir no crea carpetas nuevas ni consulta Drive', async () => {
    const { gateway, google } = setup();
    const first = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    const created = google.files.length;
    const calls = google.requests.length;
    const second = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    expect(second.folder).toBe(first.folder);
    expect(google.files).toHaveLength(created);
    // Sólo el refresh del access token: el mapa en base evita llamadas a Drive.
    expect(
      google.requests.slice(calls).map((x) => new URL(x.url).host),
    ).toEqual(['oauth2.googleapis.com']);
  });

  it('si se pierde el mapa en base, reutiliza por appProperties en vez de duplicar', async () => {
    const { gateway, google, state } = setup();
    const first = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    const created = google.files.length;
    state.folders.clear();
    const second = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    expect(second.folder).toBe(first.folder);
    expect(google.files).toHaveLength(created);
  });

  it('sólo crea Editadas cuando hay servicios de edición y persiste los IDs en el Job', async () => {
    const { gateway, google, state } = setup();
    const job = state.jobs.find((x) => x.id === JOB_A)!;
    job.items = job.items.filter((x) => x.id === ITEM_LAB);
    const result = await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    expect(result.edited).toBeNull();
    expect(folderTree(google).some((x) => x.endsWith('Editadas'))).toBe(false);
    expect(job.drive_folder_id).toBe(result.root);
    expect(job.drive_edited_folder_id).toBeNull();
  });

  it('no reescribe photo_jobs si los IDs ya están guardados (evita churn de sync)', async () => {
    const { gateway, state } = setup();
    await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    state.calls.length = 0;
    await gateway.ensureFolders(BUSINESS_A, JOB_A, ITEM_LAB);
    expect(state.calls).not.toContain('photo_jobs.set_drive_folders');
  });

  it('rechaza un item ajeno o que no recibe archivos', async () => {
    const { gateway } = setup();
    await expect(
      gateway.ensureFolders(BUSINESS_A, JOB_A, 'no-existe'),
    ).rejects.toMatchObject({ code: 'item_not_in_job' });
    await expect(
      gateway.ensureFolders(
        BUSINESS_A,
        JOB_A,
        'dddddddd-0000-4000-8000-00000000000c',
      ),
    ).rejects.toMatchObject({ code: 'item_not_uploadable' });
  });
});

describe('acceso a Drive (Vault + refresh)', () => {
  it('lee el refresh token de Vault y renueva el access token sin exponerlos', async () => {
    const { gateway, google, logger } = setup();
    const { token } = await gateway.access(BUSINESS_A);
    expect(token).toBe('drive-access-token');
    const refresh = google.requests[0]!;
    expect(refresh.body).toContain('refresh_token=refresh-a');
    expect(refresh.body).toContain('grant_type=refresh_token');
    expect(JSON.stringify(logger.mock.calls)).not.toContain('refresh-a');
  });

  it('Drive desconectado o inexistente -> drive_not_connected', async () => {
    const { gateway, state } = setup();
    state.integrations = [];
    await expect(gateway.access(BUSINESS_A)).rejects.toMatchObject({
      status: 409,
      code: 'drive_not_connected',
    });
    const other = setup();
    other.state.integrations[0]!.status = 'disconnected';
    await expect(other.gateway.access(BUSINESS_A)).rejects.toMatchObject({
      code: 'drive_not_connected',
    });
  });

  it('reconnect_required exige reconexión sin llamar a Google', async () => {
    const { gateway, state, google } = setup();
    state.integrations[0]!.status = 'reconnect_required';
    await expect(gateway.access(BUSINESS_A)).rejects.toMatchObject({
      code: 'drive_reconnect_required',
    });
    expect(google.requests).toHaveLength(0);
  });

  it('un refresh token revocado (invalid_grant) marca reconnect_required', async () => {
    const { gateway, state, google } = setup();
    google.state.tokenMode = 'invalid_grant';
    await expect(gateway.access(BUSINESS_A)).rejects.toMatchObject({
      status: 409,
      code: 'drive_reconnect_required',
    });
    expect(state.integrations[0]?.status).toBe('reconnect_required');
  });

  it.each(['invalid_client', 'network', 'server_error'] as const)(
    'un fallo %s NO desconecta la integración',
    async (mode) => {
      const { gateway, state, google } = setup();
      google.state.tokenMode = mode;
      await expect(gateway.access(BUSINESS_A)).rejects.toBeInstanceOf(Error);
      expect(state.integrations[0]?.status).toBe('connected');
    },
  );

  it('sin secreto en Vault pide reconexión', async () => {
    const { gateway, state } = setup();
    state.refreshTokens.clear();
    await expect(gateway.access(BUSINESS_A)).rejects.toMatchObject({
      code: 'drive_reconnect_required',
    });
    expect(state.integrations[0]?.status).toBe('reconnect_required');
  });

  it('faltan credenciales de Google -> configuración inválida (no revoca)', async () => {
    const state = seedState();
    const gateway = createDriveGateway({
      store: createFakeStore(state),
      getEnv: () => undefined,
      fetcher: createFakeGoogle().fetcher,
    });
    await expect(gateway.access(BUSINESS_A)).rejects.toMatchObject({
      status: 500,
      code: 'server_misconfigured',
    });
    expect(state.integrations[0]?.status).toBe('connected');
  });
});

describe('subida resumible', () => {
  it('abre la sesión con Origin, tamaño y tipo, y devuelve la URL Location', async () => {
    const { gateway, google } = setup();
    const url = await gateway.initializeResumable(
      'drive-access-token',
      { id: 'gen-1', name: 'a.jpg', parents: ['f'] },
      'image/jpeg',
      4096,
      'https://centro-color-web.vercel.app',
    );
    expect(url).toContain('upload_id=sess-');
    const request = google.requests.at(-1)!;
    expect(request.url).toContain('uploadType=resumable');
    expect(request.headers.get('X-Upload-Content-Length')).toBe('4096');
    expect(request.headers.get('X-Upload-Content-Type')).toBe('image/jpeg');
    expect(request.headers.get('Origin')).toBe(
      'https://centro-color-web.vercel.app',
    );
  });

  it('genera IDs y consulta metadata; un 404 es "archivo incompleto" reintentable', async () => {
    const { gateway } = setup();
    expect(await gateway.generateFileId('drive-access-token')).toBe('gen-1');
    await expect(
      gateway.getFile('drive-access-token', 'no-existe'),
    ).rejects.toMatchObject({ status: 409, code: 'drive_file_missing' });
  });

  it('mapea errores de Drive a códigos y mensajes accionables, sin filtrar tokens', async () => {
    const cases: [number, string | undefined, string][] = [
      [403, 'storageQuotaExceeded', 'drive_quota_exceeded'],
      [403, 'insufficientPermissions', 'drive_forbidden'],
      [403, 'rateLimitExceeded', 'drive_rate_limited'],
      [429, undefined, 'drive_rate_limited'],
      [500, undefined, 'drive_unavailable'],
      [401, undefined, 'drive_unauthorized'],
    ];
    for (const [status, reason, code] of cases) {
      const { gateway, google, logger } = setup();
      google.state.driveFailure = { status, reason };
      await expect(
        gateway.generateFileId('drive-access-token'),
      ).rejects.toMatchObject({ code });
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        'drive-access-token',
      );
    }
  });

  it('PEDIDO.txt se crea una vez y luego se actualiza (sin duplicar)', async () => {
    const { gateway, google } = setup();
    await gateway.putManifest('drive-access-token', 'parent', JOB_A, 'uno');
    await gateway.putManifest('drive-access-token', 'parent', JOB_A, 'dos');
    const manifests = google.files.filter((x) => x.name === 'PEDIDO.txt');
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.text).toBe('dos');
    expect(manifests[0]?.appProperties).toMatchObject({
      centrocolor_job_id: JOB_A,
    });
  });
});

describe('helpers de nombres y consultas', () => {
  it('escapa comillas y barras en las consultas de Drive', () => {
    expect(escapeDriveQuery("O'Brien\\x")).toBe("O\\'Brien\\\\x");
  });
  it('sanitizeName quita caracteres de ruta y conserva la extensión al truncar', () => {
    expect(sanitizeName('a/b\\c:d*.jpg')).toBe('a b c d .jpg');
    const long = `${'x'.repeat(200)}.jpeg`;
    const clean = sanitizeName(long);
    expect(clean.length).toBeLessThanOrEqual(120);
    expect(clean.endsWith('.jpeg')).toBe(true);
    expect(sanitizeName('   ')).toBe('Sin nombre');
  });
});

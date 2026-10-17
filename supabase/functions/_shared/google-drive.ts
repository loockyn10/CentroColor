/* eslint-disable @typescript-eslint/no-explicit-any -- Google/Supabase JSON boundary. */
import { serviceClient } from './supabase.ts';
import { refreshGoogleAccessToken } from './google-oauth.ts';
import { jobFolderPlan, routeFolderPlan } from './folder-plan.ts';

const driveBase = 'https://www.googleapis.com/drive/v3';
const uploadBase = 'https://www.googleapis.com/upload/drive/v3';

export function sanitizeName(value: string) {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // eslint-disable-next-line no-control-regex -- Drive names must reject ASCII controls.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  return (cleaned || 'Sin nombre').slice(0, 120);
}

async function googleJson(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok)
    throw new Error(`Google Drive respondió ${response.status}.`);
  return await response.json();
}

export async function accessForBusiness(businessId: string) {
  const service = serviceClient();
  const { data: integration } = await service
    .from('google_drive_integrations')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'connected')
    .maybeSingle();
  if (!integration)
    throw new Error('Conectá Google Drive para recibir fotos de clientes.');
  const { data: refresh, error } = await service.rpc(
    'cc_read_google_refresh_token',
    { p_secret_id: integration.refresh_token_secret_id },
  );
  if (error || !refresh) throw new Error('Google Drive requiere reconexión.');
  let token: string;
  try {
    token = await refreshGoogleAccessToken(fetch, {
      clientId: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')!,
      clientSecret: Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')!,
      refreshToken: refresh,
    });
  } catch {
    await service
      .from('google_drive_integrations')
      .update({
        status: 'reconnect_required',
        updated_at: new Date().toISOString(),
      })
      .eq('business_id', businessId);
    throw new Error(
      'Google Drive revocó el acceso; volvé a conectar la integración.',
    );
  }
  return { token, integration, service };
}

export async function createFolder(
  token: string,
  name: string,
  parentId?: string,
  appProperties: Record<string, string> = {},
) {
  return await googleJson(
    `${driveBase}/files?fields=id,name,webViewLink`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name: sanitizeName(name),
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
        appProperties,
      }),
    },
  );
}

async function ensureMappedFolder(
  businessId: string,
  jobId: string,
  key: string,
  name: string,
  parentId: string,
  token: string,
) {
  const service = serviceClient();
  const { data: mapped } = await service
    .from('photo_job_drive_folders')
    .select('drive_folder_id')
    .eq('business_id', businessId)
    .eq('photo_job_id', jobId)
    .eq('folder_key', key)
    .maybeSingle();
  if (mapped) return mapped.drive_folder_id as string;
  const q = `'${parentId.replaceAll("'", "\\'")}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='centrocolor_key' and value='${key}' }`;
  const found = await googleJson(
    `${driveBase}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
    token,
  );
  const id =
    found.files?.[0]?.id ??
    (
      await createFolder(token, name, parentId, {
        centrocolor_key: key,
        centrocolor_job_id: jobId,
      })
    ).id;
  await service.from('photo_job_drive_folders').upsert({
    business_id: businessId,
    photo_job_id: jobId,
    folder_key: key,
    drive_folder_id: id,
  });
  return id as string;
}

export async function ensureJobFolder(
  businessId: string,
  jobId: string,
  itemId?: string,
) {
  const { token, integration, service } = await accessForBusiness(businessId);
  const { data: job, error } = await service
    .from('photo_jobs')
    .select(
      '*,customers!inner(full_name),photo_job_items(*,photo_services(workflow_route,requires_customer_files))',
    )
    .eq('business_id', businessId)
    .eq('id', jobId)
    .single();
  if (error || !job) throw new Error('No se encontró el trabajo.');
  const plan = jobFolderPlan(job.id, job.customers.full_name, job.created_at);
  let parent = integration.root_folder_id as string;
  for (const folder of plan)
    parent = await ensureMappedFolder(
      businessId,
      jobId,
      folder.key,
      folder.name,
      parent,
      token,
    );
  const root = parent;
  const items = job.photo_job_items ?? [];
  const editing = items.some(
    (x: any) => x.is_active && x.photo_services?.workflow_route === 'editing',
  );
  let edited: string | null = null;
  if (editing)
    edited = await ensureMappedFolder(
      businessId,
      jobId,
      'edited',
      'Editadas',
      root,
      token,
    );
  await service
    .from('photo_jobs')
    .update({ drive_folder_id: root, drive_edited_folder_id: edited })
    .eq('business_id', businessId)
    .eq('id', jobId);
  if (!itemId) return { token, job, root, edited, folder: root };
  const item = items.find((x: any) => x.id === itemId && x.is_active);
  if (!item) throw new Error('El servicio no pertenece a este trabajo.');
  const route = item.photo_services?.workflow_route ?? 'none';
  const requires = item.photo_services?.requires_customer_files ?? false;
  if (!requires || route === 'none')
    throw new Error('Este servicio no recibe archivos del cliente.');
  const itemPlan = routeFolderPlan(route, item.id, item.service_name_snapshot);
  const base = await ensureMappedFolder(
    businessId,
    jobId,
    itemPlan.route.key,
    itemPlan.route.name,
    root,
    token,
  );
  const folder = await ensureMappedFolder(
    businessId,
    jobId,
    itemPlan.item.key,
    itemPlan.item.name,
    base,
    token,
  );
  return { token, job, item, route, root, edited, folder };
}

export async function initializeResumable(
  token: string,
  metadata: Record<string, unknown>,
  mime: string,
  size: number,
) {
  const response = await fetch(
    `${uploadBase}/files?uploadType=resumable&fields=id,name,mimeType,size,parents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime || 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(metadata),
    },
  );
  const location = response.headers.get('Location');
  if (!response.ok || !location)
    throw new Error('No se pudo iniciar la carga resumible en Drive.');
  return location;
}

export async function generateDriveFileId(token: string) {
  const result = await googleJson(
    `${driveBase}/files/generateIds?count=1&space=drive`,
    token,
  );
  if (!result.ids?.[0])
    throw new Error('Google Drive no devolvió un identificador de archivo.');
  return result.ids[0] as string;
}

export async function driveFile(token: string, id: string) {
  return await googleJson(
    `${driveBase}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed`,
    token,
  );
}

export async function putTextFile(
  token: string,
  parent: string,
  jobId: string,
  text: string,
) {
  const q = `'${parent}' in parents and trashed=false and name='PEDIDO.txt'`;
  const found = await googleJson(
    `${driveBase}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
    token,
  );
  const existing = found.files?.[0]?.id;
  if (existing) {
    const response = await fetch(
      `${uploadBase}/files/${existing}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: text,
      },
    );
    if (!response.ok) throw new Error('No se pudo actualizar PEDIDO.txt.');
    return;
  }
  const boundary = `cc_${crypto.randomUUID()}`;
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: 'PEDIDO.txt', parents: [parent], appProperties: { centrocolor_job_id: jobId, centrocolor_manifest: 'true' } })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const response = await fetch(`${uploadBase}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!response.ok) throw new Error('No se pudo crear PEDIDO.txt.');
}

const driveBase = 'https://www.googleapis.com/drive/v3';

async function driveJson(
  url: string,
  token: string,
  fetcher: typeof fetch,
  init: RequestInit = {},
) {
  const response = await fetcher(url, {
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

export async function ensureRootFolder(
  token: string,
  businessId: string,
  preferredId?: string | null,
  fetcher: typeof fetch = fetch,
) {
  if (preferredId) {
    try {
      const preferred = await driveJson(
        `${driveBase}/files/${encodeURIComponent(preferredId)}?fields=id,name,mimeType,size,parents,trashed`,
        token,
        fetcher,
      );
      if (
        !preferred.trashed &&
        preferred.mimeType === 'application/vnd.google-apps.folder'
      )
        return preferred;
    } catch {
      // Search by the stable app property before creating a replacement.
    }
  }
  const escapedBusinessId = businessId.replaceAll("'", "\\'");
  const query =
    "mimeType='application/vnd.google-apps.folder' and trashed=false and " +
    `appProperties has { key='centrocolor_root' and value='${escapedBusinessId}' }`;
  const found = await driveJson(
    `${driveBase}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,trashed)&pageSize=1`,
    token,
    fetcher,
  );
  if (found.files?.[0]) return found.files[0];
  return await driveJson(
    `${driveBase}/files?fields=id,name,webViewLink`,
    token,
    fetcher,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'CentroColor',
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { centrocolor_root: businessId },
      }),
    },
  );
}

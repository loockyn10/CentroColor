// In-memory emulation of the Google OAuth token endpoint and the Drive v3 endpoints used by
// the intake flow. Only imported by tests; it makes folder idempotency observable.
type DriveFolder = {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
  appProperties: Record<string, string>;
};
type DriveFileRecord = DriveFolder & { mimeType: string; text?: string };

export type FakeGoogle = ReturnType<typeof createFakeGoogle>;

export function createFakeGoogle() {
  const files: DriveFileRecord[] = [];
  const requests: {
    method: string;
    url: string;
    headers: Headers;
    body?: string;
  }[] = [];
  const state = {
    tokenMode: 'ok' as
      'ok' | 'invalid_grant' | 'invalid_client' | 'network' | 'server_error',
    driveFailure: null as null | { status: number; reason?: string },
    nextId: 1,
  };
  const reply = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });

  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const text = typeof init.body === 'string' ? init.body : undefined;
    requests.push({
      method,
      url: url.toString(),
      headers,
      body: init.body instanceof URLSearchParams ? String(init.body) : text,
    });

    if (url.host === 'oauth2.googleapis.com') {
      if (state.tokenMode === 'network') throw new TypeError('fetch failed');
      if (state.tokenMode === 'invalid_grant')
        return reply({ error: 'invalid_grant' }, 400);
      if (state.tokenMode === 'invalid_client')
        return reply({ error: 'invalid_client' }, 401);
      if (state.tokenMode === 'server_error') return reply({}, 503);
      return reply({ access_token: 'drive-access-token', expires_in: 3599 });
    }

    if (state.driveFailure)
      return reply(
        {
          error: {
            code: state.driveFailure.status,
            message: 'simulated',
            errors: [{ reason: state.driveFailure.reason ?? 'backendError' }],
          },
        },
        state.driveFailure.status,
      );
    if (headers.get('Authorization') !== 'Bearer drive-access-token')
      return reply(
        { error: { code: 401, message: 'Invalid Credentials' } },
        401,
      );

    const path = url.pathname;
    if (method === 'GET' && path === '/drive/v3/files/generateIds')
      return reply({ ids: [`gen-${state.nextId++}`] });

    if (method === 'GET' && path === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'((?:[^'\\]|\\.)*)' in parents/.exec(q)?.[1];
      const key = /key='((?:[^'\\]|\\.)*)' and value='((?:[^'\\]|\\.)*)'/.exec(
        q,
      );
      const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
      const found = files.filter(
        (x) =>
          !x.trashed &&
          (!parent || x.parents.includes(parent.replaceAll("\\'", "'"))) &&
          (!key || x.appProperties[key[1]!] === key[2]) &&
          (!name || x.name === name),
      );
      return reply({ files: found.slice(0, 1).map((x) => ({ id: x.id })) });
    }

    if (method === 'POST' && path === '/drive/v3/files') {
      const meta = JSON.parse(text ?? '{}');
      const record: DriveFileRecord = {
        id: `folder-${state.nextId++}`,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents ?? [],
        trashed: false,
        appProperties: meta.appProperties ?? {},
      };
      files.push(record);
      return reply({ id: record.id, name: record.name });
    }

    if (method === 'POST' && path === '/upload/drive/v3/files') {
      const mode = url.searchParams.get('uploadType');
      if (mode === 'resumable') {
        const meta = JSON.parse(text ?? '{}');
        files.push({
          id: meta.id ?? `file-${state.nextId++}`,
          name: meta.name,
          mimeType: headers.get('X-Upload-Content-Type') ?? '',
          parents: meta.parents ?? [],
          trashed: false,
          appProperties: meta.appProperties ?? {},
        });
        return new Response('{}', {
          status: 200,
          headers: {
            Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=sess-${state.nextId++}`,
          },
        });
      }
      if (mode === 'multipart') {
        const meta = JSON.parse(
          /Content-Type: application\/json; charset=UTF-8\r\n\r\n(.*?)\r\n--/s.exec(
            text ?? '',
          )?.[1] ?? '{}',
        );
        const content =
          /Content-Type: text\/plain; charset=UTF-8\r\n\r\n(.*)\r\n--cc_/s.exec(
            text ?? '',
          )?.[1] ?? '';
        const record: DriveFileRecord = {
          id: `text-${state.nextId++}`,
          name: meta.name,
          mimeType: 'text/plain',
          parents: meta.parents ?? [],
          trashed: false,
          appProperties: meta.appProperties ?? {},
          text: content,
        };
        files.push(record);
        return reply({ id: record.id });
      }
    }

    const match = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (method === 'GET' && match) {
      const record = files.find((x) => x.id === decodeURIComponent(match[1]!));
      return record
        ? reply({
            id: record.id,
            name: record.name,
            mimeType: record.mimeType,
            parents: record.parents,
            trashed: record.trashed,
            size: record.text ? String(record.text.length) : undefined,
          })
        : reply({ error: { code: 404, message: 'File not found' } }, 404);
    }
    const upload = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (method === 'PATCH' && upload) {
      const record = files.find((x) => x.id === decodeURIComponent(upload[1]!));
      if (!record) return reply({ error: { code: 404 } }, 404);
      record.text = text;
      return reply({ id: record.id });
    }
    return reply(
      { error: { code: 400, message: `unhandled ${method} ${path}` } },
      400,
    );
  }) as typeof fetch;

  return { fetcher, files, requests, state };
}

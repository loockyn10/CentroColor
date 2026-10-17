import { useEffect, useMemo, useState } from 'react';

type Destination = {
  destinationId: string;
  name: string;
  quantity: number;
  widthMm: number | null;
  heightMm: number | null;
  workflowRoute: 'lab' | 'editing' | 'other';
};
type Context = {
  businessName: string;
  customerName: string;
  orderCode: string;
  destinations: Destination[];
  expiresAt: string | null;
};
type Upload = {
  id: string;
  destinationId: string;
  file: File;
  copies: number;
  progress: number;
  status: 'waiting' | 'uploading' | 'uploaded' | 'failed';
  uploadId?: string;
  uploadUrl?: string;
  chunkSize?: number;
  error?: string;
};

const errorText = (x: unknown) =>
  x instanceof Error ? x.message : 'No se pudo completar la operación.';

async function call(name: string, body: unknown) {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${base}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key ?? '',
      Authorization: `Bearer ${key ?? ''}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error)
    throw new Error(payload.error ?? 'No se pudo contactar a CentroColor.');
  return payload;
}

export async function resumableOffset(url: string, size: number) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${size}` },
  });
  if (response.ok) return size;
  if (response.status !== 308) throw new Error('La sesión de carga venció.');
  const range = response.headers.get('Range');
  return range ? Number(range.split('-')[1]) + 1 : 0;
}

export async function uploadChunks(
  file: File,
  url: string,
  chunkSize: number,
  onProgress: (value: number) => void,
  start = 0,
) {
  let offset = start;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
      },
      body: file.slice(offset, end),
    });
    if (response.status !== 308 && !response.ok)
      throw new Error(`La carga se interrumpió (${response.status}).`);
    const range = response.headers.get('Range');
    offset = range ? Number(range.split('-')[1]) + 1 : end;
    onProgress(Math.round((offset * 100) / file.size));
  }
}

export function PhotoUploadPortal({ token }: { token: string }) {
  const [context, setContext] = useState<Context | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    call('photo-upload-context', { token })
      .then(setContext)
      .catch((x) => setFatal(errorText(x)));
  }, [token]);
  const summary = useMemo(
    () =>
      (context?.destinations ?? []).map((d) => {
        const own = uploads.filter(
          (x) => x.destinationId === d.destinationId && x.status === 'uploaded',
        );
        return {
          ...d,
          files: own.length,
          copies: own.reduce((s, x) => s + x.copies, 0),
        };
      }),
    [context, uploads],
  );
  function choose(destinationId: string, list: FileList | null) {
    if (!list) return;
    setUploads((current) => [
      ...current,
      ...Array.from(list).map((file) => ({
        id: crypto.randomUUID(),
        destinationId,
        file,
        copies: 1,
        progress: 0,
        status: 'waiting' as const,
      })),
    ]);
  }
  function patch(id: string, value: Partial<Upload>) {
    setUploads((rows) =>
      rows.map((x) => (x.id === id ? { ...x, ...value } : x)),
    );
  }
  async function send(row: Upload) {
    patch(row.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      if (row.uploadUrl && row.uploadId && row.chunkSize) {
        try {
          const offset = await resumableOffset(row.uploadUrl, row.file.size);
          if (offset < row.file.size)
            await uploadChunks(
              row.file,
              row.uploadUrl,
              row.chunkSize,
              (progress) => patch(row.id, { progress }),
              offset,
            );
          await call('photo-upload-finalize', {
            token,
            uploadId: row.uploadId,
          });
          patch(row.id, { status: 'uploaded', progress: 100 });
          return;
        } catch {
          patch(row.id, { uploadUrl: undefined, chunkSize: undefined });
        }
      }
      const session = await call('photo-upload-session', {
        token,
        destinationId: row.destinationId,
        filename: row.file.name,
        mimeType: row.file.type,
        sizeBytes: row.file.size,
        copies: row.copies,
        previousUploadId: row.uploadId,
      });
      patch(row.id, {
        uploadId: session.uploadId,
        uploadUrl: session.uploadUrl,
        chunkSize: session.chunkSize,
      });
      await uploadChunks(
        row.file,
        session.uploadUrl,
        session.chunkSize,
        (progress) => patch(row.id, { progress }),
      );
      await call('photo-upload-finalize', {
        token,
        uploadId: session.uploadId,
      });
      patch(row.id, {
        status: 'uploaded',
        progress: 100,
        uploadId: session.uploadId,
      });
    } catch (x) {
      patch(row.id, { status: 'failed', error: errorText(x) });
    }
  }
  async function sendAll() {
    setMessage(null);
    for (const row of uploads.filter(
      (x) => x.status === 'waiting' || x.status === 'failed',
    ))
      await send(row);
  }
  async function finish() {
    if (!window.confirm('¿Confirmás que terminaste de enviar tus fotos?'))
      return;
    try {
      const result = await call('photo-upload-submit', { token });
      setSubmitted(true);
      if (result.warnings?.length) setMessage(result.warnings.join(' '));
    } catch (x) {
      setMessage(errorText(x));
    }
  }
  if (fatal)
    return (
      <main className="upload-portal">
        <section>
          <h1>CentroColor</h1>
          <div className="upload-error">{fatal}</div>
        </section>
      </main>
    );
  if (!context)
    return (
      <main className="upload-portal">
        <section>
          <h1>CentroColor</h1>
          <p>Cargando pedido…</p>
        </section>
      </main>
    );
  if (submitted)
    return (
      <main className="upload-portal">
        <section className="upload-success">
          <h1>¡Listo!</h1>
          <p>CentroColor recibió tus archivos.</p>
          {message && <small>{message}</small>}
        </section>
      </main>
    );
  const busy = uploads.some((x) => x.status === 'uploading');
  const canFinish =
    uploads.some((x) => x.status === 'uploaded') &&
    !busy &&
    !uploads.some((x) => x.status === 'waiting');
  return (
    <main className="upload-portal">
      <section>
        <header>
          <span>{context.businessName}</span>
          <h1>Hola, {context.customerName}</h1>
          <p>
            Subí las fotos de tu pedido {context.orderCode}. Elegí el servicio
            correcto para cada archivo.
          </p>
        </header>
        {context.destinations.map((destination) => (
          <article
            className="upload-destination"
            key={destination.destinationId}
          >
            <h2>{destination.name}</h2>
            <p>
              {destination.quantity}{' '}
              {destination.quantity === 1 ? 'unidad' : 'unidades'}
            </p>
            <label className="upload-picker">
              Seleccionar fotos
              <input
                type="file"
                multiple
                accept="image/*,.heic,.heif,.tif,.tiff,.dng,.cr2,.cr3,.nef,.arw,.orf,.rw2,.raf"
                onChange={(e) =>
                  choose(destination.destinationId, e.target.files)
                }
              />
            </label>
            {uploads
              .filter((x) => x.destinationId === destination.destinationId)
              .map((row) => (
                <div className="upload-row" key={row.id}>
                  <div>
                    <strong>{row.file.name}</strong>
                    <small>
                      {(row.file.size / 1024 / 1024).toFixed(1)} MB ·{' '}
                      {row.status === 'uploaded'
                        ? '✓ recibido'
                        : row.status === 'failed'
                          ? row.error
                          : row.status === 'uploading'
                            ? `${row.progress}%`
                            : 'esperando'}
                    </small>
                  </div>
                  {destination.workflowRoute === 'lab' && (
                    <label>
                      Copias
                      <input
                        type="number"
                        min="1"
                        max="9999"
                        value={row.copies}
                        disabled={
                          row.status === 'uploading' ||
                          row.status === 'uploaded'
                        }
                        onChange={(e) =>
                          patch(row.id, {
                            copies: Math.max(1, Number(e.target.value)),
                          })
                        }
                      />
                    </label>
                  )}
                  {row.status === 'failed' && (
                    <button onClick={() => void send(row)}>Reintentar</button>
                  )}
                  {row.status === 'uploading' && (
                    <progress max="100" value={row.progress} />
                  )}
                </div>
              ))}
          </article>
        ))}
        {!!uploads.length && (
          <section className="upload-summary">
            <h2>Resumen</h2>
            {summary
              .filter((x) => x.files)
              .map((x) => (
                <p key={x.destinationId}>
                  <strong>{x.name}</strong>: {x.files} archivos
                  {x.workflowRoute === 'lab' ? ` · ${x.copies} copias` : ''}
                  {x.workflowRoute === 'lab' && x.copies !== x.quantity
                    ? ` · Revisá: el pedido indica ${x.quantity}`
                    : ''}
                </p>
              ))}
          </section>
        )}
        {message && <div className="upload-error">{message}</div>}
        <div className="upload-actions">
          <button
            disabled={
              busy ||
              !uploads.some(
                (x) => x.status === 'waiting' || x.status === 'failed',
              )
            }
            onClick={() => void sendAll()}
          >
            Subir archivos
          </button>
          <button
            className="upload-finish"
            disabled={!canFinish}
            onClick={() => void finish()}
          >
            Terminé de enviar mis fotos
          </button>
        </div>
      </section>
    </main>
  );
}

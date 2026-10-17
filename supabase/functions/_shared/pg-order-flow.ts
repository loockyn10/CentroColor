/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Browser-side choreography of the public order, shared by the integration tests:
// start → resumable upload (bytes "PUT" into the emulated Drive) → finalize → submit → track.
import { IDS } from './pg-harness';
import type { World } from './pg-world';
import { jsonRequest } from './test-support';
import {
  handlePublicCatalog,
  handlePublicOrderStart,
  handlePublicOrderSubmit,
  handlePublicOrderTrack,
} from './public-order-handlers';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';

export const CLIENT_KEY = 'client-key-aaaaaaaaaaaa';

export function orderFlow(world: () => World) {
  const call = async (
    handler: (r: Request, d: any) => Promise<Response>,
    deps: unknown,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await handler(jsonRequest(body, headers), deps);
    return { status: response.status, body: (await response.json()) as any };
  };
  const catalog = () => call(handlePublicCatalog, world().orderDeps, {});
  const start = (overrides: Record<string, unknown> = {}, headers = {}) =>
    call(
      handlePublicOrderStart,
      world().orderDeps,
      {
        clientKey: CLIENT_KEY,
        customer: { name: 'María García', phone: '342 555 1234' },
        whatsappOptIn: true,
        items: [{ serviceId: IDS.svc10x15, quantity: 3 }],
        ...overrides,
      },
      headers,
    );
  const submit = (token: string) =>
    call(handlePublicOrderSubmit, world().orderDeps, { token });
  const track = (token: string) =>
    call(handlePublicOrderTrack, world().orderDeps, { token });

  /** The browser's part: open the resumable session, "PUT" the bytes, finalize. */
  async function upload(
    token: string,
    destinationId: string,
    name: string,
    copies = 1,
    size = 12,
  ) {
    const w = world();
    const session = await call(handleUploadSession, w.uploadDeps, {
      token,
      destinationId,
      filename: name,
      mimeType: 'image/jpeg',
      sizeBytes: size,
      copies,
    });
    if (session.status !== 200) return { session, finalize: null };
    const row = (
      await w.db.query<any>(
        `select drive_file_id from public.photo_job_files where id=$1`,
        [session.body.uploadId],
      )
    ).rows[0];
    const driveFile = w.google.files.find((x) => x.id === row.drive_file_id)!;
    (driveFile as any).text = 'x'.repeat(size);
    const finalize = await call(handleUploadFinalize, w.uploadDeps, {
      token,
      uploadId: session.body.uploadId,
    });
    return { session, finalize };
  }

  const dest = (started: any, serviceId: string) =>
    started.body.destinations.find((d: any) => d.serviceId === serviceId)
      .destinationId as string;

  async function placeOrder(overrides: Record<string, unknown> = {}) {
    const started = await start({
      items: [
        { serviceId: IDS.svc10x15, quantity: 3 },
        { serviceId: IDS.svc20x30, quantity: 1 },
      ],
      ...overrides,
    });
    if (started.status !== 200) throw new Error(JSON.stringify(started.body));
    const token = started.body.uploadToken as string;
    await upload(token, dest(started, IDS.svc10x15), 'IMG_001.jpg', 2);
    await upload(token, dest(started, IDS.svc10x15), 'IMG_002.jpg', 1);
    await upload(token, dest(started, IDS.svc20x30), 'IMG_003.jpg', 1);
    const done = await submit(token);
    if (done.status !== 200) throw new Error(JSON.stringify(done.body));
    const jobId = (
      await world().db.query<any>(
        `select photo_job_id from public.public_photo_orders order by created_at desc limit 1`,
      )
    ).rows[0].photo_job_id as string;
    return { started, token, done, jobId };
  }

  return { call, catalog, start, submit, track, upload, dest, placeOrder };
}

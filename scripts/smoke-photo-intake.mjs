#!/usr/bin/env node
// Smoke test del portal de archivos contra el proyecto REAL, sin secretos en el repo.
//
//   $env:CC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."   # la misma que usa Vercel
//   node scripts/smoke-photo-intake.mjs --link "https://centro-color-web.vercel.app/enviar/<token>"
//   node scripts/smoke-photo-intake.mjs --link "<url>" --upload           # además sube 1 JPEG diminuto
//
// Sin --upload es de sólo lectura (valida token, Business, Job y destinos). Con --upload crea
// 1 archivo de prueba (smoke-test.jpg, ~300 bytes) en la carpeta del Job en Drive y comprueba
// el preflight CORS de Google con el Origin del portal; NO llama a submit, así que el link
// sigue abierto. Borrá smoke-test.jpg de Drive después.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const link = option('link');
const supabaseUrl = (
  option('supabase-url') ??
  process.env.CC_SUPABASE_URL ??
  'https://rymxlyionglffbmammfu.supabase.co'
).replace(/\/$/, '');
const key = process.env.CC_SUPABASE_PUBLISHABLE_KEY;
const origin = option('origin', new URL(link ?? 'https://x.invalid').origin);
const route = option('destination', 'lab');
const upload = args.includes('--upload');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
if (!link) fail('Falta --link <url del portal>.');
if (!key)
  fail(
    'Definí CC_SUPABASE_PUBLISHABLE_KEY (clave publishable, no la service role).',
  );
const token = decodeURIComponent(new URL(link).pathname.split('/').pop() ?? '');

async function edge(name, body) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    fail(
      `${name} → HTTP ${response.status} ${payload.code ?? ''} ${payload.error ?? ''} ${payload.requestId ? `(ref ${payload.requestId.slice(0, 8)})` : ''}`,
    );
  return payload;
}

const context = await edge('photo-upload-context', { token });
console.log(
  `✓ context: ${context.businessName} · ${context.orderCode} · ${context.destinations.length} destino(s)`,
);
for (const d of context.destinations)
  console.log(`   - [${d.workflowRoute}] ${d.name} x${d.quantity}`);
if (!upload) process.exit(0);

const destination = context.destinations.find((d) => d.workflowRoute === route);
if (!destination) fail(`No hay destino con workflowRoute=${route}.`);
// JPEG mínimo válido de 1x1.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const session = await edge('photo-upload-session', {
  token,
  destinationId: destination.destinationId,
  filename: 'smoke-test.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: jpeg.length,
  copies: 1,
});
console.log(
  `✓ session: uploadId=${session.uploadId.slice(0, 8)} chunk=${session.chunkSize}`,
);

const preflight = await fetch(session.uploadUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-range,content-type',
  },
});
const allowOrigin = preflight.headers.get('access-control-allow-origin');
const allowHeaders = preflight.headers.get('access-control-allow-headers');
console.log(
  `${allowOrigin ? '✓' : '✗'} preflight CORS de Drive: status=${preflight.status} allow-origin=${allowOrigin} allow-headers=${allowHeaders}`,
);

const put = await fetch(session.uploadUrl, {
  method: 'PUT',
  headers: {
    Origin: origin,
    'Content-Type': 'image/jpeg',
    'Content-Range': `bytes 0-${jpeg.length - 1}/${jpeg.length}`,
  },
  body: jpeg,
});
console.log(
  `${put.ok ? '✓' : '✗'} PUT a Drive: status=${put.status} allow-origin=${put.headers.get('access-control-allow-origin')} expose=${put.headers.get('access-control-expose-headers')}`,
);
if (!put.ok) fail('Drive no aceptó el archivo.');

const finalize = await edge('photo-upload-finalize', {
  token,
  uploadId: session.uploadId,
});
console.log(
  `✓ finalize: ok=${finalize.ok}. Archivo de prueba "smoke-test.jpg" creado; borralo de Drive. El link sigue abierto (no se llamó a submit).`,
);

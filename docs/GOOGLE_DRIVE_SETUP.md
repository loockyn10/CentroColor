# Puesta en marcha de Google Drive — Sprint 13

No copiar secretos al repositorio, Vercel, variables `VITE_`, navegador ni SQLite.

## Google Cloud Console

1. Crear o seleccionar un proyecto de Google Cloud para CentroColor.
2. En **APIs & Services → Library**, habilitar **Google Drive API**.
3. En **Google Auth Platform / OAuth consent screen**, configurar nombre de aplicación, email de soporte y dominios autorizados. Si la app queda en modo Testing, agregar como test user la cuenta Google que conectará el Drive del negocio; para uso estable, completar el proceso de publicación que Google solicite.
4. Declarar solamente el scope `https://www.googleapis.com/auth/drive.file`.
5. En **Credentials**, crear un **OAuth client ID → Web application**.
6. Agregar como Authorized redirect URI exactamente:

   `https://rymxlyionglffbmammfu.supabase.co/functions/v1/google-drive-oauth-callback`

7. Copiar Client ID y Client Secret a un gestor seguro para el paso Supabase. No guardarlos en Git.

## Supabase

El proyecto ya está vinculado al ref `rymxlyionglffbmammfu`. Revisar primero el dry-run y aplicar sólo con autorización:

```powershell
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

La migración Sprint 13 base es `20261017000000_photo_file_intake.sql`. Como ya está aplicada, no modificarla. El hardening OAuth posterior vive en `20261017010000_google_drive_oauth_hardening.sql`; agrega permisos server-only explícitos, `consumed_at` y finalización transaccional. Aplicar únicamente mediante migración, nunca con SQL manual equivalente.

Estabilización del 17/10/2026 (grants de `service_role`, corrección del trigger de PhotoJob y columnas de intake de servidor). Ejecutar en este orden, desde la raíz del repo, en PowerShell:

```powershell
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
pnpm exec supabase functions deploy photo-file-admin --use-api
pnpm exec supabase functions deploy photo-upload-context --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-session --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-finalize --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-submit --no-verify-jwt --use-api
```

El dry-run debe listar únicamente `20261017020000_photo_file_intake_stabilization.sql`. No redesplegar `google-drive-oauth-callback` ni `google-drive-oauth-start`: su comportamiento no cambió y OAuth ya funciona. `--use-api` empaqueta en Supabase y no usa Docker. Después, publicar la Web (push a la rama que despliega Vercel).

Sin la migración los links no pueden generarse aunque las funciones estén desplegadas; con las funciones viejas la migración no basta. Los errores de base quedan en los logs de cada función (`*_database_error`, con operación y SQLSTATE) y la UI muestra un código `ref.` para correlacionarlos.

Configurar o corregir secrets de Edge Functions (por ejemplo `PHOTO_UPLOAD_MAX_BYTES`; deben ser enteros: bytes, días 1–90, URL https sin barra final), sustituyendo los marcadores y usando la URL pública real del deployment Web:

```powershell
pnpm exec supabase secrets set GOOGLE_DRIVE_CLIENT_ID="REEMPLAZAR" GOOGLE_DRIVE_CLIENT_SECRET="REEMPLAZAR" GOOGLE_DRIVE_REDIRECT_URI="https://rymxlyionglffbmammfu.supabase.co/functions/v1/google-drive-oauth-callback" WEB_APP_URL="https://centro-color-web.vercel.app" PUBLIC_WEB_URL="https://centro-color-web.vercel.app" PHOTO_UPLOAD_SIGNING_SECRET="REEMPLAZAR-POR-32-BYTES-ALEATORIOS-O-MAS" PHOTO_UPLOAD_LINK_DAYS="14" PHOTO_UPLOAD_MAX_BYTES="2147483648"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son secrets reservados que Supabase inyecta en Edge Functions; no duplicarlos ni exponerlos.

Despliegue completo desde cero (en una actualización usar sólo los comandos de arriba). Desplegar las funciones autenticadas:

```powershell
pnpm exec supabase functions deploy google-drive-oauth-start
pnpm exec supabase functions deploy photo-file-admin
```

Desplegar callback y portal público sin verificación JWT de gateway; cada endpoint público aplica su propio token hasheado:

```powershell
pnpm exec supabase functions deploy google-drive-oauth-callback --no-verify-jwt
pnpm exec supabase functions deploy photo-upload-context --no-verify-jwt
pnpm exec supabase functions deploy photo-upload-session --no-verify-jwt
pnpm exec supabase functions deploy photo-upload-finalize --no-verify-jwt
pnpm exec supabase functions deploy photo-upload-submit --no-verify-jwt
```

Después, iniciar sesión como owner/admin en CentroColor, abrir **Configuración → Integraciones → Google Drive**, conectar la cuenta y verificar que se cree/abra la carpeta raíz `CentroColor`.

## Vercel

Mantener únicamente las variables públicas ya requeridas por Web:

```text
VITE_SUPABASE_URL=https://rymxlyionglffbmammfu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

No configurar en Vercel `GOOGLE_DRIVE_CLIENT_SECRET`, refresh tokens, access tokens, `SUPABASE_SERVICE_ROLE_KEY` ni `PHOTO_UPLOAD_SIGNING_SECRET`. Si el Root Directory del proyecto Vercel es `apps/web`, `apps/web/vercel.json` ya reescribe `/enviar/:token` a `index.html`. Si el deployment usa otra raíz, reproducir esa rewrite en su configuración antes de publicar.

Tras cambiar variables `VITE_`, generar un deployment nuevo. Probar `/enviar/<token-real>` desde Android, iPhone y navegador desktop con un archivo pequeño y luego uno grande; confirmar carpeta, metadata, `PEDIDO.txt`, colas y reapertura por regeneración.

## Verificación sin navegador

`scripts/smoke-photo-intake.mjs` valida un link real contra el proyecto sin guardar secretos en el repo (clave publishable en `CC_SUPABASE_PUBLISHABLE_KEY`). Sin `--upload` es de sólo lectura; con `--upload` sube un JPEG de 1×1, comprueba el preflight CORS de Drive con el `Origin` del portal y finaliza la carga sin cerrar el link; borrar `smoke-test.jpg` de Drive después.

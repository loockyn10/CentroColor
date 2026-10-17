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

La migración Sprint 13 es `20261017000000_photo_file_intake.sql`; crea la extensión Vault si falta, tablas/RLS, metadata e integración. No ejecutar SQL manual equivalente.

Configurar secrets de Edge Functions, sustituyendo los marcadores y usando la URL pública real del deployment Web:

```powershell
pnpm exec supabase secrets set GOOGLE_DRIVE_CLIENT_ID="REEMPLAZAR" GOOGLE_DRIVE_CLIENT_SECRET="REEMPLAZAR" GOOGLE_DRIVE_REDIRECT_URI="https://rymxlyionglffbmammfu.supabase.co/functions/v1/google-drive-oauth-callback" WEB_APP_URL="https://REEMPLAZAR-DOMINIO-WEB" PUBLIC_WEB_URL="https://REEMPLAZAR-DOMINIO-WEB" PHOTO_UPLOAD_SIGNING_SECRET="REEMPLAZAR-POR-32-BYTES-ALEATORIOS-O-MAS" PHOTO_UPLOAD_LINK_DAYS="14" PHOTO_UPLOAD_MAX_BYTES="2147483648"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son secrets reservados que Supabase inyecta en Edge Functions; no duplicarlos ni exponerlos.

Desplegar las funciones autenticadas:

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

Después, iniciar sesión como owner/admin en CentroColor, abrir **Configuración → Google Drive**, conectar la cuenta y verificar que se cree/abra la carpeta raíz `CentroColor`.

## Vercel

Mantener únicamente las variables públicas ya requeridas por Web:

```text
VITE_SUPABASE_URL=https://rymxlyionglffbmammfu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

No configurar en Vercel `GOOGLE_DRIVE_CLIENT_SECRET`, refresh tokens, access tokens, `SUPABASE_SERVICE_ROLE_KEY` ni `PHOTO_UPLOAD_SIGNING_SECRET`. Si el Root Directory del proyecto Vercel es `apps/web`, `apps/web/vercel.json` ya reescribe `/enviar/:token` a `index.html`. Si el deployment usa otra raíz, reproducir esa rewrite en su configuración antes de publicar.

Tras cambiar variables `VITE_`, generar un deployment nuevo. Probar `/enviar/<token-real>` desde Android, iPhone y navegador desktop con un archivo pequeño y luego uno grande; confirmar carpeta, metadata, `PEDIDO.txt`, colas y reapertura por regeneración.

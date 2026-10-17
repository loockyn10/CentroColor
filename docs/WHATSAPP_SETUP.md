# Puesta en marcha de WhatsApp — Sprint 14

Integración directa con la **WhatsApp Cloud API de Meta**. No usa WhatsApp Web, Selenium, números no oficiales ni proveedores pagos intermedios. El token de acceso vive sólo en Supabase Vault: nunca en una columna, en Vercel, en variables `VITE_`, en SQLite ni en el repositorio.

Si WhatsApp no está configurado, los pedidos funcionan igual; sólo queda sin enviar el aviso automático (el trabajo queda `Listo` y el aviso queda `failed` con el motivo, reintentable desde la ficha).

## 1. Meta for Developers (lo hace el dueño del negocio)

1. Entrar a <https://developers.facebook.com> con la cuenta que administra el negocio → **My Apps → Create App**. Tipo **Business**. Asociarla al _Business portfolio_ de CentroColor.
2. En el panel de la app: **Add product → WhatsApp → Set up**. Esto crea (o vincula) una **WhatsApp Business Account (WABA)**.
3. **WhatsApp → API Setup** muestra, para el número de prueba que Meta regala:
   - **Phone number ID** → es el valor de `Phone Number ID` en CentroColor.
   - **WhatsApp Business Account ID** → es el `WABA ID` (opcional pero recomendado: permite verificar que la plantilla está aprobada).
   - Un **token temporal** (dura ~24 h). Sirve sólo para probar.
4. **Número real**: en _API Setup → Add phone number_ cargar el número del local, verificarlo por SMS/llamada y esperar la aprobación del nombre visible. El número no puede estar activo en la app de WhatsApp común (hay que eliminar esa cuenta o usar un número nuevo). Agregar un **método de pago** en _WhatsApp Manager → Payment methods_: las plantillas de utilidad se cobran por mensaje enviado.
5. **Token permanente** (producción): _Business Settings → Users → System users → Add_ (rol _Admin_) → _Add assets_ (la app y la cuenta de WhatsApp, con control total) → **Generate token**, app = la creada, expiración **Never**, permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Copiarlo a un gestor de contraseñas: se pega una sola vez en CentroColor.
6. **Plantilla de utilidad**: _WhatsApp Manager → Message templates → Create template_.
   - Categoría **Utility**; nombre `pedido_listo`; idioma **Spanish (Argentina)** = `es_AR` (o el que corresponda: el valor que se configure en CentroColor debe ser idéntico).
   - Cuerpo, con las tres variables en este orden:

     ```text
     Hola {{1}}, tu pedido {{2}} de CentroColor ya está listo para retirar.

     Podés consultar el estado aquí:
     {{3}}
     ```

   - Ejemplos para las variables: `María`, `CC-1A2B3C4D`, `https://centro-color-web.vercel.app/pedido/ejemplo`.
   - `{{1}}` = primer nombre del cliente, `{{2}}` = código del pedido, `{{3}}` = link de seguimiento (de sólo lectura, generado para ese mensaje).
   - Meta decide la aprobación: el texto exacto puede requerir ajustes. Nombre e idioma son configurables en CentroColor; si cambia el texto, **mantener tres variables de cuerpo en ese orden**. Si Meta rechazara una URL dentro del cuerpo, la alternativa es un botón _Visit website_ con URL dinámica (requeriría un pequeño cambio en `meta-client.ts` → `buildTemplatePayload`).
7. **Webhook** (recibos `delivered`/`read`/`failed`; recomendado):
   - _WhatsApp → Configuration → Webhook → Edit_: **Callback URL** `https://rymxlyionglffbmammfu.supabase.co/functions/v1/whatsapp-webhook` y **Verify token** = el valor que se defina en `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (ver §2). Meta hace un GET de verificación; la función debe estar desplegada antes.
   - En _Webhook fields_ suscribirse a **messages** (los estados de entrega llegan por ese campo).
   - **App secret**: _App settings → Basic → App secret → Show_; va a `WHATSAPP_APP_SECRET`. Sin firma válida (`X-Hub-Signature-256`) el webhook rechaza todo.
   - Si la WABA no la creó esta app, suscribir la app a la WABA una vez (con el token del sistema, sin pegarlo en ningún archivo):

     ```powershell
     curl.exe -X POST "https://graph.facebook.com/v22.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer <TOKEN>"
     ```

   - Sin webhook el flujo funciona igual: el aviso queda `Enviado` (aceptado por Meta) y **nunca** se marca `Entregado` sin un recibo real.

## 2. Supabase

Secrets de Edge Functions (reemplazar los marcadores; no commitear valores reales):

```powershell
pnpm exec supabase secrets set WHATSAPP_DISPATCH_SECRET="REEMPLAZAR-CON-32-CARACTERES-ALEATORIOS-O-MAS" WHATSAPP_APP_SECRET="REEMPLAZAR" WHATSAPP_WEBHOOK_VERIFY_TOKEN="REEMPLAZAR-CON-16-CARACTERES-O-MAS"
```

Opcionales: `WHATSAPP_GRAPH_API_VERSION` (por defecto `v22.0`) y `WHATSAPP_AR_DROP_MOBILE_NINE=true` (ver «Argentina» abajo).

Migraciones y funciones (después del `--dry-run`, que debe listar `20261018000000_public_photo_orders.sql` y `20261018010000_whatsapp_notifications.sql`):

```powershell
pnpm exec supabase db push
pnpm exec supabase functions deploy whatsapp-admin --use-api
pnpm exec supabase functions deploy whatsapp-send --use-api
pnpm exec supabase functions deploy whatsapp-dispatch --no-verify-jwt --use-api
pnpm exec supabase functions deploy whatsapp-webhook --no-verify-jwt --use-api
```

`whatsapp-admin` y `whatsapp-send` validan el JWT del usuario (owner/admin y cualquier miembro, respectivamente). `whatsapp-dispatch` se autoriza con `x-dispatch-secret` y `whatsapp-webhook` con la firma HMAC de Meta, por eso no verifican JWT en el gateway.

### Despertar al emisor desde la base (necesario para el aviso que nace de Desktop)

Un trabajo marcado `Listo` en Desktop sin conexión llega a la nube al sincronizar; el trigger de PostgreSQL encola el aviso. Para que se envíe **en el acto** (y no sólo cuando alguien lo dispare desde la Web), el trigger llama por `pg_net` a `whatsapp-dispatch`, usando dos secretos de Vault que se crean **una vez** en el SQL Editor (reemplazar los marcadores; el segundo valor es el mismo `WHATSAPP_DISPATCH_SECRET`):

```sql
select vault.create_secret('https://rymxlyionglffbmammfu.supabase.co/functions/v1/whatsapp-dispatch', 'whatsapp_dispatch_url');
select vault.create_secret('REEMPLAZAR-IGUAL-A-WHATSAPP_DISPATCH_SECRET', 'whatsapp_dispatch_secret');
```

Requiere la extensión `pg_net` (Database → Extensions). Si falta, el cambio de estado **no falla**: el aviso queda `pending` hasta que algún emisor lo procese. Red de seguridad opcional con `pg_cron` (cada 5 minutos procesa lo pendiente):

```sql
select cron.schedule('whatsapp-dispatch-sweep', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_dispatch_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_dispatch_secret')),
    body := '{}'::jsonb
  )
$$);
```

## 3. CentroColor

Owner/admin: **Configuración → Integraciones → WhatsApp → Configurar**: Phone Number ID, WABA ID, nombre de plantilla (`pedido_listo`), idioma (`es_AR`) y token. Luego **Probar conexión**: verifica el número y, si hay WABA ID, que la plantilla exista y esté `APPROVED`. **Desconectar** destruye el token guardado.

## 4. Qué pasa en producción

- `Recibido/En proceso → Listo` (desde Web, Desktop sincronizado o SQL) crea **una** notificación `photo_job:<id>:ready:whatsapp` si el pedido web tiene consentimiento. `Listo → En proceso → Listo` **no** crea otra.
- El trabajo queda `Listo` aunque Meta falle. El aviso queda `failed` con un mensaje útil (token vencido, plantilla inexistente/no aprobada, número inválido, límite de Meta, Meta caído, _timeout_) y se reintenta con un clic. Un envío cuyo _timeout_ es ambiguo (Meta pudo haberlo aceptado) se marca como tal: verificar antes de reintentar.
- **Reenviar aviso** crea una notificación nueva y auditada (máximo 5 por trabajo); no toca la automática.
- Los pedidos manuales y los clientes sin consentimiento no reciben avisos automáticos. El consentimiento es transaccional, vale sólo para ese pedido y **no** habilita marketing.

### Argentina (celulares con `9`)

CentroColor guarda los celulares argentinos como `+549…` (forma canónica). Algunas cuentas de Meta sólo resuelven la forma sin el `9` (`+54…`), típicamente con el número de prueba (error `131030`/`131026`). Si ocurre, definir `WHATSAPP_AR_DROP_MOBILE_NINE=true`: el número guardado no cambia, sólo se envía sin el `9` a la API.

## 5. Verificación manual sugerida

1. Con el número de prueba, agregar tu propio celular como destinatario verificado en _API Setup_.
2. Hacer un pedido en `/imprimir` con consentimiento y tu número; en Laboratorio marcarlo `Listo`.
3. Ver `✓ Aviso enviado` en la ficha y el mensaje en tu WhatsApp; abrir el link y ver `LISTO PARA RETIRAR`.
4. Con el webhook activo, ver el aviso pasar a `Entregado`/`Leído`.

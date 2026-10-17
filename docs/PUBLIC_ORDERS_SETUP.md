# Puesta en marcha de pedidos públicos — Sprint 14

`/imprimir` es un portal público sin login: el cliente elige tamaños, sube fotos, indica copias, deja nombre y WhatsApp y confirma. El backend crea Customer + PhotoJob + items, recibe los archivos en Google Drive (infraestructura de Sprint 13) y el trabajo entra solo a **Laboratorio**. El flujo manual «Trabajo → Generar link» sigue existiendo para casos excepcionales.

Requisito previo: Google Drive conectado y las migraciones/funciones de Sprint 13 vigentes (ver `docs/GOOGLE_DRIVE_SETUP.md`). WhatsApp es opcional: ver `docs/WHATSAPP_SETUP.md`.

## 1. Supabase

Comprobar qué se aplicaría (no ejecuta nada) y aplicar sólo con autorización:

```powershell
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

El dry-run debe listar únicamente `20261018000000_public_photo_orders.sql` y `20261018010000_whatsapp_notifications.sql` (la estabilización `20261017020000` ya figura aplicada). Las migraciones son incrementales y no reescriben datos: agregan columnas con valores por defecto, tablas nuevas y una columna generada `customers.phone_match_key` (clave derivada para detectar teléfonos repetidos; no modifica clientes históricos).

Desplegar las funciones nuevas (las cuatro públicas **sin** verificación JWT: cada una se autoriza por token capability) y **redesplegar** las que cambiaron por reutilizar código compartido:

```powershell
pnpm exec supabase functions deploy public-photo-catalog --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-start --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-submit --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-track --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-file-admin --use-api
pnpm exec supabase functions deploy photo-upload-context --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-session --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-finalize --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-submit --no-verify-jwt --use-api
```

No redesplegar `google-drive-oauth-start` ni `google-drive-oauth-callback`. **El redespliegue de `photo-file-admin` y de las cuatro `photo-upload-*` es obligatorio**: las versiones de Sprint 13 no distinguen el propósito del link y aceptarían un link de seguimiento como link de subida. Aplicar migraciones y funciones antes de publicar la Web.

Secrets opcionales (los de Sprint 13 ya cubren lo demás):

| Secret                       | Por defecto   | Uso                                                      |
| ---------------------------- | ------------- | -------------------------------------------------------- |
| `PUBLIC_ORDER_BUSINESS_SLUG` | `centrocolor` | Slug del negocio que atiende `/imprimir`.                |
| `PUBLIC_ORDER_TRACKING_DAYS` | `180`         | Vigencia del link de seguimiento tras confirmar (1–730). |

```powershell
pnpm exec supabase secrets set PUBLIC_ORDER_BUSINESS_SLUG="centrocolor" PUBLIC_ORDER_TRACKING_DAYS="180"
```

`PUBLIC_WEB_URL` debe apuntar al dominio real de la Web (se usa para el link de seguimiento del WhatsApp). Los pedidos se asocian a la **primera sucursal activa** del negocio y su «creador técnico» es el owner (el origen real queda en `source_channel = 'public_web'`).

## 2. Vercel

No hay variables nuevas. `apps/web/vercel.json` ya reescribe cualquier ruta a `index.html`, por lo que `/imprimir` y `/pedido/:token` funcionan con Root Directory `apps/web`. Publicar la Web **después** de aplicar migraciones y funciones. La PWA ya instalada abre ambas rutas sin login; no se exige instalar nada.

## 3. Configurar la lista de precios pública

**Fotografía → Servicios → Editar**, sección _Catálogo público_:

- **Mostrar en la web**: aparece en la lista de precios.
- **Aceptar pedidos directos**: se puede pedir online. Sólo disponible si el servicio es **Laboratorio** y **requiere archivos del cliente**.
- _Nombre público_ (opcional; si se deja vacío se usa el nombre interno), _Descripción pública_ y _Orden en la lista_.

`/imprimir` muestra únicamente servicios **activos + públicos + con pedido directo**. El precio es el precio unitario del servicio: cambiarlo en Servicios cambia la web de inmediato, y los pedidos ya confirmados conservan el precio que tenían. Restauración, edición compleja, etc. quedan fuera de `/imprimir` con sólo no marcarlos.

## 4. Operación

- Un pedido confirmado aparece solo en **Fotografía → Producción → Laboratorio** con `ORIGEN: WEB`, sin acción administrativa intermedia. No tiene fecha prometida: se define a mano cuando corresponda («Te avisaremos cuando esté listo»).
- **Pedidos abandonados**: al iniciar la subida se crea un _borrador_ invisible para Producción, Trabajos, Dashboard y Desktop (RLS). Si el cliente no confirma, el borrador queda inactivo y su link de subida vence a los 14 días. Nada se borra automáticamente. Para marcar como `abandoned` los borradores sin actividad (revoca sus links, conserva todo) ejecutar en el SQL Editor la política que se decida, por ejemplo: `select public.cc_public_order_mark_abandoned(interval '30 days');`. No está programada: elegir el período de retención con el negocio y, si se quiere, programarla con `pg_cron`.
- Un cliente que reintenta (recarga, doble clic, cambia de celular) con la misma clave del navegador retoma el mismo pedido y obtiene un link de subida nuevo (el anterior se revoca).
- El seguimiento `/pedido/:token` usa un link **de sólo lectura** distinto del de subida; sigue funcionando aunque el equipo regenere o revoque el link de subida de un trabajo.
- El flujo manual (Generar link) y su portal `/enviar/:token` no cambian.

## 5. Prueba de humo (sin credenciales de producción)

1. Abrir `/imprimir` en una ventana privada desde un celular: deben verse los tamaños con sus precios.
2. Elegir `10x15` y `20x30`, subir 2–3 fotos (una grande), ajustar copias y comprobar el total.
3. Completar nombre y WhatsApp, **Confirmar pedido** y ver `PEDIDO RECIBIDO` con el código `CC-XXXXXXXX`.
4. En la Web administrativa: Producción → Laboratorio muestra el pedido con `ORIGEN: WEB`; Drive tiene la carpeta y `PEDIDO.txt`.
5. Abrir `Ver estado del pedido`; marcar el trabajo `En proceso` y `Listo` y recargar el link: debe leer `En preparación` y `LISTO PARA RETIRAR`.
6. Cambiar el precio de un servicio y comprobar que `/imprimir` lo refleja y que el pedido anterior no cambió.

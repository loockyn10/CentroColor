# Auditoría final de despliegue — `/imprimir` (cascada, varios tamaños, nombres con copias) y `/profesionales` (07/11/2026)

Documento único para publicar ambos sprints juntos. Sustituye, para este despliegue, a las listas parciales de `HANDOFF.md` y de `PROFESSIONAL_PORTAL_SETUP.md` (que conservan el detalle de cada tema). No se ejecutó ninguna migración ni deploy: lo único consultado en el remoto fue de sólo lectura (`supabase functions list`, `migration list`, `secrets list`).

## 0. Actualización 08/11/2026 — `/profesionales` público (se suma a esta lista)

Nada de esto se ejecutó. **Migraciones nuevas, después de `20261107000000`, en este orden:** `20261108000000_professional_requests.sql` y `20261108010000_professional_requests_hardening.sql` (el `--dry-run` debe listar las dos —y `20261107000000` si sigue pendiente—; la segunda sólo reemplaza funciones y suma dos: sin cambios de tablas). **Desktop:** migraciones SQLite `0021_quote_status.sql` y `0022_pending_quote_in_progress.sql` (versiones 21 y 22 en `lib.rs`; se ejecutan al abrir el instalador nuevo).
**Funciones nuevas, sin JWT** (`--no-verify-jwt`; `config.toml` ya lo declara): `professional-public-catalog`, `professional-request-start`, `professional-request-submit`. **Obligatorias por cambio de comportamiento** (ya estaban en la lista B, ahora con más motivo): `photo-upload-session` (tope propio de la solicitud anónima), `public-photo-order-submit` (rechaza solicitudes profesionales) y `public-photo-order-track` (no envía importes de una solicitud). Sin la migración las funciones nuevas fallan de forma controlada; con la migración y las funciones viejas, `/imprimir` y las cuentas siguen igual, pero una solicitud anónima vería importes en un seguimiento viejo: **desplegar `public-photo-order-track` antes de publicar la Web nueva**.
Comandos exactos y orden en `docs/HANDOFF.md` (sección 08/11/2026).

## 1. Estado del repositorio y del remoto

- **Git:** `master` = `origin/master` (`91c1936`, 07/11 07:59). El sprint de cascada/varios tamaños/nombres con copias (commits `0c214c5` y `425334f`) y el portal profesional (`91c1936`: migración `20261107000000`, las 4 funciones `professional-*` y `apps/web/src/professional/`) **ya están commiteados y subidos**; sólo esta auditoría (este documento y el pie de `HANDOFF`/`CURRENT_STATE`) está sin commit. **Atención:** si Vercel despliega desde `master`, la Web con `/profesionales` puede estar publicada **antes** que la migración y las funciones; hasta completar §4 ese portal responde con error (las funciones no existen) y `/imprimir` sigue funcionando.
- **Migraciones** (`supabase migration list`): todas hasta `20261105000000` figuran aplicadas. **Única pendiente: `20261107000000_professional_portal.sql`.** Sin migración SQLite nueva.
- **Edge Functions remotas** (`supabase functions list`, fechas UTC):

| Función                                                             | Versión remota | Última publicación | Observación                                                                                                                                    |
| ------------------------------------------------------------------- | -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `photo-upload-session`                                              | v4             | 07/11 10:11        | Posterior al commit de la cascada, pero **anterior** a los últimos cambios del código (topes profesionales, 600 sesiones/min). No es confiable |
| `public-photo-order-submit`                                         | v3             | 07/11 10:11        | Ídem: no contiene el rechazo de pedidos profesionales ni el núcleo final                                                                       |
| `public-photo-catalog`                                              | v3             | 07/11 10:11        | Salida equivalente a la actual (refactor sin cambio de comportamiento)                                                                         |
| `photo-upload-submit`                                               | v3             | 06/11 18:34        | Coincide con el commit `0c214c5`                                                                                                               |
| `public-photo-order-start`                                          | v2             | 29/10              | Sin cambios de comportamiento desde entonces                                                                                                   |
| `public-photo-order-track`                                          | **v1**         | **17/10**          | Nunca se actualizó: no devuelve `paymentTerms`                                                                                                 |
| `photo-upload-finalize`, `photo-upload-context`, `photo-file-admin` | v2, v2, v3     | 17/10              | Sin cambios de comportamiento                                                                                                                  |
| `google-drive-oauth-start/callback`                                 | v4, v3         | 17/10              | Sin cambios                                                                                                                                    |
| `whatsapp-admin/send/dispatch/webhook`                              | **no existen** | —                  | WhatsApp nunca se desplegó (ver §7)                                                                                                            |
| `professional-*` (4)                                                | **no existen** | —                  | Nuevas                                                                                                                                         |

- **Secrets remotos** (`supabase secrets list`, sólo nombres y huella): `GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI`, `PHOTO_UPLOAD_LINK_DAYS` (= 14), `PHOTO_UPLOAD_MAX_BYTES` (= 524288000, 500 MB), `PHOTO_UPLOAD_SIGNING_SECRET`, `PUBLIC_WEB_URL` y `WEB_APP_URL` (ambas = `https://centro-color-web.vercel.app`, sin barra final) más los `SUPABASE_*` inyectados. No hay `PUBLIC_ORDER_*` (usa los valores por defecto) ni `WHATSAPP_*`.

## 2. Qué función necesita qué (todas las que pasan por `runtime.ts` empaquetan los módulos compartidos; se decidió por quién **ejecuta** el código cambiado)

| Capacidad                                                      | Código                                                                                                  | Funciones que lo ejecutan                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selección en cascada (tamaño y papel separados)                | `catalogServiceBody` (`sizeName`, `paper`, `paperLabel`, `photoServiceId`)                              | `public-photo-catalog` (la Web deduce del nombre si falta: sin él igual funciona)                                                                     |
| Varios tamaños en un pedido (carpetas por reclamo, integridad) | `claimFolderId`, `expectedFiles`/`acceptPartial`, `supersedeAttempt`                                    | `photo-upload-session`, `public-photo-order-submit`, `photo-upload-submit` (carpetas), `professional-order-submit`                                    |
| Renombrado con copias (`001_2copias.jpg`)                      | `nameFilesForPrinting`, `uploadIds`, copias actualizadas en reintento                                   | `public-photo-order-submit`, `professional-order-submit` (mismo `confirmUploadedOrder`), `photo-upload-session`                                       |
| Portal profesional                                             | `professional-*`, `cc_professional_*`, `is_professional`, topes propios                                 | 4 funciones nuevas + `photo-upload-session`; `public-photo-order-submit` (rechaza pedidos profesionales); `public-photo-order-track` (`paymentTerms`) |
| Subida masiva desde carpetas                                   | Web (`webkitdirectory`, lista virtualizada) + topes del servidor (1000 fotos, 300 MB, 600 sesiones/min) | `photo-upload-session` (obligatoria); el resto es Web                                                                                                 |

## 3. Funciones a desplegar (consolidado)

**A. Nuevas (con verificación JWT, sin `--no-verify-jwt`):** `professional-catalog`, `professional-order-start`, `professional-order-submit`, `professional-admin`.

**B. Obligatorias (cambio de comportamiento):** `photo-upload-session`, `public-photo-order-submit`, `public-photo-order-track`.

**C. Para dejar un único build coherente (sin cambio de comportamiento, pero el remoto no es verificable):** `public-photo-catalog`, `photo-upload-submit`, `public-photo-order-start`, `photo-upload-finalize`, `photo-upload-context`, `photo-file-admin`. Se recomienda desplegarlas en la misma tanda: son segundos cada una y eliminan la duda de qué versión del código compartido ejecuta cada una.

**No desplegar ahora:** `google-drive-oauth-start`, `google-drive-oauth-callback` (sin cambios) y `whatsapp-*` (decisión aparte, §7).

## 4. Comandos exactos de publicación (en este orden)

```powershell
# 0. Comprobar (sólo lectura): debe listar ÚNICAMENTE 20261107000000_professional_portal.sql
pnpm exec supabase db push --dry-run

# 1. Migración (con autorización)
pnpm exec supabase db push

# 2A. Funciones nuevas (JWT verificado)
pnpm exec supabase functions deploy professional-catalog --use-api
pnpm exec supabase functions deploy professional-order-start --use-api
pnpm exec supabase functions deploy professional-order-submit --use-api
pnpm exec supabase functions deploy professional-admin --use-api

# 2B. Obligatorias (token capability: sin JWT)
pnpm exec supabase functions deploy photo-upload-session --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-submit --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-track --no-verify-jwt --use-api

# 2C. Mismo build para el resto
pnpm exec supabase functions deploy public-photo-catalog --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-start --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-finalize --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-context --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-submit --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-file-admin --use-api

# 3. Verificar (sólo lectura): las 13 de arriba con fecha nueva; verify_jwt = true sólo en professional-* y photo-file-admin
pnpm exec supabase functions list
```

Después: comprobar en Vercel que el último deployment de `master` es el de `91c1936` (o redesplegarlo; sin variables nuevas) y recién entonces la prueba de humo. Orden y compatibilidad: migración → funciones → Web. Una Web vieja contra funciones nuevas sigue funcionando; una Web nueva contra funciones viejas deja `/profesionales` sin respuesta (404 de las funciones) pero no afecta a `/imprimir` (es el estado posible ahora mismo, ver §1). La migración es aditiva y no rompe a las funciones actuales. Reversión: volver a desplegar las funciones desde `git` (la migración puede quedar).

## 5. Configuración de Supabase Auth (Dashboard → Authentication)

1. **URL Configuration → Site URL:** `https://centro-color-web.vercel.app`.
2. **Redirect URLs:** agregar `https://centro-color-web.vercel.app/profesionales` (idéntica a `PUBLIC_WEB_URL` + `/profesionales`). Si falta, el enlace de invitación/restablecimiento cae en la raíz del sitio (el panel no procesa esos tokens) y el profesional queda sin entrar.
3. **Templates → Invite user / Reset password:** los de fábrica sirven (el portal lee `access_token`/`refresh_token`/`type` del fragmento). Si se personalizan, conservar `{{ .ConfirmationURL }}`.
4. **SMTP:** con el SMTP por defecto de Supabase el envío está muy limitado (unos pocos e-mails por hora para todo el proyecto): configurar un SMTP propio antes de invitar a varios fotógrafos.
5. Opcional: desactivar el registro libre (no es un riesgo: un usuario sin cuenta profesional no ve ni puede nada; probado).
6. Rate limits de Auth y política de contraseña: revisar que la mínima configurada no sea mayor que 8 caracteres (el portal exige 8).

## 6. Variables de entorno

- **Edge Functions (secrets):** no hay secrets nuevos obligatorios. Imprescindibles, ya presentes: `PHOTO_UPLOAD_SIGNING_SECRET`, `PUBLIC_WEB_URL` (o `WEB_APP_URL`; se usa también como origen CORS del PUT a Drive y como destino de la invitación), `PHOTO_UPLOAD_LINK_DAYS`, `PHOTO_UPLOAD_MAX_BYTES` (hoy 500 MB: cubre los 300 MB del pedido profesional; si se baja de 300 MB limitaría a los profesionales), `GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI`. Opcionales con valor por defecto: `PUBLIC_ORDER_BUSINESS_SLUG` (`centrocolor`), `PUBLIC_ORDER_TRACKING_DAYS` (180). `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase.
- **Vercel (build Web):** `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (ya existentes). Nada nuevo.
- **Sólo si se habilita WhatsApp (§7):** `WHATSAPP_DISPATCH_SECRET`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y, opcionales, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_AR_DROP_MOBILE_NINE` (ver `docs/WHATSAPP_SETUP.md`).

## 7. Hallazgos de la auditoría

**Verificado (con pruebas automáticas, contra las migraciones reales en PGlite y handlers reales):**

- **Nombres con copias en pedidos profesionales:** funcionan igual que en `/imprimir` porque ambos portales ejecutan el mismo `confirmUploadedOrder`: `Para imprimir/<tamaño · papel · Profesional>/001_2copias.jpg`, numeración por el orden que ve el cliente (`uploadIds`, hasta 1000), `original_filename` intacto, `PEDIDO.txt` con original y copias, un solo árbol de carpetas aun con subidas concurrentes, y reintentos idempotentes (copias actualizadas sin duplicar). Cubierto en `professional.handlers.test.ts` (120 fotos, dos formatos) y `professional.web-contract.test.ts` (150 fotos con el cliente web real, incluida la confirmación cortada y repetida).
- **Aislamiento de las cuentas profesionales:** con su JWT no leen ninguna fila de clientes, trabajos, items, pedidos, listas, tramos ni membresías; **no pueden cambiar su lista de precios, la de otro cliente, un precio, un tramo, su condición de pago ni su cuenta** (0 filas o permiso denegado); no ejecutan ninguna función `cc_*`; las únicas cinco funciones SQL ejecutables por `authenticated` (`post_work_payment`, `void_work_payment`, `complete_pos_sale`, `apply_stock_movement`, `record_stock_change`) exigen membresía y fallan para ellos; `anon` no ejecuta ninguna. Las funciones de administración (`professional-admin`, `photo-file-admin`, `whatsapp-*`) exigen membresía/rol y los profesionales no la tienen. Un test cierra la lista de funciones ejecutables para que una futura no pase inadvertida.
- **Límites:** público 200 fotos / 100 MB / 1000 copias por tamaño / 120 sesiones por minuto (cliente: 200 fotos); profesional 1000 fotos / 300 MB / 50 000 copias por formato / 600 sesiones por minuto (cliente: 1000); `uploadIds` ≤ 500 (público) y ≤ 1000 (profesional); 60 pedidos por hora por cuenta; 10 y 30 formatos por pedido respectivamente.
- **Recuperación:** reintento con intento previo (sin duplicar, copias actualizadas), «Reintentar sólo las fallidas», `rate_limited` con espera, pedido incompleto (`order_incomplete`) bloqueado salvo «enviar sin esas fotos» explícito, confirmación cortada → repetir con la misma clave retoma el borrador, `finalize` idempotente aun tras el renombrado, renombrado idempotente que converge tras un fallo.

**Defecto corregido en esta auditoría:** un 401 del gateway de Supabase por JWT vencido (sin `code` de texto) no se reconocía y el portal profesional quedaba en «No pudimos cargar tu lista de precios» en vez de pedir un nuevo ingreso. Ahora `isSessionExpired` (status 401 o código `unauthorized`) cierra la sesión local y vuelve al ingreso. No se encontraron otros defectos que impidan publicar.

**Riesgos conocidos, sin cambio de código (verificar en la prueba real):**

1. **Renombrado en la confirmación:** `public-photo-order-submit`/`professional-order-submit` renombran cada foto en Drive (4 en paralelo) dentro de **una** invocación. Con 1000 fotos son ~250 rondas de llamadas a Drive: debería entrar en el límite de tiempo de una Edge Function (150 s en Free, 400 s en Pro), pero no está medido. Si se corta, el navegador vuelve a «Confirmar» y el renombrado retoma donde quedó (probado), pero conviene medir con 300–500 fotos reales y, si hace falta, subir la concurrencia del renombrado en un cambio aparte.
2. **Renombrar con `drive.file`:** sólo comprobado contra el emulador de Google; los archivos los creó la propia app, por lo que debería alcanzar.
3. **WhatsApp no está desplegado** (las 4 funciones no existen y no hay secrets `WHATSAPP_*`), aunque `/imprimir` y `/profesionales` dicen «Te avisaremos por WhatsApp». Al pasar un pedido a «Listo» el trigger encola el aviso como fallido (`integration_not_configured`) y no sale nada. Es una decisión de producto, no de este despliegue: o se completa `docs/WHATSAPP_SETUP.md` (Meta, plantilla, 4 funciones, secrets) o se retira esa promesa de las pantallas.
4. **`PHOTO_UPLOAD_MAX_BYTES` = 500 MB** es el techo real por archivo para todos (los 300 MB profesionales caben).

## 8. Pruebas reales pendientes (con servicios de producción, después de publicar)

1. **`/imprimir` en el celular** (cascada): 10×15 Brillo con 3 fotos (copias 3, 1, 5) y «Agregar otro» 13×18 Mate con 2; confirmar. En Drive: `Para imprimir/<tamaño · papel · Público>/001_3copias.jpg`, `002_1copia.jpg`, `003_5copias.jpg` y numeración propia en la otra carpeta, más `PEDIDO.txt`. Verifica también que la cuenta de Drive puede renombrar.
2. **Alta de un profesional:** cliente con lista Profesional (y otro con convenio) → Configuración → Integraciones → «Dar acceso» con un e-mail propio → llega la invitación → elegir contraseña → entrar a `/profesionales`.
3. **Precios:** el profesional ve su lista (no la pública); el convenio muestra sólo sus formatos.
4. **Carpeta real de Lightroom con 100+ fotos** en 10×15 Brillo, «Copias para todas» = 2, una foto en 5; 13×18 Mate con selección múltiple. Confirmar. En Drive: una carpeta por formato y papel con `001_2copias.jpg`…; en la Web: pedido con `ORIGEN: WEB`, cliente = el profesional y la nota de pago. **Medir cuánto tarda la confirmación.**
5. **Pago:** con y sin «Puede pagar después» (pantalla «Pago pendiente» vs alias) y el seguimiento `/pedido/:token` correspondiente.
6. **Fallos:** cortar la conexión a mitad de una carga grande → «Reintentar las N» sólo reenvía las fallidas; cerrar la pestaña avisa.
7. **Aislamiento real:** con la cuenta profesional abrir `/` («Sin acceso asignado»); con una cuenta del equipo abrir `/profesionales` («no tiene acceso»); la cuenta profesional no ve datos en el panel.
8. **Navegadores:** Chrome/Edge y Safari/Firefox de escritorio (selector de carpeta), y un teléfono (selección múltiple).
9. **CORS del PUT resumable** de Drive con varios archivos simultáneos desde el dominio de producción.

# Handoff

## `/profesionales` público: precios privados y pedidos «por presupuestar» (08/11/2026)

Detalle en `docs/CURRENT_STATE.md`; decisiones 111–115; guía de cuentas en `docs/PROFESSIONAL_PORTAL_SETUP.md`. **Nada aplicado ni desplegado**, sin SQL remoto, sin commit ni push (los cambios están en el árbol de trabajo). Las cuentas profesionales de la entrega anterior se conservan sin cambios de comportamiento.

**Publicar (en este orden; se suma a la lista de `docs/DEPLOY_CHECKLIST.md`):**

```powershell
# 0. Sólo lectura: debe listar 20261108000000_professional_requests.sql (y 20261107000000 si todavía no se aplicó)
pnpm exec supabase db push --dry-run

# 1. Migración (con autorización). Aditiva: columnas nuevas con valores por defecto, nada se reescribe.
pnpm exec supabase db push

# 2A. Funciones NUEVAS (sin JWT: cada una autoriza por token capability y nunca maneja importes)
pnpm exec supabase functions deploy professional-public-catalog --no-verify-jwt --use-api
pnpm exec supabase functions deploy professional-request-start --no-verify-jwt --use-api
pnpm exec supabase functions deploy professional-request-submit --no-verify-jwt --use-api

# 2B. OBLIGATORIAS por cambio de comportamiento
pnpm exec supabase functions deploy photo-upload-session --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-submit --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-track --no-verify-jwt --use-api

# 2C. Recomendadas (mismo build; sin cambio de comportamiento: empaquetan store.ts/store-supabase.ts y la nueva consulta de `portal`)
pnpm exec supabase functions deploy public-photo-order-start --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-finalize --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-context --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-upload-submit --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-catalog --no-verify-jwt --use-api
pnpm exec supabase functions deploy photo-file-admin --use-api

# 3. Verificar (sólo lectura)
pnpm exec supabase functions list
```

Las funciones con JWT (`professional-catalog`, `professional-order-start`, `professional-order-submit`, `professional-admin`) **no cambian de comportamiento** y no requieren redeploy por este trabajo. Después: publicar la Web (Vercel, sin variables nuevas) y, para Desktop, el instalador nuevo (`pnpm build:desktop`; ejecuta la migración SQLite `0021` al abrirse). **Funciones primero:** una Web nueva contra funciones viejas falla de forma controlada en `/profesionales` (no encuentra las funciones nuevas); un seguimiento viejo mostraría importes de una solicitud, por eso `public-photo-order-track` va antes que la Web.

**Prueba de humo real (pendiente):** (1) en una ventana sin sesión, `/profesionales`: ninguna cifra en pantalla ni en la pestaña Red (catálogo, inicio, confirmación, seguimiento); carpeta de 100+ fotos reales, «Copias para todas», dos formatos, cortar la conexión a mitad y reintentar. (2) En Drive: `<tamaño · papel · Por presupuestar>/001_3copias.jpg…` y `PEDIDO.txt`. (3) En el panel Web: Pedidos muestra «Por presupuestar» (también Inicio y la insignia de navegación); no deja marcar listo, cobrar ni editar el precio; «Presupuestar» con la lista del cliente (Profesional o convenio) fija el importe y habilita Cobros. (4) Con una cuenta de CentroColor abierta, `/profesionales` sigue sin mostrar precios; con una cuenta profesional, sí (su lista). (5) `/imprimir` completo, sin cambios. (6) Desktop: el pedido pendiente aparece sincronizado, sin importe y sin cobrar; tras presupuestar en la Web, llega con importe.

**Punto de reanudación:** `supabase/migrations/20261108000000_professional_requests.sql`, `supabase/functions/_shared/professional-request-handlers.ts` (anónimo), `apps/web/src/professional/` (`portal.tsx` decide el modo; `order-portal.tsx` sirve ambos), `packages/features/src/photo-quote.tsx` (panel «Presupuestar») y `apps/web/src/photo-quote.ts`. Siguiente trabajo posible, sólo con pedido nuevo: re-presupuestar una solicitud, presupuestar desde Desktop, CAPTCHA (Turnstile) si hay abuso, limpieza programada de borradores abandonados (`cc_public_order_mark_abandoned`), y el sistema general de cuentas de clientes (que reutilizaría `professional_accounts`).

## Auditoría final de despliegue (07/11/2026)

Lista consolidada y verificada contra el remoto (sólo lectura) en `docs/DEPLOY_CHECKLIST.md`: **una migración pendiente** (`20261107000000`), 4 funciones nuevas, 3 obligatorias y 6 más para un build coherente, configuración de Auth, variables y pruebas reales. Ambos sprints están commiteados y subidos (`91c1936`); la Web puede estar publicada antes que las funciones. WhatsApp sigue sin desplegarse.

## Portal profesional `/profesionales` (07/11/2026)

Detalle en `docs/CURRENT_STATE.md`; guía de publicación y de alta de profesionales en `docs/PROFESSIONAL_PORTAL_SETUP.md`; decisiones 107–110. **Nada aplicado ni desplegado**, sin commit ni push.

**Publicar (en este orden):** (1) `pnpm exec supabase db push --dry-run` (debe listar sólo `20261107000000_professional_portal.sql`) y, con autorización, `db push`; **sin migración SQLite**. (2) Desplegar con JWT `professional-catalog`, `professional-order-start`, `professional-order-submit` y `professional-admin`, y redesplegar `photo-upload-session` (**obligatoria**), `public-photo-order-submit` y `public-photo-order-track` (recomendadas); comandos exactos en la guía. (3) Agregar `https://<dominio>/profesionales` a Redirect URLs de Supabase Auth. (4) Publicar la Web. Funciones primero: una Web nueva contra funciones viejas sólo no encuentra `professional-*` (el portal profesional falla de forma controlada, `/imprimir` no se afecta).

**Prueba de humo real (pendiente):** ver §5 de la guía (100+ fotos reales de Lightroom por carpeta, «Copias para todas», dos formatos, ambas condiciones de pago, Drive con `001_2copias.jpg`, panel con `ORIGEN: WEB`, reintento con la conexión cortada, aislamiento del panel).

**Punto de reanudación:** `supabase/functions/_shared/professional-*.ts` (handlers), `supabase/migrations/20261107000000_professional_portal.sql`, `apps/web/src/professional/` (portal) y `apps/web/src/public-order/order-submission.ts` (subida compartida con `/imprimir`). Siguiente trabajo posible, sólo con pedido nuevo: historial de pedidos del profesional, estado de pago/acreditación visible en Cobros para pedidos `deferred`, pausa/cancelación de cargas.

## `/imprimir`: cascada de tamaño/papel y nombres con copias (06/11/2026)

Detalle en `docs/CURRENT_STATE.md`; decisión 106. Sin SQL remoto, sin commit ni push, **sin migraciones**.

**Publicar (en este orden):** (1) redesplegar estas Edge Functions, una por una (comandos en `docs/PUBLIC_ORDERS_SETUP.md`). **Obligatorias:** `public-photo-order-submit` (renombrado, `uploadIds`) y `photo-upload-session` (actualiza las copias en un reintento). **Recomendada:** `public-photo-catalog` (envía tamaño y papel por separado; sin ella la Web los deduce del nombre y funciona igual). **No requieren redeploy:** `photo-upload-finalize`, `public-photo-order-start`, `public-photo-order-track`, `photo-upload-context`, `photo-upload-submit`, `photo-file-admin`, WhatsApp y OAuth. (2) Publicar la Web (Vercel). Funciones primero: una Web vieja contra funciones nuevas sigue funcionando (sin `uploadIds` no se retira nada y la numeración sale de la creación); una Web nueva contra funciones viejas sólo no renombra las fotos ni actualiza copias cambiadas en un reintento.

**Prueba de humo real (pendiente):** `/imprimir` en el celular: 10×15 Brillo con 3 fotos (copias 3, 1, 5) y «Agregar otro» 13×18 Mate con 2; confirmar. En Drive, `Para imprimir/<tamaño · papel · Publico>/` debe tener `001_3copias.jpg`, `002_1copia.jpg`, `003_5copias.jpg` y en la otra carpeta su propia numeración desde 001, más `PEDIDO.txt` con los nombres. Verificar también que la cuenta de Drive conectada puede renombrar (no se probó contra Google).

## Corrección `/imprimir`: varios tamaños (06/11/2026)

Detalle y causa raíz en `docs/CURRENT_STATE.md`; decisión 105 en `docs/DECISIONS.md`. Sin SQL remoto, sin commit ni push, **sin migraciones nuevas**.

**Publicar (en este orden):** (1) redesplegar las Edge Functions. Se determinó por quién **ejecuta** el código cambiado (`ensureFolders`/`claimFolderId`, `supersedeAttempt`, el chequeo de integridad del submit), no por quién lo importa: todas las que pasan por `runtime.ts` empaquetan los módulos modificados, pero sólo estas tres cambian de comportamiento. **Obligatorias:** `photo-upload-session` y `public-photo-order-submit`. **Recomendada** (su `ensureFolders` para `PEDIDO.txt` pasa a reclamar carpetas; sin redeploy conserva el comportamiento anterior en el flujo manual): `photo-upload-submit`. **Sin cambio funcional, no requieren redeploy:** `photo-upload-finalize`, `photo-upload-context`, `public-photo-order-start`, `public-photo-catalog`, `public-photo-order-track`, `photo-file-admin`, WhatsApp y OAuth. Comandos en `docs/PUBLIC_ORDERS_SETUP.md`. (2) Publicar la Web (Vercel). Funciones primero: un navegador viejo contra funciones nuevas recibe `order_incomplete` en lugar de un pedido incompleto confirmado en silencio, y uno nuevo contra funciones viejas sólo ve ignorados los campos extra.

**Prueba de humo:** `/imprimir`, elegir 10x15 y 13x18, 2–3 fotos en cada una, confirmar: Drive debe tener `Para imprimir/<tamaño>/` por cada tamaño dentro de una única carpeta del pedido, junto a `PEDIDO.txt`.

## UX/UI transversal — navegación, Papelera, filtros y controles propios (05/11/2026)

Sprint transversal de patrones compartidos (no parches por pantalla). Sin cambios en reglas comerciales, sin SQL remoto, sin commit ni push. Detalle de patrones en `docs/UX_GRAMMAR.md`; decisiones 101–104 en `docs/DECISIONS.md`; modelo en `docs/DATA_MODEL.md`.

**Qué hay:** (1) **Volver global:** `PageHeader onBack` («← Volver» sobre el título, siempre en el mismo lugar), `BackButton` y un administrador de historial (`packages/ui/src/nav-history.ts` + `useHistoryNavigation`/`useBackLayer`) que hace que **Atrás del navegador cierre el detalle/hoja o vuelva al módulo anterior** en lugar de salir de la app; `Sheet` ya lo usa. La causa del caso de Ventas era un botón `← Volver a ventas` oculto por CSS en ≥1100 px. (2) **Papelera:** eliminar ≠ inactivo; `deleted_at` en 7 catálogos; «Configuración → Papelera» lista y restaura. (3) **Filtros:** `FilterBar` único (wrap sin `min-width`, 2 por fila en mobile, «Limpiar») con `FilterSelect`/`FilterDate`; aplicado a Productos, Turnos, Calendario, Ventas, Stock, Clientes, Cobros, Plotter y la propia Papelera. (4) **Controles propios:** `Select`, `DatePicker`, `DateTimePicker` (sobre `Popover` en portal; hoja inferior en mobile) reemplazan a los 36 `<select>` y 12 `<input type=date/datetime-local>` nativos. (5) **Agenda mobile:** sin desborde en Calendario, Turnos y Disponibilidad (medido a 390 px).

### Despliegue: qué requiere acción (informado explícitamente)

- **VERSIONADO EN REPO (creado, no aplicado):** `supabase/migrations/20261105000000_catalog_trash.sql` (Cloud) y su gemela `apps/desktop/src-tauri/migrations/0020_catalog_trash.sql` (registrada como versión 20 en `apps/desktop/src-tauri/src/lib.rs`).
- **APLICADO REMOTAMENTE:** **no**. No se ejecutó ningún SQL remoto ni `db push`, ni siquiera el dry-run. Pasos, en este orden: `pnpm exec supabase db push --dry-run` y, si lista sólo `20261105000000_catalog_trash.sql`, `pnpm exec supabase db push`.
- **ORDEN IMPORTANTE:** aplicar la migración **antes** de publicar la Web nueva o instalar el Desktop nuevo. La Web nueva consulta `deleted_at` (PostgREST falla si la columna no existe) y el sync de Desktop envía `deleted_at` en cada alta/edición de productos, categorías, tipos, recursos y marquetería. Con la migración aplicada, una Web o un Desktop **viejos** siguen funcionando, pero **no ocultan** los elementos eliminados hasta actualizarse.
- **VERIFICADO EN PRODUCCIÓN:** **nada**. Lo verificado fue local (ver `CURRENT_STATE`): tests, PGlite con las migraciones reales, SQLite en memoria y navegador con repositorios en memoria.
- **Edge Functions:** ninguna modificada; no requieren redeploy por este trabajo (siguen vigentes los pendientes históricos de arriba). Los servicios fotográficos no usan Papelera justamente para no tocar las funciones públicas.
- **Desktop:** requiere **reinstalar** (instalador nuevo de `pnpm build:desktop`): trae la UI nueva y ejecuta `0020_catalog_trash` al abrirse. **Web:** requiere volver a publicar en Vercel.

### Decisiones de dominio y deuda que quedaron fuera

- **Sin Papelera (a propósito):** ventas, pagos, movimientos de stock, reservas/turnos/pedidos/cotizaciones históricos (auditoría); clientes (siguen con Activo/Inactivo); **servicios fotográficos**, variantes y escalones de precio, listas de precios, tarifas y ofertas/LED (los expone el flujo público `/imprimir` y las funciones SQL/Edge de pedidos públicos filtran por `is_active`/`is_public`; habría que reescribirlas y redesplegarlas) y **materiales de plotter** (las reglas de precio dependen de su código). Quedan con Activo/Inactivo.
- **Nombre de categoría reservado:** `UNIQUE(business_id,name)` de `product_categories` incluye eliminadas (rehacerlo en SQLite exige reconstruir la tabla). Crear una categoría con el nombre de una eliminada falla; hay que restaurarla o cambiar el nombre. El código de barras, en cambio, sí queda libre mientras el producto está en la Papelera (índice parcial); restaurar uno cuyo código ya usa otro producto vivo falla con mensaje claro.
- **No hay «Eliminar definitivamente»:** la fila se conserva para no romper referencias; una purga segura (sin referencias históricas) queda como decisión futura.
- Productos de una categoría eliminada conservan `category_id` y se muestran sin categoría; restaurar la categoría los reengancha. Los listados de Ventas/Stock/Clientes aplican sus filtros sobre las últimas 100 filas cargadas (límite previo de esas pantallas).
- Sin datepicker propio para años lejanos más allá de las flechas de mes y RePág/AvPág (sirve para fechas de agenda y entrega).
- **No verificado:** ventana Tauri real, sincronización real Desktop↔Cloud de eliminar/restaurar (sólo triggers y adaptadores por prueba), producción, tablet física, lector de pantalla.

## UX/UI — fase 8: limpieza y cierre global (29/10/2026)

Cierre de la pasada UX/UI (fases 0–8; informe y cierre en `docs/UX_AUDIT.md`, gramática en `docs/UX_GRAMMAR.md`). Sin cambios de reglas de negocio, dominio, sync, migraciones ni SQL remoto, y sin commit. En esta fase: Pedidos (detalle con estado único, edición bajo demanda, cancelación con diálogo, archivos con `Button`), Nuevo pedido (`CustomerField`, líneas rotuladas, pie con total), Servicios fotográficos (catálogo + drawer), Stock (sin tarjetas duplicadas; «Movimientos» en una hoja), Ventas/POS (sólo botones y mensajes con los componentes comunes; el flujo de escaneo, carrito y cobro no cambió), anulación de pagos con diálogo propio, poda de CSS sin uso (~1 100 líneas) y de los primitivos `Badge`/`StateLine`. Verificación local: `pnpm lint`, `pnpm typecheck`, `pnpm test` (568/568), `pnpm build`, `pnpm build:desktop` y `git diff --check`; 24 vistas sin desborde horizontal a 390 px (arnés con repositorios en memoria).

### Despliegue: qué requiere acción (informado explícitamente)

- **Migraciones:** verificado el 29/10/2026 con `supabase migration list` y `supabase db push --dry-run` (sólo lectura): las 22 migraciones locales, incluida `20261027000000_pricing_ux.sql`, figuran aplicadas en remoto y el dry-run responde «Remote database is up to date». No hay migración pendiente de aplicar. Su gemela SQLite `0019_pricing_ux.sql` se ejecuta en Desktop al abrir la versión nueva.
- **Edge Functions:** este trabajo no modificó ninguna función ni `supabase/`. Siguen vigentes los pendientes históricos de `HANDOFF` (estado verificado al 25/10/2026: `public-photo-catalog`, `public-photo-order-start` y las otras públicas seguían en la versión 1 del 17/10; para que `/imprimir` use variantes Brillo/Mate hay que redesplegarlas). No se verificó el estado actual.
- **Desktop:** requiere **reinstalar** con un instalador nuevo para ver los cambios de interfaz y para que SQLite aplique `0019_pricing_ux` (la migración se ejecuta al abrir la versión nueva). Instalador generado por `pnpm build:desktop`: `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe` (ver resultado en `CURRENT_STATE`). **Web:** hay que volver a publicar en Vercel para que las producciones vean la UI nueva.

### BUGs funcionales pendientes

Ver «Cierre» en `docs/UX_AUDIT.md`: BUG-1, BUG-4, BUG-5, BUG-8, aviso inmediato de WhatsApp, agenda sin reservas, cobros de Plotter, Marquetería sin edición de varillas/materiales, ventas POS sin cliente, disponibilidad sólo al guardar, y las consultas N+1 de Producción y Cobros.

## UX/UI — fase 7: Taller y Configuración secundaria (29/10/2026)

Sólo presentación y composición; sin cambios de dominio, reglas, esquema, migraciones, SQL ni sync (sin commit). **Plotter:** cotizador de dos zonas (entradas a la izquierda: Cliente, Material y medidas, Extras, Notas; resultado fijo a la derecha con m², ajuste al rollo, **precio por m²** del material y la lista, líneas, total y «Guardar cotización»); «Doblez de lona» sólo aparece con lonas y se reinicia al cambiar de material; la lista de cotizaciones muestra cliente, fecha, total y estado en español (Cotizada/Aceptada/Completada); no hay ninguna referencia a producción. **Marquetería:** la cotización es en vivo (se quitó «Actualizar cálculo»), con Medidas · Varilla · Componentes a la izquierda y el Resultado a la derecha; «Trabajos y presupuestos» separa Presupuestos (Aceptar) de Trabajos (estado + «Cuenta» en una hoja) y cada trabajo muestra medidas y total leyendo el presupuesto aceptado (`listQuotes` con estados quoted y accepted). **Patrón de catálogo** (`CatalogSection`/`CatalogRow` en `configuration-ui.tsx`; estados `StatusBadge` Activo/Inactivo; Crear/Editar en `FormDrawer`; desactivar dentro del drawer): Productos (categorías en un drawer propio, sin `window.prompt`; el alta por escáner y el formulario de POS no cambian), Materiales › Plotter / Varillas / Otros materiales, Tipos y parámetros (dos secciones apiladas), Recursos (lista de equipamiento + Capacidad LED en tres secciones, sin precios comerciales). **Integraciones:** `IntegrationCard` (título, estado, datos técnicos, acciones) para Google Drive y WhatsApp; la configuración de WhatsApp es un drawer (ya no se abre sola) y las desconexiones usan `ConfirmDialog`; en Desktop sólo una nota informativa. Se eliminaron los componentes `Configuration*` sin uso.

**BUGs / pendientes documentados, sin tocar:** (1) la cotización de Marquetería sigue guardándose con `customerId: null` (BUG-5): no hay cliente ni fecha prometida y el trabajo nace sin cliente. (2) Plotter no tiene PlotterJob ni acción de rechazar/cancelar una cotización; «Completar» sólo cambia el estado de la cotización. (3) Varillas y Otros materiales de Marquetería no tienen edición ni desactivación (sólo alta); `FramingRepository` no expone esas operaciones en la UI. (4) El costo de varillas/materiales sigue ingresándose con `Number(...)` sin validar formato (comportamiento previo). (5) «Atajos: tamaños LED» y el pool siguen dentro de Recursos (decisión de ubicación pendiente). (6) Los estilos `config-*`, `event-config-*`, `pos-product-*` y `catalog-form` de `legacy.css`/`panel.css` quedaron sin uso; se podan en la limpieza. **No verificado:** guardar materiales, tipos, categorías, equipos o integraciones contra datos reales; flujo OAuth de Drive; ventana Tauri; tablet física.

## UX/UI — fase 6: Mostrador (Inicio, Clientes, Cobros) (29/10/2026)

Sólo presentación y composición; sin cambios de reglas de cobro, `WorkPayment`, dominio, esquema, SQL ni sync (sin commit). **Inicio** («Hoy»): se quitó la línea de identidad y el KPI duplicado «Esperando pago» + la fila «Saldos pendientes»; quedan 4 KPI sin repetición (Ventas hoy · Pedidos en curso, en rojo si hay atrasados · Listos para entregar · Por cobrar, con importe y cuentas); «Para resolver ahora» sólo muestra lo que pide una decisión (atrasados, urgentes, listos **con saldo**, stock) con tope de 6 y «y N avisos más»; los listos sin saldo ya no son una fila por pedido (los cuenta el KPI); «Turnos de hoy» sólo es tarjeta si hay turnos, si no es una fila de seguimiento; accesos rápidos: Nueva venta (primario) y Nuevo pedido. **Clientes:** la ficha se ordena Encabezado (acción primaria «Nuevo pedido», WhatsApp secundario, «Editar» ligero) → Datos (teléfono y email como enlaces, documento, lista de precios, notas; sólo lectura) → Cuenta → Pedidos de laboratorio → Presupuestos y reservas (nuevo, sólo lectura vía `listEvents`; `CustomersPage` recibe `eventRepository` opcional desde Web y Desktop). Crear y editar son un `FormDrawer`; la lista de precios se asigna dentro de «Editar» (misma llamada `assignPriceList`, al guardar) y desactivar/reactivar vive al fondo del drawer. **Cobros:** tabla Cliente · Origen · Total · Pagado · Saldo · Estado · Cobrar (en mobile, tarjetas con los tres importes rotulados), filtros compactos (Todos/Terminados + selector de origen) y rótulos de origen coherentes con el menú (Pedido, Reserva, Marquetería); el total adeudado aparece una vez en el encabezado; la cuenta del cliente muestra cada origen con sus tres importes y el saldo total sólo si hay más de un origen. `status.ts` suma `photoJobStatus` y `workSourceStatus`. POS y ventas **no se tocaron**; Cobros sigue siendo exclusivamente `WorkPayment` (sin mezclar ventas POS). Código: `pages.tsx`, `customers.tsx`, `payments.tsx`, `patterns.css`, y las llamadas a `CustomersPage` en los `main.tsx`.

**BUGs / pendientes documentados, sin tocar:** (1) la ficha busca los pedidos y reservas del cliente por nombre y filtra por id: con más de 50 coincidencias de nombre pueden faltar filas (límite previo de pedidos; nuevo en reservas). (2) Las ventas POS no están asociadas a un Customer, así que no aparecen en la ficha (limitación de dominio ya conocida). (3) Cobros no abre el origen de la deuda (pedido/reserva) desde la fila; requeriría navegación con id. (4) El nombre del cliente en Cobros muestra «Cliente» mientras se cargan los nombres (una consulta por cliente). (5) Inicio sigue cargando hasta 300 ventas para contar las de hoy. (6) Stock y Productos (Mostrador) siguen sin rediseñar; quedan para la fase de limpieza. **No verificado:** guardar/editar clientes y registrar pagos contra datos reales, ventana Tauri, tablet física.

## UX/UI — fase 5: Presupuestos y reservas + Agenda (29/10/2026)

Sólo presentación y composición; sin cambios de reglas de negocio, disponibilidad, estados de dominio, esquema, SQL ni sync (sin commit). **Presupuestos y reservas:** el editor ya no es un overlay propio sino una hoja lateral ancha (`Sheet size="lg"`, con foco atrapado, Esc y por encima de la barra superior) con pie fijo: Servicios · Recursos · **Total** + Volver / Guardar. Arriba, en 4 filas, cliente (búsqueda + selección + «Nuevo cliente» bajo demanda), título/tipo, inicio/fin/estado y «Lugar y notas» plegado; «Servicios contratados» empieza a ~480 px (antes 819 px) y el editor completo ya no obliga a desplazarse para guardar. Una sola acción para agregar servicios, «Agregar servicio», abre una segunda hoja con «Del catálogo» (cotizador, ahora con secciones «Servicio» y «Viáticos y tiempos») o «Personalizado»; se eliminó la fila libre duplicada. Distinción visual: servicios vendidos (borde amarillo), viáticos (insignia y sangría azul), recursos físicos en su bloque aparte (borde gris, campos rotulados) y un botón «Verificar» por recurso que muestra la disponibilidad con la misma consulta que hace el guardado (informativo; la regla de bloqueo sigue siendo sólo al guardar como Reservado/Realizado). `window.confirm` se reemplazó por `ConfirmDialog` (mismo texto). **Agenda:** el H1 es «Agenda» con las pestañas debajo; `AgendaBar` junta Día/Semana, ‹ Hoy ›, período y estado en una fila; «+ Nuevo turno» es la acción primaria del encabezado; Turnos usa `FilterBar` (búsqueda, desde/hasta, estado); el editor de turnos es un `FormDrawer`; estados con `StatusBadge` (`appointmentStatus`, `eventStatus` en `status.ts`); «Disponibilidad» usa la misma barra. `Sheet` ahora admite hojas apiladas (sólo la última atiende teclado y foco). Código: `event-editor.tsx`, `editor-parts.tsx`, `appointments.tsx`, `events.tsx`, `event-service-composer.tsx`, `patterns.css`.

**BUGs / decisiones documentados, sin tocar:** (1) la Agenda sigue sin mostrar las reservas (Events); la agenda transversal real queda para otra decisión de dominio. (2) Un recurso agregado a mano toma `defaultPriceCents` (invisible en Recursos), igual que antes (BUG-8). (3) La disponibilidad se exige sólo al guardar como Reservado o Realizado; «Verificar» no la impone. (4) «Reservar recurso» con el campo Inicio vacío lanza un `RangeError` al convertir la fecha (comportamiento previo, sin tratar). (5) Calendario filtra por defecto «Programado», lo que oculta turnos completados o ausentes hasta cambiar el filtro. (6) Los estilos `event-editor*`, `appointment-editor*` y `appointment-form*` de `legacy.css` quedaron sin uso; se podan en la fase de limpieza. **No verificado:** guardado real de presupuestos, conflictos reales de recursos, ventana Tauri, tablet física.

## UX/UI — fase 4: Precios (29/10/2026)

Unificada la gramática de **Configuración → Precios** sin cambios de dominio, reglas, migraciones, SQL ni sync (sin commit). Arriba: lista seleccionada + «Administrar listas» + «Viáticos» juntos. Debajo: «Familias de precios» con `PriceFamilyCard` iguales (toda la tarjeta es el botón; estado «Completa / Parcial / Sin precios» y «N de M con precio»; sin botón «Configurar» por tarjeta). Cada familia abre el mismo detalle (`PriceFamilyDetail`: volver, título, lista activa, acciones secundarias) con `PriceSection` + `PriceRow`: valores siempre con unidad («Precio por copia», «Precio por m²», «Precio por metro», «Precio por pieza», «Operador», «Precio sin/con proyector», «Precio fijo») y una sola acción, «Editar». Crear y editar ocurre en `FormDrawer` (tramos de Laboratorio, tarifas de Plotter, ofertas LED/tela/eventos, nueva pantalla de tela): ya no hay formularios en línea. La disponibilidad por papel/canal y la publicación en `/imprimir` salieron de la pantalla de precios hacia el panel «Disponibilidad y publicación»; en pantallas de tela, el equipamiento físico (pantalla/proyector) quedó en una sección «Tamaño y equipamiento» separada de «Precio». «Fotografía / Video» dice «Próximamente» (sin texto técnico). Código: `configuration-ui.tsx`, `services.tsx`, `event-pricing-catalog.tsx`, `patterns.css`.

**Pendientes documentados, sin resolver sólo con UX:** (1) Marquetería sigue configurándose en Materiales › Varillas/Otros materiales (la tarjeta de Precios lo enlaza): unificarla exige rediseñar `FramingCatalogPage` y sus ajustes (merma, mano de obra), que además mezcla costos con precios. (2) Fotografía / Video depende del catálogo extensible de la Fase C. (3) «Atajos: tamaños LED habituales» sigue en Recursos: son presets de cotización, no equipamiento ni precio; falta decidir su lugar. (4) Las variantes «Kiosco» siguen existiendo en el dominio; sólo se ven en «Disponibilidad y publicación». (5) Los importes se editan como «120000,00» (formato previo, no se cambió). (6) «Administrar listas» conserva su formulario en línea dentro de la hoja para no anidar hojas. (7) La cobertura de Plotter cuenta 21 tarifas fijas (8 materiales, 5 terminaciones, 8 tamaños de bastidor). **No verificado:** guardar tarifas contra Supabase/SQLite reales, ventana Tauri y tablet física.

## UX/UI — fase 3: Producción para tablet (29/10/2026)

Rediseñada sólo la presentación de `photo-production.tsx` y su CSS (`panel.css`). La carga, el armado de colas por carril, el filtro de pedidos con archivos recibidos, el cambio de estado y el aviso a la nube al pasar a «Listo» en pedidos web son exactamente los de antes; no hay cambios de dominio, esquema, SQL ni sync, y no hay commit. Hecho: selector «Laboratorio | Edición» con conteo y urgentes en lugar de dos carriles apilados; chips Todos · Pendiente · En proceso · Listo con conteo; filas de columnas fijas (En proceso 142 px · Listo 110 · Drive 120 · Abrir 96) con botones de 56 px, siempre en la misma posición; estados como pastillas de 16 px (Urgente/Atrasado aparte del estado); la acción siguiente va en amarillo; «Pendiente» rotula el estado `received` sólo en esta vista; la descripción administrativa se quitó. El diseño se adapta por contenedor: una fila (≥880 px), información + 4 acciones iguales (600–879 px, tablet vertical y riel) y 2×2 en móvil.

**Pendientes documentados, sin tocar (decisión de producto o dominio):** (1) BUG-1: los pedidos de mostrador sin archivos recibidos siguen sin aparecer en Producción. (2) BUG-4: un pedido con ítems de Laboratorio y de Edición aparece en ambas colas y «Listo» cambia el estado del pedido completo. (3) «Listo» en un pedido web sigue avisando por WhatsApp de inmediato, sin confirmar ni deshacer; un toque equivocado es irreversible (no se agregó confirmación para no alterar el flujo ni el aviso automático). (4) Un pedido «Listo» queda en la cola sin acción de entrega: «Para entregar» es sólo una etiqueta; se entrega desde Pedidos. (5) `listJobs` + un `getJob` por pedido (hasta 300). **No verificado:** tablet física, ventana Tauri y datos reales.

## UX/UI — fases 0–2 de la auditoría (29/10/2026)

Hecho (sólo UX, estructura y refactor menor; sin cambios de reglas de negocio, dominio, SQL, migraciones ni sync; sin commit): `PhotoProductionPage` y `EventEditor` en archivos propios (`photo-production.tsx`, `event-editor.tsx`); componentes `InlineMessage`/`useFlash`, `StatusBadge`, `FilterBar`, `EntityRow`, `FormDrawer`, `ConfirmDialog` en `packages/ui`; pestañas de módulo bajo el título (H1 = nombre del módulo); mensajes de éxito ya no se pintan como error; menú «+ Nuevo» abre el alta real de Cliente, Turno y Presupuesto o reserva y suma Plotter; estados de Plotter traducidos y Marquetería sin «En producción»; carga de Pedidos sin vacío falso; `.form-row`/`.eyebrow` con CSS; editores de eventos y turnos por encima de la barra superior; iconos únicos. Gramática y componentes: `docs/UX_GRAMMAR.md`. Diagnóstico completo, BUGs y decisiones de dominio pendientes: `docs/UX_AUDIT.md`. Siguiente fase autorizable: Producción para tablet (fase 3), con pedido expreso.

## Configuración → Precios — Fases A/B (27/10/2026)

Web y Desktop ya muestran una sola entrada **Configuración → Precios**. La pantalla comparte una lista seleccionada entre Laboratorio, Plotter, LED, pantallas de tela y servicios de eventos; la administración de listas vive en una hoja lateral. La portada es una grilla de familias y sólo abre el editor elegido. Marquetería enlaza a su configuración propia; Fotografía/Video queda explícitamente pendiente de Fase C. Los alias internos `price-lists` y `photo-services` se conservan, sin entradas duplicadas en la navegación.

Recursos ahora se describe y opera como catálogo de equipamiento físico reservable: alta/edición bajo demanda, sin precio visible y con el campo legado preservado. La capacidad técnica LED (pool, controladores y presets) está en Recursos; Precios contiene sólo su tarifa comercial. No hubo cambios de esquema, dominio, RLS, SQLite, outboxes ni backend remoto.

Verificación local: lint, typecheck, 563/563 pruebas, build de todo el workspace y build Tauri/NSIS pasan. Instalador: `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. No hubo commit, push ni SQL remoto. El siguiente punto de producto es **Fase C únicamente con una solicitud nueva**: diseñar el catálogo real de Fotografía/Video; no usar `PhotoService` ni ofertas de eventos como sustituto accidental.

## Reorganización funcional de navegación (26/10/2026)

Implementadas las etapas 1–3 sin cambios de esquema, migraciones, SQL remoto, reglas de negocio ni sync. La navegación compartida Web/Desktop queda en Inicio, Mostrador, Laboratorio, Servicios, Taller y Configuración; `PhotoJob` se muestra como Pedido, `Event` como Presupuesto o reserva y Producción como vista operativa de Pedidos. Catálogo desaparece como contenedor. Tipos de turno/reserva se agrupan en Configuración; materiales de Plotter, varillas y otros materiales de marquetería comparten el módulo Materiales; Drive/WhatsApp quedan en Integraciones. Se conservaron los IDs históricos y se agregó sólo el ID de vista `plotter-materials`.

Verificación local: typecheck, lint, build Web/Desktop y empaquetado NSIS pasan; la suite completa tuvo 562/563 verdes y un `EPERM` transitorio al listar `supabase/migrations`, cuyo archivo de 51 pruebas pasó completo al reintentarlo. No se hizo commit ni push. Deuda deliberada: agenda transversal Appointment+Event, catálogo extensible de servicios y PlotterJob.

## Limpieza de datos operativos de prueba (26/10/2026)

Auditoría estática completa, sin SQL remoto ni borrados. Informe: `docs/OPERATIONAL_TEST_DATA_CLEANUP.md`; consulta de sólo lectura para FK/conteos: `docs/sql/customer_test_data_audit.sql`; propuesta transaccional: `docs/sql/customer_test_data_cleanup.sql` (termina en `ROLLBACK`, `COMMIT` comentado). Alcance propuesto: todos los Customers del Business `centrocolor` y sólo sus dependencias operativas. Antes de ejecutar: obtener y revisar conteos reales, confirmar que el preflight reconoce todas las tablas, cerrar Desktop y diseñar la limpieza SQLite/outboxes para evitar datos residuales o re-subidas. No hay decisión arquitectónica nueva ni cambios en `DECISIONS.md`.

## SERVICIOS-01 (24/10/2026)

Implementado y verificado en código (detalle en `docs/CURRENT_STATE.md`, decisiones 93–98). **Estado remoto verificado el 25/10/2026**: las migraciones `20261024*` ya figuran aplicadas, pero `public-photo-catalog` y las otras tres funciones públicas seguían en su versión 1 del 17/10. No volver a empujar esas migraciones basándose en notas históricas. Para que `/imprimir` use las variantes todavía corresponde verificar/redesplegar `public-photo-catalog` y `public-photo-order-start` y publicar cada tamaño desde Configuración → Precios → Laboratorio → «Publicar en /imprimir». Después, cargar los datos listados en CURRENT_STATE y probar sync Desktop↔Cloud y un pedido `/imprimir` con Mate y Brillo. No hay commit de este trabajo.

## Punto de reanudación

Las Fases A/B de Precios están terminadas localmente. Para retomarlas, empezar por `packages/features/src/services.tsx`, `event-service-catalog.tsx`, `resource-capacity.tsx`, `events.tsx` y `photo.tsx`; la composición/alias vive en `packages/ui/src/navigation.ts` y en los `main.tsx` de Web/Desktop. La próxima ampliación autorizable es Fase C (catálogo de Fotografía/Video) y requiere una solicitud y decisión de modelo propias. Antes de esa fase conviene hacer una prueba manual con datos reales en Web y en la ventana Tauri, especialmente cambio de lista, persistencia de tarifas y edición de capacidad LED.

Los pendientes remotos históricos de Sprint 14/SERVICIOS-01 siguen separados de esta entrega de UI. Confirmar siempre el estado remoto actual antes de ejecutar migraciones o despliegues; las migraciones `20261024*` constaban aplicadas al 25/10/2026.

## Pendientes operativos históricos (confirmar estado remoto antes de ejecutar)

1. Consultar primero la lista de migraciones remotas y ejecutar `pnpm exec supabase db push --dry-run`; no asumir que las notas de octubre reflejan el estado actual. Sólo con autorización explícita, aplicar lo que el dry-run confirme pendiente. Comandos: `docs/PUBLIC_ORDERS_SETUP.md`.
2. Desplegar las funciones nuevas y **redesplegar** `photo-file-admin`, `photo-upload-context`, `photo-upload-session`, `photo-upload-finalize` y `photo-upload-submit` (obligatorio: ahora distinguen links de subida y de seguimiento y aplican los límites del pedido anónimo). No tocar las dos de OAuth.
3. Publicar la Web en Vercel (sin variables nuevas).
4. En Configuración → Precios → Laboratorio publicar los tamaños correspondientes y revisar la lista en `/imprimir`.
5. Prueba humo de pedido (checklist de `docs/PUBLIC_ORDERS_SETUP.md`) desde un celular real, incluyendo una foto grande y el PUT resumable de Google desde el navegador.
6. WhatsApp (opcional, no bloquea los pedidos): seguir `docs/WHATSAPP_SETUP.md` (app Meta, número, token permanente, plantilla `pedido_listo` de utilidad, secrets, secretos de Vault para `pg_net`, webhook) y probar con un número verificado: Listo → aviso → reintento → reenvío. Probar también Desktop: marcar Listo sin conexión, sincronizar y ver que sale un solo aviso.
7. Definir la política de abandono (retención) y, si se desea, programar `cc_public_order_mark_abandoned`.

## Escáner global

Detector, coordinador y proveedor en `packages/features/src/scan-*.ts` y `global-scanner.tsx` (detalle en `docs/CURRENT_STATE.md`). Falta probarlo con un lector físico en Web y en la ventana Tauri.

## Garantías y límites

El navegador nunca decide un precio ni autoriza con un UUID; los borradores no llegan a Producción ni a Desktop; el aviso de «listo» es único por trabajo y depende del estado Cloud; el token de WhatsApp sólo vive en Vault. Drive sigue siendo la autoridad binaria (Sprint 13) y Desktop sigue sin binarios.

No se implementaron: editor Polaroid/plantillas/recorte/texto, Gmail (sólo se reserva `future_gmail`), galería, IA, impresión automática, pago online, envíos, promociones, cuentas de clientes, marketing por WhatsApp ni emails automáticos. Deuda técnica y no verificado contra servicios reales: ver `docs/CURRENT_STATE.md`.

## UX/UI (DESIGN-02 adoptado)

La app real (Web y Desktop) ya usa el sistema visual de DESIGN-02: tokens y componentes en `packages/ui` (`styles.css` agrega `tokens`, `base`, `compat`, `components`, `shell`, `legacy` y `panel`), navegación por módulos con pestañas en `packages/ui/src/navigation.ts`, `PanelShell`/`GlobalSearch`/`useNavAttention` en `packages/features` y el portal en `apps/web/src/public-order/` (`public-order.css`). Estado, diferencias respecto de la preview y deuda: `docs/CURRENT_STATE.md`; decisiones 87–91 en `docs/DECISIONS.md`. `apps/design-preview` **se conserva** como referencia histórica (`pnpm --filter @centrocolor/design-preview dev`) y no se usa en producción.

Pendiente de producto/diseño antes de dar por cerrado el portal: (1) implementar el **gate de backend** del pago por transferencia (el portal ya comunica alias y «impresión una vez acreditado el pago»; falta estado de pago/acreditación), (2) revisión legal de que no haya casilla de consentimiento de WhatsApp, (3) logo vectorial/plano para fondos oscuros, (4) probar Producción en la tablet real de laboratorio (~10") y Desktop en su ventana Tauri, y (5) pasada con lector de pantalla. Para revisar visualmente sin backend se usó un arnés temporal con repositorios en memoria (no versionado): se puede recrear montando `PanelShell` con repositorios falsos.

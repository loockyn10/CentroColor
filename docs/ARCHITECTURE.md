# Arquitectura

## Clientes y código compartido

- `apps/desktop`: React/Vite dentro de Tauri 2. SQLite local permite iniciar con un contexto autorizado previamente; Supabase valida el primer acceso.
- `apps/web`: React/Vite configurada como PWA. Tiene cliente y repositorios Supabase aislados en su propia capa de infraestructura. Supabase/PostgreSQL es la fuente primaria de identidad Web y sus consultas están protegidas por RLS.
- `packages/domain`: TypeScript puro para Business, Branch, Device, Profile, BusinessMembership, Customer, Product, ProductCategory, CartLine, Sale y SaleItem; no depende de infraestructura ni UI.
- `packages/application`: contratos de repositorios y resolución del contexto actual. Los adaptadores de cada cliente implementan sus puertos; la UI compartida no consulta SQLite ni Supabase.
- `packages/ui`: AppShell, navegación, componentes básicos y CSS responsive compartidos.
- `packages/features`: Login, estados de acceso, Inicio, Clientes y POS compartido; Desktop y Web reciben repositorios distintos.

Los adaptadores SQLite y Supabase residen en cada app. Web escribe en Supabase y Desktop en SQLite. Ambos clientes representan el mismo sistema y deben mantener paridad funcional razonable; la UX puede adaptarse a cada pantalla. Customer Sync y POS Sync sincronizan Desktop cuando existe sesión Cloud válida; Web usa Cloud directamente. Las migraciones Cloud del POS y su sync siguen pendientes de aplicación remota.

## Identidad estructural

El adaptador estructural de Sprint 2 conserva la capacidad de crear un `installation_id` y entidades locales provisionales, pero ya no se invoca al iniciar la UI. El acceso actual se decide con BusinessContext derivado de Supabase o de su última copia validada en SQLite. Los IDs Cloud no se sustituyen por los IDs provisionales locales.

Business, Branch y Device tienen representación tanto en Cloud como en SQLite. Profiles y memberships viven en Cloud; SQLite guarda solo una copia del contexto autorizado. Los adaptadores traducen entre columnas `snake_case` y tipos TypeScript `camelCase`. Los IDs estructurales son UUID generables sin conexión. Cloud usa `timestamptz` y SQLite guarda instantes UTC ISO 8601 como texto. Customer tiene versión Cloud en `updated_at` y metadata de sincronización exclusivamente local.

Supabase Auth (`auth.users`) es la identidad Cloud. `profiles` conserva únicamente el nombre visible; `business_memberships` vincula usuario, negocio y rol (`owner`, `admin`, `staff`). El adaptador Cloud de cada cliente carga perfil, memberships activos, negocios y sucursales permitidos. `resolveBusinessContext` en `application` selecciona un contexto coherente y el proveedor React compartido lo entrega a las pantallas. Sin membership activo se muestra “Sin acceso asignado”. Web persiste la sesión en `localStorage` del origen mediante el SDK de Supabase para restaurarla al recargar. Desktop mantiene la sesión Supabase únicamente en memoria.

RLS protege las cinco tablas de identidad Cloud mediante lecturas limitadas al propio perfil/membership o a negocios con membership activo. El helper `private.has_active_membership` usa `SECURITY DEFINER`, `search_path` vacío y `auth.uid()`; solo `authenticated` puede ejecutarlo. Clientes añade SELECT, INSERT y UPDATE bajo ese mismo criterio, sin DELETE. Las altas de usuarios y memberships son administrativas. `owner` representa control administrativo completo, `admin` operación completa salvo futuras reservas del owner y `staff` operación diaria. El rol queda disponible en BusinessContext, sin matriz granular de permisos aún.

Desktop copia a SQLite únicamente el contexto autorizado tras una validación Cloud: IDs de usuario, negocio y sucursal, nombres visibles, rol y fecha de validación. Al reiniciar lo carga como `offline-authenticated`, incluso si no hay Internet. Ese estado permite operar Customer localmente; ninguna operación Cloud se ejecuta sin una sesión Supabase actual y un membership activo revalidado. La sesión y los tokens Desktop no se escriben en disco; revalidar requiere ingresar credenciales de nuevo. Cerrar sesión borra la copia local, pero conserva Customers y outbox. RLS protege datos Cloud, no SQLite: el archivo local pertenece al dispositivo y la autorización offline depende de la aplicación.

## Sincronización Customer — Sprint 5

Desktop SQLite ↔ sincronización Customer ↔ Supabase/PostgreSQL. La UI y `SQLiteCustomerRepository` siempre leen/escriben SQLite, sin esperar Cloud. Triggers SQLite registran en `sync_outbox` cada alta o modificación local en la misma sentencia; la clave única por negocio/entidad compacta cambios consecutivos. La migración local añade pendientes para Customers anteriores. Un pull escribe con origen `remote` y no genera outbox.

El push usa la sesión autenticada y RLS. Una inserción conserva el UUID local; una edición usa `WHERE updated_at = cloud_updated_at` como comparación de versión. Si la versión Cloud cambió, conserva la edición local, registra el conflicto y guarda una instantánea remota. Ante fallos, la operación permanece pendiente con intentos y error. Un reintento tras una respuesta Cloud perdida reconoce datos ya iguales y confirma el push sin duplicarlo.

El pull consulta páginas ordenadas por `(updated_at, id)` desde el cursor persistido en `customer_sync_cursor` por negocio. El cursor compuesto cubre empates de la migración inicial. PostgreSQL fija `updated_at` al insertar y actualizar mediante un reloj monotónico por negocio protegido por bloqueo transaccional, de modo que el orden visible sigue el orden de versión; no depende del reloj Desktop. Cada fila se aplica o registra como conflicto antes de avanzar el cursor. En la UI Desktop se puede conservar la versión local o la versión Web: ambas acciones vuelven a consultar Cloud; conservar local vuelve a intentar con comparación de versión, y conservar Web sustituye SQLite sin generar outbox.

El ciclo se ejecuta tras login online, cuando hay sesión válida al iniciar, mediante `Sincronizar ahora`, al volver la conectividad y cada dos minutos mientras Desktop está abierto y autenticado. Solo hay un ciclo activo a la vez; los errores no bloquean la UI. `packages/application` define el orquestador y sus puertos; los adaptadores concretos viven en Desktop. Web no usa este ciclo. El shell Web PWA precachea la interfaz, pero Web requiere conexión para operar Clientes.

Customer Sync conserva sus tablas, triggers y orquestador propios. No se reescribió ni se mezcló su outbox con POS. La revocación remota no llega a Desktop desconectado y el login debe revalidarse para volver a sincronizar.

## POS MVP Desktop — Sprint 5

Desktop usa `SQLiteProductRepository` para productos/categorías y lookup exacto por barcode. `SQLiteSaleRepository` consulta historial y llama a `complete_local_sale`, comando Rust de Tauri que inserta Sale y SaleItems en una transacción SQLx SQLite. El comando abre el mismo archivo en `app_config_dir` que `tauri-plugin-sql`, activa foreign keys y valida importes/totales antes de escribir. La UI no accede a SQLite directamente: recibe los puertos de application.

La pantalla Nueva venta usa el input principal para scanner HID Keyboard terminado en Enter. El Enter sin selección consulta exactamente `(business_id, barcode)` local; la búsqueda por nombre se carga con retraso breve en una lista aparte y requiere selección. Alta rápida, carrito, checkout e historial usan únicamente SQLite y continúan disponibles con el contexto `offline-authenticated`. El carrito se conserva en `sessionStorage` de la ventana mientras se navega. Las ventas completadas no tienen operación de edición. `device_id` es nullable porque el contexto autorizado actual no vincula todavía un registro Device Cloud al equipo; branch y usuario son obligatorios.

## POS compartido y sincronización — Sprint 6

Web usa `SupabaseProductRepository` y `SupabaseSaleRepository` con la misma feature de Productos, Nueva venta e Historial que Desktop. La UI recibe `ProductRepository` y `SaleRepository`; el negocio procede de `BusinessContext`. Web requiere conexión y sesión autenticada. Desktop continúa operando en SQLite sin conexión.

Desktop agrega `pos_sync_outbox` independiente para `category`, `product` y `sale`, con triggers locales y backfill. `pos_sync_cursor` guarda un cursor `(updated_at, id)` por negocio y tipo. El ciclo se ejecuta después de validar la sesión/membership, en orden Customer → ProductCategory → Product → Sale. ProductCategory y Product son mutables: Cloud fija versiones monotónicas por negocio mediante `private.pos_sync_clock`, y el push actualiza solo si coincide la última versión Cloud conocida. Una divergencia conserva el cambio local y registra el snapshot remoto; el usuario puede conservar Desktop o Web. Los pulls escriben con `sync_origin='remote'` y no generan outbox.

Sale completada es inmutable. El push invoca `complete_pos_sale` con Sale y todas las SaleItems en una transacción PostgreSQL; el mismo UUID y contenido es idempotente. Los INSERT directos de Sale y SaleItem se revocan a `authenticated`. El pull pagina Sales por su `updated_at` y recupera todas las SaleItems antes de aplicar el bundle con `apply_remote_sale`, transacción SQLite que valida totales e ítems. SaleItem no tiene cursor propio porque nunca se sincroniza separada de Sale. Su snapshot histórico no consulta el Product actual. La RLS por membership y las FK compuestas impiden asociar una línea a una venta o producto de otro negocio.

La migración Cloud del POS base (`20260923000000_pos_mvp.sql`) y la nueva (`20260924000000_pos_sync.sql`) deben aplicarse en ese orden antes de usar POS Web o Sync. El dry-run enumera ambas, pero no verifica ejecución SQL. No se ha probado todavía una sesión Cloud real de POS ni el scanner físico. Stock sigue fuera de alcance.

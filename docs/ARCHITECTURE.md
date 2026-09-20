# Arquitectura

## Clientes y código compartido

- `apps/desktop`: React/Vite dentro de Tauri 2. SQLite local permite iniciar con un contexto autorizado previamente; Supabase valida el primer acceso.
- `apps/web`: React/Vite configurada como PWA. Tiene cliente y repositorios Supabase aislados en su propia capa de infraestructura. Supabase/PostgreSQL es la fuente primaria de identidad Web y sus consultas están protegidas por RLS.
- `packages/domain`: TypeScript puro para Business, Branch, Device, Profile, BusinessMembership y Customer; no depende de infraestructura ni UI.
- `packages/application`: contratos de repositorios y resolución del contexto actual. Los adaptadores de cada cliente implementan sus puertos; la UI compartida no consulta SQLite ni Supabase.
- `packages/ui`: AppShell, navegación, componentes básicos y CSS responsive compartidos.
- `packages/features`: Login, estados de acceso, Inicio, Clientes y una pantalla placeholder compartidos.

Los adaptadores SQLite y Supabase residen en cada app. Clientes es la primera persistencia de operación: Web escribe en Supabase y Desktop en SQLite. Sprint 5 agrega sincronización eventual solo de Customer desde Desktop; Web mantiene su acceso directo a Supabase. La migración Cloud de Sprint 4 ya fue aplicada según el usuario; la nueva migración de timestamps de Sprint 5 requiere revisión y aplicación manual.

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

No hay sincronización genérica, Realtime ni cambios a otras entidades. La revocación remota no llega a Desktop desconectado y el login debe revalidarse para volver a sincronizar. El reloj por negocio serializa escrituras Customer Cloud; si el volumen crece mucho, habrá que medir esa contención antes de ampliar el mecanismo.

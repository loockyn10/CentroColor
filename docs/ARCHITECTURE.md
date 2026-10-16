# Arquitectura

## Clientes y código compartido

- `apps/desktop`: React/Vite dentro de Tauri 2. SQLite local permite iniciar con un contexto autorizado previamente; Supabase valida el primer acceso.
- `apps/web`: React/Vite configurada como PWA. Tiene cliente y repositorios Supabase aislados en su propia capa de infraestructura. Supabase/PostgreSQL es la fuente primaria de identidad Web y sus consultas están protegidas por RLS.
- `packages/domain`: TypeScript puro para Business, Branch, Device, Profile, BusinessMembership, Customer, Product, ProductCategory, CartLine, Sale y SaleItem; no depende de infraestructura ni UI.
- `packages/application`: contratos de repositorios y resolución del contexto actual. Los adaptadores de cada cliente implementan sus puertos; la UI compartida no consulta SQLite ni Supabase.
- `packages/ui`: AppShell, navegación, componentes básicos y CSS responsive compartidos.
- `packages/features`: Login, estados de acceso, Inicio, Clientes y POS compartido; Desktop y Web reciben repositorios distintos.

Los adaptadores SQLite y Supabase residen en cada app. Web escribe en Supabase y Desktop en SQLite. Ambos clientes representan el mismo sistema y deben mantener paridad funcional razonable; la UX puede adaptarse a cada pantalla. Customer, POS y Stock Sync sincronizan Desktop cuando existe sesión Cloud válida; Web usa Cloud directamente. Las migraciones Cloud POS figuran aplicadas en el historial remoto; la de Stock está pendiente.

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

Desktop agrega `pos_sync_outbox` independiente para `category`, `product` y `sale`, con triggers locales y backfill. `pos_sync_cursor` guarda un cursor `(updated_at, id)` por negocio y tipo. El ciclo se ejecuta después de validar la sesión/membership, en orden Customer → ProductCategory → Product → Sale → StockMovement. ProductCategory y Product son mutables: Cloud fija versiones monotónicas por negocio mediante `private.pos_sync_clock`, y el push actualiza solo si coincide la última versión Cloud conocida. Una divergencia conserva el cambio local y registra el snapshot remoto; el usuario puede conservar Desktop o Web. Los pulls escriben con `sync_origin='remote'` y no generan outbox.

Sale completada es inmutable. El push invoca `complete_pos_sale` con Sale y todas las SaleItems en una transacción PostgreSQL; el mismo UUID y contenido es idempotente. Los INSERT directos de Sale y SaleItem se revocan a `authenticated`. El pull pagina Sales por su `updated_at` y recupera todas las SaleItems antes de aplicar el bundle con `apply_remote_sale`, transacción SQLite que valida totales e ítems. SaleItem no tiene cursor propio porque nunca se sincroniza separada de Sale. Su snapshot histórico no consulta el Product actual. La RLS por membership y las FK compuestas impiden asociar una línea a una venta o producto de otro negocio.

Las migraciones Cloud POS `20260923000000` y `20260924000000` aparecen aplicadas en el historial remoto consultado el 21/9/2026; su operación con una sesión real aún requiere validación.

## Inventario por sucursal — Sprint 7

`Product.tracksInventory` comienza en falso para todo producto anterior. `InventoryBalance` está identificado por `(business_id,branch_id,product_id)` y es una materialización del ledger `StockMovement`; no se sincroniza como valor mutable. La migración SQLite 0008 y Cloud `20260925000000_inventory.sql` añaden el ledger, restricciones multiempresa y triggers que materializan el delta dentro de la misma transacción. Las cantidades son enteros. Los balances pueden ser negativos; el POS advierte sin bloquear.

Cada línea de venta nueva conserva `tracks_inventory` como snapshot operativo. Si es verdadero, el trigger de inserción crea un movimiento `sale` cuyo UUID es el UUID de `SaleItem`. Así el checkout Desktop, el checkout Web y el reintento de Sale Sync convergen en la misma identidad: la venta se inserta una vez y el segundo camino de movimiento reconoce el UUID ya existente. Las líneas antiguas reciben falso, por lo que no hay backfill de ventas. La transacción SQLite de Tauri o la RPC `complete_pos_sale` en PostgreSQL agrupa Sale, líneas, movimientos y balances.

Owner/admin puede crear `initial`, `entry` y `adjustment`. La UI recibe el contexto actual y no acepta business/branch arbitrarios. Desktop valida su `authorized_context` al escribir y usa SQLite sin Internet; Web invoca una RPC que revalida `auth.uid()`, membership, rol y relaciones Business/Branch/Product. Staff solo lee stock y vende. Desactivar tracking conserva ledger y balance. El stock inicial de cero activa tracking sin movimiento porque el ledger prohíbe delta cero.

Desktop sincroniza ProductCategory → Product → Sale → StockMovement. Los movimientos manuales salen por outbox local; los movimientos Cloud entran con cursor `(received_at,id)` fijado por servidor mediante el reloj POS por negocio. Una inserción remota ya existente no aplica delta otra vez ni crea outbox. Los movimientos de Sale creados al aplicar un bundle remoto se reconocen luego por UUID durante el pull de movimientos. Si falla la aplicación, el cursor no avanza. El estado visual de sync suma pendientes de stock. La migración Cloud de inventario sigue pendiente; falta validación con PostgreSQL remoto y equipos reales.

## Agenda y Turnos — Sprint 8

`packages/domain/src/appointment.ts` define `AppointmentType`, `Appointment`, estados, normalización temporal y detección pura de solapamientos. `packages/application/src/appointment.ts` expone el puerto común y casos de uso; los adaptadores concretos son `SQLiteAppointmentRepository` y `SupabaseAppointmentRepository`. La feature React compartida contiene Calendario Día/Semana, listado, editor, tipos de turno y tarjeta de Inicio. Desktop y Web comparten acciones, aunque la semana prioriza espacio horizontal y móvil convierte la agenda en una secuencia táctil.

La UI construye fechas con controles locales `datetime-local` y convierte a instantes ISO UTC antes de persistir. PostgreSQL usa `timestamptz`; SQLite texto ISO. No se codifica un offset fijo. `business_id` y `branch_id` proceden siempre de `BusinessContext`; el formulario no los permite seleccionar. El título conserva una copia editable del nombre del tipo, por lo que desactivar o renombrar la plantilla no vuelve ilegible el turno histórico.

Desktop usa `appointment_sync_outbox` para `appointment_type` y `appointment`, y `appointment_sync_cursor` con `(updated_at,id)` por negocio/tipo. El ciclo corre después de Customer y Stock: Customer → POS/Stock → AppointmentType → Appointment, de modo que las referencias existan antes del turno. Cloud asigna versiones monotónicas por negocio mediante `private.appointment_sync_clock`. El push usa comparación optimista con `cloud_updated_at`; una divergencia conserva la fila local y el snapshot Cloud hasta elegir “este equipo” o “Web”. Un pull usa `sync_origin='remote'`, no dispara outbox y avanza el cursor solo después de aplicar la fila.

RLS Cloud permite lectura de tipos y turnos a memberships activos. Owner/admin gestiona tipos y cancela; staff puede ver, crear, editar, completar y marcar ausente. Las FK compuestas validan Branch, Customer y AppointmentType dentro del mismo Business. No hay DELETE cliente. La migración Cloud `20261011000000_appointments.sql` está pendiente y no fue validada en PostgreSQL: la CLI vinculada respondió 403 al consultar el rol de login. Appointment no se reutiliza como Event ni reserva recursos.

## Eventos y recursos — Sprint 9

`packages/domain/src/event.ts` separa `EventType`, `Event`, `EventServiceItem`, `Resource` y `ResourceReservation` de Appointment, Product e Inventory. Application expone un único `EventRepository` y un ciclo de sync de cinco tipos. `packages/features/src/events.tsx` contiene listado/ficha/editor de Events, alta rápida de Customer, tipos, catálogo de recursos, disponibilidad Día/Semana y tarjeta de Inicio. Desktop implementa los puertos en SQLite; Web en Supabase.

Desktop sincroniza Customer y luego `EventType → Resource → Event → EventServiceItem → ResourceReservation`. Cada fila conserva UUID, versión Cloud, revisión local y outbox; los pulls usan `(updated_at,id)` y `sync_origin='remote'`. Items y reservas tienen `is_active` para preservar historial sin DELETE. Los conflictos por edición conservan ambas versiones. Un conflicto físico de reserva se marca aparte y no ofrece “forzar”: se resuelve editando horario/recurso o desactivando la reserva local.

Cloud es la autoridad final de disponibilidad. Triggers PostgreSQL ejecutados en la transacción de INSERT/UPDATE adquieren `pg_advisory_xact_lock` por Business+Resource y vuelven a comprobar intervalos. La transición de un Event a `reserved`/`completed` bloquea los recursos en orden y valida todas sus reservas. Así se cubren Web concurrente y push offline sin confiar en la UI. `cancelled`, `quoted` e `inquiry` no bloquean; `reserved` y `completed` sí. SQLite aplica la misma regla contra la última copia conocida, con la limitación explícita de que un Desktop offline puede no conocer una reserva remota reciente.

Cloud usa FK compuestas para Customer, Branch, EventType, Event y Resource dentro del mismo Business, RLS por membership y permisos de configuración restringidos a owner/admin. Staff consulta y opera Events cotidianos. No hay grants DELETE, `service_role` ni RPC insegura. Instantes siguen la estrategia de Appointment: UTC absoluto en persistencia y presentación local, permitiendo cruzar medianoche.

## Marquetería — Sprint 10

`packages/domain/src/framing.ts` contiene el cálculo puro y las invariantes de medidas, merma, markup y snapshots; `packages/application/src/framing.ts` define el puerto compartido. Desktop persiste los catálogos, configuración, cotizaciones, ítems y trabajos con SQLite; Web los consulta directamente en Supabase bajo RLS. Las cotizaciones se construyen a partir de catálogos, pero al guardarlas nunca vuelven a derivar precio de esos registros. `framing_sync_outbox` y `framing_sync_cursor` sincronizan `moulding → material → settings → quote → quote_item → job` después de Customer; cada push conserva UUID, usa comparación optimista y cada pull remoto evita crear outbox. Las divergencias quedan como conflicto con snapshot remoto; no existe overwrite silencioso.

## Trabajos fotográficos — Sprint 11

`packages/domain/src/photo.ts` define `PhotoService`, `PhotoJob`, `PhotoJobItem`, estados, prioridad, validaciones monetarias, total, atraso y orden de producción. `packages/application/src/photo.ts` contiene el puerto común y la construcción de bundles con snapshots. La feature React compartida ofrece catálogo, alta rápida, listado/cola, ficha operativa, edición básica y tarjeta de Dashboard; Desktop y Web inyectan adaptadores SQLite/Supabase distintos.

Desktop escribe siempre en SQLite y sincroniza `PhotoService → PhotoJob → PhotoJobItem` después de Customer, Appointment y Event. `photo_sync_outbox` compacta cambios, conserva revisión local, error, versión y snapshot remoto; `photo_sync_cursor` pagina por `(updated_at,id)`. El push compara `cloud_updated_at`; una divergencia —incluida una transición de estado distinta— conserva el cambio local como conflicto. El pull usa `sync_origin='remote'` y no crea loops. UUID, snapshots y líneas inactivas convergen sin DELETE.

Cloud usa un reloj monotónico por Business, FK compuestas hacia Branch, Customer, Appointment/Event opcionales, PhotoJob y PhotoService, y RLS. Owner/admin administra `PhotoService`; staff lo lee. Todo membership activo opera PhotoJobs e items. No se concede DELETE ni se usa `service_role`. `PhotoService` no reutiliza Product y el módulo no persiste archivos fotográficos.

## Pagos de trabajos — Sprint 12

`packages/domain/src/payment.ts` define un único `WorkPayment` para Event, FrameJob y PhotoJob. Tres FK nullable y un CHECK obligan exactamente una fuente coherente con `source_type`; no se usa una referencia polimórfica sin integridad. El total continúa perteneciendo a cada módulo: servicios+recursos activos del Event, total snapshot del presupuesto aceptado en FrameJob e items activos del PhotoJob. `paid_cents` es seña+pago posted menos refunds posted; anulados no cuentan.

El ledger es append-only. INSERT y la transición auditada `posted → voided` son las únicas mutaciones funcionales; importe, fuente, cliente, medio, fecha y autor permanecen inmutables. Cancelar una fuente no anula ni devuelve. Web usa `post_work_payment(jsonb)` y `void_work_payment(...)`, RPC `SECURITY DEFINER` con `auth.uid()`, membership/rol y `search_path` vacío. Un advisory lock por Business+tipo+fuente agrupa lectura del neto, validación y escritura, por lo que dos cobros concurrentes no pueden consumir el mismo saldo. La tabla sólo concede SELECT directo; las mutaciones pasan por RPC.

Desktop guarda pagos y auditoría en SQLite 0014. Triggers validan contexto, Business/Branch/Customer/fuente, saldo y refund incluso offline. `work_payment_sync_outbox` y cursor `(updated_at,id)` sincronizan después de Customer y las tres fuentes. El push es idempotente por UUID. Un rechazo Cloud financiero marca conflicto sin borrar la fila local ni contarla en el saldo operativo; owner/admin puede anular ese conflicto para conservarlo como historial local resuelto. El pull remoto usa `sync_origin='remote'` y no genera loops. POS/Sale conserva su modelo y `payment_method` sin integración en este sprint.

# Modelo de datos

## Identidad implementada en Sprint 2

| Entidad                 | Columnas                                                                                                                            | Restricciones principales                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Business (`businesses`) | `id`, `name`, `slug`, `created_at`, `updated_at`                                                                                    | UUID PK; `slug` único y normalizado.                                                                                                                   |
| Branch (`branches`)     | `id`, `business_id`, `name`, `is_active`, `created_at`, `updated_at`                                                                | UUID PK; FK a Business; nombre único por negocio.                                                                                                      |
| Device (`devices`)      | `id`, `business_id`, `branch_id`, `name`, `device_type`, `installation_id`, `is_active`, `last_seen_at`, `created_at`, `updated_at` | UUID PK; sucursal requerida y coherente con el negocio mediante FK compuesta; `installation_id` único; tipo restringido a `desktop`, `web` o `mobile`. |

Cloud usa UUID nativos y `timestamptz`. SQLite usa UUID como texto e instantes UTC ISO 8601; las dos representaciones se traducen a los mismos tipos de dominio. Los IDs se generan sin conexión cuando procede. `created_at` y `updated_at` se fijan al insertar; los futuros adaptadores de escritura deben renovar `updated_at` al modificar. `last_seen_at` es opcional y no implica que exista seguimiento en tiempo real.

La base Desktop mantiene también `app_meta` para `installation_id` y la selección provisional de Sprint 2. El seed Cloud es solo de desarrollo y crea CentroColor + Sucursal principal sin IDs fijos. En producción, el bootstrap inicial de Business, Branch y primer owner se realizó manualmente; no depende del seed.

## Autenticación y autorización

| Entidad                     | Columnas                                                                                                                          | Restricciones                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                  | `id`, `display_name`, `created_at`, `updated_at`                                                                                  | `id` es PK y FK a `auth.users(id)`; se crea con trigger y se completan usuarios anteriores a la migración. No duplica email. |
| `business_memberships`      | `id`, `business_id`, `user_id`, `role`, `is_active`, `created_at`, `updated_at`                                                   | FK a Business y Auth; único `(business_id, user_id)`; rol limitado a `owner`, `admin`, `staff`.                              |
| SQLite `authorized_context` | `slot`, `user_id`, `display_name`, `business_id`, `business_name`, `branch_id`, `branch_name`, `role`, `last_cloud_validation_at` | Una copia local de la última autorización Cloud validada. No guarda contraseña ni token.                                     |

RLS permite `SELECT` de Business, Branch y Device solo con membership activo del negocio; Profile solo propio; Membership solo propio y activo. No hay escrituras cliente en estas tablas de identidad. La copia SQLite no está protegida por RLS y puede quedar obsoleta mientras está offline.

## Clientes — Sprint 4

`customers` contiene `id` UUID, `business_id` UUID, `full_name` obligatorio, `phone`, `email`, `document_number` y `notes` opcionales, `is_active`, `created_at` y `updated_at`. Cloud usa UUID y `timestamptz`; Desktop usa UUID en texto y UTC ISO 8601. Los IDs se generan en application mediante `crypto.randomUUID()`, también offline. La desactivación usa `is_active = false`; no hay DELETE físico en el cliente.

Cloud tiene FK a `businesses`, índices por negocio/estado/nombre y por campos de búsqueda, RLS SELECT/INSERT/UPDATE restringida a membership activo. Los permisos de UPDATE excluyen `id`, `business_id` y timestamps; un trigger actualiza `updated_at`. Desktop tiene migración incremental 0004, índices equivalentes y consultas siempre filtradas por `business_id`. No tiene FK local a `businesses`: el ID autorizado proviene de Cloud y las filas estructurales locales de Sprint 2 pueden ser provisionales con otros IDs.

## Sincronización de Customer — Sprint 5

La migración Cloud `20260922000000_customer_sync_timestamps.sql` hace que PostgreSQL asigne `updated_at` en INSERT y UPDATE, rebasa timestamps previos que pudieron venir del cliente y agrega índice `(business_id, updated_at, id)`. La tabla privada `customer_sync_clock` guarda el último timestamp por negocio; un bloqueo de fila hasta commit permite asignar versiones monotónicas incluso con transacciones concurrentes o retroceso del reloj. `created_at` original se conserva al subir un Customer offline. La versión para comparación optimista es el `updated_at` Cloud exacto, no el reloj Desktop.

La migración SQLite 0005 añade a `customers` solo metadata local: `sync_origin` (`local`/`remote`), `local_revision` y `cloud_updated_at`. El modelo de dominio no incorpora esos campos. Los triggers de cambios locales crean o compactan un outbox en la misma sentencia; el pull establece `sync_origin='remote'` para no crear nuevas operaciones.

| Tabla local            | Campos principales                                                                                                                                                       | Función                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `sync_outbox`          | `id`, `business_id`, `entity_type`, `entity_id`, `operation`, `created_at`, `attempts`, `last_error`, `status`, `local_revision`, `remote_updated_at`, `remote_snapshot` | Una operación `upsert` por Customer y negocio; estado `pending` o `conflict`; error e instantánea para diagnóstico/resolución. |
| `customer_sync_cursor` | `business_id`, `updated_at`, `customer_id`, `last_success_at`                                                                                                            | Última posición de pull confirmada para cada negocio.                                                                          |

Las filas Customer locales anteriores a 0005 entran al outbox en la migración. No se borran clientes ni se regeneran IDs. La columna `local_revision` impide que el acuse de un push en curso elimine una edición local posterior.

## POS MVP — Sprint 5

`product_categories`: UUID `id`, `business_id`, nombre obligatorio, `is_active`, timestamps; nombre único por negocio. No hay jerarquía. `products`: UUID `id`, `business_id`, nombre obligatorio, `barcode` nullable, `sale_price_cents` entero no negativo, `cost_price_cents` nullable entero no negativo, `category_id` nullable, `is_active`, timestamps. Índice único parcial `(business_id, barcode)` solo para códigos presentes; se permiten múltiples productos sin código. La FK compuesta `(business_id, category_id)` impide vincular categorías de otro negocio. La búsqueda exacta de scanner usa ese índice.

`sales`: UUID `id`, `business_id`, `branch_id`, `device_id` nullable, `created_by`, estado limitado a `completed`, `subtotal_cents`, `total_cents`, `payment_method` (`cash`, `debit`, `credit`, `transfer`, `other`) y timestamps. En este sprint total = subtotal. `sale_items`: UUID `id`, `business_id`, `sale_id`, `product_id` nullable, `product_name`, `barcode` nullable, `unit_price_cents`, `quantity` positiva y `total_cents`. Nombre, barcode y precio son snapshots: modificar Product no cambia la venta histórica. Las FK compuestas aíslan sale/product por negocio. El UUID es identidad; la UI solo muestra ocho caracteres como referencia visual sin valor fiscal.

SQLite usa UUID e instantes UTC como texto e importes `INTEGER`; Cloud usa UUID, `timestamptz` y `bigint`. Los importes se limitan al rango entero seguro de JavaScript. No hay campo global `stock` en Product. Desktop y Cloud guardan Sale + SaleItems en transacciones. Ninguna de estas tablas participa en Customer Sync.

## Sincronización POS — Sprint 6

La migración SQLite 0007 agrega `sync_origin`, `local_revision` y `cloud_updated_at` a ProductCategory y Product; Sale recibe `sync_origin`. `pos_sync_outbox` guarda una operación por `(business_id, entity_type, entity_id)` para categoría/producto y una por venta; `status` es `pending` o `conflict`. Los triggers crean la operación en la misma sentencia de cada cambio local. El backfill registra los datos POS anteriores. `pos_sync_cursor` guarda `(updated_at, entity_id)` por negocio y tipo `category`, `product`, `sale`. SaleItem no lleva cursor separado: su unidad de pull y push es la venta completa.

La migración Cloud `20260924000000_pos_sync.sql` agrega un reloj monotónico privado por negocio que gobierna `updated_at` de ProductCategory/Product en INSERT/UPDATE y Sale en INSERT. Los índices `(business_id, updated_at, id)` soportan pulls incrementales. `complete_pos_sale(jsonb,jsonb)` valida membership, usuario, totales y líneas, inserta Sale + SaleItems de forma atómica y verifica contenido en reintentos con el mismo UUID. Los clientes autenticados conservan SELECT bajo RLS pero no INSERT directo en Sales/SaleItems ni UPDATE de ventas completadas. FK compuestas de la migración POS base mantienen `business_id` coherente entre Sale, SaleItem, Product y Branch.

ProductCategory y Product usan comparación optimista con `cloud_updated_at`. El dato local y el snapshot Cloud se conservan al detectar un conflicto; la resolución explícita elige uno y vuelve a consultar Cloud. La unicidad de barcode por negocio sigue en SQLite y Cloud. Sale y SaleItems son históricamente inmutables y preservan UUID y snapshots de nombre, barcode, precio y cantidad.

## Futuro

`products.tracks_inventory` boolean/SQLite INTEGER se añade con default falso. `sale_items.tracks_inventory` captura si la línea nueva descuenta stock; las líneas existentes quedan en falso. No hay `products.stock`.

`inventory_balances`: `(business_id,branch_id,product_id)` PK, `quantity` entero con signo, `updated_at`. Cloud usa FK compuestas a Branch y Product del mismo Business. SQLite valida Product por FK compuesta y toma Branch del contexto autorizado o Sale; no depende de filas estructurales locales provisionales.

`stock_movements`: UUID `id`, Business, Branch, Product, `movement_type` (`initial`, `entry`, `adjustment`, `sale`), `quantity_delta` entero no cero, `sale_id`/`sale_item_id` opcionales solo para `sale`, nota, usuario, dispositivo opcional, `occurred_at`; Cloud asigna `received_at` y `created_at`. `sale_item_id` es único; en movimientos de venta el propio `id` coincide con SaleItem.id. Índice parcial limita un inicial por Product/Branch. El trigger de INSERT aplica el delta al balance atómicamente. No se permite editar ni eliminar un movimiento desde el cliente. Desktop tiene `stock_sync_outbox` y `stock_sync_cursor` separados.

Entidades previstas, aún no modeladas: Service, Resource, Booking, Event, Order, Payment, Supplier, Purchase, FrameMoulding y FrameQuote.

# Modelo de datos

## Identidad implementada en Sprint 2

| Entidad                 | Columnas                                                                                                                            | Restricciones principales                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Business (`businesses`) | `id`, `name`, `slug`, `created_at`, `updated_at`                                                                                    | UUID PK; `slug` único y normalizado.                                                                                                                   |
| Branch (`branches`)     | `id`, `business_id`, `name`, `is_active`, `created_at`, `updated_at`                                                                | UUID PK; FK a Business; nombre único por negocio.                                                                                                      |
| Device (`devices`)      | `id`, `business_id`, `branch_id`, `name`, `device_type`, `installation_id`, `is_active`, `last_seen_at`, `created_at`, `updated_at` | UUID PK; sucursal requerida y coherente con el negocio mediante FK compuesta; `installation_id` único; tipo restringido a `desktop`, `web` o `mobile`. |

Cloud usa UUID nativos y `timestamptz`. SQLite usa UUID como texto e instantes UTC ISO 8601; las dos representaciones se traducen a los mismos tipos de dominio. Los IDs se generan sin conexión cuando procede. `created_at` y `updated_at` se fijan al insertar; los futuros adaptadores de escritura deben renovar `updated_at` al modificar. `last_seen_at` es opcional y no implica que exista seguimiento en tiempo real.

La base Desktop mantiene también `app_meta` para `installation_id` y la selección provisional de Sprint 2. El seed Cloud es solo de desarrollo y crea CentroColor + Sucursal principal sin IDs fijos.

## Autenticación y autorización

| Entidad                     | Columnas                                                                                                                          | Restricciones                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                  | `id`, `display_name`, `created_at`, `updated_at`                                                                                  | `id` es PK y FK a `auth.users(id)`; se crea con trigger y se completan usuarios anteriores a la migración. No duplica email. |
| `business_memberships`      | `id`, `business_id`, `user_id`, `role`, `is_active`, `created_at`, `updated_at`                                                   | FK a Business y Auth; único `(business_id, user_id)`; rol limitado a `owner`, `admin`, `staff`.                              |
| SQLite `authorized_context` | `slot`, `user_id`, `display_name`, `business_id`, `business_name`, `branch_id`, `branch_name`, `role`, `last_cloud_validation_at` | Una copia local de la última autorización Cloud validada. No guarda contraseña ni token.                                     |

RLS permite `SELECT` de Business, Branch y Device solo con membership activo del negocio; Profile solo propio; Membership solo propio y activo. No hay escrituras cliente. La copia SQLite no está protegida por RLS y puede quedar obsoleta mientras está offline.

## Futuro

Entidades previstas, aún no modeladas: User, Customer, Product, Service, Resource, Booking, Event, Order, Sale, Payment, FrameMoulding y FrameQuote. Sus tablas se definirán incrementalmente. Considerarán `business_id`, `branch_id` y `device_id` donde corresponda, sin anticipar ahora su diseño.

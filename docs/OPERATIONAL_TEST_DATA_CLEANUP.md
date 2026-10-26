# Auditoría para limpiar datos operativos de prueba

Estado: propuesta estática, no ejecutada. No se consultó ni modificó la base remota.

## Alcance

La selección propuesta toma **todos** los `customers` del único `Business` cuyo `slug` es `centrocolor`. A partir de ellos incluye solamente las filas operativas necesarias para eliminar esos clientes sin romper claves foráneas.

Las migraciones versionadas muestran estas dependencias:

| Tabla a limpiar | Motivo |
| --- | --- |
| `customers` | Raíz solicitada. |
| `appointments` | FK directa a Customer. |
| `events` | FK directa a Customer. |
| `event_service_items` | Hija de Event. |
| `resource_reservations` | Hija de Event; no borra `resources`. |
| `led_panel_reservations` | Hija de Event y EventServiceItem; no borra pools, presets ni controladores. |
| `frame_quotes` | FK directa nullable a Customer. |
| `frame_quote_items` | Hija de FrameQuote; conserva catálogos de varillas/materiales. |
| `frame_jobs` | FK a FrameQuote y Customer. |
| `plotter_quotes` | FK directa nullable a Customer. No existe `plotter_jobs` en el esquema versionado. |
| `photo_jobs` | FK a Customer y opcionalmente a Appointment/Event. |
| `photo_job_items` | Hija de PhotoJob; no borra `photo_services`, variantes ni listas. |
| `photo_job_upload_links` | Hija de PhotoJob. |
| `photo_job_files` | Hija de PhotoJob/PhotoJobItem; sólo metadata, no binarios de Drive. |
| `photo_job_drive_folders` | Hija de PhotoJob. Es la única FK relevante con `ON DELETE CASCADE`, pero el script la borra explícitamente. |
| `public_photo_orders` | FK a PhotoJob y Customer. |
| `outbound_notifications` | FK a PhotoJob y Customer. |
| `outbound_notification_events` | Hija de OutboundNotification. |
| `work_payments` | FK directa a Customer y a Event/FrameJob/PhotoJob. No hay tablas Cloud con FK hacia `work_payments`. |

Los números reales no se pueden afirmar sin leer la base. El script [customer_test_data_audit.sql](sql/customer_test_data_audit.sql) devuelve el inventario real de tablas/FK y el conteo exacto por tabla, sin escrituras. El script [customer_test_data_cleanup.sql](sql/customer_test_data_cleanup.sql) congela el mismo alcance, borra en orden de hojas a padres, comprueba residuos y termina en `ROLLBACK`.

## Orden de borrado

1. `outbound_notification_events`
2. `outbound_notifications`
3. `work_payments`
4. `public_photo_orders`
5. `photo_job_files`
6. `photo_job_upload_links`
7. `photo_job_drive_folders`
8. `photo_job_items`
9. `photo_jobs`
10. `led_panel_reservations`
11. `resource_reservations`
12. `event_service_items`
13. `events`
14. `frame_jobs`
15. `frame_quote_items`
16. `frame_quotes`
17. `appointments`
18. `plotter_quotes`
19. `customers`

## Datos expresamente preservados

No se tocan `auth.users`, `profiles`, `business_memberships`, `businesses`, `branches`, `devices`, `products`, categorías, ventas POS, inventario, movimientos de stock, tipos de turno/evento, `resources`, catálogos de marquetería, `photo_services`, listas de precios, variantes/tramos de Laboratorio, materiales/tarifas Plotter, ofertas/tarifas de Eventos, pools/presets/controladores LED, configuración Google Drive, configuración WhatsApp, Vault, migraciones ni funciones.

La limpieza de metadata de archivos no elimina carpetas ni binarios de Google Drive. Tampoco elimina configuración ni auditoría ajena a los trabajos objetivo.

## Riesgo Desktop/offline

La base SQLite de Desktop conserva copias operativas y outboxes, y el sync no tiene tombstones de borrado. Una limpieza sólo en Cloud no limpia automáticamente cada Desktop; además, un outbox pendiente podría volver a subir datos. Antes de un COMMIT real hay que cerrar las Desktop, auditar sus outboxes y preparar una limpieza SQLite separada y filtrada por el mismo `business_id`. Esa limpieza local no forma parte de los scripts actuales.


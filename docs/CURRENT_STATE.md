# Estado actual

Sprint 4 — Clientes implementado en el repositorio el 20 de septiembre de 2026. La migración Cloud nueva todavía no se aplicó desde esta sesión ni se hizo una prueba de extremo a extremo con credenciales reales. Según el estado de producción comunicado por el usuario, Sprint 3 ya opera en producción: Supabase Auth, profiles, business_memberships y RLS; CentroColor, Sucursal principal y al menos un owner se inicializaron manualmente.

- `Customer` vive en domain con nombre obligatorio, email opcional validado y normalización básica. Application define un puerto único y casos de uso para listar, buscar, obtener, crear, editar, desactivar y reactivar.
- La nueva migración Cloud `20260921000000_customers.sql` crea tabla, índices, FK a Business, timestamps y RLS SELECT/INSERT/UPDATE para memberships activos. No se concede DELETE ni cambio de `business_id` desde el cliente.
- La migración SQLite incremental 0004 crea `customers` sin borrar datos existentes. Su `business_id` usa el ID autorizado Cloud; no hay FK a las antiguas filas estructurales locales provisionales.
- Web usa `SupabaseCustomerRepository`; Desktop usa `SQLiteCustomerRepository`. Ambas implementan el mismo puerto y usan una pantalla Clientes responsive compartida. La lista muestra hasta 100 filas y busca en la persistencia correspondiente por nombre, teléfono, email o documento.
- Desktop funciona con su contexto offline previamente validado. Las escrituras de Clientes permanecen locales, aun si hay Internet. Web escribe en Cloud. No existe Sync Engine ni tablas `sync_state` o `sync_outbox`; los clientes creados en una plataforma no aparecen automáticamente en la otra.
- `seed.sql` se usa solo en desarrollo. El bootstrap de producción de Business, Branch y primer owner fue manual. Ningún ID personal de owner está versionado.
- Los demás módulos siguen como placeholders. No se implementaron Catálogo, ventas, agenda, WhatsApp ni sincronización.

Las verificaciones ejecutadas y limitaciones se detallan en `HANDOFF.md`.

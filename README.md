# CentroColor

Fundación técnica, identidad, acceso, Clientes, POS, inventario, Agenda/Turnos, Eventos/Recursos, Marquetería, Trabajos fotográficos y pagos de trabajos Desktop/Web. Desktop (Tauri/SQLite) y Web (PWA/Supabase) comparten dominio, contratos y UI. Desktop guarda la operación en SQLite y sincroniza con Supabase tras validar una sesión Cloud; Web usa Supabase directamente. Desktop conserva operación sin Internet. Las migraciones Cloud posteriores a POS siguen pendientes de aplicación y validación operativa real.

## Requisitos

Node.js, pnpm 9, Rust con toolchain MSVC y los [prerrequisitos de Tauri para Windows](https://v2.tauri.app/start/prerequisites/) para ejecutar Desktop. Docker es necesario solo para la pila local de Supabase.

## Comandos

```sh
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm build:desktop
pnpm format:check
python tests/pos_sqlite.py
python tests/pos_sync_sqlite.py
python tests/inventory_sqlite.py
python tests/appointments_sqlite.py
python tests/appointments_cloud_sql.py
python tests/events_sqlite.py
python tests/events_cloud_sql.py
python tests/photo_sqlite.py
python tests/photo_cloud_sql.py
python tests/work_payments_sqlite.py
python tests/work_payments_cloud_sql.py
python tests/photo_file_intake_sqlite.py
python tests/photo_file_intake_cloud_sql.py
python tests/public_orders_sqlite.py
python tests/public_orders_cloud_sql.py
python tests/whatsapp_cloud_sql.py
pnpm exec supabase db push --dry-run
```

`pnpm build` compila los frontends Web y Desktop. `pnpm build:desktop` compila y empaqueta la aplicación nativa. La PWA se prueba instalable desde un servidor HTTPS o localhost con `pnpm --filter @centrocolor/web preview` luego de compilar.

`pnpm dev:desktop` usa Vite en desarrollo mediante `tauri.dev.conf.json`. `pnpm build:desktop` incorpora los assets de `apps/desktop/dist` al ejecutable Tauri y genera un instalador NSIS en `apps/desktop/src-tauri/target/release/bundle/nsis/`; el Desktop instalado no necesita Vite.

Para Web y Desktop, copiar el `.env.example` de cada app a `.env.local` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` del proyecto existente. En desarrollo, Web muestra un aviso explícito si falta configuración; el build Web ahora falla antes de generar un deployment inválido. No usar claves secretas ni `service_role` en el cliente.

Vite incorpora las variables `VITE_` al bundle **durante el build**. En Vercel deben estar asignadas al entorno del deployment que se construye; cambiar sus valores requiere un nuevo build/deploy. Web valida la URL y la clave pública antes de crear el cliente y muestra un error de configuración específico si faltan o son inválidas. La clave `sb_publishable_` es pública y puede estar en el frontend; nunca configurar una `sb_secret_` ni `service_role`.

Las migraciones Cloud y el seed local están en `supabase/`. Consultar `supabase/README.md` para validar con Docker y vincular/aplicar al proyecto remoto sin guardar secretos. El seed no se envía al remoto con `db push` normal.

La puesta en marcha de OAuth, Vault, Edge Functions y el portal de archivos de Sprint 13 está detallada en `docs/GOOGLE_DRIVE_SETUP.md`. Los secretos Google nunca se configuran en `VITE_` ni en Vercel.

Sprint 14 (pedidos públicos `/imprimir`, seguimiento `/pedido/:token` y avisos por WhatsApp): puesta en marcha en `docs/PUBLIC_ORDERS_SETUP.md` y `docs/WHATSAPP_SETUP.md`. `pnpm test` ejecuta las migraciones reales en PGlite (PostgreSQL embebido), sin Docker. El token de WhatsApp se guarda sólo en Supabase Vault; nunca en `VITE_`, Vercel, SQLite ni el repositorio.

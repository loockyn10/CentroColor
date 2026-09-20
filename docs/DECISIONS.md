# Decisiones arquitectónicas aprobadas

1. **Dos clientes en un workspace pnpm.** Desktop usa Tauri 2; Web usa Vite con soporte PWA. Comparten `domain`, `application`, `ui` y `features` para evitar duplicación.
2. **Persistencia por plataforma.** SQLite local es la fuente primaria de operación de Desktop. Supabase/PostgreSQL es la fuente central compartida prevista para Web; el adaptador existe, pero el acceso a filas espera autenticación y políticas RLS.
3. **Separación mediante puertos.** `application` define contratos; cada app aloja su adaptador concreto. `domain` permanece en TypeScript puro, sin React, Tauri, SQLite ni Supabase.
4. **Modelo incremental.** Sprint 1 creó `app_meta`; Sprint 2 añade solo Business, Branch y Device. Las entidades futuras considerarán `business_id`, `branch_id` y, para sincronización, `device_id` cuando corresponda.
5. **Sincronización diferida.** El futuro flujo Desktop SQLite ↔ Sync Engine ↔ Supabase se documenta, sin implementar colas ni resolución de conflictos en este sprint.
6. **Sucursal obligatoria para Device.** Cada Device pertenece a una Branch del mismo Business; una FK compuesta impide vínculos cruzados. No hay razón actual para permitir dispositivos sin sucursal.
7. **Identificadores y tiempos.** UUID generables localmente permiten identidad offline. Cloud guarda `timestamptz`; Desktop guarda UTC ISO 8601. La instalación Desktop posee un UUID persistente separado del ID del registro Device.
8. **RLS cerrada hasta autenticación.** Las tablas Cloud habilitan RLS y revocan acceso a `anon` y `authenticated`, sin políticas permisivas temporales. El seed se limita a desarrollo y no se aplica automáticamente al remoto.
9. **Bootstrap Desktop provisional.** Una instalación sin contexto crea CentroColor, Sucursal principal y un Device local con IDs generados; el mecanismo también corre en el build de producción hasta que se implemente onboarding. La selección queda centralizada en `app_meta` y se reutiliza al reiniciar.

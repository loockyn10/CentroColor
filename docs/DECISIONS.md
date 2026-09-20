# Decisiones arquitectónicas aprobadas

1. **Dos clientes en un workspace pnpm.** Desktop usa Tauri 2; Web usa Vite con soporte PWA. Comparten `domain`, `application`, `ui` y `features` para evitar duplicación.
2. **Persistencia por plataforma.** SQLite local es la fuente primaria de operación de Desktop. Supabase/PostgreSQL será la fuente central compartida y la fuente primaria futura de Web. El acceso cloud aún no está implementado.
3. **Separación mediante puertos.** `application` define contratos; cada app aloja su adaptador concreto. `domain` permanece en TypeScript puro, sin React, Tauri, SQLite ni Supabase.
4. **Modelo incremental.** En Sprint 1 solo se crea `app_meta`. Las entidades futuras considerarán `business_id`, `branch_id` y, para sincronización, `device_id` cuando corresponda. No se anticipan tablas de negocio.
5. **Sincronización diferida.** El futuro flujo Desktop SQLite ↔ Sync Engine ↔ Supabase se documenta, sin implementar colas ni resolución de conflictos en este sprint.

# Arquitectura

## Clientes y código compartido

- `apps/desktop`: React/Vite dentro de Tauri 2. SQLite local permite iniciar con un contexto autorizado previamente; Supabase valida el primer acceso.
- `apps/web`: React/Vite configurada como PWA. Tiene cliente y repositorios Supabase aislados en su propia capa de infraestructura. Supabase/PostgreSQL es la fuente primaria de identidad Web y sus consultas están protegidas por RLS.
- `packages/domain`: TypeScript puro para Business, Branch, Device, Profile, BusinessMembership y Customer; no depende de infraestructura ni UI.
- `packages/application`: contratos de repositorios y resolución del contexto actual. Los adaptadores de cada cliente implementan sus puertos; la UI compartida no consulta SQLite ni Supabase.
- `packages/ui`: AppShell, navegación, componentes básicos y CSS responsive compartidos.
- `packages/features`: Login, estados de acceso, Inicio, Clientes y una pantalla placeholder compartidos.

Los adaptadores SQLite y Supabase residen en cada app. Clientes es la primera persistencia de operación: Web escribe en Supabase y Desktop en SQLite. No hay sincronización. La migración Cloud de Clientes se mantiene versionada y requiere aplicación manual.

## Identidad estructural

El adaptador estructural de Sprint 2 conserva la capacidad de crear un `installation_id` y entidades locales provisionales, pero ya no se invoca al iniciar la UI. El acceso actual se decide con BusinessContext derivado de Supabase o de su última copia validada en SQLite. Los IDs Cloud no se sustituyen por los IDs provisionales locales.

Business, Branch y Device tienen representación tanto en Cloud como en SQLite. Profiles y memberships viven en Cloud; SQLite guarda solo una copia del contexto autorizado. Los adaptadores traducen entre columnas `snake_case` y tipos TypeScript `camelCase`. Los IDs estructurales son UUID generables sin conexión. Cloud usa `timestamptz` y SQLite guarda instantes UTC ISO 8601 como texto; `created_at` se fija al insertar y los futuros escritores deberán actualizar `updated_at` en cada modificación. No hay versionado ni resolución de conflictos.

Supabase Auth (`auth.users`) es la identidad Cloud. `profiles` conserva únicamente el nombre visible; `business_memberships` vincula usuario, negocio y rol (`owner`, `admin`, `staff`). El adaptador Cloud de cada cliente carga perfil, memberships activos, negocios y sucursales permitidos. `resolveBusinessContext` en `application` selecciona un contexto coherente y el proveedor React compartido lo entrega a las pantallas. Sin membership activo se muestra “Sin acceso asignado”. Web persiste la sesión en `localStorage` del origen mediante el SDK de Supabase para restaurarla al recargar. Desktop mantiene la sesión Supabase únicamente en memoria.

RLS protege las cinco tablas de identidad Cloud mediante lecturas limitadas al propio perfil/membership o a negocios con membership activo. El helper `private.has_active_membership` usa `SECURITY DEFINER`, `search_path` vacío y `auth.uid()`; solo `authenticated` puede ejecutarlo. Clientes añade SELECT, INSERT y UPDATE bajo ese mismo criterio, sin DELETE. Las altas de usuarios y memberships son administrativas. `owner` representa control administrativo completo, `admin` operación completa salvo futuras reservas del owner y `staff` operación diaria. El rol queda disponible en BusinessContext, sin matriz granular de permisos aún.

Desktop copia a SQLite únicamente el contexto autorizado tras una validación Cloud: IDs de usuario, negocio y sucursal, nombres visibles, rol y fecha de validación. Al reiniciar lo carga como `offline-authenticated`, incluso si no hay Internet. Ese estado permite la UI local; ninguna operación Cloud debe usarse hasta revalidar con Supabase. La sesión y los tokens Desktop no se escriben en disco; revalidar requiere ingresar credenciales de nuevo. Cerrar sesión borra la copia local. RLS protege datos Cloud, no SQLite: el archivo local pertenece al dispositivo y la autorización offline depende de la aplicación. Un PIN o bloqueo de estación puede añadirse más adelante si el riesgo local lo exige. No hay Sync Engine.

## Offline first y futura sincronización

Desktop SQLite ↔ futuro Sync Engine ↔ Supabase/PostgreSQL. Tras una primera validación Cloud, Desktop no necesita consultar Cloud para iniciar o usar Clientes. El motor futuro deberá manejar identidad de dispositivo (`device_id`), conflictos, reintentos y estado de cambios; no se implementa aquí. El build Web genera manifest y service worker que precachea el shell. Web requiere conexión para operar Clientes y no se ha comprobado la instalación manual de la PWA desde un navegador.

La base local conserva `app_meta`, `businesses`, `branches` y `devices`, y añade `authorized_context` mediante una tercera migración y `customers` mediante la cuarta. No existen `sync_state` ni `sync_outbox`: para sincronizar Clientes habrá que definir cola durable de cambios locales, identidad de dispositivo, transferencia autenticada, checkpoint de descarga, reintentos, deduplicación y política de conflictos. Los UUID y timestamps ya son compatibles conceptualmente, pero no transportan cambios entre plataformas por sí solos.

El contrato `CustomerRepository` en application ofrece lectura, búsqueda, alta, edición y cambio de estado, siempre con `businessId` del contexto autenticado. La UI responsive en features no conoce los adaptadores. Los listados devuelven como máximo 100 filas y buscan en servidor/base local. En Desktop, el contexto offline validado previamente autoriza operaciones locales; la revocación remota no puede aplicarse mientras el equipo está desconectado.

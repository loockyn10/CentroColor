# Handoff

## Punto de reanudación

Revisar y aplicar por el flujo administrativo, en este orden, `20260923000000_pos_mvp.sql` y `20260924000000_pos_sync.sql`. El dry-run remoto mostró ambas como pendientes y no aplicó cambios. La migración base POS ya incluye la clave UNIQUE `(business_id, id)` de `devices` que faltó en un intento remoto anterior. Probar la ejecución SQL en PostgreSQL antes o durante ese flujo; el daemon Docker local no estuvo disponible en esta sesión. No usar `service_role` en clientes ni enviar seed al remoto.

Tras aplicar el esquema, validar con usuario y membership reales los casos Desktop offline Product → Sale → reconexión → Web, Web Product → pull Desktop → venta, Web Sale → historial Desktop y Desktop Sale → historial Web. Probar conflicto de ProductCategory/Product, barcode repetido por negocio, reintento tras interrupción de red y que Customer Sync continúa en ambos sentidos. Hacer prueba manual de scanner HID en el equipo del local y UI móvil táctil. Ninguna de estas pruebas operativas se declara completada.

## Implementación Sprint 6

`packages/application/src/pos-sync.ts` coordina el push y pull por tipo. `apps/desktop/src/sqlite-pos-sync-adapter.ts` usa el outbox y cursores POS de la migración SQLite 0007; `apps/desktop/src/cloud-pos-sync-adapter.ts` usa Supabase. Customer Sync permanece separado. Las categorías se sincronizan antes que productos, y las ventas después. El pull no genera outbox. ProductCategory/Product usan versión `updated_at` Cloud y resolución explícita de divergencias desde el indicador Desktop.

La RPC `complete_pos_sale` inserta Sale y SaleItems en una transacción, valida membership/usuario/sumas/FK y acepta reintento idéntico con el mismo UUID sin duplicar. El comando Tauri `apply_remote_sale` inserta o verifica una venta Cloud y sus líneas en una transacción SQLite. `sales.updated_at` es el cursor del bundle; no hay pull independiente de SaleItem. Los snapshots históricos se mantienen.

Web usa `SupabaseProductRepository` y `SupabaseSaleRepository` con sesión normal y RLS. Los placeholders de Productos, Nueva venta y Ventas se reemplazaron por las features compartidas. Desktop sigue consultando y guardando en SQLite sin depender de red. Web sigue online-first.

## Verificación y límites

Ver `CURRENT_STATE.md` para la lista de verificaciones de esta sesión. El dry-run enumera migraciones pendientes, pero no prueba que el SQL ejecute ni modifica Cloud. El test Python valida migración y triggers SQLite, y las pruebas Vitest cubren orquestación, conflicto, reintento y adaptadores Web. Falta prueba end-to-end contra Supabase real y prueba manual del dispositivo. Stock sigue fuera de alcance. No iniciar otro sprint sin nueva solicitud.

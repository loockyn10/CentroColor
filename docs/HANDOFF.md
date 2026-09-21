# Handoff

## Punto de reanudación

Revisar y aplicar manualmente la migración Cloud `20260923000000_pos_mvp.sql` mediante el flujo administrativo. Un intento remoto previo falló con PostgreSQL `42830`: `sales` referenciaba `devices(business_id, id)` sin una UNIQUE explícita sobre ese par. La migración pendiente ahora agrega `devices_business_id_id_unique` antes de crear `sales`; no se modificaron migraciones ya aplicadas ni se ejecutó un nuevo push remoto en esta sesión. Después, probar manualmente Desktop en el local: scanner HID con Enter, alta rápida, producto sin código, cantidades, cobro, historial y operación sin Internet. No afirmar que esa prueba operativa ya ocurrió.

## Implementación

`packages/domain` contiene Product, ProductCategory, CartLine, Sale y SaleItem y reglas de validación con centavos enteros. `packages/application/src/pos.ts` contiene puertos y casos de uso. `SQLiteProductRepository` implementa catálogo y lookup exacto por `(business_id, barcode)` en SQLite. `SQLiteSaleRepository` llama al comando Tauri `complete_local_sale`; el comando valida totales y persiste Sale y SaleItems en **una** transacción SQLite con foreign keys activas. La UI Desktop de Productos, Nueva venta e Historial vive en `packages/features/src/pos.tsx`. Web conserva esas entradas como placeholders.

Al escanear, el input con foco recibe caracteres del lector HID y Enter. Se normalizan espacios externos, se consulta SQLite exactamente por barcode y negocio, y se agrega o incrementa la línea. Un código desconocido abre alta rápida con barcode bloqueado; guardar crea el producto local y lo agrega. Tras agregar o cerrar los modales se devuelve el foco al campo. La búsqueda manual por nombre usa una lista con retraso breve y selección por flechas/Enter o mouse; Enter sin selección prioriza lookup exacto. Un producto inactivo muestra error y se reactiva desde Catálogo.

La venta se mantiene local. Al confirmar se generan UUID de Sale y SaleItems, se toman nombre/barcode/precio como snapshot y se insertan juntos. Si falla la transacción, el carrito permanece visible. El identificador de ocho caracteres mostrado es solo abreviatura del UUID, **no** numeración fiscal. El usuario de ventas históricas ajenas se muestra por UUID abreviado porque aún no hay caché local de perfiles históricos.

## Customer Sync y Sprint 7

Customer Sync sigue funcional y, según el usuario, fue probada en ambos sentidos. No se tocaron `customer-sync.ts`, los adaptadores de Customer, outbox, cursor ni el ciclo programado. `sync_outbox` restringe `entity_type` a `customer`, por lo que Product/Sale no se registran. Para Sprint 7 pueden reutilizarse la idea de outbox atómico, UUID offline, cursor `(updated_at, id)`, comparación de versión Cloud, validación de sesión/membership y UI de conflictos. Habrá que diseñar entidades y cursores propios y decidir orden transaccional para Sale/SaleItems; no se debe extender Customer Sync cambiando su semántica a ciegas. El reloj Cloud por negocio de Customer puede causar contención si se generaliza y requiere evaluación.

## Verificación y límites

Pasaron typecheck, lint, 40 pruebas Vitest, build Web/Desktop, format:check, build nativo con MSI y NSIS y test SQLite del esquema POS. El test SQLite cubre barcode único por negocio, productos sin barcode, separación de negocio, rollback y snapshots. El dry-run Cloud solo verifica el plan de migraciones; **no valida la ejecución SQL ni aplicó la migración**. No hubo prueba visual/interactiva de scanner real, sesión offline en un equipo del local ni cuenta Cloud para el nuevo esquema.

La validación dirigida `tests/pos_cloud_fk.py` comprueba que las cinco FK compuestas nuevas tienen una clave UNIQUE correspondiente, incluida `devices(business_id, id)`. `supabase db lint --local` no pudo conectarse porque no hay PostgreSQL local activo en `127.0.0.1:54322`; por lo tanto, la migración corregida aún no se ejecutó contra PostgreSQL en esta sesión.

El POS Desktop opera en SQLite aunque Supabase no esté disponible, sujeto a la autorización offline ya existente. Product, Sale e inventario no se sincronizan; Web no ve esos datos Desktop. No hay stock, devoluciones, promociones, impresión, pagos divididos ni identificación fiscal.

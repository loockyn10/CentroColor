# Handoff

## Punto de reanudación

Sprint 7 está implementado en código. **No aplicar automáticamente** `supabase/migrations/20260925000000_inventory.sql`: la consigna pidió dry-run y flujo versionado, sin push real. El historial remoto consultado el 21/9/2026 tiene aplicadas todas las migraciones previas (`20260919000000` a `20260924000000`); el dry-run enumera únicamente inventario, sin seed ni roles. La discrepancia histórica del objeto `devices_business_id_id_unique` no se ha explicado con una inspección del esquema remoto, aunque las migraciones POS aparecen aplicadas.

Tras revisar y aplicar la migración de inventario por el flujo administrativo, probar con usuario owner/admin y staff reales: inicial 10 → venta 2 → entrada 5 → ajuste a 11, aviso y venta con stock negativo, venta Desktop offline → reconexión → Web, entrada Web → pull Desktop, retry del mismo SaleItem y UUID de movimiento. Validar aislamiento entre negocios/sucursales y RLS contra PostgreSQL real. No hay daemon Docker local en este entorno; la migración Cloud nueva no fue ejecutada en una base de prueba.

## Implementación

`packages/domain/src/inventory.ts` define Balance y Movement. `packages/application/src/inventory.ts` y `stock-sync.ts` alojan puertos y reglas comunes. Adaptadores concretos viven en Desktop y Web. SQLite 0008 y Cloud `20260925000000_inventory.sql` modelan el ledger. `SaleItem.tracks_inventory` captura si la línea descontó stock; valores anteriores son falsos. El movimiento `sale` usa el UUID de SaleItem. La venta y su descuento son una transacción SQLite o PostgreSQL; Sale Sync no crea una segunda identidad. El balance se deriva de movimientos, y el cursor Cloud usa `received_at` gobernado por servidor.

`packages/features/src/stock.tsx` habilita la pantalla Stock compartida. Productos permite activar/desactivar tracking; el POS muestra stock controlado y advierte sin bloquear ventas que pueden dejar negativo. El estado Sync Desktop suma los pendientes de stock. No se añadieron módulos de compras/proveedores ni otros fuera de alcance.

## Verificación y límites

Ver `CURRENT_STATE.md` para resultados exactos. Los comandos `pnpm` del entorno invocaron pnpm 11 y quisieron reinstalar el workspace declarado con pnpm 9; se usaron herramientas locales equivalentes. El último build release Desktop generó NSIS después de los cambios de Rust/UI. Ninguna prueba declara validado el comportamiento del nuevo SQL Cloud; el dry-run solo enumera migraciones. La autorización offline de Desktop depende de su contexto local ya validado. Iniciales concurrentes requieren revisión manual en sync. El historial muestra UUID abreviado de usuario.

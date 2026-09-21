# Estado actual

Sprint 5 — POS MVP Desktop implementado en código el 20 de septiembre de 2026. El esquema Cloud nuevo **no se aplicó**. El build Desktop, las pruebas automatizadas y el dry-run Supabase pasaron; falta una prueba manual del flujo de scanner y cobro en un equipo del negocio, con y sin Internet.

- Desktop: Productos y categorías en SQLite; alta manual sin barcode, búsqueda, edición y cambio de estado. Nueva venta consulta SQLite por barcode exacto al recibir Enter, ofrece alta rápida ante un código desconocido, añade al carrito y permite búsqueda manual por nombre. Carrito y cobro usan centavos enteros. Sale y SaleItems se guardan en una transacción SQLite; el historial local muestra snapshots inmutables. El carrito se conserva en `sessionStorage` durante la sesión de la ventana.
- Las tablas SQLite nuevas son la migración incremental `0006_pos.sql`. No se alteraron migraciones anteriores ni se borraron datos.
- Cloud: `20260923000000_pos_mvp.sql` define products, product_categories, sales y sale_items con FK, constraints, índices y RLS por membership. La migración sigue pendiente de aplicación remota. No existe adaptador Web para estas entidades.
- Customer Sync **sí existe** y, según la confirmación del usuario, fue probada manualmente en ambos sentidos Desktop→Web y Web→Desktop. El código de sincronización de Customer y sus migraciones anteriores no se modificaron. El dry-run remoto ya no enumera la migración de timestamps de Customer como pendiente.
- Product Sync **no existe**. Sales Sync **no existe**. Inventory/Stock **no está implementado**. El indicador de sincronización Desktop sigue refiriéndose exclusivamente a Customer.
- Verificaciones: `pnpm typecheck`, `pnpm lint`, `pnpm test` (40 pruebas), `pnpm build`, `pnpm format:check`, `pnpm build:desktop` y `python tests/pos_sqlite.py` pasaron. `pnpm exec supabase db push --dry-run` conectó y mostró solo `20260923000000_pos_mvp.sql`, sin seeds ni roles. El build nativo emitió el aviso habitual del linker y un aviso de tamaño de chunk Vite, sin fallar.

El estado detallado y el punto de reanudación están en `HANDOFF.md`.

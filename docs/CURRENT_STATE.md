# Estado actual

Sprint 7 implementado en código el 21 de septiembre de 2026. Desktop y Web/PWA comparten pantalla Stock, control de inventario en Product, stock en POS, aviso por insuficiencia y descuento por venta. Desktop escribe SQLite offline; Web usa Supabase online. **La migración Cloud de inventario `20260925000000_inventory.sql` está pendiente de aplicar**; la funcionalidad Web y el sync de stock no están operativos en el remoto hasta entonces. No se hizo push real.

## Hechos verificados

- La CLI `supabase migration list` del proyecto vinculado muestra `20260919000000` a `20260924000000` tanto en local como remoto. Esto corrige la documentación previa que decía que POS aún no estaba aplicado. No explica por sí solo el origen de la relación remota `devices_business_id_id_unique` detectada antes ni prueba un flujo POS real.
- `supabase db push --dry-run` enumera solo `20260925000000_inventory.sql`, sin seed ni roles. Es planificación: no ejecuta el SQL nuevo.
- SQLite 0008 agrega `tracks_inventory=false` a Product y SaleItem, balances por Business/Branch/Product, movimientos con UUID, outbox y cursor de recepción. Triggers generan movimientos de venta a partir de las líneas nuevas y actualizan balance en la misma transacción. Las ventas anteriores no generan movimientos.
- Cloud `20260925000000_inventory.sql` contiene FK compuestas, RLS de lectura, RPC para cambios manuales y extensión de `complete_pos_sale`. Está preparado para aplicar; no fue ejecutado ni validado en PostgreSQL local o remoto.
- `SaleItem.id` es el UUID de su movimiento `sale`. Sale Sync crea el movimiento Cloud por trigger y el posterior push de StockMovement reconoce el mismo UUID. Pull repetido no vuelve a aplicar delta en SQLite. Product `tracks_inventory` viaja con el sync mutable y conserva su resolución de conflictos existente.
- Owner/admin puede activar tracking, cargar inicial, entradas y ajustes; staff ve stock y vende. El control se valida en la UI, en el comando local y en la RPC Cloud. El balance admite negativos; el POS muestra aviso sin bloquear.
- La pantalla Stock muestra catálogo, categoría, estado de control, balance de la sucursal, movimientos y acciones manuales. La UI usa BusinessContext/BranchContext; no expone un selector de otros negocios o sucursales.
- `pnpm` provisto por este entorno es versión 11.19.0 y trató de reinstalar dependencias al ejecutar scripts del workspace (declarado con pnpm 9.6.0). Se ejecutaron las herramientas locales equivalentes directamente para evitar modificar `node_modules`.

## Verificación de esta sesión

- `tsc --noEmit` para domain, application, features, desktop y web: pasa.
- `eslint .`: pasa.
- `vitest run --configLoader runner`: 52 pruebas en 20 archivos, pasa. Preserva las pruebas Customer/Product/Sale y añade pruebas de inventario/sync.
- `tests/inventory_sqlite.py`, `tests/pos_sqlite.py`, `tests/pos_sync_sqlite.py`, `tests/pos_cloud_fk.py`: pasan. Inventory SQLite cubre saldo inicial, entrada, ajustes positivos/negativos, varios productos en venta, producto sin tracking, UUID repetido, pull sin outbox, negativos, aislamiento Business/Branch y restricción local de tracking para staff.
- `cargo check --offline`: pasa. Los builds de frontends Web y Desktop con Vite pasan. El build release Desktop posterior a los cambios de Rust/UI generó el instalador NSIS `CentroColor_0.1.0_x64-setup.exe`.
- Falta prueba SQL real de la migración nueva por ausencia de daemon Docker local. Falta prueba end-to-end con usuario, membership, dispositivos reales y red intermitente. El dry-run no sustituye estas pruebas.

## Límites

La app Desktop sigue dependiendo de una copia local de autorización para operar offline; la revocación remota no se conoce hasta revalidar. Un stock inicial concurrente desde dos dispositivos genera un pendiente con error para revisión, ya que fusionar dos conteos físicos sumándolos sería incorrecto. El historial muestra el UUID abreviado del usuario porque Profile de otros usuarios no forma parte de la sincronización local. No se implementaron proveedores, compras, transferencias, devoluciones, reservas ni módulos fuera del Sprint 7.

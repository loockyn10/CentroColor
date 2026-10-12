# Roadmap

1. Sprint 1 — Fundación técnica. Completado.
2. Sprint 2 — Identidad, negocio, sucursal y dispositivos. Completado.
3. Sprint 3 — Supabase Auth, profiles, memberships, RLS y acceso offline Desktop. Completado.
4. Sprint 4 — Customers en Web/Supabase y Desktop/SQLite. Completado.
5. Customer Sync — Sincronización bidireccional Desktop↔Cloud de Customer. Implementada y, según el usuario, probada manualmente en ambos sentidos.
6. Sprint 5 — POS MVP Desktop: Products, ProductCategories, carrito, Sales y SaleItems locales; esquema Cloud preparado. Implementado en código; prueba operativa manual pendiente.
7. Sprint 6 — ProductCategory/Product y Sale/SaleItem Sync Desktop↔Cloud; Productos, Nueva venta e Historial en Web/PWA con paridad funcional. Implementado en código; migraciones Cloud registradas como aplicadas, validación operativa pendiente.
8. Sprint 7 — Inventario por sucursal, ledger de movimientos, descuento por venta y sincronización Desktop↔Cloud. Implementado en código; migración Cloud y validación operativa pendientes.
9. Sprint 8 — Agenda + Turnos, AppointmentTypes, estados, Customers, Día/Semana, dashboard y sync Desktop↔Cloud. Implementado en código; migración Cloud y validación operativa pendientes.
10. Sprint 9 — Events, EventTypes, snapshots de servicios, Resources físicos, ResourceReservations, disponibilidad, prevención Cloud de double booking, conflicto offline y paridad Desktop/Web. Implementado en código; migración Cloud y validación operativa pendientes.
11. Siguiente sprint — Por definir mediante una solicitud nueva. Pagos/señas, contratos, facturación, personal asignado, logística avanzada, Marquetería y demás módulos siguen fuera de alcance.

Customer Sync ✅ existente y probado según el usuario. POS Sync y Web POS ✅ en código y con migraciones Cloud POS registradas como aplicadas; falta prueba operativa real. Inventory/Stock ✅ en código; migración Cloud `20260925000000` pendiente. Agenda/Turnos ✅ en código; migración Cloud `20261011000000` pendiente. Eventos/Recursos ✅ en código; migración Cloud `20261012000000` pendiente. El último intento de CLI documentado no pudo actualizar el historial ni completar el dry-run porque el endpoint de rol de login respondió 403.

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
10. Siguiente sprint — Por definir mediante una solicitud nueva. Events complejos, reservas de recursos, marquetería, notificaciones, pagos de turnos y demás módulos siguen fuera de alcance.

Customer Sync ✅ existente y probado según el usuario. POS Sync y Web POS ✅ en código y con migraciones Cloud POS registradas como aplicadas; falta prueba operativa real. Inventory/Stock ✅ en código; migración Cloud `20260925000000` pendiente. Agenda/Turnos ✅ en código; migración Cloud `20261011000000` pendiente. El 11/10/2026 la CLI no pudo actualizar el historial ni completar el dry-run porque el endpoint de rol de login respondió 403.

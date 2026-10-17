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
11. Sprint 10 — Marquetería: varillas, materiales, cotizador opening, presupuestos snapshot, trabajos, sync incremental y permisos. Implementado en código; migraciones Cloud y validación operativa real pendientes.
12. Sprint 11 — PhotoServices, PhotoJobs, items snapshot, cola de producción, Dashboard, operación offline y sync Desktop↔Cloud. Implementado en código; migración Cloud y validación operativa real pendientes.
13. Sprint 12 — WorkPayment común para Event/FrameJob/PhotoJob, señas/pagos/refunds, anulación auditada, saldo, Customer account, Dashboard, offline y concurrencia Cloud. Implementado en código; migración Cloud y validación operativa real pendientes.
14. Sprint 13 — Portal público de archivos PhotoJob, Google Drive OAuth/Vault, upload resumable directo, metadata, manifest, colas Laboratorio/Edición y sync Desktop sin binarios. Implementado en código; migración, secrets, deploy de Edge Functions y validación real con Google pendientes.
15. Sprint 14 — Pedidos públicos autoservicio (`/imprimir`), seguimiento (`/pedido/:token`), catálogo público sobre PhotoService, borradores invisibles, WhatsApp Cloud API con OutboundNotification idempotente, reintento/reenvío auditado, webhook de recibos y aviso desde la nube para cambios hechos en Desktop offline. Implementado en código; migraciones, funciones, Meta y validación real pendientes.
16. Siguiente sprint — Por definir mediante una solicitud nueva. Login/galería/entrega digital de cliente, Event/FrameJob files, integración WorkPayment↔POS, contratos, facturación, caja/contabilidad, personal asignado, logística avanzada y stock específico de marquetería siguen fuera de alcance.

Customer Sync ✅ existente y probado según el usuario. POS Sync y Web POS ✅ en código y con migraciones Cloud POS registradas como aplicadas; falta prueba operativa real. Inventory/Stock, Agenda, Eventos, Marquetería, Fotografía, WorkPayment y portal Drive ✅ en código; sus migraciones Cloud posteriores a POS requieren revisión/aplicación según el dry-run documentado en CURRENT_STATE.

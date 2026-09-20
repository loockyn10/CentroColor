# Modelo de datos conceptual

Entidades futuras principales: Business, Branch, Device, User, Customer, Product, Service, Resource, Booking, Event, Order, Sale, Payment, FrameMoulding y FrameQuote.

El modelo se definirá incrementalmente conforme se implementen las funciones. Las entidades de negocio deberán considerar `business_id` y, cuando corresponda, `branch_id`; la infraestructura de sincronización deberá contemplar `device_id`. No se definen tablas ni relaciones definitivas en este sprint. La única tabla técnica actual es `app_meta` en SQLite local.

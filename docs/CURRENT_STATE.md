# Estado actual

Sprint 12 — Señas, pagos y saldos de trabajos quedó implementado en código el 16 de octubre de 2026. Event, FrameJob y PhotoJob comparten `WorkPayment`; Web opera mediante Supabase/RPC y Desktop persiste en SQLite, funciona offline y sincroniza después de sus fuentes. No se modificó Sale/POS y no se ejecutó ningún push real ni SQL manual.

El dry-run remoto se completó correctamente el 16/10/2026. El proyecto vinculado reconoce las migraciones anteriores y reporta únicamente `20261016000000_work_payments.sql` pendiente. El comando fue sólo `db push --dry-run`; la migración de pagos no fue aplicada.

## Sprint 12 implementado

- `WorkPayment` usa UUID estable, Business, Branch, Customer, tipo de fuente y tres FK reales nullable con exactamente una presente para Event/FrameJob/PhotoJob. Dinero se guarda en centavos enteros.
- Tipos `deposit`, `payment` y `refund`; medios `cash`, `transfer`, `debit_card`, `credit_card`, `mercado_pago`, `other`; estados `posted`/`voided`.
- El ledger es append-only. No existe DELETE ni edición silenciosa de importe/fuente/medio/fecha. Owner/admin anula con actor, instante y motivo obligatorio; staff puede cobrar y consultar, pero no anular.
- Event deriva total de servicios+reservas activas; FrameJob usa el total snapshot de su presupuesto; PhotoJob deriva items activos. Pagado neto = señas+pagos posted−refunds posted; anulados no cuentan; saldo = total−neto.
- SQLite y Cloud bloquean sobrepago y refund superior al neto pagado. Cloud usa RPC transaccional y advisory lock por fuente, por lo que dos clientes concurrentes no consumen el mismo saldo.
- Desktop guarda altas/anulaciones en `work_payment_sync_outbox`, hace pull incremental por `(updated_at,id)`, reintenta por UUID y evita loops con `sync_origin='remote'`. Un rechazo financiero Cloud queda en conflicto, se conserva localmente y deja de afectar el saldo operativo; owner/admin puede resolverlo anulándolo sin borrar historial.
- Event, FrameJob y PhotoJob muestran cuenta, total/pagado/saldo, historial y acciones de cobro/refund. Saldo cero muestra PAGADO. Las fuentes canceladas con neto recibido muestran advertencia y no generan devolución automática.
- Customer muestra fuentes con saldo, total/pagado/saldo, estado, pagos recientes y saldo total positivo de fuentes no canceladas.
- Dashboard muestra a owner/admin saldo pendiente agregado y cantidad de trabajos; staff conserva acceso al saldo del trabajo que opera.
- Migraciones incrementales: SQLite `0014_work_payments.sql` y Supabase `20261016000000_work_payments.sql`. La tabla Cloud sólo concede SELECT directo; altas/anulaciones pasan por RPC autenticadas. No hay `service_role` cliente.

## Verificación de esta sesión

- `pnpm typecheck`: pasa en los seis paquetes/apps compilables.
- `pnpm lint`: pasa.
- `pnpm test`: 79 pruebas en 30 archivos, pasa. Incluye cálculo financiero y orquestador de sync WorkPayment.
- Regresión Python completa: Customer Sync, POS, POS Sync/FK Cloud, Inventory, Appointments SQLite/Cloud, Events SQLite/Cloud, Photo SQLite/Cloud y WorkPayment SQLite/Cloud, pasa.
- `pnpm build`: pasa. Warnings no bloqueantes por chunks mayores a 500 kB: Web 616.65 kB; Desktop 727.34 kB.
- `pnpm format:check`: pasa.
- `pnpm build:desktop`: pasa tras permitir la descarga oficial de NSIS; genera `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. Rust informa sólo el warning del linker al crear la import library.
- `git diff --check`: sin errores; sólo avisos LF→CRLF del checkout Windows.
- `pnpm exec supabase db push --dry-run`: pasa y propone únicamente `20261016000000_work_payments.sql`; no aplica nada.

## Límites y deuda

La migración Cloud de pagos no fue aplicada ni probada contra escrituras PostgreSQL reales. Falta validar con owner/admin/staff, dos sesiones concurrentes y un Desktop realmente desconectado que el segundo cobro del último saldo queda en conflicto y se resuelve por anulación. El chequeo Cloud automatizado actual inspecciona estructura SQL; no sustituye una ejecución de la migración.

La ficha de la fuente muestra conflictos financieros, pero no existe un centro global de resolución de conflictos WorkPayment. Las consultas Customer/Dashboard componen cuentas fuente por fuente; a alto volumen convendrá una vista/RPC agregada. Los listados priorizan no ensanchar tablas y muestran el estado financiero en el detalle. Cambiar a la baja los items/servicios de una fuente ya cobrada puede producir total menor al neto recibido; falta una regla de negocio explícita para bloquear o resolver esa edición. FrameJob sin Customer no puede recibir pagos hasta asociarlo a uno.

Siguen fuera de alcance AFIP/ARCA, factura, caja diaria, contabilidad, conciliación bancaria, proveedores/compras, integración POS/Sale, cuotas/intereses, cuenta corriente manual, WhatsApp, portal cliente y archivos/Google Drive.

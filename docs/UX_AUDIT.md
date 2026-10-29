# Auditoría integral UX/UI — primera entrega (29/10/2026)

> **Estado de cierre (fases 0–8, 29/10/2026).** Este documento conserva el diagnóstico original. La sección «Cierre» al final resume qué quedó resuelto y qué sigue pendiente.

Sólo diagnóstico. No se cambió código de producto, dominio, SQL, migraciones ni sync; no hay commit ni push. El árbol quedó limpio (`git status` vacío).

## Método y límites

- Leído: `AGENTS.md`, `CLAUDE.md`, `HANDOFF`, `CURRENT_STATE`, `PRODUCT`, `ARCHITECTURE`, `DECISIONS` y el código de `packages/ui`, `packages/features` y los `main.tsx` de Web y Desktop.
- Visto en navegador: la UI real (mismos componentes que Web y Desktop) con repositorios en memoria y datos de muestra inventados (clientes, 7 pedidos, 3 saldos, 6 productos), a 1280×800, 800×1280 (tablet ~10") y 390×844. El arnés era temporal y se borró.
- **No verificado**: ventana Tauri real, datos reales, tablet física, lector de códigos, lector de pantalla, estados de error de red. Las pantallas sin datos de muestra (Agenda con turnos, Marquetería con trabajos, Precios con tarifas) se auditaron por código más su estado vacío.
- Los hallazgos con «(código)» salen de leer el fuente y no se reprodujeron en pantalla; los «(visto)» sí.

---

## 1. Los 28 problemas más importantes

**Transversales**

1. **Los mensajes de éxito se pintan como error (visto).** 15 usos de `<p className="appointment-error">` (rojo, `panel.css:287`) muestran «Pedido creado como Recibido.», «Link copiado.», «Link revocado.», «Presupuesto guardado como cotizado.». Un alta correcta parece una falla.
2. **Las pestañas del módulo van arriba del título (visto).** `AppShell` (`shell.tsx:186-194`) las dibuja antes de `children`, que empieza con el `<h1>`. En Agenda se lee «Calendario | Turnos | Disponibilidad» y debajo un H1 «Calendario» que repite la pestaña activa. Pasa igual en Marquetería y Materiales.
3. **Tres sistemas de modal/edición.** `Sheet` (con foco atrapado y `role=dialog`); el editor de presupuestos (`events.tsx:447`, sin rol ni foco, z-index 40 bajo la barra superior de 60: el ✕ y el encabezado quedan tapados, visto); el editor de turnos (`appointment-editor-*`); más formularios que se expanden en línea (Plotter, tramos de Laboratorio) y 4 `window.confirm`.
4. **Un sistema de botones y cuatro maneras de saltárselo.** `Button` casi no se usa en las pantallas operativas: hay ~150 `<button>` crudos (photo 30, appointments 22, events 19, pos 18), `.customer-primary` (19 usos) y `.customer-secondary` (5) como clon del botón primario, y `.btn.touch-lg` a mano en Producción. `Badge` se usa en un solo archivo, `StateLine` en uno, `Notice` en uno y `Chip` está exportado pero nadie lo usa (Cobros y Pedidos escriben `.chip` a mano).
5. **Clases sin CSS (visto).** `.form-row` se usa 9 veces (Plotter, tramos de Laboratorio, compositor de servicios) y no existe en ninguna hoja: los campos se apilan a ancho completo (Plotter ocupa 5 filas de ancho completo en 1280 px). `.eyebrow` tampoco tiene regla.
6. **Vocabulario de estados que cambia por pantalla.** Mismo concepto, distinto nombre: Laboratorio «En proceso» / Marquetería «En producción»; Pedidos «Recibido» (el usuario lo llama «Pendiente»); Plotter muestra el enum en inglés (`quoted`, `accepted`, `completed`, `services.tsx:1360`); Cobros usa «Terminados» y «Fotografía/Servicios»; «Activo/Inactivo» es una insignia en Configuración, texto plano «Activo» + enlaces «Editar/Desactivar» en Productos, y un botón «Desactivar cliente» en la ficha.
7. **Los estados en listas se leen mal.** `StateLine` los dibuja en DM Mono de 11,5 px, en mayúsculas y concatenados: «ATRASADO · LISTO PARA ENTREGAR» (contradictorio a la vista), «URGENTE · ATRASADO · RECIBIDO», que además se parte en dos líneas.
8. **Tres formatos de fecha en una misma pantalla (visto).** «Ayer 08:23 p. m.», «29/10/2026, 01:23:37» (con segundos) y «28/10/2026 20:23» (input 24 h) conviven en el detalle de un pedido.
9. **El menú «+ Nuevo» promete crear y a veces sólo navega.** `createItems` (`shell.tsx:18-25`): «Cliente», «Turno» y «Presupuesto o reserva» abren la lista, no el alta. Falta además la cotización de Plotter.
10. **Iconos repetidos en ítems distintos.** Seis pares comparten icono: Marquetería/Materiales (marco), Producción/Plotter (impresora), Reservas/Recursos (estrella), Stock/Productos (caja), Cobros/Precios (billetera), Parámetros/Integraciones (sliders). En el riel de tablet (visto, 20 ítems con etiquetas de ~8 px) no se distinguen.
11. **La navegación no filtra por rol (código).** `staff` ve Cobros (pantalla «Sólo owner y admin ven los cobros», un callejón sin salida) y toda Configuración.
12. **El mismo selector de cliente se reimplementa 3 veces.** «Buscar cliente» + «Cliente *» (select) + «+ Crear cliente» en Nuevo pedido, en el editor de presupuestos y en Turnos: dos controles para elegir una sola cosa, y el segundo es un `<select>` nativo.

**Inicio**

13. **Un mismo número en tres lugares (código + visto).** «Esperando pago» (KPI), «Saldos pendientes» (fila de seguimiento, `pages.tsx:370` y `:454`) y la cabecera de Cobros muestran el mismo total; «Pedidos pendientes» y «Listos para entregar» llevan a la misma lista sin filtro.
14. **«Para resolver ahora» no está acotada.** Agrega una fila verde «Listo para entregar» por cada pedido listo (`pages.tsx:260`): con 20 listos son 20 filas «ok» que ahogan los atrasados. En 390 px la lista empieza en y≈515 de 844 (título, 2 botones, línea de identidad y 4 KPI van antes).

**Mostrador**

15. **Producción (tablet): las acciones no tienen posición fija (visto).** Con 4 botones la columna de acciones mide 330 px y «Abrir» baja de línea; «Listo» está en x=1051 o 1132 según haya «En proceso» o no. La fila más alta mide 137 px frente a ~87 de las otras, así que caben ~4 pedidos por pantalla en 1280×800.
16. **Producción: «Listo» no tiene confirmación ni deshacer (código).** En pedidos web `advance()` llama a `notificationRepository.wake` y manda un WhatsApp al cliente; un toque equivocado en la tablet es irreversible desde Producción. Un pedido ya «Listo» queda en la cola sin acción útil (sin «Entregar»).
17. **Cobros: nombres y filtros mezclados.** La pantalla se llama «Cobros», el KPI «Esperando pago» y la fila «Saldos pendientes» (sólo hay cuentas por cobrar, no historial de lo cobrado). La fila de chips mezcla un estado («Terminados») con orígenes («Fotografía», «Marquetería», «Servicios») que no coinciden con el menú (Pedidos, Presupuestos y reservas). La fila no dice de qué fecha viene la deuda ni abre el origen; mientras cargan los nombres se ve «Cliente».
18. **Stock repite Productos (visto).** Ambas listan todo el catálogo; Stock agrega 4 tarjetas KPI que repiten exactamente las 4 chips de debajo y un botón «Ver movimientos» en las 6 filas. Productos usa enlaces «Editar/Desactivar» sin forma de botón.
19. **Clientes: la configuración manda sobre la ficha (visto).** La lista de precios del cliente es un `<select>` editable permanente debajo de 4 botones (WhatsApp, Nuevo pedido, Llamar, Email); la ficha no muestra reservas, turnos ni marquetería (sólo Cuenta + pedidos + datos).

**Laboratorio**

20. **Nuevo pedido: lo principal está escondido en un `<select>` (visto).** Tamaño × papel (Brillo/Mate) es una sola lista plana «Foto 10x15 · Mate»; cada línea agregada trae 4–6 inputs (servicio de sólo lectura, cantidad, «Precio unitario» de sólo lectura, notas). Sin seña al crear ni opción de pedir archivos.
21. **El detalle de pedido repite el estado 3 veces (visto).** Línea de estado, fila «Estado: Recibido» y botones de transición; la fecha prometida aparece como texto y como input; el formulario de edición (fecha, prioridad, notas, «Guardar datos») está siempre abierto; «Cancelar» (anula el pedido) está pegado a «Marcar listo». Además la lista muestra «No hay pedidos para este filtro» mientras carga.

**Servicios**

22. **Presupuestos y reservas: el editor mide 1546 px (visto).** «Servicios contratados», lo único que importa, empieza en y=819 (por debajo del primer pantallazo a 800 px); los totales y «Guardar» están al final sin sticky. Seis campos de cabecera (Tipo, Título, Lugar, Dirección, Estado, Notas) preceden al contenido.
23. **Servicio vendido, recurso físico y precio se mezclan en el editor (visto + código).** Hay tres entradas: el compositor «Cotizar servicio», «+ Agregar servicio» (fila libre con nombre, precio y descripción) y «+ Reservar recurso» (fila manual). El compositor muestra siempre Distancia/Armado/Desarmado. Un recurso elegido a mano toma `defaultPriceCents` (`events.tsx:726`) aunque Recursos ya no lo muestra ni lo edita: precio invisible.
24. **Presupuestos y reservas: filtros y tablero dicen lo mismo (visto).** Las chips «Consulta / Presupuestado / Reservado / Realizado / Cancelado» y las 3 columnas del Tablero son los mismos estados; con el Tablero abierto una chip y una columna filtran igual.
25. **Agenda: 5 filas de control antes del contenido en móvil (visto).** Pestañas, H1 repetido, Hoy/Día-Semana, tres botones de navegación temporal, filtro de estado y «+ Nuevo turno» (secundario) ocupan la mitad de la pantalla. «Turnos» es otra lista de los mismos Appointment. Los Events (reservas) no aparecen en el calendario: una reserva del sábado no se ve en Agenda.

**Taller**

26. **Plotter (visto + código).** Formulario fijo a ancho completo con el resultado en otra tarjeta debajo (hay que bajar para ver el precio mientras se tipean medidas), «Varillas» y «Doblez de lona» visibles para cualquier material, y la lista de cotizaciones sin cliente ni fecha, con el enum en inglés y sin rechazar.
27. **Marquetería: trabajos que no se pueden identificar (código).** La fila de trabajo sólo dice estado, fecha y botones: no muestra cliente, medidas ni total. La cotización guarda `customerId: null` (`framing.tsx:183`), sin campo cliente ni fecha prometida, y el cálculo exige pulsar «Actualizar cálculo» (Plotter es en vivo). El botón final se llama «Guardar cotizado».

**Configuración**

28. **Precios no cumple su propia gramática (visto + código).** (a) Tres patrones de edición: filas con formulario en línea (Plotter), tarjeta con «+ Nuevo tramo» en línea (Laboratorio) y `Sheet` lateral (LED, tela, eventos). (b) El detalle de Laboratorio mezcla precios con disponibilidad por canal («Papel y canal», «Kiosco»: «sólo conserva precios de referencia») y publicación web («Visibilidad en /imprimir», con texto técnico). (c) Las filas de Plotter usan `active={Boolean(rate)}`: sin precio muestran la insignia «Inactivo». (d) La tarjeta «Fotografía / Video» expone lenguaje de desarrollo («No se crean servicios temporales ni enums nuevos en esta fase»). (e) Siete botones «Configurar» idénticos. (f) El precio de Marquetería vive en Materiales › Varillas, no en Precios. (g) «Administrar tamaños y servicios» navega a un alias oculto (`photo-services`).

---

## 2. Problemas por módulo (lo que no está arriba)

| Módulo                    | Hallazgos adicionales                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inicio**                | La línea «Fede · CentroColor · Esperanza» repite el pie de la barra lateral. El título es una pregunta. Hay 3 accesos a Nueva venta (barra lateral, botón, «+ Nuevo») y 4 a Nuevo pedido (+ la ficha). La tarjeta «Turnos de hoy» vacía ocupa una tarjeta completa para decir «Sin turnos hoy». Falta lo que más decide: entregas prometidas para hoy y cola de Producción. |
| **Nueva venta**           | Flujo correcto: escanear → carrito → Cobrar → forma de pago → Confirmar (3 toques tras el escaneo; foco vuelve al campo). Mejorables sin romperlo: la forma de pago es un `<select>` (default Efectivo) en vez de 3–4 botones grandes; sin «recibido/vuelto» para efectivo; sin grilla táctil de productos frecuentes.                                                      |
| **Ventas**                | Estado vacío = encabezado de tabla suelto + «Todavía no hay ventas.» (no usa `EmptyState`).                                                                                                                                                                                                                                                                                 |
| **Clientes**              | Buscador a medio ancho; lista sólo con nombre y teléfono; «Nuevo pedido» y «Nuevo cliente» compiten con WhatsApp en el mismo nivel.                                                                                                                                                                                                                                         |
| **Pedidos**               | Prioridad es un select de 2 opciones (debería ser un interruptor «Urgente»). Lista y Tablero conviven con 8 chips de estado.                                                                                                                                                                                                                                                |
| **Producción**            | Dos carriles apilados (Edición queda bajo el pliegue); sin filtros; sólo aparecen pedidos con `fileIntakeStatus === 'submitted'` y archivos subidos (`photo.tsx:1749-1763`): ver BUG-1. N+1: `listJobs` y luego un `getJob` por pedido (hasta 300).                                                                                                                         |
| **Plotter / Marquetería** | Ver 26–27. En Marquetería «Presupuestos cotizados» muestra sólo medidas y total, sin cliente, y sólo ofrece «Aceptar».                                                                                                                                                                                                                                                      |
| **Recursos**              | Cuatro bloques apilados con eyebrow + título + descripción + acción propia (inventario, capacidad LED, controladores, «Atajos: tamaños LED habituales»). Los atajos son presets de cotización, no equipamiento.                                                                                                                                                             |
| **Tipos y parámetros**    | Dos formularios de alta permanentes en paralelo (Tipos de turno: nombre + duración + Crear; Tipos de servicio: nombre + Crear), con encabezados distintos (uno fuera de la tarjeta, otro dentro). No existe ningún «parámetro».                                                                                                                                             |
| **Materiales / Varillas** | Alta permanente (Nombre + Costo por metro + Agregar) sobre la lista.                                                                                                                                                                                                                                                                                                        |
| **Integraciones**         | Correcto en estructura. En Desktop la pantalla sólo informa.                                                                                                                                                                                                                                                                                                                |
| **Desktop (código)**      | Una barra «Sincronización: … N pendiente(s) · M conflicto(s) [Sincronizar ahora] [Revisar conflictos]» fija sobre cada pantalla, y un panel de conflictos propio en `main.tsx` (1351 líneas) con otra gramática.                                                                                                                                                            |

## 3. Duplicaciones detectadas

- Total adeudado: KPI «Esperando pago», fila «Saldos pendientes», cabecera de Cobros, tarjeta «Cuenta» de cada ficha.
- Estado del pedido en el detalle: línea de estado + fila «Estado» + botones.
- Fecha prometida: texto y input en el mismo panel.
- Selector de cliente: 3 implementaciones; búsqueda + select para una misma elección.
- Catálogo de productos: Productos y Stock.
- Estados de reservas: chips y columnas del Tablero.
- Entradas de creación: nav, botones de Inicio, menú «+ Nuevo», ficha.
- Turnos: Calendario y Turnos son vistas del mismo `Appointment`.
- Alta de servicios en eventos: compositor, fila libre y reserva manual de recurso.
- Stock: 4 tarjetas KPI y 4 chips con las mismas particiones; Precios: un botón «Configurar» por tarjeta.
- Tres patrones de edición de precios (ver 28a).

## 4. Inconsistencias visuales

- Botón primario: `.btn--primary` y `.customer-primary` (mismo aspecto reimplementado en `components.css:802`).
- Acciones de fila: botones de contorno (Stock), enlaces (Productos), `ghost` (Producción), texto en rojo (anular pago).
- Encabezado: `PageHeader` en algunas pantallas, `<header className="page-head">` a mano en Cobros, H1 + pestañas invertidos en módulos con subs.
- Descripción bajo el título sólo en Producción y Precios.
- Mensajes: `appointment-error`, `customer-error`, `auth-error`, `whatsapp-error`, `<p role="alert">` sin clase, `<p role="status">` sin clase.
- Vacíos: `EmptyState`, `<p className="muted">`, «Sin turnos · agregar», tabla vacía.
- Densidad: filas `oprow` de 87–137 px, tarjetas de Precios de ~190 px, editor de 1546 px.
- Tipografía de estado: mono 11,5 px en Producción vs Figtree en tarjetas.

## 5. Flujos con demasiados pasos

- **Entregar y cobrar un pedido listo**: en Inicio el botón «Entregar» sólo abre el detalle del pedido (`openJob`); el cobro y la entrega son dos gestos separados (cuenta de pago y transición de estado). Cobros → «Cobrar» ahorra pasos pero no cierra la entrega.
- **Presupuesto con un servicio**: «+ Nuevo presupuesto» → buscar cliente → elegir en el select → tipo → título → inicio/fin → bajar 800 px → compositor → «Comprobar y cotizar» → agregar → bajar 700 px → «Guardar». ~12 interacciones y 2 desplazamientos largos.
- **Pedido de 3 tamaños**: elegir cliente (2 controles) → fecha → 3× (abrir select, buscar «tamaño · papel», teclear cantidad) → guardar; los precios de laboratorio sólo se ven después de agregar la línea.
- **Pasar un pedido a Listo y entregar** desde Producción: «Listo» → ir a Pedidos → abrir → Entregar.
- **Crear un tipo de turno / de reserva / varilla**: formulario siempre abierto (pocos pasos) pero ocupa la pantalla y no hay confirmación de alta.

## 6. Formularios mal ubicados (permanentes y no son la tarea principal)

Detalle del pedido (fecha/prioridad/notas); ficha de cliente («Datos» y lista de precios); Tipos y parámetros (×2); Varillas y Otros materiales; Categorías de Productos; alta/edición de servicios fotográficos; editor de turno y de presupuesto como overlays propios; tramos de Laboratorio y tarifas de Plotter como formularios en línea; compositor de servicios del editor de eventos. **Sí corresponde permanente**: Nueva venta (buscador + carrito), Nuevo pedido, cotización de Plotter y de Marquetería.

## 7. Información que debería eliminarse

- «Una lista activa para todas las familias comerciales.», «PRECIOS POR FAMILIA» y «Tarifas correspondientes a …» (tres líneas para una idea).
- «Vista operativa de los pedidos de laboratorio y edición.» (el menú ya lo dice).
- Línea de identidad en Inicio; «EVENTOS · Esperanza» sobre el editor; «WEB» + «Panel interno» en la barra.
- «Pendiente Fase C … No se crean servicios temporales ni enums nuevos en esta fase.» (lenguaje de desarrollo).
- «Kiosco sólo conserva precios de referencia; no genera pedidos ni trabajos.»: no es una decisión del usuario; sacar «Kiosco» de la vista (o moverlo a un detalle avanzado).
- Insignia «Activo» repetida en cada tramo de Laboratorio (`active={variant.isActive}`); «Inactivo» por falta de precio en Plotter.
- Las 4 tarjetas KPI de Stock (duplican chips); «Ver movimientos» en cada fila (usar la fila entera).
- «Sin turnos hoy.» como tarjeta; «Todo al día. Nada requiere atención.» cuando ya hay KPI en cero.
- Etiqueta «Pedido web» repetida bajo el nombre en cada fila; mejor un solo icono/etiqueta consistente.
- Fila «Estado» y fila de fecha prometida en el detalle del pedido (ya están en la línea de estado y en el formulario).
- Segundos en las marcas de fecha del detalle.

## 8. Acciones a mover o simplificar

- **Una acción primaria por pantalla**: Inicio (Nueva venta), Pedidos (Nuevo pedido), Presupuestos y reservas (Nuevo presupuesto), Agenda («+ Nuevo turno» hoy es secundario), Precios (la hoja de la familia), Producción (la transición siguiente).
- **Producción**: una sola acción de transición por fila en posición fija (Empezar → Listo → Entregar); «Drive» y «Abrir» a un menú «⋯» o al toque sobre la fila.
- **Detalle de pedido**: «Cancelar pedido» separado de las transiciones (menú «⋯» + diálogo propio, no `window.confirm`).
- **Ficha de cliente**: WhatsApp y Nuevo pedido primarios; Llamar/Email como iconos; lista de precios al editor «Editar cliente».
- **Cobros**: «Cobrar» abre la cuenta en un `Sheet` (ya lo hace); agregar «Entregar» cuando el pedido está listo y el saldo es 0.
- **Agenda**: unir Hoy/Día/Semana + navegación + estado en un solo `FilterBar`; dejar «+ Nuevo turno» como primaria del encabezado.
- **Presupuestos**: botones «Guardar» y «Volver» en un pie fijo con los totales; Estado como control de transición, no como campo libre.
- **Precios**: tarjeta entera clicable en lugar de un botón «Configurar» por tarjeta.

---

## 9. Patrones compartidos propuestos

Existe una base sólida (`Button`, `Card`, `PageHeader`, `Badge`, `StateLine`, `Metric`, `EmptyState`, `Notice`, `Segmented`, `Chip`, `Tabs`, `Sheet`, filas `oprow`, `ConfigurationCard/Row/DetailHeader/MoneyField`). El problema es adopción y huecos, no falta de sistema. Propuesta mínima, en `packages/ui`:

| Componente                     | Qué reemplaza                                                          | Notas                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PageHeader` v2                | `<header className="page-head">`, pestañas sobre el H1                 | `title`, `tabs?`, `primaryAction?`, `meta?`; el `AppShell` deja de pintar `Tabs`                |
| `FilterBar`                    | chips y toolbars a mano (Cobros, Pedidos, Agenda, Stock, Presupuestos) | búsqueda + `Segmented` + chips con conteo + acción de vista; una sola fila                      |
| `StatusBadge` + `statusTone`   | `StateLine` mono, textos de color, tablas de etiquetas por pantalla    | un mapa `estado → {label, tone}`; mantiene el criterio «sólo urgencia/atraso/listo llevan tono» |
| `InlineMessage`                | `appointment-error`, `customer-error`, `<p role="alert">`              | `tone: success                                                                                  | error | info`, con `role` correcto |
| `FormDrawer`                   | overlays de eventos/turnos, formularios en línea                       | `Sheet` lateral + pie fijo (Guardar/Cancelar) + modo «pantalla completa» en móvil               |
| `EntityList` / `EntityRow`     | variantes de `oprow`, `job-row`, `prod-row`, `config-row`              | slots: identidad, detalle, fecha, estado, acción; grilla fija                                   |
| `ConfirmDialog`                | `window.confirm` (4)                                                   | acción destructiva con texto de consecuencia                                                    |
| `CustomerPicker`               | selector de cliente ×3                                                 | un campo con autocompletado + «Crear cliente» en un `FormDrawer`                                |
| `SettingsCard`                 | tarjetas de Configuración                                              | `title`, `summary`, `status?`, tarjeta clicable                                                 |
| `PriceFamilyCard` / `PriceRow` | `ConfigurationCard`, `RateRow`, `LabTierCard`                          | siempre con **unidad** (`/ m²`, `/ copia`, `por evento`) y edición en `FormDrawer`              |
| `ActionBar` (sticky)           | pies de formularios largos                                             | totales + acción primaria visibles                                                              |
| `PaymentMethodPicker`          | `<select>` de forma de pago                                            | 3–4 botones grandes, mismo objetivo táctil que Producción                                       |

## 10. Nueva gramática visual propuesta

**Anatomía de página (toda pantalla):** (1) título H1; (2) pestañas de módulo, si existen, _debajo_ del título; (3) fila de contexto = `FilterBar` (búsqueda, filtros, vista); (4) acción primaria en el encabezado, derecha, una sola; (5) contenido; (6) acciones secundarias dentro de la fila o en menú «⋯».

**Estados (única tabla, cinco tonos):**

| Familia             | Tono          | Ejemplos                                                           |
| ------------------- | ------------- | ------------------------------------------------------------------ |
| Pendiente / inicial | neutro        | Recibido (se mostrará «Pendiente»), Consulta, Pendiente            |
| En curso            | amarillo      | En proceso, En producción (unificar a «En proceso»), Presupuestado |
| Listo / OK          | verde         | Listo, Realizado, Activo, Pagado                                   |
| Alerta              | rojo          | Atrasado, Urgente, Conflicto, Error                                |
| Cerrado / baja      | gris atenuado | Entregado, Cancelado, Inactivo                                     |

Texto siempre en Figtree 13 px mínimo (16 px en tablet), nunca mayúsculas concatenadas; DM Mono sólo para códigos, horas e importes.

**Botones:** primario (amarillo) 1 por pantalla; secundario contorno; `ghost` para terciarios; destructivo sólo dentro de menú/diálogo. Objetivo táctil 44 px general, 52 px en Producción y Nueva venta.

**Formularios:** crear/editar siempre en `FormDrawer` (lateral en ≥768 px, hoja inferior en móvil); la pantalla muestra lista + «+ Nuevo». Excepciones: venta, pedido, cotizaciones.

**Mensajes:** `InlineMessage` éxito/error/info; éxito se descarta solo a los 4 s.

**Vacíos:** `EmptyState` con acción («Crear el primero») salvo en listas filtradas.

**Fechas:** un solo helper: «Hoy 18:30», «Mañana 09:00», «jue 29 oct», sin segundos; atrasado en rojo con «hace 3 h».

**Navegación:** iconos únicos por módulo; ocultar por rol (staff no ve Cobros ni Configuración); riel de tablet sólo con los módulos diarios y «Más» para Configuración.

**Identidad:** se mantiene amarillo, grafito, crema, Bricolage Grotesque (títulos), Figtree (UI) y DM Mono (cifras/códigos). No se agrega decoración.

## 11. Cambios específicos por pantalla

- **Inicio.** Quitar línea de identidad y el título en pregunta («Hoy»). KPI: Ventas hoy · Para entregar hoy · En producción · Por cobrar (una sola vez). Eliminar fila «Saldos pendientes». «Para resolver ahora»: máximo 5 filas, sólo atrasados, urgentes y listos con saldo; el resto en «Ver todos (N)». Botón «Nuevo pedido» queda en el menú «+ Nuevo».
- **Nueva venta.** No tocar el flujo de escaneo. Forma de pago en botones; campo «Recibido» con vuelto opcional; atajo de productos frecuentes (opcional, P2).
- **Ventas.** `EmptyState` y filtro por fecha; sin cambios de datos.
- **Clientes.** Encabezado: nombre + WhatsApp y Nuevo pedido; Llamar/Email como iconos; lista de precios y «Datos» pasan a «Editar cliente» (`FormDrawer`); «Cuenta» arriba con el saldo y los orígenes como enlaces; secciones por tipo de origen (Pedidos, Reservas, Marquetería).
- **Cobros.** Renombrar la tarjeta/KPI/fila a un único término (propuesta: «Por cobrar» en Inicio, «Cobros» en el menú). Chips = estado (Todos · Terminados · En curso); el origen como columna con el nombre del menú (Pedido, Reserva, Marquetería). Cada fila abre su origen. Precargar nombres en la consulta en lugar de N `getCustomer`.
- **Pedidos.** Estado de carga antes del vacío; detalle con estado único arriba, fecha editable en un `FormDrawer`, «Cancelar pedido» en «⋯».
- **Nuevo pedido.** Cliente con `CustomerPicker`; matriz de tamaño × papel (Brillo/Mate como botones) con precio visible; línea compacta (tamaño · papel · cantidad · total); entrega prometida con atajos «Hoy / Mañana / +2 días»; «Urgente» como interruptor; pie fijo con total y «Guardar» (+ «Guardar y cobrar seña»: reutiliza `WorkPaymentRepository`).
- **Producción.** Segmentado «Laboratorio | Edición» con conteos (en lugar de dos carriles apilados) + chips «Pendiente · En proceso · Listo»; fila de grilla fija con **una** acción grande («Empezar», «Listo», «Entregar») en la misma columna de 160 px; «⋯» o toque en la fila para Drive y detalle; fuente de estado 16 px; «Listo» en pedidos web con deshacer de 5 s antes de avisar al cliente.
- **Presupuestos y reservas.** Quitar chips o columnas (dejar chips + Lista, Tablero opcional); editor en `FormDrawer` ancho con 3 secciones: Cliente y fecha → Servicios (un único compositor; los recursos son consecuencia del servicio, sólo lectura con «Disponibilidad») → Resumen y totales en pie fijo.
- **Agenda.** `PageHeader` con pestañas debajo; un `FilterBar` (Hoy · ← → · Día/Semana · estado) y «+ Nuevo turno» primario; capa de lectura de reservas (Events) sobre el calendario sin fusionar datos; «Turnos» como vista de lista del mismo calendario o eliminada.
- **Plotter.** Dos columnas desde 900 px: formulario a la izquierda, presupuesto sticky a la derecha; «Varillas»/«Doblez» sólo para lona/vinilo; lista de cotizaciones con cliente, fecha y estado traducido, y acción «Rechazar».
- **Marquetería.** Cotización en vivo (sin «Actualizar cálculo»), cliente y fecha prometida, «Guardar presupuesto»; fila de trabajo con cliente, medidas, total y estado; costos técnicos (merma, mano de obra) sólo en Configuración.
- **Precios.** Orden: selector de lista + «Administrar listas» + «Viáticos» arriba; debajo 7 `PriceFamilyCard` iguales (título, resumen con unidad, estado «N de M con precio»), clicables; todas se editan en `FormDrawer`; disponibilidad por canal y publicación en `/imprimir` en una sección «Publicación» aparte del precio; eliminar la tarjeta de Fase C del flujo visible (o mostrar «Próximamente» sin texto técnico); Marquetería enlaza a su configuración pero indicando dónde vive.
- **Recursos.** Sólo equipamiento: lista (nombre, tipo, estado) + «+ Nuevo equipo»; la capacidad LED como detalle del equipo («Pool de paneles», «Controladores»); los «Atajos de tamaños LED» pasan a Precios › Pantalla LED.
- **Productos.** Alta/edición en `FormDrawer`; categorías en un `FormDrawer` de «Categorías».
- **Stock.** Quitar las 4 tarjetas; chips; fila entera abre «Movimientos» en un `FormDrawer`; foco en existencias y alertas.
- **Tipos y parámetros.** Renombrar a «Tipos» (o dividir en dos filas de lista); alta en `FormDrawer`; fuera del módulo la palabra «parámetros».
- **Materiales (Plotter / Varillas / Otros).** Lista + «+ Nuevo» en `FormDrawer`; mismos encabezados y estados.
- **Integraciones.** Sin cambios estructurales; usar `SettingsCard` y estados `StatusBadge`.
- **Desktop.** Reducir la barra de sincronización a un indicador (icono + contador) en la barra superior; conflictos como `FormDrawer`.

## 12. Clasificación de cambios

**Sólo UX/UI (sin refactor de lógica):** mensajes de éxito, `.form-row`/`.eyebrow`, pestañas bajo el título, iconos únicos, ocultar «Fase C», etiquetas «Pendiente / En proceso», traducción de estados de Plotter, formato de fecha, estado de carga de Pedidos, KPI y filas duplicadas de Inicio, tarjetas de Stock, Plotter en dos columnas, menú «+ Nuevo», copy de Precios/Recursos.

**Refactor menor (componentes y composición, sin tocar dominio):** `PageHeader` v2, `FilterBar`, `StatusBadge`, `InlineMessage`, `FormDrawer`, `EntityList`, `CustomerPicker`, `ConfirmDialog`, `PriceFamilyCard`; mover `PhotoProductionPage` a su archivo; rediseño de Producción; editor de presupuestos; Nuevo pedido; Agenda con capa de lectura de Events; ficha de Cliente; Cobros con origen enlazado y precarga de nombres; ocultar navegación por rol; Desktop: barra de sync.

**Cambios de dominio (requieren decisión de producto; no hacer sin pedido expreso):**

- Que Producción incluya pedidos de mostrador sin archivos (BUG-1).
- Estados por carril cuando un pedido tiene ítems de Laboratorio y de Edición (BUG-4).
- Cobros de Plotter (`WorkPaymentSourceType` no incluye `plotter_quote`).
- Quitar o conservar `defaultPriceCents` como fuente de precio de un recurso (hoy invisible).
- Cliente obligatorio/opcional en cotizaciones de Marquetería y de Plotter (ver BUG-5; la columna ya existe).
- Agenda transversal real Appointment + Event (la capa de lectura es UI; la fusión de datos queda fuera).
- Seña al crear un pedido: la lógica existe (`WorkPaymentRepository`), el cambio es de UI pero afecta reglas de cobro; confirmar.

## 13. Prioridad

**P0 — corrige errores visibles o riesgos operativos; bajo riesgo:**

1. `InlineMessage` y reemplazo de los 15 `appointment-error` usados como éxito.
2. `.form-row` y `.eyebrow` con CSS.
3. Pestañas bajo el título (cambio en `AppShell` + `PageHeader`).
4. Producción para tablet: grilla fija, una acción por fila, fuentes legibles, deshacer en «Listo» web.
5. Traducir estados de Plotter y unificar etiquetas de estado (`statusLabel` único).
6. Estado de carga en Pedidos.
7. Editor de presupuestos: no tapado por la barra superior, pie fijo con totales, un solo compositor.
8. Menú «+ Nuevo»: 3 ítems que realmente crean.
9. Precios: quitar texto de desarrollo; mismo patrón de edición en las 7 familias.

**P1 — coherencia y productividad:**
`PageHeader`/`FilterBar`/`StatusBadge`/`FormDrawer`/`EntityList` y su adopción en Cobros, Pedidos, Stock, Productos y Agenda; Inicio simplificado; Nuevo pedido con matriz tamaño × papel; ficha de cliente; Cobros; Agenda (barra única + eventos en lectura); Plotter y Marquetería (en vivo, cliente, filas identificables); Tipos y parámetros, Materiales, Recursos en `FormDrawer`; navegación por rol.

**P2 — acabado:**
Iconos únicos; riel de tablet reducido; POS con botones de pago, vuelto y favoritos; `ConfirmDialog`; helper de fechas; empty states con acción; barra de sync de Desktop; barrido de `<button>` crudos y poda de `legacy.css`.

## 14. Plan de implementación sin reescritura

Cada fase se entrega sola, con `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`, y una pasada visual a 390 / 800 / 1280 px. Sin cambios de dominio, esquema ni sync.

0. **Preparación (1 sesión, archivos disjuntos).** Mover `PhotoProductionPage` de `photo.tsx` a `photo-production.tsx` y `Event editor` a `event-editor.tsx` para que dos agentes puedan trabajar en paralelo. Agregar `docs/UX_GRAMMAR.md` (tabla de estados, botones, fechas).
1. **Fundamentos en `packages/ui` (sin migrar pantallas).** `InlineMessage`, `StatusBadge` + mapa de estados, `FilterBar`, `PageHeader` con `tabs`/`primaryAction`, `FormDrawer`, `ConfirmDialog`, `EntityRow`, CSS de `.form-row`. Pruebas de navegación y de snapshots mínimas.
2. **Quick wins P0 transversales.** Mensajes, pestañas bajo el título, menú «+ Nuevo», estados de Plotter, carga de Pedidos, iconos únicos.
3. **Producción (tablet).** Rediseño con el nuevo `EntityRow`; validar en la tablet física antes de dar por cerrado.
4. **Precios.** `PriceFamilyCard` y `FormDrawer` para Laboratorio y Plotter (alinear con LED/tela/eventos); separar «Publicación».
5. **Servicios.** Editor de presupuestos y reservas; Agenda con `FilterBar` y capa de lectura de reservas.
6. **Mostrador.** Inicio, Clientes (ficha), Cobros, Pedidos y Nuevo pedido, Stock/Productos.
7. **Taller y Configuración secundaria.** Plotter, Marquetería, Tipos, Materiales, Recursos.
8. **Limpieza.** Reemplazo de `<button>` crudos y `.customer-primary/.customer-secondary`; poda de `legacy.css`; helper de fechas; Desktop sync.

Las fases 3, 4 y 5 tocan archivos distintos y pueden ir en paralelo una vez hecha la fase 0–1; 2 y 8 conviene hacerlas en una sola mano.

---

## BUGs funcionales documentados (no ocultables con UX)

- **BUG-1 — Producción omite los pedidos de mostrador sin archivos.** `photo.tsx:1749` filtra `fileIntakeStatus === 'submitted'` y `:1762` exige archivos `lab`/`editing`. En la muestra, «Foto carnet (mostrador, sin archivos)» aparece en Pedidos y no en Producción, aunque el encabezado dice «Vista operativa de los pedidos de laboratorio y edición». Puede ser decisión del Sprint 13; confirmar con el negocio. _(visto)_
- **BUG-2 — Éxito con estilo de error.** Ver problema 1. _(visto)_
- **BUG-3 — Plotter muestra el enum.** `quote.status` en inglés (`services.tsx:1360`). _(código)_
- **BUG-4 — Pedido con ítems en dos carriles.** Aparece en Laboratorio y Edición y `advance()` llama a `setJobStatus` a nivel de pedido: «Listo» en una cola cambia el estado de la otra. _(código; no reproducido con datos reales)_
- **BUG-5 — Cotización de Marquetería sin cliente.** `customerId: null` fijo (`framing.tsx:183`) y «Aceptar» crea un trabajo con `q.customerId` nulo. A verificar si la cuenta del trabajo puede cobrarse y si aparece en la ficha del cliente, ya que `WorkPayment.customerId` es obligatorio. _(código; a verificar)_
- **BUG-6 — Editor de presupuestos tapado por la barra superior.** z-index 40 contra 60; ✕ y encabezado quedan recortados. _(visto)_
- **BUG-7 — Vacío antes de cargar en Pedidos.** Aparece «No hay pedidos para este filtro» durante la carga inicial. _(visto)_
- **BUG-8 — Precio invisible en recursos.** `events.tsx:726` copia `defaultPriceCents` a la reserva aunque Recursos ya no muestra ni edita ese campo. _(código)_
- **BUG-9 — Estado «Inactivo» por falta de precio.** `RateRow` pasa `active={Boolean(rate)}`. _(visto)_
- **Riesgo de rendimiento:** Producción (N+1, hasta 300 `getJob`) y Cobros (un `getCustomer` por cliente).

---

## Cierre (fases 0–8)

**Resuelto en UX/UI** (sin cambios de reglas de negocio, dominio, SQL ni sync):

- **Transversales (1–12):** mensajes de éxito/error con `InlineMessage` (el éxito ya no se pinta rojo); pestañas bajo el título con H1 = módulo; `Sheet` apilable y todos los editores en hojas (`FormDrawer`/`Sheet`) por encima de la barra superior; botones del sistema (`Button`) en todas las pantallas operativas; `.form-row` y `.eyebrow` con CSS; estados con `StatusBadge` y tabla única (`status.ts`); menú «+ Nuevo» con altas reales; iconos únicos; selector de cliente único (`CustomerField`); `window.confirm`/`window.prompt` reemplazados por diálogos propios (cancelar pedido/reserva/turno, desconectar Drive/WhatsApp, anular pago).
- **Inicio (13–14):** KPI sin duplicados, avisos acotados a decisiones, deuda mostrada una sola vez.
- **Mostrador (15–19):** Producción tablet (columnas fijas, botones de 56 px), Cobros en tabla Cliente · Origen · Total · Pagado · Saldo · Estado, ficha de cliente con Datos/Cuenta/Pedidos/Reservas, Stock sin tarjetas duplicadas y con «Movimientos» en una hoja; Pedidos con detalle ordenado (estado único, edición bajo demanda, cancelación confirmada) y Nuevo pedido con pie fijo de total.
- **Servicios (22–25):** editor de presupuestos en hoja ancha con pie fijo, una sola acción «Agregar servicio», bloques distintos para servicio / viáticos / recurso físico; Agenda con título único y barra compacta.
- **Taller (26–27):** Plotter y Marquetería con cotizador de dos zonas; estados en español; trabajos de Marquetería identificables.
- **Configuración (28 y catálogos):** Precios con una sola gramática; Productos, Materiales, Tipos, Recursos, Servicios fotográficos con el patrón catálogo + drawer; Integraciones como tarjetas técnicas.
- **Limpieza (fase 8):** se podó ~1 100 líneas de CSS sin uso en `legacy.css`/`panel.css`, se quitaron los primitivos `Badge`/`StateLine` y los componentes `Configuration*` sin uso, y se verificó que ninguna de 24 vistas desborda horizontalmente a 390 px.

**BUGs funcionales y decisiones de dominio que siguen pendientes** (no se tocaron por indicación expresa):

- **BUG-1:** Producción no lista pedidos de mostrador sin archivos recibidos.
- **BUG-4:** un pedido con ítems de Laboratorio y de Edición aparece en ambas colas y «Listo» cambia el estado del pedido completo.
- **BUG-5:** la cotización de Marquetería se guarda con `customerId: null` (sin cliente ni fecha prometida); a verificar si el trabajo puede cobrarse y verse en la ficha del cliente.
- **BUG-8:** un recurso agregado a mano toma `defaultPriceCents`, que Recursos ya no muestra.
- «Listo» en un pedido web avisa por WhatsApp de inmediato, sin confirmación ni deshacer.
- La Agenda no muestra las reservas (Events); la agenda transversal es una decisión de dominio.
- Cobros de Plotter no existen (`WorkPaymentSourceType` no incluye cotizaciones de Plotter) y Plotter no tiene PlotterJob ni acción de rechazar.
- Marquetería: Varillas y Otros materiales no se pueden editar/desactivar; sus costos son configuración de Materiales, no de Precios.
- Las ventas POS no están asociadas a un Customer (no aparecen en su ficha).
- La disponibilidad de recursos sólo se exige al guardar como Reservado/Realizado.
- Rendimiento: Producción hace una consulta por pedido (hasta 300) y Cobros una por cliente.
- No verificado en ninguna fase: ventana Tauri real, tablet física, lector de pantalla, datos y persistencia reales.

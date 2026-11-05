# Gramática UX/UI (fases 0–2 de `docs/UX_AUDIT.md`)

Referencia corta para quien toque pantallas. Lo que ya existe en código está marcado con ✔; el resto es el destino de las fases siguientes.

## Anatomía de página

1. `PageHeader` con el título. Si el módulo tiene pestañas (Agenda, Marquetería, Materiales), el H1 es el nombre del módulo y las pestañas se dibujan **debajo** del título ✔ (el shell las entrega por contexto; una pantalla sin `PageHeader` las recibe arriba como respaldo).
2. Fila de contexto/filtros (`FilterBar` ✔ creado, aún sin adoptar).
3. Una sola acción primaria a la derecha del encabezado (`PageHeader primaryAction` ✔). Las secundarias van en `actions` o dentro de la fila.
4. Contenido.
5. Acciones secundarias dentro de cada fila, nunca más de una por fila con peso visual.

## Componentes de `@centrocolor/ui`

| Componente                                      | Uso                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InlineMessage` / `useFlash` / `FlashMessage` ✔ | Mensajes de éxito, error e información. Los éxitos se descartan solos a los 4 s. **No usar `appointment-error` ni `customer-error` para éxitos.** |
| `StatusBadge` ✔                                 | Estado como pastilla legible (Figtree). Tonos: `neutral`, `progress`, `ok`, `alert`, `info`, `closed`.                                            |
| `FormDrawer` ✔                                  | Alta/edición bajo demanda: hoja lateral con pie fijo Cancelar · Guardar.                                                                          |
| `ConfirmDialog` ✔                               | Confirmación con consecuencia; reemplaza a `window.confirm` (aún quedan 4).                                                                       |
| `EntityRow` ✔                                   | Fila con slots fijos (identidad · detalle · fecha · estado · acción) sobre `.oprow`.                                                              |
| `FilterBar` ✔                                   | Búsqueda + filtros + control de vista en una fila.                                                                                                |
| `requestCreate` / `takeCreateIntent` ✔          | El menú «+ Nuevo» abre directamente el alta de Cliente, Turno y Presupuesto o reserva.                                                            |

## Estados (tabla única)

Definidos en `packages/features/src/status.ts` (`plotterQuoteStatus`, `frameJobStatus`); el resto de pantallas migra a esta tabla en las fases siguientes.

| Familia             | Tono       | Ejemplos                       |
| ------------------- | ---------- | ------------------------------ |
| Pendiente / inicial | `neutral`  | Pendiente, Consulta, Borrador  |
| En curso            | `progress` | En proceso, Aceptada           |
| Listo / OK          | `ok`       | Listo, Completada, Activo      |
| Alerta              | `alert`    | Atrasado, Urgente, Error       |
| Informativo         | `info`     | Cotizada, Presupuestado        |
| Cerrado / baja      | `closed`   | Entregado, Cancelado, Inactivo |

«En proceso» es el único nombre para un trabajo en curso (Marquetería ya no dice «En producción»). El estado `received` de un Pedido sigue rotulándose «Recibido»: pasarlo a «Pendiente» queda para la fase de Producción.

## Botones, formularios y mensajes

- Un primario amarillo por pantalla; secundario de contorno; `ghost` para terciarios; destructivo sólo en menú o diálogo.
- Crear y editar en `FormDrawer` salvo que sea la tarea principal (venta, pedido, cotizaciones).
- `.form-row` ahora tiene regla (grilla autoajustable); `.eyebrow` también.
- Navegación: un icono distinto por módulo ✔ (Productos `store`, Precios `cash`, Materiales `layers`, Recursos `bolt`, Plotter `ruler`, Integraciones `link`).

## Catálogos de Configuración y Taller

Catálogo primero: `PageHeader` con la acción de alta (`primaryAction`), `FilterBar` si hay búsqueda, una tarjeta con `CatalogRow` (título, datos con rótulo, `StatusBadge` Activo/Inactivo, una sola acción «Editar») y `EmptyState`. Crear y editar en `FormDrawer`; activar/desactivar al fondo del drawer (sección «Estado»). Varios catálogos en una pantalla = `CatalogSection` apiladas. Integraciones = `IntegrationCard` (configuración técnica; sin acciones operativas). Cotizadores (Plotter, Marquetería) = `quote-workspace`: entradas a la izquierda, resultado fijo a la derecha con total y una acción primaria.

## Mostrador (Inicio, Clientes, Cobros)

Inicio: KPI sin duplicados y avisos que piden una decisión (máximo 6; lo demás se cuenta). Ficha: encabezado con una acción primaria, luego Datos (sólo lectura), Cuenta, y un bloque por tipo de origen (Pedidos, Reservas); editar en `FormDrawer`. Cobros: una fila = una cuenta, con Cliente · Origen · Total · Pagado · Saldo · Estado · acción; el total adeudado se muestra una sola vez; el origen usa el vocabulario del menú. Los estados de origen salen de `workSourceStatus`.

## Editores (presupuestos, turnos)

Se abren en `Sheet`/`FormDrawer` (nunca en overlays propios): hoja lateral (ancha con `size="lg"` si hay varias secciones), pie fijo con resumen y acción primaria, y formularios secundarios (agregar servicio, confirmar cancelación) como hojas apiladas. Datos principales en una grilla de 12 columnas (`editor-grid`, `span-N`); lo opcional (lugar, notas) plegado. Cliente = `CustomerField`. Bloques distintos para lo vendido (servicios, borde amarillo), viáticos (insignia azul) y equipamiento físico (recursos, borde gris). Agenda: `PageHeader` + `AgendaBar`/`FilterBar`; la acción primaria va en el encabezado.

## Precios (referencia de catálogo configurable)

Portada: `PriceFamilyCard` (toda la tarjeta clicable, estado y cobertura). Detalle: `PriceFamilyDetail` → `PriceSection` → `PriceRow`. Reglas: cada valor lleva su unidad en la etiqueta (nunca «Tarifa» ni «Precio» a secas salvo «Precio fijo»); una sola acción por fila («Editar»); crear/editar en `FormDrawer` con secciones («Precio» primero, luego lo que no es precio); la disponibilidad, la publicación y el equipamiento físico no se mezclan con los importes; los estados usan `StatusBadge` («Sin precio» ≠ «Inactivo»).

## Producción (referencia de fila operativa)

Texto ≥ 14 px (16 px en estados y fechas), botones de 56 px, columnas fijas por contenedor (`@container production`), una sola acción primaria por fila (la siguiente transición) y estados como `StatusBadge`. Es el patrón a reutilizar en otras colas operativas.

## Fuera de alcance de estas fases

Decisiones de dominio y BUGs funcionales (BUG-1, 4, 5, 8 de `docs/UX_AUDIT.md`) siguen documentados y sin tocar.

## Navegación interna: Volver (05/11/2026)

Cuando una pantalla **reemplaza** a otra (listado → detalle → edición) lleva `PageHeader onBack` (`backLabel` nombra el destino para lectores de pantalla): «← Volver» sobre el título, siempre en el mismo lugar. Las páginas raíz no lo llevan. Hojas, drawers y diálogos se cierran con la «✕» de `Sheet`, Escape o Cancelar. En ambos casos el botón Atrás del navegador (o el gesto del teléfono) hace lo mismo que el control visible: nunca saca al usuario de la app mientras haya algo a lo que volver. No dibujar flechas propias: usar `BackButton`/`PageHeader`.

## Filtros de listados

`FilterBar` es el único patrón: `search` + filtros como hijos + `end` opcional. `FilterSelect` («Categoría: Todas») y `FilterDate` («Desde», «Hasta») llevan el rótulo dentro del disparador; `onClear` + `dirty` agregan «Limpiar» sólo con filtros activos. Sólo se agregan filtros que segmentan de verdad (categoría, estado, origen, período); no llenar pantallas de selectores. Nunca fijar `min-width` en un control de filtro: la barra hace wrap y en pantallas angostas reparte los filtros de a dos. «Inactivo» y «Eliminado» no son lo mismo: lo eliminado no aparece en ningún filtro.

## Controles propios

`Select`, `DatePicker` y `DateTimePicker` (de `@centrocolor/ui`) reemplazan a `<select>`, `<input type=date>` y `<input type=datetime-local>`; no volver a usar los nativos. `Select` acepta `<option>` como hijos o `options`, con `value` + `onChange(value)`. Estados: hover, foco (aro grafito + halo amarillo), seleccionado (barra amarilla y tilde), deshabilitado y error (`invalid`). Teclado: flechas/Inicio/Fin/RePág/AvPág, Enter/Espacio, Escape, letras; el calendario navega por días, semanas, meses y años. En ≤640 px el panel es una hoja inferior con objetivos de 44 px.

## Eliminar y Papelera

«Eliminar» se ofrece con `DeleteAction` (botón + `DeleteDialog`): «¿Eliminar este producto? Dejará de aparecer en Productos. Podés restaurarlo desde Configuración → Papelera. [Cancelar] [Eliminar]», con una línea opcional que explica qué se conserva (p. ej. «Las ventas anteriores siguen mostrándolo»). En el drawer de edición va junto a «Estado», no como acción principal. La Papelera es una entrada discreta al final de Configuración (`TrashPage`): tipo, nombre, fecha y «Restaurar». No se usa para ventas, pagos, movimientos, reservas históricas ni clientes (ver decisión 102).

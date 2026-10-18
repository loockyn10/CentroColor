# DESIGN-01/02 — Preview de la nueva identidad UX/UI

> **Adoptado (17/10/2026):** DESIGN-02 ya está implementado en `apps/web` y `apps/desktop` (ver `docs/CURRENT_STATE.md` y §16). Esta preview queda como **referencia histórica**: no se toca ni se despliega. Las afirmaciones de «no aplica nada a la app» de §14 describen su estado al momento de DESIGN-01/02.

> **DESIGN-02 (simplificación) está al final (§15) y prevalece sobre §5–§9 donde difieran**: portal con mínimo texto, panel ~35 % más tranquilo, Trabajos en Lista por defecto, Cobros como bandeja, Eventos como tablero.

Paquete aislado `apps/design-preview` (`@centrocolor/design-preview`). **No aplica nada a `apps/web` ni `apps/desktop`.** Usa únicamente datos simulados en memoria: sin Supabase, SQLite, Edge Functions, migraciones, sync, auth real ni APIs (no hay `fetch`, `localStorage` ni variables de entorno).

## 1. Cómo ejecutarla

```bash
pnpm install                                   # enlaza el paquete nuevo
pnpm --filter @centrocolor/design-preview dev  # http://127.0.0.1:5180
# o build + servidor estático
pnpm --filter @centrocolor/design-preview build
pnpm --filter @centrocolor/design-preview preview   # http://127.0.0.1:5181
```

Abrir `/` (índice). Los datos viven en memoria: recargar la página los reinicia (o «Reiniciar datos» en el índice).

## 2. Rutas

| Ruta                     | Qué muestra                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `/`                      | Índice de la preview, reinicio de datos                                   |
| `/imprimir`              | Portal público: tamaños, fotos, copias, datos, total persistente          |
| `/imprimir/recibido`     | PEDIDO RECIBIDO, transferencia, ESPERANDO TRANSFERENCIA                   |
| `/pedido/demo`           | Tracking con timeline y simulador de estados (solo preview)               |
| `/acceso`                | Acceso simulado (no autentica; no escribir credenciales reales)           |
| `/panel`                 | Dashboard «¿Qué necesita atención hoy?»                                   |
| `/panel/pos`             | POS: scanner/búsqueda, catálogo, carrito, cobro                           |
| `/panel/clientes`        | Listado + ficha                                                           |
| `/panel/productos`       | Inventario y ajuste de stock                                              |
| `/panel/agenda`          | Turnos Día / Semana                                                       |
| `/panel/eventos`         | Eventos + disponibilidad de recursos                                      |
| `/panel/marqueteria`     | Cotizador y trabajos de marquetería                                       |
| `/panel/trabajos`        | Cola de trabajos (tablero/lista) + ficha                                  |
| `/panel/produccion`      | Laboratorio vs Edición                                                    |
| `/panel/pagos`           | Total / Pagado / Saldo, «Confirmar transferencia»                         |
| `/panel/configuracion`   | Integraciones Drive / WhatsApp / Gmail, tamaños públicos                  |
| `/diseno`                | Sistema de diseño (paleta, contraste calculado, tipografías, componentes) |
| `/dispositivos?ruta=...` | La misma ruta en 390 / 768 / 1440 px (iframes; herramienta de escritorio) |

El estado se comparte entre portal y panel: confirmar un pedido en `/imprimir` crea el trabajo `CC-4F7K2` en «Esperando transferencia»; «Confirmar transferencia» en el panel lo pasa a «Recibido» y `/pedido/demo` lo refleja.

## 3. Paleta (HEX)

| Grupo    | Token                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Amarillo | Sol `#FFC914` (marca) · Pulido `#F2B100` · 300 `#FFE066` · 100 `#FFF1B8` · 50 `#FFF9E0` · Ocre `#B88000` (solo bordes)           |
| Grafito  | 950 `#110F0C` · 900 `#181613` · 800 `#26231E` · 700 `#3A362F` · 600 `#4F4A41` · 500 `#6A6458` (texto secundario) · 300 `#A39B8A` |
| Crema    | Papel 50 `#FBF6E9` (fondo) · 0 `#FFFDF8` (tarjetas) · 100 `#F4ECD6` · 200 `#E8DDBD` · 300 `#D4C598`                              |
| Rojo     | Revelado `#D7263D` · Texto `#AB1A2D` · 100 `#FDE3E6`                                                                             |
| Estados  | Verde `#1E7B4F` / `#17653F` / 100 `#DCF1E4` · Azul `#1F4A99` / 100 `#DDE8FB` · Ámbar `#8A5A00` / 100 `#FFEEC2`                   |

Contraste (calculado en `/diseno`): grafito sobre Sol 11,7:1 · grafito sobre papel 16,7:1 · texto secundario sobre papel 5,4:1 · Sol sobre grafito 11,7:1 · rojo texto sobre papel 6,7:1 · blanco sobre rojo 5,0:1 · verde/ámbar/azul sobre sus tintes 5,2–6,8:1. Todo ≥ AA.

## 4. Tipografías

Alojadas localmente (`public/fonts`, subconjunto latino, licencia OFL): **Bricolage Grotesque** 600–800 (títulos, cifras, totales) · **Figtree** 400–800 (interfaz, lectura) · **DM Mono** 400/500 (códigos, alias, numeración de fotograma). Cuerpo 16 px; mono en mayúsculas 12 px solo para etiquetas.

## 5. Superficies

Tarjeta (papel 0, borde 1,5 px, sombra suave) · Hundida (papel 100, sin sombra: columnas, tablas) · Pegatina (borde grafito 2 px + sombra dura: lo accionable) · Marca (amarillo Sol, una por pantalla) · Grafito (navegación, totales, estado «listo»). Motivos propios: **cinta de película** con perforaciones, **número de fotograma** (`▸ CC-4F7K2`) y **resaltador** amarillo bajo el título. Fondo de página con un grano de papel casi imperceptible.

## 6. Botones, inputs, cards, badges

- **Botones**: primario (Sol), secundario, oscuro, peligro, fantasma; 40/48/60 px. Hover sube, presionado se hunde (sombra dura).
- **Inputs**: 48 px, 16 px de fuente, borde grafito 2 px, error con borde rojo + ícono + texto. Prefijo `+54 9`, stepper de copias 52 px, segmentado, chips con contador, interruptor y casilla propios.
- **Badges**: siempre ícono + texto en mayúsculas mono; tonos amarillo, ámbar, rojo, verde, azul, grafito, discontinuo.
- **Cards de trabajo**: canto de color con patrón distinto por prioridad (rojo = urgente/atrasado, rayado amarillo/negro = esperando pago, verde = listo).

## 7. Navegación

Panel: 22 entradas planas → **11 módulos** agrupados por tarea (Hoy · Mostrador · Taller · Agenda · Catálogo · Sistema). Desktop ≥ 1100: barra lateral grafito con etiquetas y borde de película. Tablet 768–1099: riel de 92 px con ícono + etiqueta. Móvil < 768: barra superior + **tab bar inferior** de 5 (Inicio, Cobrar, Trabajos, Agenda, Más) y hoja «Más» con todo. Búsqueda global (`/`) y «＋ Nuevo» en la barra superior. Portal público: sin navegación administrativa, solo logo y «Mi pedido».

## 8. Portal público

Cabecera amarilla + hero «Imprimí tus fotos» + cómo funciona (4 pasos) → cinta de película. Tamaños como tarjetas con **proporción visual** (escala comprimida, no 1:1 entre tamaños), medidas y precio; Polaroid con insignia «Personalizable». Fotos agrupadas por tamaño con zona de arrastre (escritorio) / botón de galería (móvil), miniaturas grandes, progreso de subida simulado, copias `[−] n [+]` de 52 px, validación de formato. Resumen oscuro tipo ticket: sticky en escritorio y **barra inferior con total permanente** + hoja de detalle en móvil. `/imprimir/recibido`: sello, total enorme, alias con «Copiar», leyenda «La impresión se realiza una vez acreditado el pago» y aviso de WhatsApp. `/pedido/demo`: timeline de 5 pasos y, en LISTO PARA RETIRAR, panel grafito con el título a 96 px, dirección, horario y código de retiro. **Polaroid**: cada foto se muestra con marco blanco y leyenda, y un botón «Personalizar · muy pronto» deshabilitado marca el punto de entrada del futuro editor (entre «foto subida» y «copias»); no hay editor.

## 9. Panel interno

Dashboard (atención primero: lista priorizada con acción en línea, 8 tiles sin gráficos decorativos, turnos, eventos, cola) · POS (scanner HID simulado, búsqueda, categorías, carrito, forma de pago, vuelto, venta registrada) · Clientes (maestro-detalle) · Productos/Stock (barras de nivel, ajuste con movimiento) · Agenda (línea de tiempo y semana; lista cronológica en móvil) · Eventos y Recursos (matriz semanal) · Marquetería (cotizador: 30 × 40 → 140 cm de varilla, 0,12 m² de vidrio/fondo; varilla, vidrio, fondo, ganchos, pintura, mano de obra, total) · Trabajos (tablero por estado + lista, filtros ESPERANDO PAGO / URGENTE / ATRASADO / LISTO PARA ENTREGAR) · Producción (LABORATORIO y EDICIÓN separados; cliente, servicio, cantidad, copias, entrega, estado, Drive, pago; pedidos sin acreditar bloqueados) · Pagos (Total/Pagado/Saldo + «Confirmar transferencia» con verificación) · Configuración (Conectado / No conectado / Requiere atención).

## 10–11. Pantallas móviles y de escritorio

Validadas en 390 px (móvil), 768 px (tablet) y 1440/1920 px: sin desbordamiento horizontal en todas las rutas (salvo `/dispositivos`, herramienta de escritorio). En móvil: tab bar inferior, tablas → tarjetas, tablero → grupos por estado, panel lateral → hoja inferior, POS con barra de total y carrito en hoja. En escritorio: Producción, Trabajos (Lista) y Cobros usan filas operacionales a todo el ancho; en móvil la acción de cada fila baja a su propia línea y las tablas ocultan columnas secundarias.

## 12. Accesibilidad

Contraste calculado (≥ AA) · texto grafito sobre amarillo · objetivos táctiles ≥ 44–52 px (botones 48, stepper 52, chips 44) · estados **nunca solo por color** (ícono + palabra + canto con patrón) · foco visible: aro grafito 3 px + halo amarillo (amarillo sobre fondos oscuros) · enlace «Saltar al contenido» · diálogos con foco atrapado, `Esc`, y retorno de foco · `aria-pressed`, `aria-current`, `role=switch`, `aria-live` en totales y contadores · cuerpo 16 px (sin zoom en iOS) · `prefers-reduced-motion` respetado. **No verificado**: lector de pantalla real (NVDA/VoiceOver) ni dispositivos físicos.

## 13. Qué cambiaría antes de producción

1. **Logo**: el archivo es 1024 × 1024 px, raster, con resplandor integrado. Sirve para pantalla (hasta ~300 px a 3×) pero no para cartelería/impresión ni como favicon nítido. Pedir SVG/PDF vectorial y una versión plana para fondos oscuros.
2. **Regla de marquetería**: el dominio actual (`mouldingLengthMm`) suma `2 × ancho de varilla` cuando `faceWidthMm` está configurado (por defecto 0). La preview aplica la regla de negocio indicada (30 × 40 → 140 cm, sin sumar ancho de varilla). Hay que confirmar que producción tenga `faceWidthMm = 0` o decidir cuál prevalece.
3. **Pago por transferencia antes de imprimir es cambio de producto**: `PRODUCT.md` (Sprint 14) dice que el pago sigue en el local y que `WorkPayment` no cambia. Esta preview supone un estado `esperando transferencia`, una acción administrativa de confirmación, alias configurable y mapeo público de estados: requiere decisión, modelo de datos y backend.
4. **Consentimiento de WhatsApp**: DESIGN-02 quitó la casilla «Avisame por WhatsApp» del portal (el campo WhatsApp es el único dato de contacto; el borrador sigue con `notify: true`). Revisar con criterio legal si el consentimiento debe ser explícito antes de producción.
5. **Navegación**: 22 → 11 requiere pestañas secundarias dentro de cada módulo (Agenda: Calendario/Turnos/Tipos; Fotografía: Servicios; Marquetería: Varillas/Materiales; Catálogo: Servicios/Recursos) que la preview no replica por completo.
6. **Tipografías y CSS**: migrar `packages/ui/src/styles.css` (hoy `Inter` y paleta verde) a estos tokens; self-host ya resuelto (~124 KB de fuentes). Eliminar estilos en línea y partir el CSS por feature.
7. **Datos**: precios, dirección y teléfono del local son ficticios. La escala de las impresiones en las tarjetas está comprimida a propósito.
8. **No diseñado**: modo oscuro, impresión de comprobantes, estados de error de red/offline de Desktop, edición real (CRUD) de cada módulo, editor Polaroid, empty states de primer uso.
9. **Rendimiento**: un solo chunk (398 KB / 118 KB gzip); en producción cargar por ruta.
10. **Rutas**: la preview usa History API; al desplegarla hace falta el rewrite a `index.html` (como `apps/web/vercel.json`).

## 14. Qué se tocó

**No se modificó `apps/web`, `apps/desktop` ni `packages/*`** (domain, application, ui, features), ni Supabase, SQLite, Edge Functions, migraciones, sync, auth o APIs. Cambios fuera de `apps/design-preview/`: `pnpm-lock.yaml` (+22 líneas: el importer del paquete nuevo, necesario porque el workspace incluye `apps/*`; por eso `pnpm -r typecheck` y `pnpm build` ahora también compilan la preview) y este documento más notas breves en `docs/`. Sin commit ni push.

## 15. DESIGN-02 — Simplificación, jerarquía y reducción de ruido

La identidad de DESIGN-01 (amarillo, grafito, crema, logo, fotografía, tipografías, navegación) no cambia. Se quita ruido.

**Regla de copy.** Un texto sobrevive solo si ayuda a decidir, evita un error o explica una consecuencia no evidente. Portal: se eliminaron subtítulos de pasos, el estado vacío explicativo, la pista de WhatsApp, la casilla de aviso, el eyebrow del hero, «Sin cuenta, sin vueltas», el copy del resumen vacío y el bloque «Lo que sigue» de `/imprimir/recibido`. Queda la única aclaración comercial: «Se imprime una vez acreditada la transferencia.» (con ícono de info).

**Panel: capa `src/styles/calm.css`** (todo acotado a `.app`, el portal no se ve afectado).

- Amarillo sólido solo en navegación activa, CTA principal, selección importante y avisos que exigen acción. Las filas usan botones secundarios; el CTA de la bandeja de Cobros y «Confirmar pago» siguen en amarillo.
- Bordes de 1 px (`--paper-300`) en superficies comunes; borde grafito + sombra dura solo en CTA primario y carrito del POS. Sombras duras eliminadas del resto. Fondo de crema plano (sin grano).
- Resaltador `.marker` solo en el título de Inicio. Eyebrows/migas eliminadas de los títulos del panel (la barra lateral ya orienta).
- Badges: pastillas suaves sin borde. Información secundaria (origen, Drive, saldo, cantidad) pasa a texto (`.meta`, `.txt-warn`); el estado principal se muestra como línea `URGENTE · EN PROCESO` (`StateLine`) o una única pastilla. Filtros: chips finos con contador en texto; segmentado con pastilla clara en vez de bloque negro; interruptores encendidos en grafito.
- Barra lateral: el número solo aparece si requiere atención — Cobros (por confirmar, amarillo), Trabajos (**atrasados**, único rojo) y Productos (stock bajo). Ya no cuenta «listos».

**Cambios estructurales:** Inicio (4 KPI + «Para resolver ahora» protagonista; Turnos y un bloque compacto de seguimiento con saldos/eventos/marquetería; se quitó la cola de trabajos), Trabajos (**Lista por defecto**, filas operacionales; Tablero como alternativa), Producción (filas Cliente/Trabajo·Entrega/Estado/Acción en vez de tabla+tarjetas; sin banner de bloqueo), Cobros (bandeja compacta; el pedido abre la ficha con Total/Pagado/Saldo e Historial), Eventos (tablero Consulta · Presupuestado · Reservado · Realizado a todo el ancho), Clientes (selección pálida con acento amarillo; WhatsApp y Nuevo trabajo primarios, llamar/email secundarios; métricas y notas en texto) y la ficha de trabajo (Archivos/WhatsApp sin tarjetas ni pastillas; historial en vez de lista de pastillas).

**Solo pulido:** POS (bordes, categorías, tarjetas; el carrito conserva su peso), Marquetería (30 × 40 → 140 cm de varilla intacto), Agenda (título, controles y estados más suaves), Productos/Stock (KPI «Bajo mínimo» en amarillo pálido; el badge «OK» desaparece y solo se marca bajo mínimo / sin stock), Configuración.

Verificado en 390 / 768 / 1440 px: sin desbordes horizontales en las 14 rutas del portal y el panel; `pnpm --filter @centrocolor/design-preview build`, `tsc`, ESLint y Prettier pasan. Sin lector de pantalla ni dispositivos reales.

## 16. Adopción en producción

Mapa preview → producción: tokens y fuentes (`src/styles/tokens.css`) → `packages/ui/src/tokens.css`; componentes (`src/ui.tsx`, `ui.css`) → `packages/ui/src/primitives.tsx`, `sheet.tsx`, `components.css`; capa «calma» (`calm.css`) → valores por defecto del panel (el portal sube bordes y sombras dentro de `.portal`); shell (`PanelShell.tsx`) → `packages/ui/src/shell.tsx` + `navigation.ts` + `packages/features/src/panel-shell.tsx`; portal (`src/portal/*`, `portal.css`) → `apps/web/src/public-order/*`.

Diferencias necesarias (la preview supone cosas que el backend no hace): sin «Transferí»/alias/«Confirmar transferencia»/estado «esperando transferencia» (el pago es en el local; el paso 3 dice «Confirmá» y el copy de transferencia queda tras `PAYMENT_MODE`); la casilla de WhatsApp se **conserva**; sin dirección/horario ni «Personalizar · muy pronto»; fotos de muestra reemplazadas por impresiones dibujadas con la proporción real; Clientes sin «compras» (no existe el vínculo en el dominio); Stock sin «mínimo» (el estado crítico es «Sin stock»/«Negativo»); regla de varilla corregida en dominio (30 × 40 → 140 cm); Cobros usa saldos reales de `WorkPayment`; las pestañas de submódulo (§13.5) están implementadas.

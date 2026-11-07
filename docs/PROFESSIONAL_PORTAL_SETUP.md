# Portal profesional (`/profesionales`) — puesta en marcha

> **Para publicar, usar la lista consolidada de `docs/DEPLOY_CHECKLIST.md`** (migraciones, todas las funciones de ambos sprints, Auth, variables, comandos y pruebas pendientes). Lo que sigue explica el portal; si difiere en las funciones a desplegar, manda el checklist (p. ej. `public-photo-order-track` es obligatoria, no recomendada).

`/profesionales` es el mismo pedido de impresión que `/imprimir`, para fotógrafos y clientes con convenio: se ingresa con usuario, los precios son los de **su** lista (Profesional o un convenio), se pueden subir carpetas completas de una PC y el pago puede quedar pendiente **sólo si CentroColor lo autorizó**. No es otro sistema: comparte motor de precios, PhotoJob, subida a Drive, nombres de archivo con copias y Cobros con `/imprimir`.

## 1. Publicación (nada de esto se ejecutó desde el repo)

Orden: migración → funciones → Web.

```powershell
pnpm exec supabase db push --dry-run
```

Debe listar **únicamente** `20261107000000_professional_portal.sql`. Si es así y se autoriza:

```powershell
pnpm exec supabase db push
```

La migración es aditiva (tabla nueva, dos columnas nuevas en `public_photo_orders`, funciones `cc_professional_*` y `cc_auth_user_by_email`, dos triggers). **No hay migración SQLite**: los pedidos profesionales son `PhotoJob` normales con `source_channel = 'public_web'` y las columnas nuevas son sólo de Cloud.

Funciones nuevas (**con** verificación JWT: no usar `--no-verify-jwt`; cada una vuelve a validar al usuario por su cuenta):

```powershell
pnpm exec supabase functions deploy professional-catalog --use-api
pnpm exec supabase functions deploy professional-order-start --use-api
pnpm exec supabase functions deploy professional-order-submit --use-api
pnpm exec supabase functions deploy professional-admin --use-api
```

Funciones existentes que cambiaron:

```powershell
# Obligatoria: límites del pedido profesional (1000 fotos, 300 MB, 600 sesiones/min).
pnpm exec supabase functions deploy photo-upload-session --no-verify-jwt --use-api
# Obligatorias para el portal profesional: rechaza confirmar un pedido profesional sin su cuenta; el seguimiento deja de pedir transferencia a quien paga después (la remota es v1 del 17/10).
pnpm exec supabase functions deploy public-photo-order-submit --no-verify-jwt --use-api
pnpm exec supabase functions deploy public-photo-order-track --no-verify-jwt --use-api
```

No requieren redeploy: `public-photo-catalog`, `public-photo-order-start`, `photo-upload-finalize`, `photo-upload-context`, `photo-upload-submit`, `photo-file-admin`, WhatsApp y OAuth (sólo cambian por refactor, sin diferencia de comportamiento).

Después, publicar la Web (Vercel; no hay variables nuevas: `vercel.json` ya reescribe cualquier ruta a `index.html`).

### Supabase Auth (Dashboard → Authentication)

- **URL Configuration → Redirect URLs**: agregar `https://<dominio-de-la-web>/profesionales`. Sin eso los e-mails de invitación y «Olvidé mi contraseña» no vuelven al portal.
- La invitación usa el e-mail de Supabase: con el SMTP por defecto el envío está muy limitado; para uso real conviene un SMTP propio (Authentication → SMTP Settings).
- Opcional: desactivar el registro libre de usuarios. No es un riesgo (un usuario sin cuenta profesional no ve nada), pero evita usuarios huérfanos.

## 2. Dar acceso a un fotógrafo

Requisito: el profesional ya es un **Cliente** y tiene asignada una lista **Profesional** o de **convenio** (Clientes → Editar → Lista de precios; ejemplos: fotógrafo común → _Profesional_; Diego → _Convenio Diego_). Los precios de esa lista se cargan en Configuración → Precios → Laboratorio.

1. **Configuración → Integraciones → Portal profesional → Dar acceso a un profesional** (sólo owner/admin).
2. Elegir el cliente (los que no tienen lista Profesional/convenio aparecen deshabilitados), escribir el e-mail de acceso y, si corresponde, tildar _Puede pagar después_.
3. Si el e-mail no tiene usuario, Supabase le envía una invitación para que elija su contraseña al entrar a `/profesionales`. Si ya tenía usuario, entra con su contraseña.

Desde la misma tarjeta: **Permitir/Quitar pago posterior** y **Desactivar/Reactivar**. Los cambios rigen desde el siguiente pedido. Cambiar la lista del cliente (Clientes → Editar) cambia lo que ve y paga en el portal al instante; los pedidos ya confirmados conservan su precio.

Sin interfaz (SQL Editor, equivalente a «Dar acceso»; el usuario debe existir en Authentication → Users):

```sql
select public.cc_professional_link(
  '<business_id>',
  public.cc_auth_user_by_email('fotografo@ejemplo.com'),
  '<customer_id>',
  false,   -- true = puede pagar después
  null
);
```

Un e-mail del equipo de CentroColor (con membership) **no** puede ser profesional y viceversa: lo impide la base. Para probar el portal con la cuenta propia hay que usar otro e-mail.

## 3. Cómo se decide qué ve y paga cada cuenta

`JWT → professional_accounts → Customer → Customer.price_list_id`, todo en el servidor. Si el cliente no tiene lista, o su lista es la pública o está inactiva, el portal muestra «Tu cuenta todavía no tiene lista de precios» y no permite pedir: nunca se cae al precio público. El navegador sólo envía formato, papel y cantidad; el total que ve sirve para detectar una lista vieja (`price_changed`). Los precios profesionales sólo salen de `professional-catalog`, que responde 401/403 a cualquier llamada anónima o de otra cuenta.

Pago: `prepaid` (por defecto) muestra alias y «se imprime una vez acreditado el pago», igual que `/imprimir`; `deferred` confirma el pedido con pago pendiente. La condición queda congelada en `public_photo_orders.payment_terms`, en las notas del pedido («Pedido profesional (web) · pago posterior autorizado») y en `PEDIDO.txt`; el saldo sigue la contabilidad de siempre (Cobros).

## 4. Carga de carpetas

El navegador entrega la carpeta como lista de archivos locales (`webkitdirectory`: Chrome, Edge, Firefox y Safari de escritorio; si no existe, queda «Seleccionar fotografías», que admite selección múltiple y arrastrar). Se suman las subcarpetas; los archivos que no son fotos (`.lrcat`, `.xmp`, `.DS_Store`) se ignoran y se informa cuántos. Las fotos se ordenan por nombre natural (IMG_2 antes que IMG_10) y esa posición define la numeración en Drive. Volver a elegir la misma carpeta no duplica nada.

- Los archivos nunca se leen enteros a memoria: sólo se tiene la referencia y se sube por chunks. La lista usa filas fijas virtualizadas (500 fotos = ~12 filas en pantalla) y las miniaturas se decodifican chicas, de a dos, sólo para las filas visibles (HEIC/TIFF muestran un ícono).
- Subida: 4 fotos en paralelo sobre las funciones `photo-upload-*` existentes. Cada reintento nombra su intento anterior, de modo que una foto que ya llegó nunca se sube dos veces. Si algunas fallan: «Reintentar las N que fallaron» envía sólo esas, o «Enviar sin esas fotos» (explícito). Si el servidor pide ir más despacio (`rate_limited`) el cliente espera y reintenta.
- Límites de un pedido profesional: 1000 fotos, 300 MB por foto, hasta 50 000 copias por formato, 600 sesiones por minuto (público: 200 fotos, 100 MB, 1000 copias, 120 por minuto).

Drive mantiene la estructura de `/imprimir`: `Trabajos/<año>/<mes>/CC-XXXXXXXX - <Cliente>/Para imprimir/<tamaño · papel · <lista>>/001_2copias.jpg`; el nombre original queda en la base y `PEDIDO.txt` lista cada archivo con sus copias.

## 5. Prueba de humo (pendiente de hacer con servicios reales)

1. Crear/ubicar un cliente con lista Profesional, darle acceso con un e-mail propio, abrir el link de invitación y elegir contraseña.
2. En `/profesionales`: comprobar que ve los precios Profesional (y no los públicos).
3. 10×15 Brillo → _Seleccionar carpeta_ con 100+ fotos reales de Lightroom; _Copias para todas_ = 2; cambiar una foto a 5. 13×18 Mate con una selección múltiple. Confirmar.
4. En Drive: una carpeta por formato y papel con `001_2copias.jpg`…, y `PEDIDO.txt`. En la Web: el pedido aparece en Producción con `ORIGEN: WEB`, cliente = el profesional y la nota de pago.
5. Con y sin _Puede pagar después_: pantalla de pedido recibido («Pago pendiente» vs alias de transferencia).
6. Con esa cuenta abrir `/`: debe decir «Sin acceso asignado». Con una cuenta del equipo abrir `/profesionales`: «no tiene acceso al portal profesional».
7. Cortar la conexión a mitad de una carga grande y comprobar el reintento sólo de las fallidas.

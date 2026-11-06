import { PublicShell, useDocumentMeta } from './shell';

/**
 * Política de privacidad pública (/privacidad). También es la URL que Google pide en la
 * pantalla de consentimiento OAuth. Sin login, indexable.
 */
export const PRIVACY_UPDATED = '6 de noviembre de 2026';

export function PrivacyPolicy() {
  useDocumentMeta('Política de privacidad · CentroColor', false);
  return (
    <PublicShell orderLink={false}>
      <div className="pt-page">
        <article className="po-card po-prose">
          <h1>Política de privacidad</h1>
          <p className="po-prose-date">
            Última actualización: {PRIVACY_UPDATED}
          </p>
          <p>
            CentroColor es un laboratorio fotográfico. Esta página explica qué
            datos usamos cuando pedís una impresión desde este sitio, para qué y
            qué podés hacer con ellos.
          </p>

          <h2>Qué datos recibimos</h2>
          <ul>
            <li>Tu nombre y tu teléfono de WhatsApp (obligatorios).</li>
            <li>Tu email y notas del pedido (opcionales).</li>
            <li>
              Las fotos que subís, con el tamaño y la cantidad de copias de cada
              una.
            </li>
            <li>
              Datos técnicos mínimos para que el sitio funcione, como el
              identificador de tu pedido guardado en tu propio navegador.
            </li>
          </ul>

          <h2>Para qué los usamos</h2>
          <ul>
            <li>Preparar, imprimir y entregar tu pedido.</li>
            <li>
              Avisarte por WhatsApp sobre el estado de tu pedido, sólo si lo
              aceptaste al hacerlo.
            </li>
            <li>Atender consultas y reclamos sobre ese pedido.</li>
          </ul>
          <p>
            No vendemos tus datos, no los usamos para publicidad ni los
            compartimos con terceros para sus propios fines.
          </p>

          <h2>Dónde se guardan tus fotos</h2>
          <p>
            Las fotos se guardan en una carpeta de Google Drive del negocio,
            organizada por pedido. La conexión con Google Drive usa un permiso
            limitado (<em>drive.file</em>): CentroColor sólo puede ver y
            modificar los archivos y carpetas que crea para sus pedidos, no el
            resto del Drive. Los datos del pedido se guardan en una base de
            datos con acceso restringido al personal del negocio.
          </p>
          <p>
            El uso de la información recibida de las APIs de Google se ajusta a
            la Política de datos de usuario de los Servicios de API de Google,
            incluidos los requisitos de Uso Limitado. Esa información se usa
            únicamente para guardar y entregar los pedidos de impresión.
          </p>

          <h2>Con quién se comparte</h2>
          <ul>
            <li>
              <strong>Google (Drive):</strong> almacenamiento de las fotos.
            </li>
            <li>
              <strong>Meta (WhatsApp):</strong> envío de avisos del pedido, si
              los aceptaste.
            </li>
            <li>
              <strong>
                Servicios de alojamiento del sitio y la base de datos:
              </strong>{' '}
              necesarios para que el sitio funcione.
            </li>
          </ul>

          <h2>Cuánto tiempo las conservamos</h2>
          <p>
            Conservamos los datos y las fotos mientras sea necesario para
            realizar el pedido, atender reclamos y cumplir obligaciones legales.
          </p>

          <h2>Tus derechos</h2>
          <p>
            Podés pedirnos ver, corregir o eliminar tus datos y tus fotos.
            Escribinos desde el WhatsApp con el que te avisamos de tu pedido, o
            acercate al local, indicando tu nombre y el código de tu pedido (por
            ejemplo, CC-1A2B3C4D).
          </p>

          <h2>Cambios en esta política</h2>
          <p>
            Si cambiamos algo importante, actualizaremos esta página y la fecha
            de arriba.
          </p>
        </article>
      </div>
    </PublicShell>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import type {
  BusinessContext,
  WhatsAppAdminRepository,
  WhatsAppIntegrationView,
  WhatsAppTestResult,
} from '@centrocolor/application';
import { Card, StateLine } from '@centrocolor/ui';

const stateLabel: Record<WhatsAppIntegrationView['status'], string> = {
  not_configured: 'Sin configurar',
  configured: 'Configurado',
  error: 'Requiere revisión',
  disconnected: 'Desconectado',
};

const errorText = (x: unknown) =>
  x instanceof Error ? x.message : 'No se pudo completar la operación.';

/** Configuración → Integraciones → WhatsApp (owner/admin). The token is write-only. */
export function WhatsAppSettingsPage({
  context,
  repository,
}: {
  context: BusinessContext;
  repository: WhatsAppAdminRepository;
}) {
  const [integration, setIntegration] =
    useState<WhatsAppIntegrationView | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [test, setTest] = useState<WhatsAppTestResult | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [templateName, setTemplateName] = useState('pedido_listo');
  const [templateLanguage, setTemplateLanguage] = useState('es_AR');
  const [accessToken, setAccessToken] = useState('');

  const admin = context.role !== 'staff';
  const load = () =>
    repository
      .getIntegration(context.businessId)
      .then((value) => {
        setIntegration(value);
        setEditing(value.status === 'not_configured');
        if (value.phoneNumberId) setPhoneNumberId(value.phoneNumberId);
        if (value.wabaId) setWabaId(value.wabaId);
        if (value.templateName) setTemplateName(value.templateName);
        if (value.templateLanguage) setTemplateLanguage(value.templateLanguage);
      })
      .catch((x) => setMessage(errorText(x)));
  useEffect(() => {
    if (admin) void load();
  }, [context.businessId, admin, repository]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (x) {
      setMessage(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const token = accessToken;
      setAccessToken('');
      setIntegration(
        await repository.configure(context.businessId, {
          phoneNumberId: phoneNumberId.trim(),
          wabaId: wabaId.trim(),
          templateName: templateName.trim(),
          templateLanguage: templateLanguage.trim(),
          accessToken: token.trim(),
        }),
      );
      setEditing(false);
      setTest(null);
      setMessage('Configuración guardada. Probá la conexión para verificarla.');
    });
  };
  const probe = () =>
    run(async () => {
      const result = await repository.test(context.businessId);
      setTest(result);
      setIntegration(result.integration);
    });
  const disconnect = () => {
    if (
      !window.confirm(
        '¿Desconectar WhatsApp? Se borra el token guardado. Los pedidos siguen funcionando, pero no se enviarán avisos.',
      )
    )
      return;
    void run(async () => {
      setIntegration(await repository.disconnect(context.businessId));
      setTest(null);
      setEditing(true);
    });
  };

  if (!admin)
    return (
      <Card className="integration">
        <header className="integration-head">
          <h2>WhatsApp</h2>
        </header>
        <p className="muted">
          Tu rol puede operar trabajos, pero sólo owner/admin puede configurar
          WhatsApp.
        </p>
      </Card>
    );
  const configured = integration && integration.status !== 'not_configured';
  return (
    <>
      <Card className="integration whatsapp-settings">
        <header className="integration-head">
          <h2>WhatsApp</h2>
          <StateLine
            parts={[
              {
                text: integration ? stateLabel[integration.status] : '…',
                tone:
                  integration?.status === 'configured'
                    ? 'ok'
                    : integration?.status === 'error'
                      ? 'alert'
                      : undefined,
              },
            ]}
          />
        </header>
        {message && <p className="appointment-error">{message}</p>}
        <dl>
          <dt>Número configurado</dt>
          <dd>
            {integration?.displayPhoneNumber ??
              (integration?.phoneNumberId
                ? `ID ${integration.phoneNumberId}`
                : '—')}
          </dd>
          <dt>Plantilla</dt>
          <dd>{integration?.templateName ?? '—'}</dd>
          <dt>Idioma</dt>
          <dd>{integration?.templateLanguage ?? '—'}</dd>
        </dl>
        {integration?.lastCheckError && (
          <p className="whatsapp-error">{integration.lastCheckError}</p>
        )}
        {integration?.status === 'not_configured' && (
          <p>
            Sin WhatsApp los pedidos funcionan igual: sólo queda sin enviar el
            aviso automático.
          </p>
        )}
        <div className="photo-actions">
          <button
            className="customer-primary"
            disabled={busy}
            onClick={() => setEditing((value) => !value)}
          >
            {configured ? 'Cambiar configuración' : 'Configurar'}
          </button>
          {configured && integration.status !== 'disconnected' && (
            <>
              <button disabled={busy} onClick={() => void probe()}>
                Probar conexión
              </button>
              <button
                className="danger-action"
                disabled={busy}
                onClick={disconnect}
              >
                Desconectar
              </button>
            </>
          )}
        </div>
        {test && (
          <p className={test.ok ? 'whatsapp-ok' : 'whatsapp-error'}>
            {test.ok
              ? `✓ Conexión correcta${test.displayPhoneNumber ? ` (${test.displayPhoneNumber})` : ''}${test.template?.checked ? ` · plantilla ${test.template.status}` : ' · cargá el WABA ID para verificar la plantilla'}.`
              : `⚠ ${test.message ?? 'La conexión falló.'}`}
          </p>
        )}
      </Card>
      {editing && (
        <Card>
          <form
            className="photo-service-form"
            onSubmit={save}
            autoComplete="off"
          >
            <label>
              Phone Number ID *
              <input
                required
                inputMode="numeric"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
              />
            </label>
            <label>
              WABA ID (cuenta de WhatsApp Business)
              <input
                inputMode="numeric"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
              />
            </label>
            <label>
              Nombre de la plantilla *
              <input
                required
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </label>
            <label>
              Idioma de la plantilla *
              <input
                required
                value={templateLanguage}
                onChange={(e) => setTemplateLanguage(e.target.value)}
              />
            </label>
            <label>
              Token de acceso
              {integration?.status === 'not_configured' ? ' *' : ''}
              <input
                type="password"
                autoComplete="new-password"
                required={!configured || integration?.status === 'disconnected'}
                placeholder={
                  configured && integration?.status !== 'disconnected'
                    ? 'Dejar vacío para conservar el actual'
                    : ''
                }
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
              <small>
                Se guarda cifrado en el servidor y no se vuelve a mostrar.
              </small>
            </label>
            <div>
              <button
                className="customer-primary"
                type="submit"
                disabled={busy}
              >
                Guardar
              </button>
              {configured && (
                <button type="button" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </Card>
      )}
    </>
  );
}

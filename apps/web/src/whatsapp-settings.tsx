import { useEffect, useState } from 'react';
import type {
  BusinessContext,
  WhatsAppAdminRepository,
  WhatsAppIntegrationView,
  WhatsAppTestResult,
} from '@centrocolor/application';
import {
  Button,
  ConfirmDialog,
  FormDrawer,
  InlineMessage,
  IntegrationCard,
  StatusBadge,
} from '@centrocolor/ui';

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
  const [confirming, setConfirming] = useState(false);
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
  const save = () =>
    run(async () => {
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
  const probe = () =>
    run(async () => {
      const result = await repository.test(context.businessId);
      setTest(result);
      setIntegration(result.integration);
    });
  const disconnect = () => {
    setConfirming(false);
    return run(async () => {
      setIntegration(await repository.disconnect(context.businessId));
      setTest(null);
    });
  };

  if (!admin)
    return (
      <IntegrationCard title="WhatsApp">
        <p className="meta">Sólo owner o admin pueden configurar WhatsApp.</p>
      </IntegrationCard>
    );
  const configured = integration && integration.status !== 'not_configured';
  return (
    <>
      <IntegrationCard
        title="WhatsApp"
        status={
          <StatusBadge
            tone={
              integration?.status === 'configured'
                ? 'ok'
                : integration?.status === 'error'
                  ? 'alert'
                  : 'closed'
            }
          >
            {integration ? stateLabel[integration.status] : '…'}
          </StatusBadge>
        }
        details={[
          {
            label: 'Número configurado',
            value:
              integration?.displayPhoneNumber ??
              (integration?.phoneNumberId
                ? `ID ${integration.phoneNumberId}`
                : '—'),
          },
          { label: 'Plantilla', value: integration?.templateName ?? '—' },
          { label: 'Idioma', value: integration?.templateLanguage ?? '—' },
        ]}
        actions={
          <>
            <Button
              variant={configured ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              {configured ? 'Cambiar configuración' : 'Configurar'}
            </Button>
            {configured && integration.status !== 'disconnected' && (
              <>
                <Button disabled={busy} onClick={() => void probe()}>
                  Probar conexión
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Desconectar
                </Button>
              </>
            )}
          </>
        }
      >
        {message && !editing && (
          <InlineMessage tone="info">{message}</InlineMessage>
        )}
        {integration?.lastCheckError && (
          <InlineMessage tone="error">
            {integration.lastCheckError}
          </InlineMessage>
        )}
        {integration?.status === 'not_configured' && (
          <p className="meta">
            Sin WhatsApp los pedidos funcionan igual: sólo queda sin enviar el
            aviso automático.
          </p>
        )}
        {test && (
          <InlineMessage tone={test.ok ? 'success' : 'error'}>
            {test.ok
              ? `Conexión correcta${test.displayPhoneNumber ? ` (${test.displayPhoneNumber})` : ''}${test.template?.checked ? ` · plantilla ${test.template.status}` : ' · cargá el WABA ID para verificar la plantilla'}.`
              : (test.message ?? 'La conexión falló.')}
          </InlineMessage>
        )}
      </IntegrationCard>
      <FormDrawer
        open={editing}
        onClose={() => setEditing(false)}
        title="Configurar WhatsApp"
        busy={busy}
        error={editing ? message : null}
        onSubmit={save}
      >
        <label>
          Phone Number ID *
          <input
            required
            inputMode="numeric"
            autoComplete="off"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          />
        </label>
        <label>
          WABA ID (cuenta de WhatsApp Business)
          <input
            inputMode="numeric"
            autoComplete="off"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
          />
        </label>
        <div className="config-editor-form__grid">
          <label>
            Nombre de la plantilla *
            <input
              required
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </label>
          <label>
            Idioma *
            <input
              required
              value={templateLanguage}
              onChange={(e) => setTemplateLanguage(e.target.value)}
            />
          </label>
        </div>
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
          <small className="meta">
            Se guarda cifrado en el servidor y no se vuelve a mostrar.
          </small>
        </label>
      </FormDrawer>
      <ConfirmDialog
        open={confirming}
        title="Desconectar WhatsApp"
        destructive
        confirmLabel="Desconectar"
        onCancel={() => setConfirming(false)}
        onConfirm={disconnect}
      >
        Se borra el token guardado. Los pedidos siguen funcionando, pero no se
        enviarán avisos.
      </ConfirmDialog>
    </>
  );
}

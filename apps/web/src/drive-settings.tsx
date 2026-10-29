import { useEffect, useState } from 'react';
import type {
  BusinessContext,
  GoogleDriveIntegrationView,
  PhotoFileIntakeAdminRepository,
} from '@centrocolor/application';
import {
  Button,
  ConfirmDialog,
  InlineMessage,
  IntegrationCard,
  StatusBadge,
  type MessageTone,
} from '@centrocolor/ui';

/** Configuración → Integraciones → Google Drive (owner/admin). Configuración técnica, no operativa. */
export function DriveSettingsPage({
  context,
  repository,
}: {
  context: BusinessContext;
  repository: PhotoFileIntakeAdminRepository;
}) {
  const [integration, setIntegration] =
    useState<GoogleDriveIntegrationView | null>(null);
  const [message, setMessage] = useState<{
    tone: MessageTone;
    text: string;
  } | null>(() => {
    const query = new URLSearchParams(window.location.search);
    return query.get('googleDrive') === 'error'
      ? {
          tone: 'error',
          text: query.get('message') ?? 'No se pudo conectar Google Drive.',
        }
      : query.get('googleDrive') === 'connected'
        ? { tone: 'success', text: 'Google Drive quedó conectado.' }
        : null;
  });
  const [confirming, setConfirming] = useState(false);
  const fail = (x: unknown, fallback: string) =>
    setMessage({
      tone: 'error',
      text: x instanceof Error ? x.message : fallback,
    });
  const load = () =>
    repository
      .getDriveIntegration(context.businessId)
      .then(setIntegration)
      .catch((x) => fail(x, 'No se pudo consultar Google Drive.'));
  useEffect(() => {
    if (context.role !== 'staff') void load();
  }, [context.businessId, context.role, repository]);
  async function connect() {
    try {
      window.location.assign(
        await repository.startDriveConnection(context.businessId),
      );
    } catch (x) {
      fail(x, 'No se pudo iniciar Google OAuth.');
    }
  }
  async function disconnect() {
    setConfirming(false);
    try {
      await repository.disconnectDrive(context.businessId);
      await load();
    } catch (x) {
      fail(x, 'No se pudo desconectar.');
    }
  }
  if (context.role === 'staff')
    return (
      <IntegrationCard title="Google Drive">
        <p className="meta">
          Sólo owner o admin pueden administrar Google Drive.
        </p>
      </IntegrationCard>
    );
  const connected = integration?.status === 'connected';
  const needsAttention =
    integration?.status === 'reconnect_required' ||
    integration?.status === 'error';
  return (
    <IntegrationCard
      title="Google Drive"
      status={
        <StatusBadge
          tone={connected ? 'ok' : needsAttention ? 'alert' : 'closed'}
        >
          {connected
            ? 'Conectado'
            : needsAttention
              ? 'Requiere atención'
              : 'No conectado'}
        </StatusBadge>
      }
      details={
        connected
          ? [
              {
                label: 'Cuenta',
                value: integration.googleAccountEmail ?? 'cuenta Google',
              },
            ]
          : undefined
      }
      actions={
        connected ? (
          <>
            <Button
              onClick={() =>
                repository.openDriveFolder(integration.rootFolderId!)
              }
            >
              Abrir Drive
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Desconectar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => void connect()}>
            {needsAttention ? 'Reconectar' : 'Conectar'}
          </Button>
        )
      }
    >
      {message && (
        <InlineMessage tone={message.tone}>{message.text}</InlineMessage>
      )}
      {!connected && (
        <p className="meta">
          {needsAttention
            ? 'Reconectá para seguir recibiendo fotos de clientes.'
            : 'Se usa para recibir las fotos de los pedidos.'}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title="Desconectar Google Drive"
        destructive
        confirmLabel="Desconectar"
        onCancel={() => setConfirming(false)}
        onConfirm={disconnect}
      >
        La metadata histórica se conservará.
      </ConfirmDialog>
    </IntegrationCard>
  );
}

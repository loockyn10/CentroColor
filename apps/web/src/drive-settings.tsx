import { useEffect, useState } from 'react';
import type {
  BusinessContext,
  GoogleDriveIntegrationView,
  PhotoFileIntakeAdminRepository,
} from '@centrocolor/application';
import { Card, StateLine } from '@centrocolor/ui';

export function DriveSettingsPage({
  context,
  repository,
}: {
  context: BusinessContext;
  repository: PhotoFileIntakeAdminRepository;
}) {
  const [integration, setIntegration] =
    useState<GoogleDriveIntegrationView | null>(null);
  const [message, setMessage] = useState<string | null>(() => {
    const query = new URLSearchParams(window.location.search);
    return query.get('googleDrive') === 'error'
      ? (query.get('message') ?? 'No se pudo conectar Google Drive.')
      : query.get('googleDrive') === 'connected'
        ? 'Google Drive quedó conectado.'
        : null;
  });
  const load = () =>
    repository
      .getDriveIntegration(context.businessId)
      .then(setIntegration)
      .catch((x) =>
        setMessage(
          x instanceof Error ? x.message : 'No se pudo consultar Google Drive.',
        ),
      );
  useEffect(() => {
    if (context.role !== 'staff') void load();
  }, [context.businessId, context.role, repository]);
  async function connect() {
    try {
      window.location.assign(
        await repository.startDriveConnection(context.businessId),
      );
    } catch (x) {
      setMessage(
        x instanceof Error ? x.message : 'No se pudo iniciar Google OAuth.',
      );
    }
  }
  async function disconnect() {
    if (
      !window.confirm(
        '¿Desconectar Google Drive? La metadata histórica se conservará.',
      )
    )
      return;
    try {
      await repository.disconnectDrive(context.businessId);
      await load();
    } catch (x) {
      setMessage(x instanceof Error ? x.message : 'No se pudo desconectar.');
    }
  }
  if (context.role === 'staff')
    return (
      <Card className="integration">
        <header className="integration-head">
          <h2>Google Drive</h2>
        </header>
        <p className="muted">
          Tu rol puede operar trabajos, pero sólo owner/admin puede administrar
          Google Drive.
        </p>
      </Card>
    );
  const connected = integration?.status === 'connected';
  const needsAttention =
    integration?.status === 'reconnect_required' ||
    integration?.status === 'error';
  return (
    <Card className="integration drive-settings">
      <header className="integration-head">
        <h2>Google Drive</h2>
        <StateLine
          parts={[
            connected
              ? { text: 'Conectado', tone: 'ok' }
              : needsAttention
                ? { text: 'Requiere atención', tone: 'alert' }
                : { text: 'No conectado' },
          ]}
        />
      </header>
      {message && <p className="appointment-error">{message}</p>}
      {connected ? (
        <>
          <p>
            Conectado como{' '}
            <strong>{integration.googleAccountEmail ?? 'cuenta Google'}</strong>
          </p>
          <div className="photo-actions">
            <button
              onClick={() =>
                repository.openDriveFolder(integration.rootFolderId!)
              }
            >
              Abrir Drive
            </button>
            <button className="danger-action" onClick={() => void disconnect()}>
              Desconectar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {needsAttention
              ? 'Reconectá Google Drive para seguir recibiendo fotos de clientes.'
              : 'Conectá Google Drive para recibir fotos de clientes.'}
          </p>
          <div className="photo-actions">
            <button className="customer-primary" onClick={() => void connect()}>
              {needsAttention
                ? 'Reconectar Google Drive'
                : 'Conectar Google Drive'}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

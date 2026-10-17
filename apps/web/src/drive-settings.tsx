import { useEffect, useState } from 'react';
import type {
  BusinessContext,
  GoogleDriveIntegrationView,
  PhotoFileIntakeAdminRepository,
} from '@centrocolor/application';
import { Card, PageHeader } from '@centrocolor/ui';

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
      <>
        <PageHeader
          eyebrow="CONFIGURACIÓN · INTEGRACIONES"
          title="Google Drive"
          description="Almacenamiento principal de los archivos enviados por clientes."
        />
        <Card>
          <p>
            Tu rol puede operar trabajos, pero sólo owner/admin puede
            administrar Google Drive.
          </p>
        </Card>
      </>
    );
  const connected = integration?.status === 'connected';
  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACIÓN · INTEGRACIONES"
        title="Google Drive"
        description="Almacenamiento principal de los archivos enviados por clientes."
      />
      {message && <p className="appointment-error">{message}</p>}
      <Card className="drive-settings">
        {connected ? (
          <>
            <strong>
              Conectado como {integration.googleAccountEmail ?? 'cuenta Google'}
            </strong>
            <span>Carpeta raíz CentroColor vinculada por ID.</span>
            <div>
              <button
                onClick={() =>
                  repository.openDriveFolder(integration.rootFolderId!)
                }
              >
                Abrir Drive
              </button>
              <button
                className="danger-action"
                onClick={() => void disconnect()}
              >
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <strong>
              {integration?.status === 'reconnect_required' ||
              integration?.status === 'error'
                ? 'Google Drive requiere reconexión'
                : 'Google Drive no está conectado'}
            </strong>
            <p>Conectá Google Drive para recibir fotos de clientes.</p>
            <button className="customer-primary" onClick={() => void connect()}>
              Conectar Google Drive
            </button>
          </>
        )}
      </Card>
    </>
  );
}

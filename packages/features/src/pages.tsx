import { Card, PageHeader } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

const cards = [
  'Turnos de hoy',
  'Trabajos pendientes',
  'Próximos eventos',
  'Ventas de hoy',
];

export function HomePage({ onRevalidate }: { onRevalidate?: () => void }) {
  const context = useBusinessContext();
  return (
    <>
      <PageHeader
        eyebrow="PANEL PRINCIPAL"
        title="Inicio"
        description="Un vistazo a la actividad del negocio."
      />
      <p className="identity-summary">
        {context.profile.displayName || 'Usuario'} · {context.businessName}
        {context.branchName ? ` · ${context.branchName}` : ''}
      </p>
      {context.authorization === 'offline-authenticated' && (
        <p className="offline-notice">
          Modo offline · autorización local validada por última vez el{' '}
          {new Date(context.lastCloudValidationAt).toLocaleString('es-AR')}.{' '}
          {onRevalidate && (
            <button type="button" onClick={onRevalidate}>
              Revalidar acceso con Internet
            </button>
          )}
        </p>
      )}
      <div className="cards-grid">
        {cards.map((title) => (
          <Card key={title} className="metric-card">
            <h2>{title}</h2>
            <div className="metric-placeholder">—</div>
            <p>Disponible en próximos sprints</p>
          </Card>
        ))}
      </div>
    </>
  );
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader
        eyebrow="PRÓXIMAMENTE"
        title={title}
        description="Esta sección se incorporará en un próximo sprint."
      />
      <Card className="placeholder-card">
        <h2>Sección en preparación</h2>
        <p>
          La navegación está lista. Las funciones de esta sección se definirán e
          implementarán más adelante.
        </p>
      </Card>
    </>
  );
}

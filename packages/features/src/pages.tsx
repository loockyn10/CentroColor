import { Card, PageHeader } from '@centrocolor/ui';

const cards = [
  'Turnos de hoy',
  'Trabajos pendientes',
  'Próximos eventos',
  'Ventas de hoy',
];

export function HomePage() {
  return (
    <>
      <PageHeader
        eyebrow="PANEL PRINCIPAL"
        title="Inicio"
        description="Un vistazo a la actividad del negocio."
      />
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

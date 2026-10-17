export const spanishMonths = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export function jobFolderPlan(
  jobId: string,
  customerName: string,
  createdAt: string,
) {
  const created = new Date(createdAt);
  const year = created.getUTCFullYear();
  const month = created.getUTCMonth();
  return [
    { key: 'jobs', name: 'Trabajos' },
    { key: `year:${year}`, name: String(year) },
    { key: `month:${year}-${month + 1}`, name: spanishMonths[month] },
    {
      key: `job:${jobId}`,
      name: `CC-${jobId.slice(0, 8).toUpperCase()} - ${customerName}`,
    },
  ];
}

export function routeFolderPlan(
  route: 'lab' | 'editing' | 'other',
  itemId: string,
  serviceName: string,
) {
  return {
    route: {
      key: `route:${route}`,
      name:
        route === 'lab'
          ? 'Para imprimir'
          : route === 'editing'
            ? 'Para editar'
            : 'Otros',
    },
    item: { key: `item:${itemId}`, name: serviceName },
  };
}

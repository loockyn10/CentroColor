import { useState, type ReactNode } from 'react';
import type { Customer } from '@centrocolor/domain';
import { Button, Segmented } from '@centrocolor/ui';

/**
 * Cliente de un turno o presupuesto: búsqueda y selección en una sola fila y alta rápida bajo
 * demanda. Reemplaza las tres filas («Buscar cliente», «Cliente *», «+ Crear cliente»).
 */
export function CustomerField({
  customers,
  query,
  onQuery,
  value,
  onChange,
  onQuickCreate,
  busy = false,
}: {
  customers: Customer[];
  query: string;
  onQuery: (query: string) => void;
  value: string;
  onChange: (customerId: string) => void;
  /** Devuelve true si el cliente se creó y quedó seleccionado. */
  onQuickCreate: (fullName: string) => Promise<boolean>;
  busy?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="customer-field">
      <label>
        Buscar cliente
        <input
          type="search"
          value={query}
          placeholder="Nombre, teléfono, email o documento"
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <label>
        Cliente *
        <select
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Seleccionar…</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.fullName}
            </option>
          ))}
        </select>
      </label>
      <div className="customer-field__new">
        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          onClick={() => setCreating((open) => !open)}
        >
          Nuevo cliente
        </Button>
      </div>
      {creating && (
        <span className="customer-field__quick">
          <input
            aria-label="Nombre del nuevo cliente"
            value={name}
            placeholder="Nombre completo"
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !name.trim()}
            onClick={() =>
              void onQuickCreate(name).then((created) => {
                if (created) {
                  setName('');
                  setCreating(false);
                }
              })
            }
          >
            Crear y seleccionar
          </Button>
        </span>
      )}
    </div>
  );
}

/** Barra de período de la Agenda: vista, navegación temporal y período en una sola fila. */
export function AgendaBar<T extends string>({
  view,
  views,
  onView,
  period,
  onPrev,
  onToday,
  onNext,
  end,
}: {
  view: T;
  views: Array<{ value: T; label: string }>;
  onView: (view: T) => void;
  period: ReactNode;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  end?: ReactNode;
}) {
  return (
    <div className="agenda-bar">
      <Segmented label="Vista" value={view} options={views} onChange={onView} />
      <div className="agenda-nav" role="group" aria-label="Período">
        <Button
          variant="secondary"
          icon="chevL"
          aria-label="Período anterior"
          onClick={onPrev}
        />
        <Button variant="secondary" onClick={onToday}>
          Hoy
        </Button>
        <Button
          variant="secondary"
          icon="chevR"
          aria-label="Período siguiente"
          onClick={onNext}
        />
        <strong className="agenda-period">{period}</strong>
      </div>
      {end && <div className="agenda-bar__end">{end}</div>}
    </div>
  );
}

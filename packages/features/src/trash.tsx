import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  describeTrashItem,
  listTrash,
  restoreItem,
  type TrashRepository,
} from '@centrocolor/application';
import {
  canManageTrash,
  trashEntityTypes,
  trashTypeLabels,
  type TrashEntityType,
  type TrashItem,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  EmptyState,
  FilterBar,
  FilterSelect,
  FlashMessage,
  PageHeader,
  useFlash,
} from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { CatalogRow } from './configuration-ui';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la acción.';

const formatDeleted = (value: string) =>
  new Date(value).toLocaleDateString('es-AR');

/** Texto sin tildes ni mayúsculas para buscar «categoria» y encontrar «Categoría». */
const fold = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');

/** Filtra la Papelera por texto y tipo. Pura: se prueba sin pantalla. */
export function filterTrash(
  items: TrashItem[],
  query: string,
  type: TrashEntityType | '',
): TrashItem[] {
  const needle = fold(query.trim());
  return items.filter(
    (item) =>
      (!type || item.type === type) &&
      (!needle ||
        fold(`${item.name} ${describeTrashItem(item)}`).includes(needle)),
  );
}

/**
 * Configuración → Papelera. Lugar secundario y discreto donde viven los catálogos eliminados:
 * se ven, se reconocen por tipo y se restauran. No ofrece «eliminar definitivamente»: la fila
 * sigue existiendo para que el historial (ventas, turnos, reservas) conserve sus referencias.
 */
export function TrashPage({
  repository,
  onMutation,
}: {
  repository: TrashRepository;
  /** Avisa a la app que un catálogo cambió (contadores, otras pantallas). */
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const flash = useFlash();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TrashEntityType | ''>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await listTrash(repository, businessId);
      setItems(all.filter((item) => canManageTrash(role, item.type)));
    } catch (error) {
      flash.error(errorText(error));
    } finally {
      setLoaded(true);
    }
  }, [repository, businessId, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOptions = useMemo(
    () =>
      trashEntityTypes
        .filter((value) => items.some((item) => item.type === value))
        .map((value) => ({ value, label: trashTypeLabels[value] })),
    [items],
  );
  const visible = useMemo(
    () => filterTrash(items, query, type),
    [items, query, type],
  );

  async function restore(item: TrashItem) {
    setBusyId(item.id);
    try {
      await restoreItem(repository, businessId, item.type, item.id);
      flash.success(`«${item.name}» se restauró.`);
      onMutation?.();
      await load();
    } catch (error) {
      flash.error(errorText(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Papelera"
        description="Lo que eliminás de los catálogos queda acá. Restauralo para volver a usarlo."
      />
      <FlashMessage flash={flash} />
      {items.length > 0 && (
        <FilterBar
          label="Filtrar la Papelera"
          search={
            <input
              type="search"
              aria-label="Buscar en la Papelera"
              placeholder="Nombre, tipo o código"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          }
          dirty={query !== '' || type !== ''}
          onClear={() => {
            setQuery('');
            setType('');
          }}
        >
          {typeOptions.length > 1 && (
            <FilterSelect
              label="Tipo"
              allLabel="Todos los tipos"
              value={type}
              onChange={(value) => setType(value as TrashEntityType | '')}
              options={typeOptions}
            />
          )}
        </FilterBar>
      )}
      <Card className="card--flush">
        {!loaded ? (
          <p className="pad meta">Cargando…</p>
        ) : items.length === 0 ? (
          <EmptyState icon="trash" title="La Papelera está vacía">
            Cuando elimines un producto, una categoría u otro elemento de
            configuración, lo vas a encontrar acá.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState icon="search" title="Sin resultados" />
        ) : (
          <div className="rows catalog-rows">
            {visible.map((item) => (
              <CatalogRow
                key={`${item.type}:${item.id}`}
                title={item.name}
                meta={describeTrashItem(item)}
                values={[
                  { label: 'Eliminado', value: formatDeleted(item.deletedAt) },
                ]}
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyId === item.id}
                    onClick={() => void restore(item)}
                  >
                    Restaurar
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

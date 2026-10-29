import { useEffect, useState } from 'react';
import type {
  EventRepository,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import type {
  LedController,
  LedPanelPool,
  LedPreset,
  Resource,
} from '@centrocolor/domain';
import { Button, FormDrawer, InlineMessage } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { CatalogRow, CatalogSection } from './configuration-ui';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo guardar.';
const millimeters = (centimeters: string) => {
  const value = Number(centimeters.trim().replace(',', '.')) * 10;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Medida inválida.');
  return value;
};

export function ResourceCapacityPanel({
  repository,
  eventRepository,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  eventRepository: EventRepository;
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const admin = role !== 'staff';
  const [pool, setPool] = useState<LedPanelPool | null>(null);
  const [presets, setPresets] = useState<LedPreset[]>([]);
  const [controllers, setControllers] = useState<LedController[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [totalPanels, setTotalPanels] = useState('');
  const [panelArea, setPanelArea] = useState('');
  const [pixelsPerPanel, setPixelsPerPanel] = useState('');
  const [poolOpen, setPoolOpen] = useState(false);
  const [controllerOpen, setControllerOpen] = useState(false);
  const [controllerResource, setControllerResource] = useState('');
  const [controllerPixels, setControllerPixels] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetWidth, setPresetWidth] = useState('');
  const [presetHeight, setPresetHeight] = useState('');

  const reload = async () => {
    const [nextPool, nextPresets, nextControllers, nextResources] =
      await Promise.all([
        repository.getLedPanelPool(businessId),
        repository.listLedPresets(businessId),
        repository.listLedControllers(businessId),
        eventRepository.listResources(businessId, true),
      ]);
    setPool(nextPool);
    setPresets(nextPresets);
    setControllers(nextControllers);
    setResources(nextResources);
    if (nextPool) {
      setTotalPanels(String(nextPool.totalPanels));
      setPanelArea(String(nextPool.panelAreaMm2 / 1_000_000));
      setPixelsPerPanel(String(nextPool.pixelsPerPanel));
    }
  };
  useEffect(() => {
    void reload().catch((error) => setNotice(errorText(error)));
  }, [businessId, repository, eventRepository]);

  async function persist(work: () => Promise<unknown>): Promise<boolean> {
    try {
      await work();
      await reload();
      setNotice(null);
      onMutation?.();
      return true;
    } catch (error) {
      setNotice(errorText(error));
      return false;
    }
  }
  async function savePool() {
    const area = Number(panelArea.trim().replace(',', '.')) * 1_000_000;
    const total = Number(totalPanels);
    const pixels = Number(pixelsPerPanel);
    if (
      ![area, total, pixels].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    ) {
      setNotice('Revisá cantidad, área y píxeles.');
      return;
    }
    const saved = await persist(() =>
      repository.saveLedPanelPool({
        id: pool?.id ?? crypto.randomUUID(),
        businessId,
        totalPanels: total,
        panelAreaMm2: area,
        pixelsPerPanel: pixels,
        isActive: pool?.isActive ?? true,
      }),
    );
    if (saved) setPoolOpen(false);
  }
  async function saveController() {
    const maxPixels = controllerPixels.trim() ? Number(controllerPixels) : null;
    if (
      maxPixels !== null &&
      (!Number.isSafeInteger(maxPixels) || maxPixels <= 0)
    ) {
      setNotice('Píxeles inválidos.');
      return;
    }
    const existing = controllers.find(
      (controller) => controller.resourceId === controllerResource,
    );
    const saved = await persist(() =>
      repository.saveLedController({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        resourceId: controllerResource,
        maxPixels,
      }),
    );
    if (!saved) return;
    setControllerOpen(false);
  }
  async function savePreset() {
    const saved = await persist(() =>
      repository.saveLedPreset({
        id: crypto.randomUUID(),
        businessId,
        name: presetName.trim(),
        widthMm: millimeters(presetWidth),
        heightMm: millimeters(presetHeight),
        isActive: true,
      }),
    );
    if (!saved) return;
    setPresetName('');
    setPresetWidth('');
    setPresetHeight('');
    setPresetOpen(false);
  }

  return (
    <>
      {notice && !poolOpen && !controllerOpen && !presetOpen && (
        <InlineMessage tone="error">{notice}</InlineMessage>
      )}
      <div className="section-head catalog-group-head">
        <h2>Capacidad LED</h2>
      </div>
      <CatalogSection
        title="Pool de paneles"
        hint="Determina disponibilidad y compatibilidad; no interviene en el precio."
      >
        <CatalogRow
          title="Paneles disponibles"
          values={[
            {
              label: 'Capacidad',
              value: pool
                ? `${pool.totalPanels} paneles · ${pool.panelAreaMm2 / 1_000_000} m² por panel · ${pool.pixelsPerPanel.toLocaleString('es-AR')} px`
                : 'Pendiente de configurar',
            },
          ]}
          active={pool?.isActive ?? false}
          onEdit={admin ? () => setPoolOpen(true) : undefined}
        />
      </CatalogSection>
      <CatalogSection
        title="Controladores LED"
        hint="Equipos físicos vinculados y su capacidad máxima."
        action={
          admin ? (
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={() => {
                setControllerResource('');
                setControllerPixels('');
                setControllerOpen(true);
              }}
            >
              Vincular controlador
            </Button>
          ) : undefined
        }
      >
        {controllers.length === 0 && (
          <p className="meta price-empty">Sin controladores vinculados.</p>
        )}
        {controllers.map((controller) => {
          const resource = resources.find(
            (item) => item.id === controller.resourceId,
          );
          return (
            <CatalogRow
              key={controller.id}
              title={resource?.name ?? controller.resourceId}
              values={[
                {
                  label: 'Capacidad máxima',
                  value:
                    controller.maxPixels === null
                      ? 'Pendiente'
                      : `${controller.maxPixels.toLocaleString('es-AR')} px`,
                },
              ]}
              active={resource?.isActive ?? false}
              onEdit={
                admin
                  ? () => {
                      setControllerResource(controller.resourceId);
                      setControllerPixels(
                        controller.maxPixels === null
                          ? ''
                          : String(controller.maxPixels),
                      );
                      setControllerOpen(true);
                    }
                  : undefined
              }
            />
          );
        })}
      </CatalogSection>
      <CatalogSection
        title="Tamaños LED habituales"
        hint="Medidas técnicas reutilizables para calcular paneles."
        action={
          admin ? (
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={() => setPresetOpen(true)}
            >
              Nuevo tamaño
            </Button>
          ) : undefined
        }
      >
        {presets.length === 0 && (
          <p className="meta price-empty">Sin tamaños cargados.</p>
        )}
        {presets.map((preset) => (
          <CatalogRow
            key={preset.id}
            title={preset.name}
            values={[
              {
                label: 'Medidas',
                value: `${preset.widthMm / 1000} × ${preset.heightMm / 1000} m`,
              },
            ]}
            active={preset.isActive}
            actions={
              admin ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void persist(() =>
                      repository.saveLedPreset({
                        ...preset,
                        isActive: !preset.isActive,
                      }),
                    )
                  }
                >
                  {preset.isActive ? 'Desactivar' : 'Activar'}
                </Button>
              ) : undefined
            }
          />
        ))}
      </CatalogSection>
      <FormDrawer
        open={poolOpen}
        onClose={() => setPoolOpen(false)}
        title="Capacidad del pool LED"
        error={notice}
        submitLabel="Guardar capacidad"
        onSubmit={savePool}
      >
        <label>
          Paneles totales
          <input
            inputMode="numeric"
            value={totalPanels}
            onChange={(event) => setTotalPanels(event.target.value)}
          />
        </label>
        <label>
          Área por panel (m²)
          <input
            inputMode="decimal"
            value={panelArea}
            onChange={(event) => setPanelArea(event.target.value)}
          />
        </label>
        <label>
          Píxeles por panel
          <input
            inputMode="numeric"
            value={pixelsPerPanel}
            onChange={(event) => setPixelsPerPanel(event.target.value)}
          />
        </label>
      </FormDrawer>
      <FormDrawer
        open={controllerOpen}
        onClose={() => setControllerOpen(false)}
        title="Vincular controlador"
        error={notice}
        disabled={!controllerResource}
        submitLabel="Guardar controlador"
        onSubmit={saveController}
      >
        <label>
          Equipo físico
          <select
            value={controllerResource}
            onChange={(event) => setControllerResource(event.target.value)}
          >
            <option value="">Seleccionar</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Máximo de píxeles
          <input
            value={controllerPixels}
            onChange={(event) => setControllerPixels(event.target.value)}
            placeholder="Pendiente si no se conoce"
          />
        </label>
      </FormDrawer>
      <FormDrawer
        open={presetOpen}
        onClose={() => setPresetOpen(false)}
        title="Nuevo tamaño LED"
        error={notice}
        disabled={!presetName.trim()}
        submitLabel="Guardar tamaño"
        onSubmit={savePreset}
      >
        <label>
          Nombre
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
        </label>
        <div className="config-editor-form__grid">
          <label>
            Ancho (cm)
            <input
              value={presetWidth}
              onChange={(event) => setPresetWidth(event.target.value)}
            />
          </label>
          <label>
            Alto (cm)
            <input
              value={presetHeight}
              onChange={(event) => setPresetHeight(event.target.value)}
            />
          </label>
        </div>
      </FormDrawer>
    </>
  );
}

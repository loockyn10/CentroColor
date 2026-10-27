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
import { Button, Sheet } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { ConfigurationRow, ConfigurationSection } from './configuration-ui';

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
      {notice && <p role="alert">{notice}</p>}
      <ConfigurationSection
        eyebrow="CAPACIDAD TÉCNICA"
        title="Inventario LED"
        description="Determina disponibilidad y compatibilidad. No interviene en el precio comercial."
      >
        <div className="rows">
          <ConfigurationRow
            title="Pool de paneles"
            values={
              pool
                ? `${pool.totalPanels} paneles · ${pool.panelAreaMm2 / 1_000_000} m² por panel · ${pool.pixelsPerPanel.toLocaleString('es-AR')} px`
                : 'Capacidad pendiente de configurar'
            }
            active={pool?.isActive ?? false}
            onEdit={admin ? () => setPoolOpen(true) : undefined}
          />
        </div>
      </ConfigurationSection>
      <ConfigurationSection
        eyebrow="EQUIPOS"
        title="Controladores LED"
        description="Recursos físicos vinculados y su capacidad máxima."
        actions={
          admin ? (
            <Button
              variant="secondary"
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
        <div className="rows">
          {controllers.map((controller) => (
            <ConfigurationRow
              key={controller.id}
              title={
                resources.find(
                  (resource) => resource.id === controller.resourceId,
                )?.name ?? controller.resourceId
              }
              values={
                controller.maxPixels === null
                  ? 'Capacidad pendiente'
                  : `${controller.maxPixels.toLocaleString('es-AR')} px`
              }
              active={
                resources.find(
                  (resource) => resource.id === controller.resourceId,
                )?.isActive ?? false
              }
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
          ))}
        </div>
      </ConfigurationSection>
      <ConfigurationSection
        eyebrow="ATAJOS"
        title="Tamaños LED habituales"
        description="Medidas técnicas reutilizables para calcular paneles."
        actions={
          admin ? (
            <Button variant="secondary" onClick={() => setPresetOpen(true)}>
              + Nuevo tamaño
            </Button>
          ) : undefined
        }
      >
        <div className="rows">
          {presets.map((preset) => (
            <ConfigurationRow
              key={preset.id}
              title={preset.name}
              values={`${preset.widthMm / 1000} × ${preset.heightMm / 1000} m`}
              active={preset.isActive}
              onToggle={
                admin
                  ? () =>
                      void persist(() =>
                        repository.saveLedPreset({
                          ...preset,
                          isActive: !preset.isActive,
                        }),
                      )
                  : undefined
              }
            />
          ))}
        </div>
      </ConfigurationSection>
      <Sheet
        open={poolOpen}
        onClose={() => setPoolOpen(false)}
        title="Capacidad del pool LED"
        variant="side"
      >
        <div className="config-editor-form">
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
          <Button onClick={() => void savePool()}>Guardar capacidad</Button>
        </div>
      </Sheet>
      <Sheet
        open={controllerOpen}
        onClose={() => setControllerOpen(false)}
        title="Vincular controlador"
        variant="side"
      >
        <div className="config-editor-form">
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
          <Button
            disabled={!controllerResource}
            onClick={() => void saveController()}
          >
            Guardar controlador
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={presetOpen}
        onClose={() => setPresetOpen(false)}
        title="Nuevo tamaño LED"
        variant="side"
      >
        <div className="config-editor-form">
          <label>
            Nombre
            <input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
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
          <Button
            disabled={!presetName.trim()}
            onClick={() => void savePreset()}
          >
            Guardar tamaño
          </Button>
        </div>
      </Sheet>
    </>
  );
}

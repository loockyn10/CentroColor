import { useEffect, useState } from 'react';
import type {
  EventRepository,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import type {
  EventOffer,
  EventOfferRate,
  LedController,
  LedPanelPool,
  LedPreset,
  PriceList,
  Resource,
} from '@centrocolor/domain';
import { Button, Card } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'No se pudo guardar.';
const money = (c: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    c / 100,
  );
function cents(value: string) {
  const v = value.trim().replaceAll('.', '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(v)) throw new Error('Importe inválido.');
  const [a, b = ''] = v.split('.');
  const result = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Importe fuera de rango.');
  return result;
}
function mm(value: string) {
  const n = Number(value.trim().replace(',', '.')) * 10;
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error('Medida inválida (cm).');
  return n;
}
const offerKindLabel: Record<EventOffer['kind'], string> = {
  fabric_screen: 'Pantalla de tela',
  led_screen: 'Pantalla LED',
  photo_booth: 'Cabina de fotos',
  magic_mirror: 'Espejo mágico',
  spin_360: 'Giro 360',
};

export function EventCatalogPanel({
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
  const [lists, setLists] = useState<PriceList[]>([]),
    [offers, setOffers] = useState<EventOffer[]>([]);
  const [rates, setRates] = useState<EventOfferRate[]>([]),
    [resources, setResources] = useState<Resource[]>([]);
  const [pool, setPool] = useState<LedPanelPool | null>(null),
    [presets, setPresets] = useState<LedPreset[]>([]);
  const [controllers, setControllers] = useState<LedController[]>([]);
  const [listId, setListId] = useState(''),
    [notice, setNotice] = useState<string | null>(null);
  const [fabricName, setFabricName] = useState(''),
    [fabricWidth, setFabricWidth] = useState(''),
    [fabricHeight, setFabricHeight] = useState('');
  const [fabricProjection, setFabricProjection] = useState<'front' | 'rear'>(
    'front',
  );
  const [fabricPrimary, setFabricPrimary] = useState(''),
    [fabricProjector, setFabricProjector] = useState('');
  const [controllerResource, setControllerResource] = useState(''),
    [controllerPixels, setControllerPixels] = useState('');
  const [totalPanels, setTotalPanels] = useState(''),
    [panelArea, setPanelArea] = useState(''),
    [pixelsPerPanel, setPixelsPerPanel] = useState('');
  const [presetName, setPresetName] = useState(''),
    [presetWidth, setPresetWidth] = useState(''),
    [presetHeight, setPresetHeight] = useState('');
  const reload = async () => {
    const [a, b, c, d, e, f, g] = await Promise.all([
      repository.listPriceLists(businessId),
      repository.listEventOffers(businessId),
      repository.listEventOfferRates(businessId),
      eventRepository.listResources(businessId, true),
      repository.getLedPanelPool(businessId),
      repository.listLedPresets(businessId),
      repository.listLedControllers(businessId),
    ]);
    setLists(a);
    setOffers(b);
    setRates(c);
    setResources(d);
    setPool(e);
    setPresets(f);
    setControllers(g);
    setListId((old) => old || a.find((x) => x.isDefault)?.id || '');
    if (e) {
      setTotalPanels(String(e.totalPanels));
      setPanelArea(String(e.panelAreaMm2 / 1_000_000));
      setPixelsPerPanel(String(e.pixelsPerPanel));
    }
  };
  useEffect(() => {
    void reload().catch((e) => setNotice(errorText(e)));
  }, [businessId, repository, eventRepository]);
  async function persist(work: () => Promise<unknown>) {
    try {
      await work();
      await reload();
      setNotice(null);
      onMutation?.();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function rate(offer: EventOffer, value: string) {
    const existing = rates.find(
      (x) => x.offerId === offer.id && x.priceListId === listId,
    );
    await persist(() =>
      repository.saveEventOfferRate({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        offerId: offer.id,
        priceListId: listId,
        amountCents: cents(value),
      }),
    );
  }
  async function fabric() {
    await persist(() =>
      repository.saveEventOffer({
        id: crypto.randomUUID(),
        businessId,
        kind: 'fabric_screen',
        name: fabricName.trim(),
        widthMm: mm(fabricWidth),
        heightMm: mm(fabricHeight),
        projection: fabricProjection,
        withProjector: Boolean(fabricProjector),
        primaryResourceId: fabricPrimary || null,
        projectorResourceId: fabricProjector || null,
        isActive: true,
      }),
    );
    setFabricName('');
    setFabricWidth('');
    setFabricHeight('');
  }
  async function savePool() {
    const area = Number(panelArea.trim().replace(',', '.')) * 1_000_000;
    const total = Number(totalPanels),
      pixels = Number(pixelsPerPanel);
    if (
      !Number.isSafeInteger(area) ||
      area <= 0 ||
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      !Number.isSafeInteger(pixels) ||
      pixels <= 0
    )
      return setNotice('Revisá cantidad, área y píxeles.');
    await persist(() =>
      repository.saveLedPanelPool({
        id: pool?.id ?? crypto.randomUUID(),
        businessId,
        totalPanels: total,
        panelAreaMm2: area,
        pixelsPerPanel: pixels,
        isActive: pool?.isActive ?? true,
      }),
    );
  }
  async function saveController() {
    const value = controllerPixels.trim() ? Number(controllerPixels) : null;
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0))
      return setNotice('Píxeles inválidos.');
    const existing = controllers.find(
      (x) => x.resourceId === controllerResource,
    );
    await persist(() =>
      repository.saveLedController({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        resourceId: controllerResource,
        maxPixels: value,
      }),
    );
  }
  async function savePreset() {
    await persist(() =>
      repository.saveLedPreset({
        id: crypto.randomUUID(),
        businessId,
        name: presetName.trim(),
        widthMm: mm(presetWidth),
        heightMm: mm(presetHeight),
        isActive: true,
      }),
    );
    setPresetName('');
    setPresetWidth('');
    setPresetHeight('');
  }
  return (
    <>
      {notice && <p role="alert">{notice}</p>}
      <Card>
        <label>
          Lista de precios
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            {lists
              .filter((x) => x.isActive)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
      </Card>
      <Card>
        <h2>Servicios y tarifas</h2>
        <div className="rows">
          {offers.map((offer) => {
            const rateValue = rates.find(
              (x) => x.offerId === offer.id && x.priceListId === listId,
            );
            return (
              <OfferRow
                key={`${offer.id}:${listId}`}
                offer={offer}
                rate={rateValue}
                admin={admin}
                resources={resources}
                onRate={(value) => void rate(offer, value)}
                onOffer={(next) =>
                  void persist(() => repository.saveEventOffer(next))
                }
              />
            );
          })}
        </div>
        <p className="meta">
          LED usa precio por m². Los demás servicios usan precio fijo. Viáticos
          se cargan en cada evento.
        </p>
      </Card>
      {admin && (
        <Card>
          <h2>Nueva pantalla de tela</h2>
          <div className="form-row">
            <label>
              Nombre
              <input
                value={fabricName}
                onChange={(e) => setFabricName(e.target.value)}
              />
            </label>
            <label>
              Ancho cm
              <input
                inputMode="decimal"
                value={fabricWidth}
                onChange={(e) => setFabricWidth(e.target.value)}
              />
            </label>
            <label>
              Alto cm
              <input
                inputMode="decimal"
                value={fabricHeight}
                onChange={(e) => setFabricHeight(e.target.value)}
              />
            </label>
            <label>
              Proyección
              <select
                value={fabricProjection}
                onChange={(e) =>
                  setFabricProjection(e.target.value as 'front' | 'rear')
                }
              >
                <option value="front">Delantera</option>
                <option value="rear">Trasera</option>
              </select>
            </label>
            <label>
              Pantalla física
              <select
                value={fabricPrimary}
                onChange={(e) => setFabricPrimary(e.target.value)}
              >
                <option value="">Seleccionar</option>
                {resources
                  .filter((x) => x.isActive)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Proyector (opcional)
              <select
                value={fabricProjector}
                onChange={(e) => setFabricProjector(e.target.value)}
              >
                <option value="">Sin proyector</option>
                {resources
                  .filter((x) => x.isActive)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              disabled={!fabricName.trim() || !fabricPrimary}
              onClick={() => void fabric()}
            >
              Crear pantalla
            </Button>
          </div>
        </Card>
      )}
      <Card>
        <h2>Pool LED</h2>
        <div className="form-row">
          <label>
            Paneles totales
            <input
              inputMode="numeric"
              value={totalPanels}
              disabled={!admin}
              onChange={(e) => setTotalPanels(e.target.value)}
            />
          </label>
          <label>
            Área por panel (m²)
            <input
              inputMode="decimal"
              value={panelArea}
              disabled={!admin}
              onChange={(e) => setPanelArea(e.target.value)}
            />
          </label>
          <label>
            Píxeles por panel
            <input
              inputMode="numeric"
              value={pixelsPerPanel}
              disabled={!admin}
              onChange={(e) => setPixelsPerPanel(e.target.value)}
            />
          </label>
          {admin && (
            <Button onClick={() => void savePool()}>Guardar pool</Button>
          )}
        </div>
      </Card>
      <Card>
        <h2>Controladores LED</h2>
        <div className="rows">
          {controllers.map((c) => {
            const resource = resources.find((x) => x.id === c.resourceId);
            return (
              <div className="oprow" key={c.id}>
                <strong>{resource?.name ?? c.resourceId}</strong>
                <span className="meta">
                  {c.maxPixels === null
                    ? 'Capacidad pendiente'
                    : `${c.maxPixels.toLocaleString('es-AR')} px`}
                </span>
              </div>
            );
          })}
        </div>
        {admin && (
          <div className="form-row">
            <label>
              Recurso
              <select
                value={controllerResource}
                onChange={(e) => setControllerResource(e.target.value)}
              >
                <option value="">Seleccionar</option>
                {resources.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Máximo píxeles
              <input
                inputMode="numeric"
                value={controllerPixels}
                onChange={(e) => setControllerPixels(e.target.value)}
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
        )}
      </Card>
      <Card>
        <h2>Tamaños LED</h2>
        <div className="rows">
          {presets.map((p) => (
            <div className="oprow" key={p.id}>
              <strong>{p.name}</strong>
              <span className="meta">
                {p.widthMm / 1000} × {p.heightMm / 1000} m
              </span>
              {admin && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void persist(() =>
                      repository.saveLedPreset({ ...p, isActive: !p.isActive }),
                    )
                  }
                >
                  {p.isActive ? 'Desactivar' : 'Activar'}
                </Button>
              )}
            </div>
          ))}
        </div>
        {admin && (
          <div className="form-row">
            <label>
              Nombre
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </label>
            <label>
              Ancho cm
              <input
                value={presetWidth}
                onChange={(e) => setPresetWidth(e.target.value)}
              />
            </label>
            <label>
              Alto cm
              <input
                value={presetHeight}
                onChange={(e) => setPresetHeight(e.target.value)}
              />
            </label>
            <Button
              disabled={!presetName.trim()}
              onClick={() => void savePreset()}
            >
              Agregar tamaño
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

function OfferRow({
  offer,
  rate,
  resources,
  admin,
  onRate,
  onOffer,
}: {
  offer: EventOffer;
  rate?: EventOfferRate;
  resources: Resource[];
  admin: boolean;
  onRate: (v: string) => void;
  onOffer: (x: EventOffer) => void;
}) {
  const [value, setValue] = useState(
    rate ? (rate.amountCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(offer);
  return (
    <div className="oprow">
      <span className="who">
        {offerKindLabel[offer.kind]} · {offer.name}
      </span>
      {offer.kind === 'fabric_screen' && (
        <span className="meta">
          {offer.widthMm! / 10}×{offer.heightMm! / 10} cm ·{' '}
          {offer.projection === 'rear' ? 'Trasera' : 'Delantera'}
          {offer.withProjector ? ' · proyector' : ''}
        </span>
      )}
      <span className="meta">
        {offer.primaryResourceId
          ? (resources.find((r) => r.id === offer.primaryResourceId)?.name ??
            'Recurso faltante')
          : ''}
      </span>
      {admin ? (
        <>
          <input
            aria-label={`Tarifa ${offer.name}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Sin tarifa"
          />
          <Button variant="ghost" onClick={() => onRate(value)}>
            Guardar tarifa
          </Button>
          {offer.kind === 'fabric_screen' && (
            <Button variant="ghost" onClick={() => setEditing(!editing)}>
              {editing ? 'Cerrar' : 'Configurar'}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOffer({ ...offer, isActive: !offer.isActive })}
          >
            {offer.isActive ? 'Desactivar' : 'Activar'}
          </Button>
        </>
      ) : (
        <span>{rate ? money(rate.amountCents) : 'Sin tarifa'}</span>
      )}
      {editing && (
        <div className="form-row">
          <label>
            Nombre
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Ancho cm
            <input
              value={String((draft.widthMm ?? 0) / 10)}
              onChange={(e) => {
                try {
                  setDraft({ ...draft, widthMm: mm(e.target.value) });
                } catch {
                  /* Keep last valid value */
                }
              }}
            />
          </label>
          <label>
            Alto cm
            <input
              value={String((draft.heightMm ?? 0) / 10)}
              onChange={(e) => {
                try {
                  setDraft({ ...draft, heightMm: mm(e.target.value) });
                } catch {
                  /* Keep last valid value */
                }
              }}
            />
          </label>
          <label>
            Proyección
            <select
              value={draft.projection ?? 'front'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  projection: e.target.value as 'front' | 'rear',
                })
              }
            >
              <option value="front">Delantera</option>
              <option value="rear">Trasera</option>
            </select>
          </label>
          <label>
            Pantalla física
            <select
              value={draft.primaryResourceId ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  primaryResourceId: e.target.value || null,
                })
              }
            >
              <option value="">Seleccionar</option>
              {resources.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Proyector
            <select
              value={draft.projectorResourceId ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  projectorResourceId: e.target.value || null,
                  withProjector: Boolean(e.target.value),
                })
              }
            >
              <option value="">Sin proyector</option>
              {resources.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => {
              onOffer(draft);
              setEditing(false);
            }}
          >
            Guardar pantalla
          </Button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type {
  CustomerRepository,
  EventRepository,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import {
  effectivePriceListId,
  effectiveWindow,
  eventOfferBasePrice,
  ledAvailability,
  ledOfferBasePrice,
  quoteEventService,
  quoteTravel,
  windowsOverlap,
  type EventOffer,
  type EventOfferRate,
  type EventServiceItem,
  type LedController,
  type LedPanelPool,
  type LedPanelReservation,
  type LedPreset,
  type PriceList,
  type Resource,
  type ResourceReservation,
  type TravelPricingSettings,
  type TravelQuote,
} from '@centrocolor/domain';
import { Button, Card } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'No se pudo cotizar.';
const money = (c: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    c / 100,
  );
const mm = (cm: string) => {
  const n = Number(cm.trim().replace(',', '.')) * 10;
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error('Ingresá medidas en cm.');
  return n;
};
const distanceMeters = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized))
    throw new Error('Ingresá la distancia de ida en km, con hasta tres decimales.');
  const [kilometers, meters = ''] = normalized.split('.');
  const result =
    Number(kilometers) * 1_000 + Number(meters.padEnd(3, '0'));
  if (!Number.isSafeInteger(result))
    throw new Error('La distancia está fuera de rango.');
  return result;
};

type Prepared = {
  offer: EventOffer;
  priceListId: string;
  baseCents: number;
  travelCents: number;
  travelQuote: TravelQuote | null;
  travelSettings: TravelPricingSettings | null;
  window: { startsAt: string; endsAt: string };
  widthMm: number | null;
  heightMm: number | null;
  panels: number | null;
  pixels: number | null;
  controllerId: string | null;
  availableControllerIds: string[];
  resources: string[];
  includeProjector: boolean;
};

export function EventServiceComposer({
  catalog,
  eventRepository,
  customerRepository,
  customerId,
  startsAt,
  endsAt,
  currentServices,
  currentReservations,
  currentLed,
  onAdd,
}: {
  catalog: ServiceCatalogRepository;
  eventRepository: EventRepository;
  customerRepository: CustomerRepository;
  customerId: string;
  startsAt: string;
  endsAt: string;
  currentServices: EventServiceItem[];
  currentReservations: ResourceReservation[];
  currentLed: LedPanelReservation[];
  onAdd: (
    service: EventServiceItem,
    travel: EventServiceItem | null,
    resources: ResourceReservation[],
    led: LedPanelReservation | null,
  ) => void;
}) {
  const { businessId } = useBusinessContext();
  const [lists, setLists] = useState<PriceList[]>([]),
    [offers, setOffers] = useState<EventOffer[]>([]);
  const [rates, setRates] = useState<EventOfferRate[]>([]),
    [resources, setResources] = useState<Resource[]>([]);
  const [pool, setPool] = useState<LedPanelPool | null>(null),
    [presets, setPresets] = useState<LedPreset[]>([]);
  const [controllers, setControllers] = useState<LedController[]>([]);
  const [travelSettings, setTravelSettings] =
    useState<TravelPricingSettings | null>(null);
  const [customerListId, setCustomerListId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState(''),
    [presetId, setPresetId] = useState('');
  const [width, setWidth] = useState(''),
    [height, setHeight] = useState('');
  const [oneWayDistance, setOneWayDistance] = useState('0'),
    [before, setBefore] = useState('0'),
    [after, setAfter] = useState('0');
  const [includeProjector, setIncludeProjector] = useState(false);
  const [controllerId, setControllerId] = useState(''),
    [prepared, setPrepared] = useState<Prepared | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      catalog.listPriceLists(businessId),
      catalog.listEventOffers(businessId),
      catalog.listEventOfferRates(businessId),
      eventRepository.listResources(businessId, true),
      catalog.getLedPanelPool(businessId),
      catalog.listLedPresets(businessId),
      catalog.listLedControllers(businessId),
      catalog.getTravelPricingSettings(businessId),
    ])
      .then(([a, b, c, d, e, f, g, h]) => {
        if (live) {
          setLists(a);
          setOffers(b);
          setRates(c);
          setResources(d);
          setPool(e);
          setPresets(f);
          setControllers(g);
          setTravelSettings(h);
        }
      })
      .catch((e) => live && setNotice(errorText(e)));
    return () => {
      live = false;
    };
  }, [businessId, catalog, eventRepository]);
  useEffect(() => {
    let live = true;
    if (!customerId) {
      setCustomerListId(null);
      return;
    }
    void customerRepository
      .get(businessId, customerId)
      .then((c) => {
        if (live) setCustomerListId(c?.priceListId ?? null);
      })
      .catch((e) => live && setNotice(errorText(e)));
    return () => {
      live = false;
    };
  }, [businessId, customerId, customerRepository]);
  useEffect(() => {
    setPrepared(null);
    setControllerId('');
  }, [
    offerId,
    presetId,
    width,
    height,
    oneWayDistance,
    before,
    after,
    startsAt,
    endsAt,
    customerListId,
    includeProjector,
    travelSettings,
  ]);
  useEffect(() => {
    setIncludeProjector(false);
  }, [offerId]);
  const offer = offers.find((x) => x.id === offerId);
  const selectedPreset = presets.find((x) => x.id === presetId);
  async function check() {
    try {
      if (!customerId) throw new Error('Seleccioná un cliente.');
      if (!offer?.isActive)
        throw new Error('Seleccioná un servicio disponible.');
      const priceListId = effectivePriceListId(
        { priceListId: customerListId },
        lists,
      );
      const rate = rates.find(
        (x) => x.offerId === offer.id && x.priceListId === priceListId,
      );
      if (!rate) throw new Error('Falta la tarifa para la lista del cliente.');
      const start = new Date(startsAt).toISOString(),
        end = new Date(endsAt).toISOString();
      const beforeMinutes = Number(before),
        afterMinutes = Number(after);
      const window = effectiveWindow(start, end, beforeMinutes, afterMinutes);
      let widthMm: number | null = null,
        heightMm: number | null = null,
        panels: number | null = null,
        pixels: number | null = null;
      let baseCents: number;
      let availableControllers: string[] = [];
      const neededResources: string[] = [];
      if (offer.kind === 'led_screen') {
        if (!pool?.isActive) throw new Error('Configurá el pool LED.');
        widthMm = selectedPreset?.widthMm ?? mm(width);
        heightMm = selectedPreset?.heightMm ?? mm(height);
        baseCents = ledOfferBasePrice(rate, widthMm, heightMm);
        const [panelRows, ...controllerRows] = await Promise.all([
          catalog.listLedPanelReservations(
            businessId,
            window.startsAt,
            window.endsAt,
          ),
          ...controllers.map((c) =>
            eventRepository.listReservations({
              businessId,
              resourceId: c.resourceId,
              from: window.startsAt,
              to: window.endsAt,
              onlyBlocking: true,
            }),
          ),
        ]);
        const availability = ledAvailability(
          {
            widthMm,
            heightMm,
            panelAreaMm2: pool.panelAreaMm2,
            pixelsPerPanel: pool.pixelsPerPanel,
          },
          {
            totalPanels: pool.totalPanels,
            reservations: [
              ...panelRows.filter(
                (x) => !currentLed.some((own) => own.id === x.id),
              ),
              ...currentLed
                .filter((x) => x.isActive)
                .map((x) => ({
                  startsAt: x.startsAt,
                  endsAt: x.endsAt,
                  panels: x.panels,
                })),
            ],
            controllers: controllers.map((c) => ({
              id: c.resourceId,
              name:
                resources.find((r) => r.id === c.resourceId)?.name ??
                c.resourceId,
              maxPixels: c.maxPixels,
              isActive: resources.some(
                (r) => r.id === c.resourceId && r.isActive,
              ),
            })),
            controllerReservations: [
              ...controllerRows.flat().map((x) => ({
                controllerId: x.resourceId,
                startsAt: x.startsAt,
                endsAt: x.endsAt,
              })),
              ...currentReservations
                .filter((x) => x.isActive)
                .map((x) => ({
                  controllerId: x.resourceId,
                  startsAt: x.startsAt,
                  endsAt: x.endsAt,
                })),
            ],
          },
          window,
        );
        panels = availability.requiredPanels;
        pixels = availability.requiredPixels;
        if (availability.availablePanels < panels)
          throw new Error(
            `Paneles disponibles: ${availability.availablePanels}; necesarios: ${panels}.`,
          );
        if (!availability.controllers.length)
          throw new Error(
            'No hay controlador compatible y libre para este horario.',
          );
        availableControllers = availability.controllers.map((x) => x.id);
      } else {
        baseCents = eventOfferBasePrice(offer, rate, includeProjector);
        if (!offer.primaryResourceId)
          throw new Error('Configurá el recurso físico del servicio.');
        neededResources.push(offer.primaryResourceId);
        if (includeProjector) {
          if (!offer.projectorResourceId)
            throw new Error('Configurá el proyector.');
          neededResources.push(offer.projectorResourceId);
        }
        for (const id of neededResources) {
          if (!resources.some((x) => x.id === id && x.isActive))
            throw new Error('Un recurso requerido está inactivo.');
          const blocking = await eventRepository.listReservations({
            businessId,
            resourceId: id,
            from: window.startsAt,
            to: window.endsAt,
            onlyBlocking: true,
          });
          if (
            blocking.length ||
            currentReservations.some(
              (x) =>
                x.isActive && x.resourceId === id && windowsOverlap(x, window),
            )
          )
            throw new Error(
              `${resources.find((x) => x.id === id)?.name ?? 'Recurso'} no está disponible.`,
            );
        }
        widthMm = offer.widthMm;
        heightMm = offer.heightMm;
      }
      const oneWayDistanceMeters = distanceMeters(oneWayDistance);
      if (oneWayDistanceMeters > 0 && !travelSettings)
        throw new Error(
          'Configurá Viáticos en Configuración → Precios antes de cotizar un traslado.',
        );
      const travelQuote = travelSettings
        ? quoteTravel(travelSettings, oneWayDistanceMeters)
        : null;
      const travelCents = travelQuote?.totalCents ?? 0;
      setPrepared({
        offer,
        priceListId,
        baseCents,
        travelCents,
        travelQuote,
        travelSettings,
        window,
        widthMm,
        heightMm,
        panels,
        pixels,
        controllerId: availableControllers[0] ?? null,
        availableControllerIds: availableControllers,
        resources: neededResources,
        includeProjector,
      });
      setControllerId(availableControllers[0] ?? '');
      setNotice(null);
    } catch (e) {
      setPrepared(null);
      setNotice(errorText(e));
    }
  }
  function add() {
    if (!prepared) return;
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    const name =
      prepared.offer.kind === 'led_screen'
        ? `${prepared.offer.name} ${prepared.widthMm! / 1000}×${prepared.heightMm! / 1000} m`
        : prepared.offer.name;
    const quote = quoteEventService(
      name,
      prepared.baseCents,
      prepared.travelCents,
    );
    const snapshot = {
      offerId: prepared.offer.id,
      kind: prepared.offer.kind,
      name,
      priceListId: prepared.priceListId,
      widthMm: prepared.widthMm,
      heightMm: prepared.heightMm,
      projection: prepared.offer.projection,
      withProjector: prepared.includeProjector,
      window: prepared.window,
      panels: prepared.panels,
      pixels: prepared.pixels,
      controllerResourceId: controllerId || null,
      baseCents: prepared.baseCents,
      travelCents: prepared.travelCents,
      travel: prepared.travelQuote
        ? {
            oneWayDistanceMeters:
              prepared.travelQuote.oneWayDistanceMeters,
            totalDistanceMeters: prepared.travelQuote.totalDistanceMeters,
            fuelMilliLiters: prepared.travelQuote.fuelMilliLiters,
            fuelPriceCentsPerLiter:
              prepared.travelSettings!.fuelPriceCentsPerLiter,
            efficiencyMilliKmPerLiter:
              prepared.travelSettings!.efficiencyMilliKmPerLiter,
            marginBasisPoints: prepared.travelSettings!.marginBasisPoints,
            baseCostCents: prepared.travelQuote.baseCostCents,
            totalCents: prepared.travelQuote.totalCents,
          }
        : null,
      totalCents: quote.totalCents,
    };
    const service: EventServiceItem = {
      id,
      businessId,
      eventId: '',
      sourceServiceId: null,
      priceListId: prepared.priceListId,
      configSnapshot: snapshot,
      name,
      description:
        prepared.offer.kind === 'led_screen'
          ? `${prepared.panels} paneles · ${prepared.pixels?.toLocaleString('es-AR')} px`
          : null,
      quantity: 1,
      unitPriceCents: prepared.baseCents,
      totalCents: prepared.baseCents,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const travelLine: EventServiceItem | null = prepared.travelCents
      ? {
          ...service,
          id: crypto.randomUUID(),
          name: `Viáticos · ${name}`,
          description: null,
          unitPriceCents: prepared.travelCents,
          totalCents: prepared.travelCents,
          configSnapshot: {
            parentServiceItemId: id,
            priceListId: prepared.priceListId,
            travelCents: prepared.travelCents,
            travel: snapshot.travel,
          },
        }
      : null;
    const ids =
      prepared.offer.kind === 'led_screen'
        ? [controllerId]
        : prepared.resources;
    if (ids.some((x) => !x)) {
      setNotice('Seleccioná un controlador.');
      return;
    }
    const reservations = ids.map((resourceId) => ({
      id: crypto.randomUUID(),
      businessId,
      eventId: '',
      resourceId,
      startsAt: prepared.window.startsAt,
      endsAt: prepared.window.endsAt,
      priceCents: 0,
      notes: `${name} · ${id}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }));
    const led: LedPanelReservation | null = prepared.panels
      ? {
          id: crypto.randomUUID(),
          businessId,
          eventId: '',
          eventServiceItemId: id,
          controllerResourceId: controllerId,
          startsAt: prepared.window.startsAt,
          endsAt: prepared.window.endsAt,
          panels: prepared.panels,
          isActive: true,
        }
      : null;
    onAdd(service, travelLine, reservations, led);
    setPrepared(null);
    setOfferId('');
    setOneWayDistance('0');
    setNotice(null);
  }
  return (
    <Card className="event-wide">
      <h3>Cotizar servicio</h3>
      {notice && <p role="alert">{notice}</p>}
      <div className="form-row">
        <label>
          Servicio
          <select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            <option value="">Seleccionar…</option>
            {offers
              .filter((x) => x.isActive)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        {offer?.kind === 'led_screen' && (
          <>
            <label>
              Tamaño habitual
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                <option value="">Personalizado</option>
                {presets
                  .filter((x) => x.isActive)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            {!presetId && (
              <>
                <label>
                  Ancho cm
                  <input
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </label>
                <label>
                  Alto cm
                  <input
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}
        {offer?.kind === 'fabric_screen' && offer.withProjector && (
          <label>
            Variante
            <select
              value={includeProjector ? 'with' : 'without'}
              onChange={(event) =>
                setIncludeProjector(event.target.value === 'with')
              }
            >
              <option value="without">Sin proyector</option>
              <option value="with">Con proyector</option>
            </select>
          </label>
        )}
        <label>
          Distancia de ida (km)
          <input
            inputMode="decimal"
            value={oneWayDistance}
            onChange={(e) => setOneWayDistance(e.target.value)}
          />
        </label>
        <label>
          Armado antes (min)
          <input
            inputMode="numeric"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
          />
        </label>
        <label>
          Desarmado después (min)
          <input
            inputMode="numeric"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
          />
        </label>
        <Button type="button" disabled={!offerId} onClick={() => void check()}>
          Comprobar y cotizar
        </Button>
      </div>
      {prepared && (
        <div className="event-totals">
          <span>
            Servicio <strong>{money(prepared.baseCents)}</strong>
          </span>
          <span>
            Viáticos <strong>{money(prepared.travelCents)}</strong>
          </span>
          {prepared.travelQuote && prepared.travelQuote.totalDistanceMeters > 0 && (
            <span className="meta">
              {prepared.travelQuote.totalDistanceMeters / 1_000} km totales ·{' '}
              {(prepared.travelQuote.fuelMilliLiters / 1_000)
                .toFixed(3)
                .replace('.', ',')}{' '}
              litros · combustible {money(prepared.travelQuote.baseCostCents)}
            </span>
          )}
          {prepared.panels && (
            <span>
              {prepared.panels} paneles ·{' '}
              {prepared.pixels?.toLocaleString('es-AR')} px
            </span>
          )}
          {prepared.offer.kind === 'led_screen' && (
            <label>
              Controlador
              <select
                value={controllerId}
                onChange={(e) => setControllerId(e.target.value)}
              >
                {controllers
                  .filter((x) =>
                    prepared.availableControllerIds.includes(x.resourceId),
                  )
                  .map((x) => (
                    <option key={x.id} value={x.resourceId}>
                      {resources.find((r) => r.id === x.resourceId)?.name ??
                        x.resourceId}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <span>
            Total{' '}
            <strong>{money(prepared.baseCents + prepared.travelCents)}</strong>
          </span>
          <Button type="button" onClick={add}>
            Agregar al evento
          </Button>
        </div>
      )}
      {currentServices.filter((x) => x.isActive).length > 0 && (
        <p className="meta">
          Servicios agregados:{' '}
          {currentServices.filter((x) => x.isActive).length}
        </p>
      )}
    </Card>
  );
}

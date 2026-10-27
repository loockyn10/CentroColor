import { useEffect, useMemo, useState } from 'react';
import type {
  CustomerRepository,
  PhotoRepository,
  PlotterQuote,
  ServiceCatalogRepository,
  EventRepository,
} from '@centrocolor/application';
import {
  effectivePriceListId,
  labPortalStatus,
  quotePlotter,
  type Customer,
  type EventOffer,
  type EventOfferRate,
  type LabPriceTier,
  type LabVariant,
  type PhotoService,
  type PlotterMaterial,
  type PlotterRate,
  type PriceList,
} from '@centrocolor/domain';
import { Button, Card, PageHeader, Sheet } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { EventPricingCatalog } from './event-pricing-catalog';
import {
  ConfigurationCard,
  ConfigurationDetailHeader,
  ConfigurationRow,
  ConfigurationSection,
  MoneyField,
} from './configuration-ui';
import { TravelPricingButton } from './travel-pricing';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Ocurrió un error.';
const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    cents / 100,
  );
/** Avoid binary floating point for money entered in the administrative forms. */
function cents(value: string): number {
  const clean = value.trim().replaceAll('.', '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean))
    throw new Error('Ingresá un importe válido.');
  const [whole, fraction = ''] = clean.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Importe fuera de rango.');
  return result;
}
const pesos = (amount: number) => (amount / 100).toFixed(2).replace('.', ',');
const mm = (cm: string) => {
  const clean = cm.trim().replace(',', '.');
  if (!/^\d+(?:\.\d)?$/.test(clean))
    throw new Error('Ingresá centímetros con hasta un decimal.');
  const result = Math.round(Number(clean) * 10);
  if (result <= 0 || !Number.isSafeInteger(result))
    throw new Error('Medida inválida.');
  return result;
};
const rateNames: Record<string, string> = {
  canvas: 'Canvas / m²',
  photo_paper: 'Papel Foto / m²',
  plain_paper: 'Papel común / m²',
  adhesive_vinyl: 'Vinilo adhesivo / m²',
  front_banner: 'Lona Front / m²',
  blackout_banner: 'Lona Blackout / m²',
  vinyl_mdf_small: 'Vinilo + MDF 9 mm hasta 0,12 m² / m²',
  vinyl_mdf_large: 'Vinilo + MDF 9 mm mayor / m²',
  plastic_rod: 'Varilla plástica / metro',
  banner_fold_top_up_to_1m: 'Doblez arriba hasta 1 m',
  banner_fold_both_up_to_1m: 'Doblez arriba y abajo hasta 1 m',
  banner_fold_top_over_1m: 'Doblez arriba más de 1 m',
  banner_fold_both_over_1m: 'Doblez arriba y abajo más de 1 m',
  canvas_stretcher: 'Canvas con bastidor',
};

export function PriceListsPage({
  repository,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  onMutation?: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Listas de precios"
        description="Esta ruta se conserva por compatibilidad. La administración principal está dentro de Precios."
      />
      <PriceListManager repository={repository} onMutation={onMutation} />
    </>
  );
}

function PriceListManager({
  repository,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const admin = role !== 'staff';
  const [lists, setLists] = useState<PriceList[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const reload = () =>
    repository
      .listPriceLists(businessId)
      .then(setLists)
      .catch((e) => setNotice(errorText(e)));
  useEffect(() => {
    void reload();
  }, [businessId, repository]);
  async function add() {
    try {
      const now = new Date().toISOString();
      await repository.savePriceList({
        id: crypto.randomUUID(),
        businessId,
        name: name.trim(),
        kind: 'custom',
        isDefault: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      setName('');
      setCreating(false);
      setNotice(null);
      await reload();
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function toggle(list: PriceList) {
    try {
      await repository.savePriceList({ ...list, isActive: !list.isActive });
      await reload();
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function rename(list: PriceList) {
    try {
      const clean = editingName.trim();
      if (!clean) throw new Error('Ingresá un nombre para la lista.');
      await repository.savePriceList({ ...list, name: clean });
      setEditingId(null);
      setEditingName('');
      await reload();
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  return (
    <>
      {notice && <p role="alert">{notice}</p>}
      <Card>
        <div className="rows">
          {lists.map((list) => (
            <div className="oprow" key={list.id}>
              <span className="who">{list.name}</span>
              <span className="meta">
                {list.kind === 'public'
                  ? 'Pública'
                  : list.kind === 'professional'
                    ? 'Profesional'
                    : 'Convenio'}{' '}
                · {list.isActive ? 'Activa' : 'Inactiva'}
              </span>
              {admin && editingId === list.id ? (
                <div className="config-actions">
                  <input
                    aria-label={`Nombre de ${list.name}`}
                    value={editingName}
                    maxLength={80}
                    onChange={(event) => setEditingName(event.target.value)}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => void rename(list)}
                    disabled={!editingName.trim()}
                  >
                    Guardar
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                admin && (
                  <div className="config-actions">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingId(list.id);
                        setEditingName(list.name);
                      }}
                    >
                      Renombrar
                    </Button>
                    {!list.isDefault && (
                      <Button variant="ghost" onClick={() => void toggle(list)}>
                        {list.isActive ? 'Desactivar' : 'Activar'}
                      </Button>
                    )}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </Card>
      {admin && (
        <>
          {!creating && (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              + Nueva lista
            </Button>
          )}
          {creating && (
            <Card>
              <h2>Nueva lista / convenio</h2>
              <div className="form-row">
                <label>
                  Nombre
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                </label>
                <Button onClick={() => void add()} disabled={!name.trim()}>
                  Crear lista
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Cancelar
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

export function ServiceCatalogPage({
  repository,
  photoRepository,
  eventRepository,
  onNavigate,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  photoRepository: PhotoRepository;
  eventRepository: EventRepository;
  onNavigate?: (id: string) => void;
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const admin = role !== 'staff';
  const [section, setSection] = useState<
    'lab' | 'plotter' | 'led' | 'fabric' | 'events' | null
  >(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [services, setServices] = useState<PhotoService[]>([]);
  const [variants, setVariants] = useState<LabVariant[]>([]);
  const [tiers, setTiers] = useState<LabPriceTier[]>([]);
  const [rates, setRates] = useState<PlotterRate[]>([]);
  const [eventOffers, setEventOffers] = useState<EventOffer[]>([]);
  const [eventRates, setEventRates] = useState<EventOfferRate[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [listId, setListId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => {
    try {
      const [a, b, c, d, e, f, g] = await Promise.all([
        repository.listPriceLists(businessId),
        photoRepository.listServices(businessId, true),
        repository.listLabVariants(businessId),
        repository.listLabTiers(businessId),
        repository.listPlotterRates(businessId),
        repository.listEventOffers(businessId),
        repository.listEventOfferRates(businessId),
      ]);
      setLists(a);
      setServices(b);
      setVariants(c);
      setTiers(d);
      setRates(e);
      setEventOffers(f);
      setEventRates(g);
      setListId((old) =>
        a.some((list) => list.id === old && list.isActive)
          ? old
          : (a.find((x) => x.isDefault && x.isActive)?.id ??
            a.find((x) => x.isActive)?.id ??
            ''),
      );
      setServiceId(
        (old) => old || b.find((x) => x.workflowRoute === 'lab')?.id || '',
      );
    } catch (error) {
      setNotice(errorText(error));
    }
  };
  useEffect(() => {
    void reload();
  }, [businessId, repository, photoRepository, eventRepository]);
  async function saveVariant(
    paper: 'glossy' | 'matte',
    channel: 'laboratory' | 'kiosk',
  ) {
    const existing = variants.find(
      (x) =>
        x.photoServiceId === serviceId &&
        x.paper === paper &&
        x.channel === channel,
    );
    try {
      await repository.saveLabVariant(
        existing
          ? { ...existing, isActive: !existing.isActive }
          : {
              id: crypto.randomUUID(),
              businessId,
              photoServiceId: serviceId,
              paper,
              channel,
              isActive: true,
            },
      );
      await reload();
      onMutation?.();
      setNotice(null);
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function saveTier(
    variantId: string,
    minQuantity: string,
    maxQuantity: string,
    price: string,
    existing?: LabPriceTier,
  ) {
    try {
      const min = Number(minQuantity),
        max = maxQuantity.trim() ? Number(maxQuantity) : null;
      if (
        !Number.isSafeInteger(min) ||
        min < 1 ||
        (max !== null && (!Number.isSafeInteger(max) || max < min))
      )
        throw new Error('Revisá el tramo de cantidad.');
      await repository.saveLabTier({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        variantId,
        priceListId: listId,
        minQuantity: min,
        maxQuantity: max,
        unitPriceCents: cents(price),
      });
      await reload();
      onMutation?.();
      setNotice(null);
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function saveRate(
    code: string,
    price: string,
    widthMm: number | null = null,
    heightMm: number | null = null,
  ) {
    try {
      if (!listId) throw new Error('Seleccioná una lista.');
      const existing = rates.find(
        (x) =>
          x.priceListId === listId &&
          x.code === code &&
          x.widthMm === widthMm &&
          x.heightMm === heightMm,
      );
      await repository.savePlotterRate({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        priceListId: listId,
        code,
        amountCents: cents(price),
        widthMm,
        heightMm,
      });
      await reload();
      onMutation?.();
      setNotice(null);
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  const activeVariants = variants.filter((x) => x.photoServiceId === serviceId);
  const selectedService = services.find((x) => x.id === serviceId);
  const portal = selectedService
    ? labPortalStatus(selectedService, activeVariants, tiers, lists)
    : null;
  /** Lifts only the publication flags; prices, variants and tiers are untouched. */
  async function publishService() {
    if (!selectedService) return;
    try {
      await photoRepository.updateService(businessId, selectedService.id, {
        code: selectedService.code,
        name: selectedService.name,
        serviceType: selectedService.serviceType,
        widthMm: selectedService.widthMm,
        heightMm: selectedService.heightMm,
        defaultUnitPriceCents: selectedService.defaultUnitPriceCents,
        workflowRoute: selectedService.workflowRoute,
        requiresCustomerFiles: selectedService.requiresCustomerFiles,
        isPublic: true,
        publicName: selectedService.publicName,
        publicDescription: selectedService.publicDescription,
        publicSortOrder: selectedService.publicSortOrder,
        publicOrderEnabled: true,
      });
      await reload();
      onMutation?.();
      setNotice(null);
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  const selectedList = lists.find((list) => list.id === listId) ?? null;
  const labServices = services.filter(
    (service) => service.workflowRoute === 'lab',
  );
  const listLabTiers = tiers.filter((tier) => tier.priceListId === listId);
  const listPlotterRates = rates.filter((rate) => rate.priceListId === listId);
  const eventServiceOffers = eventOffers.filter((offer) =>
    ['photo_booth', 'magic_mirror', 'spin_360'].includes(offer.kind),
  );
  const offersFor = (kinds: EventOffer['kind'][]) =>
    eventOffers.filter((offer) => kinds.includes(offer.kind));
  const pricedOffers = (offers: EventOffer[]) =>
    offers.filter((offer) =>
      eventRates.some(
        (rate) => rate.offerId === offer.id && rate.priceListId === listId,
      ),
    ).length;
  const sectionTitle =
    section === 'lab'
      ? 'Laboratorio'
      : section === 'plotter'
        ? 'Plotter'
        : section === 'led'
          ? 'Pantalla LED'
          : section === 'fabric'
            ? 'Pantallas de tela'
            : section === 'events'
              ? 'Servicios para eventos'
              : null;
  return (
    <>
      <PageHeader
        title="Precios"
        description="Una lista activa para todas las familias comerciales."
      />
      {notice && <p role="alert">{notice}</p>}
      <Card className="config-list-selector">
        <label>
          Lista de precios
          <select
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            {lists
              .filter((list) => list.isActive)
              .map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
          </select>
        </label>
        <div className="config-list-selector__actions">
          <Button variant="secondary" onClick={() => setListsOpen(true)}>
            Administrar listas
          </Button>
          <TravelPricingButton
            repository={repository}
            onMutation={onMutation}
          />
        </div>
      </Card>
      {section === null && (
        <>
          <ConfigurationSection
            eyebrow="PRECIOS POR FAMILIA"
            description={`Tarifas correspondientes a ${selectedList?.name ?? 'la lista seleccionada'}.`}
          />
          <div className="config-card-grid">
            <ConfigurationCard
              title="Laboratorio"
              summary={`${labServices.length} tamaños · ${variants.filter((variant) => variant.isActive).length} variantes`}
              detail={`${listLabTiers.length} tramos en ${selectedList?.name ?? 'esta lista'}`}
              onAction={() => setSection('lab')}
            />
            <ConfigurationCard
              title="Plotter"
              summary={`${listPlotterRates.length} tarifas configuradas`}
              detail="Materiales, precio por m² y reglas especiales"
              onAction={() => setSection('plotter')}
            />
            <ConfigurationCard
              title="Pantalla LED"
              summary="Precio por m² + operador"
              detail={`${pricedOffers(offersFor(['led_screen']))} tarifas configuradas`}
              onAction={() => setSection('led')}
            />
            <ConfigurationCard
              title="Pantallas de tela"
              summary="Precio sin proyector + con proyector"
              detail={`${offersFor(['fabric_screen']).length} tamaños · ${pricedOffers(offersFor(['fabric_screen']))} con precio`}
              onAction={() => setSection('fabric')}
            />
            <ConfigurationCard
              title="Servicios para eventos"
              summary="Cabina · Espejo Mágico · Giro 360"
              detail={`${pricedOffers(eventServiceOffers)}/${eventServiceOffers.length} con tarifa en esta lista`}
              onAction={() => setSection('events')}
            />
            <ConfigurationCard
              title="Fotografía / Video"
              summary="Pendiente de catálogo extensible"
              detail="No se crean servicios temporales ni enums nuevos en esta fase."
              disabled
              actionLabel="Pendiente Fase C"
            />
            <ConfigurationCard
              title="Marquetería"
              summary="Configuración especializada"
              detail="Costos, markup, merma, mano de obra y componentes"
              onAction={() => onNavigate?.('mouldings')}
            />
          </div>
        </>
      )}
      {section !== null && (
        <ConfigurationDetailHeader
          title={sectionTitle ?? ''}
          listName={selectedList?.name ?? 'Sin lista activa'}
          description={
            section === 'led'
              ? 'Precio por superficie y componente fijo de operador.'
              : section === 'fabric'
                ? 'Precios finales por tamaño, con y sin proyector.'
                : section === 'events'
                  ? 'Precios fijos de cada servicio.'
                  : undefined
          }
          onBack={() => setSection(null)}
        />
      )}
      {section === 'lab' && (
        <>
          <Card>
            <div className="form-row">
              <label>
                Tamaño / servicio
                <select
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  {services
                    .filter((x) => x.workflowRoute === 'lab')
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                variant="secondary"
                onClick={() => onNavigate?.('photo-services')}
              >
                Administrar tamaños y servicios
              </Button>
            </div>
            {!serviceId && (
              <p className="meta">
                Creá primero un servicio fotográfico con flujo Laboratorio.
              </p>
            )}
          </Card>
          {serviceId && (
            <Card>
              <h2>Papel y canal</h2>
              <div className="rows">
                {(['laboratory', 'kiosk'] as const).flatMap((channel) =>
                  (['glossy', 'matte'] as const).map((paper) => {
                    const variant = activeVariants.find(
                      (x) => x.channel === channel && x.paper === paper,
                    );
                    return (
                      <div className="oprow" key={`${channel}-${paper}`}>
                        <span>
                          {channel === 'laboratory' ? 'Laboratorio' : 'Kiosco'}{' '}
                          · {paper === 'glossy' ? 'Brillo' : 'Mate'}
                        </span>
                        <span className="meta">
                          {variant?.isActive ? 'Disponible' : 'No disponible'}
                        </span>
                        {admin && (
                          <Button
                            variant="ghost"
                            onClick={() => void saveVariant(paper, channel)}
                          >
                            {variant?.isActive ? 'Desactivar' : 'Activar'}
                          </Button>
                        )}
                      </div>
                    );
                  }),
                )}
              </div>
              <p className="meta">
                Kiosco sólo conserva precios de referencia; no genera pedidos ni
                trabajos.
              </p>
            </Card>
          )}
          {serviceId && portal && (
            <Card>
              <h2>Visibilidad en /imprimir</h2>
              <p className="meta">
                El portal público sólo ofrece variantes de Laboratorio
                disponibles con un tramo en la lista Pública; las listas
                Profesional y de convenio nunca se muestran.
              </p>
              {portal.serviceBlockers.length > 0 && (
                <>
                  <p role="status">
                    Este servicio no se muestra en la web:{' '}
                    {portal.serviceBlockers.join(' ')}
                  </p>
                  {admin && portal.publishable && (
                    <Button onClick={() => void publishService()}>
                      Publicar en /imprimir
                    </Button>
                  )}
                </>
              )}
              <div className="rows">
                {portal.variants.map((status) => (
                  <div className="oprow" key={status.variantId}>
                    <span>
                      {status.channel === 'laboratory'
                        ? 'Laboratorio'
                        : 'Kiosco'}{' '}
                      · {status.paper === 'glossy' ? 'Brillo' : 'Mate'}
                    </span>
                    <span className="meta">
                      {status.offered
                        ? 'Se ofrece en la web'
                        : (status.reason ?? 'Oculta por el servicio')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {activeVariants.map((variant) => (
            <LabTierCard
              key={`${variant.id}:${listId}`}
              variant={variant}
              tiers={tiers.filter(
                (x) => x.variantId === variant.id && x.priceListId === listId,
              )}
              admin={admin}
              onSave={saveTier}
            />
          ))}
        </>
      )}
      {section === 'plotter' && (
        <>
          <Card>
            <h2>Tarifas</h2>
            <div className="rows">
              {Object.entries(rateNames).map(([code, label]) => {
                if (code === 'canvas_stretcher') return null;
                const rate = rates.find(
                  (x) =>
                    x.priceListId === listId &&
                    x.code === code &&
                    x.widthMm === null,
                );
                return (
                  <RateRow
                    key={`${listId}:${code}`}
                    label={label}
                    rate={rate}
                    admin={admin}
                    onSave={(value) => void saveRate(code, value)}
                  />
                );
              })}
            </div>
          </Card>
          <Card>
            <h2>Canvas con bastidor</h2>
            <div className="rows">
              {[
                [200, 300],
                [300, 400],
                [300, 450],
                [400, 500],
                [400, 600],
                [500, 600],
                [500, 800],
                [500, 900],
              ].map(([width, height]) => {
                const rate = rates.find(
                  (x) =>
                    x.priceListId === listId &&
                    x.code === 'canvas_stretcher' &&
                    x.widthMm === width &&
                    x.heightMm === height,
                );
                return (
                  <RateRow
                    key={`${listId}:${width}:${height}`}
                    label={`${width! / 10}×${height! / 10} cm`}
                    rate={rate}
                    admin={admin}
                    onSave={(value) =>
                      void saveRate('canvas_stretcher', value, width!, height!)
                    }
                  />
                );
              })}
            </div>
          </Card>
        </>
      )}
      {(section === 'led' || section === 'fabric' || section === 'events') && (
        <EventPricingCatalog
          repository={repository}
          eventRepository={eventRepository}
          selectedListId={listId}
          family={section}
          onMutation={() => {
            void reload();
            onMutation?.();
          }}
        />
      )}
      <Sheet
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        title="Administrar listas"
        variant="side"
      >
        <p className="meta">
          Pública es la lista predeterminada. Profesional y convenios pueden
          activarse o desactivarse sin borrar historial.
        </p>
        <PriceListManager
          repository={repository}
          onMutation={() => {
            void reload();
            onMutation?.();
          }}
        />
      </Sheet>
    </>
  );
}

function LabTierCard({
  variant,
  tiers,
  admin,
  onSave,
}: {
  variant: LabVariant;
  tiers: LabPriceTier[];
  admin: boolean;
  onSave: (
    variantId: string,
    min: string,
    max: string,
    price: string,
    existing?: LabPriceTier,
  ) => Promise<void>;
}) {
  const [min, setMin] = useState('1');
  const [max, setMax] = useState('');
  const [price, setPrice] = useState('');
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <h2>
        {variant.channel === 'laboratory' ? 'Laboratorio' : 'Kiosco'} ·{' '}
        {variant.paper === 'glossy' ? 'Brillo' : 'Mate'}
        {!variant.isActive && ' · No disponible'}
      </h2>
      <div className="rows">
        {tiers
          .sort((a, b) => a.minQuantity - b.minQuantity)
          .map((tier) => (
            <ConfigurationRow
              key={tier.id}
              title={`${tier.minQuantity}–${tier.maxQuantity ?? '∞'} copias`}
              values={
                <span className="config-value">
                  <small>Precio por copia</small>
                  <strong>{money(tier.unitPriceCents)}</strong>
                </span>
              }
              active={variant.isActive}
              onEdit={
                admin
                  ? () => {
                      setMin(String(tier.minQuantity));
                      setMax(tier.maxQuantity?.toString() ?? '');
                      setPrice(pesos(tier.unitPriceCents));
                      setEditing(true);
                    }
                  : undefined
              }
            />
          ))}
      </div>
      {admin && !editing && (
        <Button
          variant="secondary"
          onClick={() => {
            setMin('1');
            setMax('');
            setPrice('');
            setEditing(true);
          }}
        >
          + Nuevo tramo
        </Button>
      )}
      {admin && editing && (
        <div className="form-row">
          <label>
            Desde
            <input
              type="number"
              min="1"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </label>
          <label>
            Hasta (vacío = sin límite)
            <input
              type="number"
              min="1"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
          <MoneyField
            label="Precio por copia"
            value={price}
            onChange={setPrice}
          />
          <Button
            onClick={() => {
              void onSave(
                variant.id,
                min,
                max,
                price,
                tiers.find((x) => x.minQuantity === Number(min)),
              ).then(() => setEditing(false));
            }}
          >
            Guardar tramo
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </Card>
  );
}
function MaterialRow({
  material,
  admin,
  onSave,
}: {
  material: PlotterMaterial;
  admin: boolean;
  onSave: (m: PlotterMaterial, roll: string, active: boolean) => Promise<void>;
}) {
  const [roll, setRoll] = useState(
    material.rollWidthMm === null
      ? ''
      : String(material.rollWidthMm / 10).replace('.', ','),
  );
  return (
    <div className="oprow">
      <span className="who">{material.name}</span>
      <label>
        Ancho de rollo (cm)
        <input
          value={roll}
          onChange={(e) => setRoll(e.target.value)}
          disabled={!admin}
          placeholder="Sin confirmar"
        />
      </label>
      <span>{material.isActive ? 'Activo' : 'Inactivo'}</span>
      {admin && (
        <>
          <Button
            variant="ghost"
            onClick={() => void onSave(material, roll, material.isActive)}
          >
            Guardar
          </Button>
          <Button
            variant="ghost"
            onClick={() => void onSave(material, roll, !material.isActive)}
          >
            {material.isActive ? 'Desactivar' : 'Activar'}
          </Button>
        </>
      )}
    </div>
  );
}

export function PlotterMaterialsPage({
  repository,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const admin = role !== 'staff';
  const [materials, setMaterials] = useState<PlotterMaterial[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => {
    try {
      setMaterials(await repository.listPlotterMaterials(businessId));
      setNotice(null);
    } catch (error) {
      setNotice(errorText(error));
    }
  };
  useEffect(() => {
    void reload();
  }, [businessId, repository]);
  async function saveMaterial(
    material: PlotterMaterial,
    roll: string,
    active: boolean,
  ) {
    try {
      await repository.savePlotterMaterial({
        ...material,
        rollWidthMm: roll.trim() ? mm(roll) : null,
        isActive: active,
      });
      await reload();
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  return (
    <>
      <PageHeader title="Materiales de Plotter" />
      {notice && <p role="alert">{notice}</p>}
      <Card>
        <div className="rows">
          {materials.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              admin={admin}
              onSave={saveMaterial}
            />
          ))}
        </div>
      </Card>
    </>
  );
}

function RateRow({
  label,
  rate,
  admin,
  onSave,
}: {
  label: string;
  rate: PlotterRate | undefined;
  admin: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(rate ? pesos(rate.amountCents) : '');
  const [editing, setEditing] = useState(false);
  return (
    <>
      <ConfigurationRow
        title={label}
        values={
          <span className="config-value">
            <small>Precio</small>
            <strong>{rate ? money(rate.amountCents) : 'Sin configurar'}</strong>
          </span>
        }
        active={Boolean(rate)}
        onEdit={admin ? () => setEditing(true) : undefined}
      />
      {admin && editing && (
        <div className="form-row">
          <MoneyField
            label={`Precio · ${label}`}
            value={value}
            onChange={setValue}
          />
          <Button
            onClick={() => {
              onSave(value);
              setEditing(false);
            }}
            disabled={!value.trim()}
          >
            Guardar cambios
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </>
  );
}

export function PlotterPage({
  repository,
  customerRepository,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  customerRepository: CustomerRepository;
  onMutation?: () => void;
}) {
  const { businessId, branchId, profile } = useBusinessContext();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [materials, setMaterials] = useState<PlotterMaterial[]>([]);
  const [rates, setRates] = useState<PlotterRate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<PlotterQuote[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [width, setWidth] = useState('120');
  const [height, setHeight] = useState('200');
  const [quantity, setQuantity] = useState('1');
  const [mdf, setMdf] = useState(false);
  const [canvasStretcher, setCanvasStretcher] = useState(false);
  const [rods, setRods] = useState<0 | 1 | 2>(0);
  const [fold, setFold] = useState<'none' | 'top' | 'both'>('none');
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => {
    try {
      const [a, b, c, d, e] = await Promise.all([
        repository.listPriceLists(businessId),
        repository.listPlotterMaterials(businessId),
        repository.listPlotterRates(businessId),
        customerRepository.list(businessId, 100),
        branchId
          ? repository.listPlotterQuotes(businessId, branchId)
          : Promise.resolve([]),
      ]);
      setLists(a);
      setMaterials(b);
      setRates(c);
      setCustomers(d);
      setQuotes(e);
      setMaterialId((old) => old || b.find((x) => x.isActive)?.id || '');
    } catch (error) {
      setNotice(errorText(error));
    }
  };
  useEffect(() => {
    void reload();
  }, [businessId, branchId, repository, customerRepository]);
  const customer = customers.find((x) => x.id === customerId) ?? null;
  const listId = lists.length
    ? effectivePriceListId(customer ?? { priceListId: null }, lists)
    : null;
  const list = lists.find((x) => x.id === listId);
  const material = materials.find((x) => x.id === materialId);
  const calculation = useMemo(() => {
    if (!material || !listId) return null;
    try {
      return quotePlotter(
        {
          material,
          widthMm: mm(width),
          heightMm: mm(height),
          quantity: Number(quantity),
          priceListId: listId,
          mdf,
          canvasStretcher,
          rods,
          fold,
          notes,
        },
        rates,
      );
    } catch (error) {
      return errorText(error);
    }
  }, [
    material,
    listId,
    width,
    height,
    quantity,
    mdf,
    canvasStretcher,
    rods,
    fold,
    notes,
    rates,
  ]);
  async function save() {
    try {
      if (!calculation || typeof calculation === 'string' || !branchId)
        throw new Error('Completá la cotización.');
      const now = new Date().toISOString();
      await repository.savePlotterQuote({
        id: crypto.randomUUID(),
        businessId,
        branchId,
        customerId: customerId || null,
        priceListId: calculation.priceListId,
        status: 'quoted',
        snapshot: calculation,
        totalCents: calculation.totalCents,
        notes: notes.trim() || null,
        createdBy: profile.id,
        createdAt: now,
        updatedAt: now,
      });
      setNotice('Cotización guardada.');
      await reload();
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function changeStatus(
    quote: PlotterQuote,
    status: PlotterQuote['status'],
  ) {
    try {
      await repository.setPlotterQuoteStatus(businessId, quote.id, status);
      await reload();
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  return (
    <>
      <PageHeader title="Plotter" description="Cotizaciones" />
      {notice && <p role="status">{notice}</p>}
      <Card>
        <div className="form-row">
          <label>
            Cliente (opcional)
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Sin cliente · Público</option>
              {customers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </select>
          </label>
          <div>
            Lista: <strong>{list?.name ?? 'Sin configurar'}</strong>
          </div>
          <label>
            Material
            <select
              value={materialId}
              onChange={(e) => {
                setMaterialId(e.target.value);
                setMdf(false);
                setCanvasStretcher(false);
              }}
            >
              {materials
                .filter((x) => x.isActive)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Ancho (cm)
            <input
              inputMode="decimal"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </label>
          <label>
            Alto (cm)
            <input
              inputMode="decimal"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
          <label>
            Cantidad
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        </div>
        {material?.code === 'adhesive_vinyl' && (
          <label>
            <input
              type="checkbox"
              checked={mdf}
              onChange={(e) => setMdf(e.target.checked)}
            />{' '}
            Pegado sobre MDF 9 mm
          </label>
        )}
        {material?.code === 'canvas' && (
          <label>
            <input
              type="checkbox"
              checked={canvasStretcher}
              onChange={(e) => setCanvasStretcher(e.target.checked)}
            />{' '}
            Canvas con bastidor
          </label>
        )}
        <div className="form-row">
          <label>
            Varillas
            <select
              value={rods}
              onChange={(e) => setRods(Number(e.target.value) as 0 | 1 | 2)}
            >
              <option value={0}>Sin varillas</option>
              <option value={1}>Superior</option>
              <option value={2}>Superior + inferior</option>
            </select>
          </label>
          <label>
            Doblez de lona
            <select
              value={fold}
              onChange={(e) => setFold(e.target.value as typeof fold)}
            >
              <option value="none">Sin doblez</option>
              <option value="top">Arriba</option>
              <option value="both">Arriba + abajo</option>
            </select>
          </label>
        </div>
        <label>
          Notas
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </Card>
      <Card>
        <h2>Presupuesto</h2>
        {typeof calculation === 'string' ? (
          <p role="alert">{calculation}</p>
        ) : calculation ? (
          <>
            <p>
              Área: {(calculation.areaMm2 / 1_000_000).toLocaleString('es-AR')}{' '}
              m² ·{' '}
              {calculation.rollFit === 'no_fit'
                ? 'No entra en una sola pieza'
                : calculation.rollFit === 'rotated'
                  ? 'Entra rotado'
                  : calculation.rollFit === 'unknown'
                    ? 'Ancho de rollo sin configurar'
                    : 'Entra en el rollo'}
            </p>
            <div className="rows">
              {calculation.lines.map((line) => (
                <div className="oprow" key={line.code}>
                  <span>{line.description}</span>
                  <span>{money(line.amountCents)}</span>
                </div>
              ))}
            </div>
            <p>
              <strong>
                Total ({calculation.quantity}): {money(calculation.totalCents)}
              </strong>
            </p>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={calculation.rollFit === 'no_fit'}
            >
              Guardar cotización
            </Button>
          </>
        ) : (
          <p>Seleccioná un material.</p>
        )}
      </Card>
      <Card>
        <h2>Cotizaciones guardadas</h2>
        <div className="rows">
          {quotes.map((quote) => (
            <div className="oprow" key={quote.id}>
              <span>
                {quote.snapshot.materialName} · {quote.snapshot.widthMm / 10}×
                {quote.snapshot.heightMm / 10} cm
              </span>
              <span>{money(quote.totalCents)}</span>
              <span>{quote.status}</span>
              {quote.status === 'quoted' && (
                <Button
                  variant="ghost"
                  onClick={() => void changeStatus(quote, 'accepted')}
                >
                  Aceptar
                </Button>
              )}
              {quote.status === 'accepted' && (
                <Button
                  variant="ghost"
                  onClick={() => void changeStatus(quote, 'completed')}
                >
                  Completar
                </Button>
              )}
            </div>
          ))}
        </div>
        {quotes.length === 0 && (
          <p className="meta">Aún no hay cotizaciones.</p>
        )}
      </Card>
    </>
  );
}

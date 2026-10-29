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
import {
  Button,
  Card,
  EmptyState,
  FlashMessage,
  InlineMessage,
  FormDrawer,
  PageHeader,
  Sheet,
  StatusBadge,
  useFlash,
} from '@centrocolor/ui';
import { plotterQuoteStatus, statusMeta } from './status';
import { useBusinessContext } from './auth';
import { EventPricingCatalog } from './event-pricing-catalog';
import {
  CatalogRow,
  MoneyField,
  PriceFamilyCard,
  PriceFamilyDetail,
  PriceRow,
  PriceSection,
  priceCoverage,
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
/** Precio por m² (unidad: superficie). */
const plotterAreaRates: Array<[string, string]> = [
  ['canvas', 'Canvas'],
  ['photo_paper', 'Papel foto'],
  ['plain_paper', 'Papel común'],
  ['adhesive_vinyl', 'Vinilo adhesivo'],
  ['front_banner', 'Lona Front'],
  ['blackout_banner', 'Lona Blackout'],
  ['vinyl_mdf_small', 'Vinilo + MDF 9 mm · hasta 0,12 m²'],
  ['vinyl_mdf_large', 'Vinilo + MDF 9 mm · más de 0,12 m²'],
];
/** Varilla: por metro lineal; dobleces: precio fijo por pieza. */
const plotterFinishRates: Array<[string, string, string]> = [
  ['plastic_rod', 'Varilla plástica', 'Precio por metro'],
  ['banner_fold_top_up_to_1m', 'Doblez arriba · hasta 1 m', 'Precio por pieza'],
  [
    'banner_fold_both_up_to_1m',
    'Doblez arriba y abajo · hasta 1 m',
    'Precio por pieza',
  ],
  ['banner_fold_top_over_1m', 'Doblez arriba · más de 1 m', 'Precio por pieza'],
  [
    'banner_fold_both_over_1m',
    'Doblez arriba y abajo · más de 1 m',
    'Precio por pieza',
  ],
];
const stretcherSizes: Array<[number, number]> = [
  [200, 300],
  [300, 400],
  [300, 450],
  [400, 500],
  [400, 600],
  [500, 600],
  [500, 800],
  [500, 900],
];
const plotterRateTotal =
  plotterAreaRates.length + plotterFinishRates.length + stretcherSizes.length;
interface RateDraft {
  code: string;
  title: string;
  unit: string;
  widthMm: number | null;
  heightMm: number | null;
  value: string;
}
interface TierDraft {
  variantId: string;
  title: string;
  existing?: LabPriceTier;
  min: string;
  max: string;
  price: string;
}

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
      {notice && <InlineMessage tone="error">{notice}</InlineMessage>}
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
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);
  const [tierDraft, setTierDraft] = useState<TierDraft | null>(null);
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
  ): Promise<boolean> {
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
      return true;
    } catch (error) {
      setNotice(errorText(error));
      return false;
    }
  }
  async function saveRate(
    code: string,
    price: string,
    widthMm: number | null = null,
    heightMm: number | null = null,
  ): Promise<boolean> {
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
      return true;
    } catch (error) {
      setNotice(errorText(error));
      return false;
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
  const listName = selectedList?.name ?? 'Sin lista activa';
  const labServices = services.filter(
    (service) => service.workflowRoute === 'lab',
  );
  const rateFor = (
    code: string,
    widthMm: number | null = null,
    heightMm: number | null = null,
  ) =>
    rates.find(
      (rate) =>
        rate.priceListId === listId &&
        rate.code === code &&
        rate.widthMm === widthMm &&
        rate.heightMm === heightMm,
    );
  const offersFor = (kinds: EventOffer['kind'][]) =>
    eventOffers.filter((offer) => offer.isActive && kinds.includes(offer.kind));
  const pricedOffers = (offers: EventOffer[]) =>
    offers.filter((offer) =>
      eventRates.some(
        (rate) => rate.offerId === offer.id && rate.priceListId === listId,
      ),
    ).length;
  const labVariantsOffered = variants.filter(
    (variant) => variant.isActive && variant.channel === 'laboratory',
  );
  const labPriced = labVariantsOffered.filter((variant) =>
    tiers.some(
      (tier) => tier.variantId === variant.id && tier.priceListId === listId,
    ),
  ).length;
  const plotterPriced =
    plotterAreaRates.filter(([code]) => rateFor(code)).length +
    plotterFinishRates.filter(([code]) => rateFor(code)).length +
    stretcherSizes.filter(([w, h]) => rateFor('canvas_stretcher', w, h)).length;
  const familyCards: Array<{
    key: 'lab' | 'plotter' | 'led' | 'fabric' | 'events';
    title: string;
    summary: string;
    priced: number;
    total: number;
  }> = [
    {
      key: 'lab',
      title: 'Laboratorio',
      summary: 'Precio por copia, por tramo',
      priced: labPriced,
      total: labVariantsOffered.length,
    },
    {
      key: 'plotter',
      title: 'Plotter',
      summary: 'Precio por m², por metro y por pieza',
      priced: plotterPriced,
      total: plotterRateTotal,
    },
    {
      key: 'led',
      title: 'Pantalla LED',
      summary: 'Precio por m² y operador',
      priced: pricedOffers(offersFor(['led_screen'])),
      total: offersFor(['led_screen']).length,
    },
    {
      key: 'fabric',
      title: 'Pantallas de tela',
      summary: 'Precio sin proyector y con proyector',
      priced: pricedOffers(offersFor(['fabric_screen'])),
      total: offersFor(['fabric_screen']).length,
    },
    {
      key: 'events',
      title: 'Servicios para eventos',
      summary: 'Precio fijo: Cabina, Espejo Mágico, Giro 360',
      priced: pricedOffers(
        offersFor(['photo_booth', 'magic_mirror', 'spin_360']),
      ),
      total: offersFor(['photo_booth', 'magic_mirror', 'spin_360']).length,
    },
  ];
  const sectionTitle = familyCards.find((card) => card.key === section)?.title;
  const variantTitle = (variant: LabVariant) =>
    `${variant.channel === 'laboratory' ? 'Laboratorio' : 'Kiosco'} · ${variant.paper === 'glossy' ? 'Brillo' : 'Mate'}`;
  const plotterRow = (
    code: string,
    title: string,
    unit: string,
    widthMm: number | null = null,
    heightMm: number | null = null,
  ) => {
    const rate = rateFor(code, widthMm, heightMm);
    return (
      <PriceRow
        key={`${listId}:${code}:${widthMm}:${heightMm}`}
        title={title}
        values={[{ label: unit, cents: rate?.amountCents ?? null }]}
        onEdit={
          admin
            ? () =>
                setRateDraft({
                  code,
                  title,
                  unit,
                  widthMm,
                  heightMm,
                  value: rate ? pesos(rate.amountCents) : '',
                })
            : undefined
        }
      />
    );
  };
  return (
    <>
      <PageHeader title="Precios" />
      {notice && <InlineMessage tone="error">{notice}</InlineMessage>}
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
          <div className="section-head price-families-head">
            <h2>Familias de precios</h2>
          </div>
          <div className="config-card-grid">
            {familyCards.map((card) => {
              const coverage = priceCoverage(card.priced, card.total);
              return (
                <PriceFamilyCard
                  key={card.key}
                  title={card.title}
                  summary={card.summary}
                  detail={coverage.text}
                  status={
                    <StatusBadge tone={coverage.tone}>
                      {coverage.label}
                    </StatusBadge>
                  }
                  onOpen={() => setSection(card.key)}
                />
              );
            })}
            <PriceFamilyCard
              title="Fotografía / Video"
              summary="Próximamente"
              disabled
            />
            <PriceFamilyCard
              title="Marquetería"
              summary="Varillas y materiales"
              detail="Se configura en Materiales"
              external
              onOpen={() => onNavigate?.('mouldings')}
            />
          </div>
        </>
      )}
      {section === 'lab' && (
        <PriceFamilyDetail
          title="Laboratorio"
          listName={listName}
          onBack={() => setSection(null)}
          actions={
            <>
              <Button
                variant="secondary"
                disabled={!serviceId}
                onClick={() => setAvailabilityOpen(true)}
              >
                Disponibilidad y publicación
              </Button>
              <Button
                variant="ghost"
                onClick={() => onNavigate?.('photo-services')}
              >
                Administrar tamaños
              </Button>
            </>
          }
        >
          <div className="price-toolbar">
            <label>
              Tamaño
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {labServices.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!serviceId ? (
            <InlineMessage tone="info">
              Creá primero un tamaño con flujo Laboratorio en «Administrar
              tamaños».
            </InlineMessage>
          ) : activeVariants.length === 0 ? (
            <InlineMessage tone="info">
              Este tamaño no tiene papeles habilitados. Habilitalos en
              «Disponibilidad y publicación».
            </InlineMessage>
          ) : (
            activeVariants.map((variant) => {
              const variantTiers = tiers
                .filter(
                  (x) => x.variantId === variant.id && x.priceListId === listId,
                )
                .sort((a, b) => a.minQuantity - b.minQuantity);
              return (
                <PriceSection
                  key={`${variant.id}:${listId}`}
                  title={variantTitle(variant)}
                  hint={!variant.isActive ? 'No disponible' : undefined}
                  action={
                    admin ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setTierDraft({
                            variantId: variant.id,
                            title: variantTitle(variant),
                            min: '1',
                            max: '',
                            price: '',
                          })
                        }
                      >
                        + Nuevo tramo
                      </Button>
                    ) : undefined
                  }
                >
                  {variantTiers.length === 0 && (
                    <p className="meta price-empty">
                      Sin tramos en esta lista.
                    </p>
                  )}
                  {variantTiers.map((tier) => (
                    <PriceRow
                      key={tier.id}
                      title={`${tier.minQuantity}–${tier.maxQuantity ?? '∞'} copias`}
                      values={[
                        {
                          label: 'Precio por copia',
                          cents: tier.unitPriceCents,
                        },
                      ]}
                      inactive={!variant.isActive}
                      onEdit={
                        admin
                          ? () =>
                              setTierDraft({
                                variantId: variant.id,
                                title: variantTitle(variant),
                                existing: tier,
                                min: String(tier.minQuantity),
                                max: tier.maxQuantity?.toString() ?? '',
                                price: pesos(tier.unitPriceCents),
                              })
                          : undefined
                      }
                    />
                  ))}
                </PriceSection>
              );
            })
          )}
        </PriceFamilyDetail>
      )}
      {section === 'plotter' && (
        <PriceFamilyDetail
          title="Plotter"
          listName={listName}
          onBack={() => setSection(null)}
          actions={
            <Button
              variant="ghost"
              onClick={() => onNavigate?.('plotter-materials')}
            >
              Administrar materiales
            </Button>
          }
        >
          <PriceSection title="Materiales">
            {plotterAreaRates.map(([code, title]) =>
              plotterRow(code, title, 'Precio por m²'),
            )}
          </PriceSection>
          <PriceSection title="Terminaciones">
            {plotterFinishRates.map(([code, title, unit]) =>
              plotterRow(code, title, unit),
            )}
          </PriceSection>
          <PriceSection title="Canvas con bastidor">
            {stretcherSizes.map(([width, height]) =>
              plotterRow(
                'canvas_stretcher',
                `${width / 10}×${height / 10} cm`,
                'Precio por pieza',
                width,
                height,
              ),
            )}
          </PriceSection>
        </PriceFamilyDetail>
      )}
      {(section === 'led' || section === 'fabric' || section === 'events') && (
        <PriceFamilyDetail
          title={sectionTitle ?? ''}
          listName={listName}
          onBack={() => setSection(null)}
        >
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
        </PriceFamilyDetail>
      )}
      <FormDrawer
        open={tierDraft !== null}
        onClose={() => setTierDraft(null)}
        title={
          tierDraft
            ? `${tierDraft.existing ? 'Editar tramo' : 'Nuevo tramo'} · ${tierDraft.title}`
            : 'Tramo'
        }
        error={notice}
        disabled={!tierDraft?.price.trim()}
        onSubmit={async () => {
          if (!tierDraft) return;
          const existing =
            tierDraft.existing ??
            tiers.find(
              (x) =>
                x.variantId === tierDraft.variantId &&
                x.priceListId === listId &&
                x.minQuantity === Number(tierDraft.min),
            );
          if (
            await saveTier(
              tierDraft.variantId,
              tierDraft.min,
              tierDraft.max,
              tierDraft.price,
              existing,
            )
          )
            setTierDraft(null);
        }}
      >
        {tierDraft && (
          <>
            <div className="config-editor-form__grid">
              <label>
                Desde (copias)
                <input
                  type="number"
                  min="1"
                  value={tierDraft.min}
                  onChange={(e) =>
                    setTierDraft({ ...tierDraft, min: e.target.value })
                  }
                />
              </label>
              <label>
                Hasta (vacío = sin límite)
                <input
                  type="number"
                  min="1"
                  value={tierDraft.max}
                  onChange={(e) =>
                    setTierDraft({ ...tierDraft, max: e.target.value })
                  }
                />
              </label>
            </div>
            <MoneyField
              label="Precio por copia"
              value={tierDraft.price}
              onChange={(price) => setTierDraft({ ...tierDraft, price })}
            />
          </>
        )}
      </FormDrawer>
      <FormDrawer
        open={rateDraft !== null}
        onClose={() => setRateDraft(null)}
        title={rateDraft ? `Editar precio · ${rateDraft.title}` : 'Precio'}
        error={notice}
        disabled={!rateDraft?.value.trim()}
        onSubmit={async () => {
          if (!rateDraft) return;
          if (
            await saveRate(
              rateDraft.code,
              rateDraft.value,
              rateDraft.widthMm,
              rateDraft.heightMm,
            )
          )
            setRateDraft(null);
        }}
      >
        {rateDraft && (
          <MoneyField
            label={rateDraft.unit}
            value={rateDraft.value}
            onChange={(value) => setRateDraft({ ...rateDraft, value })}
          />
        )}
      </FormDrawer>
      <Sheet
        open={availabilityOpen}
        onClose={() => setAvailabilityOpen(false)}
        title="Disponibilidad y publicación"
        variant="side"
      >
        <div className="form-drawer">
          {selectedService && (
            <p className="meta">Tamaño: {selectedService.name}</p>
          )}
          {serviceId && (
            <section className="drawer-section">
              <h3>Papel y canal</h3>
              <div className="rows">
                {(['laboratory', 'kiosk'] as const).flatMap((channel) =>
                  (['glossy', 'matte'] as const).map((paper) => {
                    const variant = activeVariants.find(
                      (x) => x.channel === channel && x.paper === paper,
                    );
                    return (
                      <div className="price-row" key={`${channel}-${paper}`}>
                        <div className="price-row__id">
                          <strong>
                            {channel === 'laboratory'
                              ? 'Laboratorio'
                              : 'Kiosco'}{' '}
                            · {paper === 'glossy' ? 'Brillo' : 'Mate'}
                          </strong>
                        </div>
                        <StatusBadge tone={variant?.isActive ? 'ok' : 'closed'}>
                          {variant?.isActive ? 'Disponible' : 'No disponible'}
                        </StatusBadge>
                        {admin && (
                          <Button
                            variant="secondary"
                            size="sm"
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
            </section>
          )}
          {serviceId && portal && (
            <section className="drawer-section">
              <h3>Publicación en /imprimir</h3>
              <p className="meta">
                El portal público sólo ofrece variantes de Laboratorio
                disponibles con un tramo en la lista Pública; las listas
                Profesional y de convenio nunca se muestran.
              </p>
              {portal.serviceBlockers.length > 0 && (
                <>
                  <InlineMessage tone="info">
                    Este tamaño no se muestra en la web:{' '}
                    {portal.serviceBlockers.join(' ')}
                  </InlineMessage>
                  {admin && portal.publishable && (
                    <Button onClick={() => void publishService()}>
                      Publicar en /imprimir
                    </Button>
                  )}
                </>
              )}
              <div className="rows">
                {portal.variants.map((status) => (
                  <div className="price-row" key={status.variantId}>
                    <div className="price-row__id">
                      <strong>
                        {status.channel === 'laboratory'
                          ? 'Laboratorio'
                          : 'Kiosco'}{' '}
                        · {status.paper === 'glossy' ? 'Brillo' : 'Mate'}
                      </strong>
                      <span className="meta">
                        {status.offered
                          ? 'Se ofrece en la web'
                          : (status.reason ?? 'Oculta por el tamaño')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </Sheet>
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
  const [editing, setEditing] = useState<PlotterMaterial | null>(null);
  const [roll, setRoll] = useState('');
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
    rollWidth: string,
    active: boolean,
  ): Promise<boolean> {
    try {
      await repository.savePlotterMaterial({
        ...material,
        rollWidthMm: rollWidth.trim() ? mm(rollWidth) : null,
        isActive: active,
      });
      await reload();
      onMutation?.();
      return true;
    } catch (error) {
      setNotice(errorText(error));
      return false;
    }
  }
  const rollText = (material: PlotterMaterial) =>
    material.rollWidthMm === null
      ? 'Sin confirmar'
      : `${String(material.rollWidthMm / 10).replace('.', ',')} cm`;
  return (
    <>
      <PageHeader title="Materiales de Plotter" />
      {notice && !editing && (
        <InlineMessage tone="error">{notice}</InlineMessage>
      )}
      <Card className="card--flush">
        {materials.length === 0 ? (
          <EmptyState icon="layers" title="Todavía no hay materiales" />
        ) : (
          <div className="rows catalog-rows">
            {materials.map((material) => (
              <CatalogRow
                key={material.id}
                title={material.name}
                values={[
                  { label: 'Ancho de rollo', value: rollText(material) },
                ]}
                active={material.isActive}
                onEdit={
                  admin
                    ? () => {
                        setEditing(material);
                        setRoll(
                          material.rollWidthMm === null
                            ? ''
                            : String(material.rollWidthMm / 10).replace(
                                '.',
                                ',',
                              ),
                        );
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </Card>
      <FormDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Editar ${editing.name}` : 'Material'}
        error={notice}
        onSubmit={async () => {
          if (editing && (await saveMaterial(editing, roll, editing.isActive)))
            setEditing(null);
        }}
      >
        <label>
          Ancho de rollo (cm)
          <input
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            placeholder="Sin confirmar"
          />
        </label>
        {editing && (
          <section className="drawer-section">
            <h3>Estado</h3>
            <Button
              variant={editing.isActive ? 'danger' : 'secondary'}
              onClick={() =>
                void saveMaterial(editing, roll, !editing.isActive).then(
                  (saved) => saved && setEditing(null),
                )
              }
            >
              {editing.isActive ? 'Desactivar material' : 'Activar material'}
            </Button>
          </section>
        )}
      </FormDrawer>
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
  const flash = useFlash();
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
      flash.error(errorText(error));
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
      flash.success('Cotización guardada.');
      await reload();
      onMutation?.();
    } catch (error) {
      flash.error(errorText(error));
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
      flash.error(errorText(error));
    }
  }
  const isBanner =
    material?.code === 'front_banner' || material?.code === 'blackout_banner';
  const pricePerM2 =
    material && !mdf && !canvasStretcher
      ? rates.find(
          (x) =>
            x.priceListId === listId &&
            x.code === material.code &&
            x.widthMm === null,
        )?.amountCents
      : undefined;
  const customerName = (id: string | null) =>
    id
      ? (customers.find((x) => x.id === id)?.fullName ?? 'Cliente')
      : 'Sin cliente';
  const result = typeof calculation === 'string' ? null : calculation;
  return (
    <>
      <PageHeader title="Plotter" />
      <FlashMessage flash={flash} />
      <div className="quote-workspace">
        <Card className="quote-inputs">
          <section className="drawer-section drawer-section--first">
            <h3>Cliente</h3>
            <label>
              Cliente (opcional)
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Sin cliente</option>
                {customers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName}
                  </option>
                ))}
              </select>
            </label>
            <p className="meta">
              Lista de precios: {list?.name ?? 'sin configurar'}
            </p>
          </section>
          <section className="drawer-section">
            <h3>Material y medidas</h3>
            <label>
              Material
              <select
                value={materialId}
                onChange={(e) => {
                  const next = materials.find((x) => x.id === e.target.value);
                  setMaterialId(e.target.value);
                  setMdf(false);
                  setCanvasStretcher(false);
                  if (
                    next?.code !== 'front_banner' &&
                    next?.code !== 'blackout_banner'
                  )
                    setFold('none');
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
            <div className="form-row">
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
          </section>
          <section className="drawer-section">
            <h3>Extras</h3>
            {material?.code === 'adhesive_vinyl' && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={mdf}
                  onChange={(e) => setMdf(e.target.checked)}
                />
                Pegado sobre MDF 9 mm
              </label>
            )}
            {material?.code === 'canvas' && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={canvasStretcher}
                  onChange={(e) => setCanvasStretcher(e.target.checked)}
                />
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
              {isBanner && (
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
              )}
            </div>
          </section>
          <label>
            Notas
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </Card>

        <Card className="quote-result">
          <h2>Presupuesto</h2>
          {typeof calculation === 'string' ? (
            <InlineMessage tone="error">{calculation}</InlineMessage>
          ) : result ? (
            <>
              <p className="meta quote-result__facts">
                {(result.areaMm2 / 1_000_000).toLocaleString('es-AR')} m² ·{' '}
                {result.rollFit === 'no_fit'
                  ? 'No entra en una sola pieza'
                  : result.rollFit === 'rotated'
                    ? 'Entra rotado'
                    : result.rollFit === 'unknown'
                      ? 'Ancho de rollo sin configurar'
                      : 'Entra en el rollo'}
                {pricePerM2 !== undefined && (
                  <> · Precio por m² {money(pricePerM2)}</>
                )}
              </p>
              <div className="rows">
                {result.lines.map((line) => (
                  <div className="quote-line" key={line.code}>
                    <span>{line.description}</span>
                    <span className="num">{money(line.amountCents)}</span>
                  </div>
                ))}
              </div>
              <p className="quote-total">
                <span>Total ({result.quantity})</span>
                <strong>{money(result.totalCents)}</strong>
              </p>
              <Button
                variant="primary"
                block
                onClick={() => void save()}
                disabled={result.rollFit === 'no_fit'}
              >
                Guardar cotización
              </Button>
            </>
          ) : (
            <p className="meta">Elegí un material para ver el precio.</p>
          )}
        </Card>
      </div>

      <section className="price-section-gap">
        <div className="section-head">
          <h2>Cotizaciones guardadas</h2>
        </div>
        <Card className="card--flush">
          {quotes.length === 0 ? (
            <EmptyState icon="ruler" title="Todavía no hay cotizaciones" />
          ) : (
            <div className="rows catalog-rows">
              {quotes.map((quote) => {
                const state = statusMeta(plotterQuoteStatus, quote.status);
                return (
                  <div className="price-row" key={quote.id}>
                    <div className="price-row__id">
                      <strong>
                        {quote.snapshot.materialName} ·{' '}
                        {quote.snapshot.widthMm / 10}×
                        {quote.snapshot.heightMm / 10} cm
                        {quote.snapshot.quantity > 1
                          ? ` × ${quote.snapshot.quantity}`
                          : ''}
                      </strong>
                      <span className="meta">
                        {customerName(quote.customerId)} ·{' '}
                        {new Date(quote.createdAt).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                    <div className="price-row__values">
                      <span className="config-value">
                        <small>Total</small>
                        <strong>{money(quote.totalCents)}</strong>
                      </span>
                    </div>
                    <div className="price-row__state">
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                    </div>
                    {quote.status === 'quoted' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void changeStatus(quote, 'accepted')}
                      >
                        Aceptar
                      </Button>
                    )}
                    {quote.status === 'accepted' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void changeStatus(quote, 'completed')}
                      >
                        Completar
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>
    </>
  );
}

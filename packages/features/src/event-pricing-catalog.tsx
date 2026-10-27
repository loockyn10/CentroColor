import { useEffect, useState } from 'react';
import type {
  EventRepository,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import type { EventOffer, EventOfferRate, Resource } from '@centrocolor/domain';
import { Button, Card, Sheet } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import {
  ConfigurationRow,
  ConfigurationSection,
  MoneyField,
} from './configuration-ui';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo guardar.';
const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    cents / 100,
  );
function cents(value: string) {
  const clean = value.trim().replaceAll('.', '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean))
    throw new Error('Ingresá un importe válido.');
  const [whole, fraction = ''] = clean.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Importe fuera de rango.');
  return result;
}
const pesos = (amount: number | null | undefined) =>
  amount == null ? '' : (amount / 100).toFixed(2).replace('.', ',');
function mm(value: string) {
  const clean = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d)?$/.test(clean))
    throw new Error('Ingresá centímetros con hasta un decimal.');
  const [whole, fraction = ''] = clean.split('.');
  const result = Number(whole) * 10 + Number(fraction.padEnd(1, '0'));
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error('Medida inválida.');
  return result;
}

const offerKindLabel: Record<EventOffer['kind'], string> = {
  fabric_screen: 'Pantalla de tela',
  led_screen: 'Pantalla LED',
  photo_booth: 'Cabina Fotográfica',
  magic_mirror: 'Espejo Mágico',
  spin_360: 'Giro 360',
};

interface RateDraft {
  amount: string;
  operator: string;
  withProjector: string;
}

export function EventPricingCatalog({
  repository,
  eventRepository,
  selectedListId,
  family,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  eventRepository: EventRepository;
  selectedListId: string;
  family: 'led' | 'fabric' | 'events';
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const admin = role !== 'staff';
  const [offers, setOffers] = useState<EventOffer[]>([]);
  const [rates, setRates] = useState<EventOfferRate[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [newScreenOpen, setNewScreenOpen] = useState(false);
  const [fabricName, setFabricName] = useState('');
  const [fabricWidth, setFabricWidth] = useState('');
  const [fabricHeight, setFabricHeight] = useState('');
  const [fabricProjection, setFabricProjection] = useState<'front' | 'rear'>(
    'front',
  );
  const [fabricPrimary, setFabricPrimary] = useState('');
  const [fabricProjector, setFabricProjector] = useState('');

  const reload = async () => {
    const [nextOffers, nextRates, nextResources] = await Promise.all([
      repository.listEventOffers(businessId),
      repository.listEventOfferRates(businessId),
      eventRepository.listResources(businessId, true),
    ]);
    setOffers(nextOffers);
    setRates(nextRates);
    setResources(nextResources);
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

  async function saveOffer(offer: EventOffer, draft: RateDraft) {
    const existing = rates.find(
      (rate) =>
        rate.offerId === offer.id && rate.priceListId === selectedListId,
    );
    if (!selectedListId) {
      setNotice('Seleccioná una lista de precios.');
      return false;
    }
    return persist(async () => {
      if (offer.kind === 'fabric_screen')
        await repository.saveEventOffer(offer);
      await repository.saveEventOfferRate({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        offerId: offer.id,
        priceListId: selectedListId,
        amountCents: cents(draft.amount),
        operatorAmountCents:
          offer.kind === 'led_screen' ? cents(draft.operator) : 0,
        withProjectorAmountCents:
          offer.kind === 'fabric_screen' && draft.withProjector.trim()
            ? cents(draft.withProjector)
            : null,
      });
    });
  }

  async function createFabricScreen() {
    const saved = await persist(() =>
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
    if (!saved) return;
    setFabricName('');
    setFabricWidth('');
    setFabricHeight('');
    setFabricPrimary('');
    setFabricProjector('');
    setNewScreenOpen(false);
  }

  const visibleOffers = offers.filter((offer) =>
    family === 'led'
      ? offer.kind === 'led_screen'
      : family === 'fabric'
        ? offer.kind === 'fabric_screen'
        : ['photo_booth', 'magic_mirror', 'spin_360'].includes(offer.kind),
  );

  return (
    <>
      {notice && <p role="alert">{notice}</p>}
      <Card>
        <ConfigurationSection
          eyebrow="CATÁLOGO"
          description={
            family === 'led'
              ? 'Sólo componentes comerciales. Paneles, píxeles y controladores se administran en Recursos.'
              : family === 'fabric'
                ? 'Cada tamaño tiene un precio final sin proyector y otro con proyector.'
                : 'Todos los servicios usan la misma edición de precio y estado.'
          }
          actions={
            admin && family === 'fabric' ? (
              <Button
                variant="secondary"
                onClick={() => setNewScreenOpen(true)}
              >
                + Nueva pantalla
              </Button>
            ) : undefined
          }
        />
        <div className="rows">
          {visibleOffers.map((offer) => (
            <OfferRow
              key={`${offer.id}:${selectedListId}`}
              offer={offer}
              rate={rates.find(
                (rate) =>
                  rate.offerId === offer.id &&
                  rate.priceListId === selectedListId,
              )}
              resources={resources}
              admin={admin}
              onSave={saveOffer}
              onToggle={(next) =>
                persist(() => repository.saveEventOffer(next))
              }
            />
          ))}
          {!visibleOffers.length && (
            <p className="meta">Todavía no hay elementos en esta familia.</p>
          )}
        </div>
      </Card>
      <Sheet
        open={newScreenOpen}
        onClose={() => setNewScreenOpen(false)}
        title="Nueva pantalla de tela"
        variant="side"
      >
        <div className="config-editor-form">
          <label>
            Nombre
            <input
              value={fabricName}
              onChange={(event) => setFabricName(event.target.value)}
              placeholder="Pantalla 3×2"
            />
          </label>
          <div className="config-editor-form__grid">
            <label>
              Ancho (cm)
              <input
                inputMode="decimal"
                value={fabricWidth}
                onChange={(event) => setFabricWidth(event.target.value)}
              />
            </label>
            <label>
              Alto (cm)
              <input
                inputMode="decimal"
                value={fabricHeight}
                onChange={(event) => setFabricHeight(event.target.value)}
              />
            </label>
          </div>
          <label>
            Proyección
            <select
              value={fabricProjection}
              onChange={(event) =>
                setFabricProjection(event.target.value as 'front' | 'rear')
              }
            >
              <option value="front">Delantera</option>
              <option value="rear">Trasera</option>
            </select>
          </label>
          <ResourceSelect
            label="Pantalla física"
            value={fabricPrimary}
            resources={resources}
            onChange={setFabricPrimary}
          />
          <ResourceSelect
            label="Proyector físico (opcional)"
            value={fabricProjector}
            resources={resources}
            onChange={setFabricProjector}
            optional
          />
          <Button
            disabled={
              !fabricName.trim() ||
              !fabricWidth.trim() ||
              !fabricHeight.trim() ||
              !fabricPrimary
            }
            onClick={() => void createFabricScreen()}
          >
            Crear pantalla
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function OfferRow({
  offer,
  rate,
  resources,
  admin,
  onSave,
  onToggle,
}: {
  offer: EventOffer;
  rate?: EventOfferRate;
  resources: Resource[];
  admin: boolean;
  onSave: (offer: EventOffer, draft: RateDraft) => Promise<boolean>;
  onToggle: (offer: EventOffer) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(offer);
  const [amount, setAmount] = useState(pesos(rate?.amountCents));
  const [operator, setOperator] = useState(
    pesos(rate?.operatorAmountCents ?? 0),
  );
  const [withProjector, setWithProjector] = useState(
    pesos(rate?.withProjectorAmountCents),
  );
  const displayName =
    offer.kind === 'fabric_screen' ? offer.name : offerKindLabel[offer.kind];
  const meta =
    offer.kind === 'fabric_screen'
      ? `${offer.widthMm! / 1000} × ${offer.heightMm! / 1000} m · ${offer.projection === 'rear' ? 'Proyección trasera' : 'Proyección delantera'}`
      : offer.primaryResourceId
        ? (resources.find((resource) => resource.id === offer.primaryResourceId)
            ?.name ?? 'Recurso faltante')
        : undefined;
  const values =
    offer.kind === 'led_screen' ? (
      <>
        <PriceValue label="Precio por m²" amount={rate?.amountCents ?? null} />
        <PriceValue
          label="Operador"
          amount={rate?.operatorAmountCents ?? null}
        />
      </>
    ) : offer.kind === 'fabric_screen' ? (
      <>
        <PriceValue label="Sin proyector" amount={rate?.amountCents ?? null} />
        <PriceValue
          label="Con proyector"
          amount={rate?.withProjectorAmountCents ?? null}
        />
      </>
    ) : (
      <PriceValue label="Precio" amount={rate?.amountCents ?? null} />
    );

  function beginEdit() {
    setDraft(offer);
    setAmount(pesos(rate?.amountCents));
    setOperator(pesos(rate?.operatorAmountCents ?? 0));
    setWithProjector(pesos(rate?.withProjectorAmountCents));
    setOpen(true);
  }

  async function save() {
    const saved = await onSave(draft, { amount, operator, withProjector });
    if (saved) setOpen(false);
  }

  return (
    <>
      <ConfigurationRow
        title={displayName}
        meta={meta}
        values={values}
        active={offer.isActive}
        onEdit={admin ? beginEdit : undefined}
        onToggle={
          admin
            ? () => void onToggle({ ...offer, isActive: !offer.isActive })
            : undefined
        }
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Editar ${displayName}`}
        variant="side"
      >
        <div className="config-editor-form">
          {offer.kind === 'led_screen' ? (
            <>
              <MoneyField
                label="Precio por m²"
                value={amount}
                onChange={setAmount}
              />
              <MoneyField
                label="Operador"
                value={operator}
                onChange={setOperator}
              />
            </>
          ) : offer.kind === 'fabric_screen' ? (
            <>
              <MoneyField
                label="Sin proyector"
                value={amount}
                onChange={setAmount}
              />
              <MoneyField
                label="Con proyector"
                value={withProjector}
                onChange={setWithProjector}
                placeholder="Opcional"
              />
              <label>
                Nombre
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <div className="config-editor-form__grid">
                <DimensionField
                  label="Ancho (cm)"
                  valueMm={draft.widthMm}
                  onChange={(widthMm) => setDraft({ ...draft, widthMm })}
                />
                <DimensionField
                  label="Alto (cm)"
                  valueMm={draft.heightMm}
                  onChange={(heightMm) => setDraft({ ...draft, heightMm })}
                />
              </div>
              <label>
                Proyección
                <select
                  value={draft.projection ?? 'front'}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      projection: event.target.value as 'front' | 'rear',
                    })
                  }
                >
                  <option value="front">Delantera</option>
                  <option value="rear">Trasera</option>
                </select>
              </label>
              <ResourceSelect
                label="Pantalla física"
                value={draft.primaryResourceId ?? ''}
                resources={resources}
                onChange={(value) =>
                  setDraft({ ...draft, primaryResourceId: value || null })
                }
              />
              <ResourceSelect
                label="Proyector físico"
                value={draft.projectorResourceId ?? ''}
                resources={resources}
                optional
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    projectorResourceId: value || null,
                    withProjector: Boolean(value),
                  })
                }
              />
            </>
          ) : (
            <MoneyField label="Precio" value={amount} onChange={setAmount} />
          )}
          <Button
            disabled={
              !amount.trim() ||
              (offer.kind === 'led_screen' && !operator.trim())
            }
            onClick={() => void save()}
          >
            Guardar cambios
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function PriceValue({
  label,
  amount,
}: {
  label: string;
  amount: number | null;
}) {
  return (
    <span className="config-value">
      <small>{label}</small>
      <strong>{amount === null ? 'Sin configurar' : money(amount)}</strong>
    </span>
  );
}

function ResourceSelect({
  label,
  value,
  resources,
  optional = false,
  onChange,
}: {
  label: string;
  value: string;
  resources: Resource[];
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? 'Sin asignar' : 'Seleccionar'}</option>
        {resources
          .filter((resource) => resource.isActive)
          .map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name}
            </option>
          ))}
      </select>
    </label>
  );
}

function DimensionField({
  label,
  valueMm,
  onChange,
}: {
  label: string;
  valueMm: number | null;
  onChange: (value: number) => void;
}) {
  const [value, setValue] = useState(
    valueMm === null ? '' : String(valueMm / 10).replace('.', ','),
  );
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          try {
            onChange(mm(next));
          } catch {
            // Validation is shown when saving; retain the editable text meanwhile.
          }
        }}
      />
    </label>
  );
}

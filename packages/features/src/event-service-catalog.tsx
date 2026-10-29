import { useEffect, useState } from 'react';
import type {
  EventRepository,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import type { EventOffer, EventOfferRate, Resource } from '@centrocolor/domain';
import { Button, Card, InlineMessage } from '@centrocolor/ui';
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
  photo_booth: 'Cabina Fotográfica',
  magic_mirror: 'Espejo Mágico',
  spin_360: 'Giro 360',
};

export function EventCatalogPanel({
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
  const [rates, setRates] = useState<EventOfferRate[]>([]),
    [resources, setResources] = useState<Resource[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [showFabricForm, setShowFabricForm] = useState(false);
  const [fabricName, setFabricName] = useState(''),
    [fabricWidth, setFabricWidth] = useState(''),
    [fabricHeight, setFabricHeight] = useState('');
  const [fabricProjection, setFabricProjection] = useState<'front' | 'rear'>(
    'front',
  );
  const [fabricPrimary, setFabricPrimary] = useState(''),
    [fabricProjector, setFabricProjector] = useState('');
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
    void reload().catch((e) => setNotice(errorText(e)));
  }, [businessId, repository, eventRepository]);
  async function persist(work: () => Promise<unknown>): Promise<boolean> {
    try {
      await work();
      await reload();
      setNotice(null);
      onMutation?.();
      return true;
    } catch (e) {
      setNotice(errorText(e));
      return false;
    }
  }
  async function rate(offer: EventOffer, value: string): Promise<boolean> {
    const existing = rates.find(
      (x) => x.offerId === offer.id && x.priceListId === selectedListId,
    );
    return persist(() =>
      repository.saveEventOfferRate({
        id: existing?.id ?? crypto.randomUUID(),
        businessId,
        offerId: offer.id,
        priceListId: selectedListId,
        amountCents: cents(value),
        operatorAmountCents: existing?.operatorAmountCents ?? 0,
        withProjectorAmountCents: existing?.withProjectorAmountCents ?? null,
      }),
    );
  }
  async function fabric() {
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
    setShowFabricForm(false);
  }
  return (
    <>
      {notice && <InlineMessage tone="error">{notice}</InlineMessage>}
      <Card>
        <div className="pricing-card-heading">
          <div>
            <h2>Servicios y tarifas</h2>
            <p className="meta">
              {family === 'led'
                ? 'Precio por m². La capacidad técnica se administra en Recursos.'
                : family === 'fabric'
                  ? 'Tamaños, proyección, equipos requeridos y precio fijo.'
                  : 'Precio fijo por lista; los equipos físicos se reservan por separado.'}
            </p>
          </div>
          {admin && family === 'fabric' && !showFabricForm && (
            <Button variant="secondary" onClick={() => setShowFabricForm(true)}>
              + Nueva pantalla
            </Button>
          )}
        </div>
        <div className="rows">
          {offers
            .filter((offer) =>
              family === 'led'
                ? offer.kind === 'led_screen'
                : family === 'fabric'
                  ? offer.kind === 'fabric_screen'
                  : ['photo_booth', 'magic_mirror', 'spin_360'].includes(
                      offer.kind,
                    ),
            )
            .map((offer) => {
              const rateValue = rates.find(
                (x) =>
                  x.offerId === offer.id && x.priceListId === selectedListId,
              );
              return (
                <OfferRow
                  key={`${offer.id}:${selectedListId}`}
                  offer={offer}
                  rate={rateValue}
                  admin={admin}
                  resources={resources}
                  onRate={(value) => rate(offer, value)}
                  onOffer={(next) =>
                    persist(() => repository.saveEventOffer(next))
                  }
                />
              );
            })}
        </div>
      </Card>
      {admin && family === 'fabric' && showFabricForm && (
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
            <Button variant="ghost" onClick={() => setShowFabricForm(false)}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}
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
  onRate: (v: string) => Promise<boolean>;
  onOffer: (x: EventOffer) => Promise<boolean>;
}) {
  const [value, setValue] = useState(
    rate ? (rate.amountCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(offer);
  const displayName =
    offer.kind === 'fabric_screen'
      ? `${offerKindLabel[offer.kind]} · ${offer.name}`
      : offerKindLabel[offer.kind];
  return (
    <div className="oprow">
      <span className="who">{displayName}</span>
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
      <span>{rate ? money(rate.amountCents) : 'Sin tarifa'}</span>
      <span className="meta">{offer.isActive ? 'Activo' : 'Inactivo'}</span>
      {admin && (
        <div className="pricing-row-actions">
          <Button variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Cerrar' : 'Editar'}
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void onOffer({ ...offer, isActive: !offer.isActive })
            }
          >
            {offer.isActive ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      )}
      {editing && (
        <div className="form-row">
          <label>
            Tarifa en la lista seleccionada
            <input
              aria-label={`Tarifa ${displayName}`}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Sin tarifa"
            />
          </label>
          <Button
            disabled={!value.trim()}
            onClick={() =>
              void onRate(value).then((saved) => {
                if (saved && offer.kind !== 'fabric_screen') setEditing(false);
              })
            }
          >
            Guardar tarifa
          </Button>
          {offer.kind === 'fabric_screen' && (
            <>
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
                onClick={() =>
                  void onOffer(draft).then((saved) => {
                    if (saved) setEditing(false);
                  })
                }
              >
                Guardar pantalla
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}

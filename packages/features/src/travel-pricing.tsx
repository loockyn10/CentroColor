import { useEffect, useMemo, useState } from 'react';
import type { ServiceCatalogRepository } from '@centrocolor/application';
import { quoteTravel, type TravelPricingSettings } from '@centrocolor/domain';
import { Button, Sheet } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { MoneyField } from './configuration-ui';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo guardar.';
const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(cents / 100);
const decimal = (scaled: number, digits: number) => {
  const divisor = 10 ** digits;
  const whole = Math.floor(scaled / divisor);
  const fraction = String(scaled % divisor)
    .padStart(digits, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole},${fraction}` : String(whole);
};
function scaledInteger(value: string, digits: number, label: string) {
  const clean = value.trim().replace(',', '.');
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(clean))
    throw new Error(`${label}: ingresá un valor válido.`);
  const [whole, fraction = ''] = clean.split('.');
  const result =
    Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(result))
    throw new Error(`${label}: valor fuera de rango.`);
  return result;
}

export function TravelPricingButton({
  repository,
  onMutation,
}: {
  repository: ServiceCatalogRepository;
  onMutation?: () => void;
}) {
  const { businessId, role } = useBusinessContext();
  const admin = role !== 'staff';
  const [settings, setSettings] = useState<TravelPricingSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [fuelPrice, setFuelPrice] = useState('');
  const [efficiency, setEfficiency] = useState('');
  const [margin, setMargin] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () =>
    repository
      .getTravelPricingSettings(businessId)
      .then(setSettings)
      .catch((error) => setNotice(errorText(error)));
  useEffect(() => {
    void reload();
  }, [businessId, repository]);

  function edit() {
    setFuelPrice(settings ? decimal(settings.fuelPriceCentsPerLiter, 2) : '');
    setEfficiency(
      settings ? decimal(settings.efficiencyMilliKmPerLiter, 3) : '',
    );
    setMargin(settings ? decimal(settings.marginBasisPoints, 2) : '');
    setNotice(null);
    setOpen(true);
  }

  const draft = useMemo(() => {
    try {
      return {
        id: settings?.id ?? '',
        businessId,
        fuelPriceCentsPerLiter: scaledInteger(
          fuelPrice,
          2,
          'Precio de combustible',
        ),
        efficiencyMilliKmPerLiter: scaledInteger(efficiency, 3, 'Rendimiento'),
        marginBasisPoints: scaledInteger(margin, 2, 'Margen'),
      } satisfies TravelPricingSettings;
    } catch {
      return null;
    }
  }, [businessId, efficiency, fuelPrice, margin, settings?.id]);
  const example = draft ? quoteTravel(draft, 25_000) : null;

  async function save() {
    try {
      if (!draft) throw new Error('Revisá los tres valores de viáticos.');
      if (draft.fuelPriceCentsPerLiter <= 0)
        throw new Error('El precio por litro debe ser mayor que cero.');
      if (draft.efficiencyMilliKmPerLiter <= 0)
        throw new Error('El rendimiento debe ser mayor que cero.');
      const saved = await repository.saveTravelPricingSettings({
        ...draft,
        id: settings?.id ?? crypto.randomUUID(),
      });
      setSettings(saved);
      setNotice(null);
      setOpen(false);
      onMutation?.();
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  return (
    <>
      {notice && !open && (
        <span className="config-inline-alert" role="alert">
          {notice}
        </span>
      )}
      <Button variant="secondary" disabled={!admin} onClick={edit}>
        Viáticos
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Configurar viáticos"
        variant="side"
      >
        <div className="config-editor-form">
          <p className="meta">
            Se aplica al viaje de ida y vuelta y no depende de la lista
            seleccionada.
          </p>
          <MoneyField
            label="Precio combustible por litro"
            value={fuelPrice}
            onChange={setFuelPrice}
            placeholder="1600,00"
          />
          <label>
            Rendimiento del vehículo (km/l)
            <input
              inputMode="decimal"
              value={efficiency}
              onChange={(event) => setEfficiency(event.target.value)}
              placeholder="10"
            />
          </label>
          <label>
            Margen adicional (%)
            <input
              inputMode="decimal"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              placeholder="20"
            />
          </label>
          {example && (
            <div className="notice" role="status">
              <strong>Ejemplo con 25 km de ida</strong>
              <span>
                50 km totales · {decimal(example.fuelMilliLiters, 3)} litros ·{' '}
                {money(example.baseCostCents)} de combustible ·{' '}
                <strong>{money(example.totalCents)} final</strong>
              </span>
            </div>
          )}
          <Button disabled={!draft} onClick={() => void save()}>
            Guardar cambios
          </Button>
        </div>
      </Sheet>
    </>
  );
}

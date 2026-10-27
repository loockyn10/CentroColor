import { describe, expect, it } from 'vitest';
import {
  effectivePriceListId,
  labPortalStatus,
  labUnitPrice,
  ledAvailability,
  effectiveWindow,
  eventOfferBasePrice,
  ledOfferBasePrice,
  quoteEventService,
  quotePlotter,
  quoteTravel,
  rollFit,
  type LabPriceTier,
  type LabVariant,
  type PlotterMaterial,
  type PlotterRate,
  type PriceList,
} from './services';

const lists: PriceList[] = [
  {
    id: 'public',
    businessId: 'b',
    name: 'Público',
    kind: 'public',
    isDefault: true,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'pro',
    businessId: 'b',
    name: 'Profesional',
    kind: 'professional',
    isDefault: false,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
];
const material = (
  code: PlotterMaterial['code'],
  rollWidthMm: number | null = null,
): PlotterMaterial => ({
  id: code,
  businessId: 'b',
  code,
  name: code,
  rollWidthMm,
  isActive: true,
});

describe('pricing UX calculations', () => {
  const travelSettings = {
    id: 'travel',
    businessId: 'b',
    fuelPriceCentsPerLiter: 160_000,
    efficiencyMilliKmPerLiter: 10_000,
    marginBasisPoints: 2_000,
  };
  const fabricOffer = {
    id: 'fabric',
    businessId: 'b',
    kind: 'fabric_screen' as const,
    name: 'Pantalla 3 × 2',
    widthMm: 3_000,
    heightMm: 2_000,
    projection: 'front' as const,
    withProjector: true,
    primaryResourceId: 'screen',
    projectorResourceId: 'projector',
    isActive: true,
  };
  const rate = {
    id: 'rate',
    businessId: 'b',
    offerId: 'fabric',
    priceListId: 'public',
    amountCents: 4_000_000,
    operatorAmountCents: 750_000,
    withProjectorAmountCents: 5_500_000,
  };

  it('calcula ida y vuelta, combustible y margen sólo con enteros', () => {
    expect(quoteTravel(travelSettings, 25_000)).toEqual({
      oneWayDistanceMeters: 25_000,
      totalDistanceMeters: 50_000,
      fuelMilliLiters: 5_000,
      baseCostCents: 800_000,
      totalCents: 960_000,
    });
    expect(quoteTravel(travelSettings, 1)).toMatchObject({
      totalDistanceMeters: 2,
      totalCents: 38,
    });
    expect(() => quoteTravel(travelSettings, 1.5)).toThrow('metros enteros');
  });

  it('redondea cada salida a la unidad entera más cercana, con empates hacia arriba', () => {
    const halfCent = {
      ...travelSettings,
      fuelPriceCentsPerLiter: 1,
      efficiencyMilliKmPerLiter: 1_000,
      marginBasisPoints: 0,
    };
    expect(quoteTravel(halfCent, 250)).toEqual({
      oneWayDistanceMeters: 250,
      totalDistanceMeters: 500,
      fuelMilliLiters: 500,
      baseCostCents: 1,
      totalCents: 1,
    });
  });

  it('aplica el margen sobre el costo exacto antes del redondeo monetario final', () => {
    const fractionalCost = {
      ...travelSettings,
      fuelPriceCentsPerLiter: 1,
      efficiencyMilliKmPerLiter: 1_000,
      marginBasisPoints: 5_000,
    };
    expect(quoteTravel(fractionalCost, 250)).toMatchObject({
      baseCostCents: 1,
      totalCents: 1,
    });
  });

  it('separa las variantes de tela y suma el operador al LED', () => {
    expect(eventOfferBasePrice(fabricOffer, rate, false)).toBe(4_000_000);
    expect(eventOfferBasePrice(fabricOffer, rate, true)).toBe(5_500_000);
    expect(
      ledOfferBasePrice(
        { ...rate, offerId: 'led', amountCents: 1_000_000 },
        3_000,
        2_000,
      ),
    ).toBe(6_750_000);
  });
});
const rate = (
  code: string,
  amountCents: number,
  widthMm: number | null = null,
  heightMm: number | null = null,
): PlotterRate => ({
  id: `${code}:${widthMm}:${heightMm}`,
  businessId: 'b',
  priceListId: 'pro',
  code,
  amountCents,
  widthMm,
  heightMm,
});
const base = {
  widthMm: 1200,
  heightMm: 2000,
  quantity: 1,
  priceListId: 'pro',
  mdf: false,
  canvasStretcher: false,
  rods: 0 as const,
  fold: 'none' as const,
  notes: null,
};

describe('listas y laboratorio', () => {
  it('usa Público para clientes sin lista y para todo pedido anónimo', () => {
    expect(effectivePriceListId(null, lists)).toBe('public');
    expect(effectivePriceListId({ priceListId: 'pro' }, lists)).toBe('pro');
    expect(effectivePriceListId({ priceListId: 'pro' }, lists, true)).toBe(
      'public',
    );
  });
  it('separa Mate/Brillo, cantidad por variante y lista', () => {
    const glossy: LabVariant = {
      id: 'glossy',
      businessId: 'b',
      photoServiceId: '10x15',
      channel: 'laboratory',
      paper: 'glossy',
      isActive: true,
    };
    const matte: LabVariant = {
      ...glossy,
      id: 'matte',
      paper: 'matte',
      isActive: false,
    };
    const tiers: LabPriceTier[] = [
      {
        id: 'a',
        businessId: 'b',
        variantId: 'glossy',
        priceListId: 'public',
        minQuantity: 1,
        maxQuantity: 9,
        unitPriceCents: 10000,
      },
      {
        id: 'b',
        businessId: 'b',
        variantId: 'glossy',
        priceListId: 'public',
        minQuantity: 10,
        maxQuantity: null,
        unitPriceCents: 8000,
      },
      {
        id: 'c',
        businessId: 'b',
        variantId: 'glossy',
        priceListId: 'pro',
        minQuantity: 1,
        maxQuantity: null,
        unitPriceCents: 7000,
      },
    ];
    expect(labUnitPrice(glossy, tiers, 'public', 9)).toBe(10000);
    expect(labUnitPrice(glossy, tiers, 'public', 10)).toBe(8000);
    expect(labUnitPrice(glossy, tiers, 'pro', 10)).toBe(7000);
    expect(() => labUnitPrice(matte, tiers, 'public', 1)).toThrow(
      'no está disponible',
    );
  });
});

describe('visibilidad de Laboratorio en /imprimir', () => {
  const variant = (id: string, over: Partial<LabVariant> = {}): LabVariant => ({
    id,
    businessId: 'b',
    photoServiceId: 's',
    channel: 'laboratory',
    paper: 'glossy',
    isActive: true,
    ...over,
  });
  const tier = (variantId: string, priceListId: string): LabPriceTier => ({
    id: `${variantId}:${priceListId}`,
    businessId: 'b',
    variantId,
    priceListId,
    minQuantity: 1,
    maxQuantity: null,
    unitPriceCents: 1,
  });
  const published = {
    isActive: true,
    isPublic: true,
    publicOrderEnabled: true,
    workflowRoute: 'lab' as const,
    requiresCustomerFiles: true,
  };
  it('ofrece sólo variantes activas con tramo en la lista Pública', () => {
    const status = labPortalStatus(
      published,
      [
        variant('ok'),
        variant('inactive', { paper: 'matte', isActive: false }),
        variant('only-pro'),
        variant('kiosk', { channel: 'kiosk' }),
      ],
      [tier('ok', 'public'), tier('only-pro', 'pro'), tier('kiosk', 'public')],
      lists,
    );
    expect(
      status.variants.map((x) => [x.variantId, x.offered, x.reason]),
    ).toEqual([
      ['ok', true, null],
      ['inactive', false, 'Variante no disponible.'],
      ['only-pro', false, 'Sin tramo de precio en la lista Pública.'],
      ['kiosk', false, 'Kiosco no se ofrece en la web.'],
    ]);
  });
  it('explica la compuerta de publicación y sólo ofrece publicar si es seguro', () => {
    const hidden = labPortalStatus(
      { ...published, isPublic: false, publicOrderEnabled: false },
      [variant('ok')],
      [tier('ok', 'public')],
      lists,
    );
    expect(hidden.serviceBlockers).toEqual([
      'Falta «Mostrar en la web».',
      'Falta «Aceptar pedidos directos».',
    ]);
    expect(hidden.publishable).toBe(true);
    expect(hidden.variants[0]?.offered).toBe(false);
    const notLab = labPortalStatus(
      { ...published, isPublic: false, workflowRoute: 'editing' as const },
      [variant('ok')],
      [tier('ok', 'public')],
      lists,
    );
    expect(notLab.publishable).toBe(false);
  });
});

describe('cotizador Plotter', () => {
  it('calcula Lona Front profesional 120×200 cm a $61.200', () => {
    const quote = quotePlotter(
      { ...base, material: material('front_banner') },
      [rate('front_banner', 2_550_000)],
    );
    expect(quote.totalCents).toBe(6_120_000);
    expect(quote.areaMm2).toBe(2_400_000);
    expect(quote.lines[0].amountCents).toBe(6_120_000);
  });
  it.each([
    [200, 300, 540_000],
    [300, 400, 1_080_000],
    [400, 500, 1_580_000],
  ])('vinilo MDF %i×%i mm', (widthMm, heightMm, expected) => {
    expect(
      quotePlotter(
        {
          ...base,
          material: material('adhesive_vinyl'),
          widthMm,
          heightMm,
          mdf: true,
        },
        [
          rate('vinyl_mdf_small', 9_000_000),
          rate('vinyl_mdf_large', 7_900_000),
        ],
      ).totalCents,
    ).toBe(expected);
  });
  it('cobra varillas por metro lineal y doblez de exactamente 1 m en el tramo inferior', () => {
    const rates = [
      rate('front_banner', 2_550_000),
      rate('plastic_rod', 800_000),
      rate('banner_fold_top_up_to_1m', 360_000),
      rate('banner_fold_top_over_1m', 470_000),
    ];
    expect(
      quotePlotter(
        { ...base, material: material('front_banner'), rods: 1 },
        rates,
      ).lines[1].amountCents,
    ).toBe(960_000);
    expect(
      quotePlotter(
        { ...base, material: material('front_banner'), rods: 2 },
        rates,
      ).lines[1].amountCents,
    ).toBe(1_920_000);
    expect(
      quotePlotter(
        {
          ...base,
          material: material('front_banner'),
          widthMm: 1000,
          fold: 'top',
        },
        rates,
      ).lines[1].amountCents,
    ).toBe(360_000);
  });
  it('usa la tabla Canvas Bastidor y conserva snapshot tras cambiar tarifas', () => {
    const input = {
      ...base,
      material: material('canvas'),
      widthMm: 200,
      heightMm: 300,
      canvasStretcher: true,
    };
    const rates = [rate('canvas_stretcher', 1_650_000, 200, 300)];
    const saved = quotePlotter(input, rates);
    rates[0].amountCents = 2_000_000;
    expect(saved.totalCents).toBe(1_650_000);
    expect(quotePlotter(input, rates).totalCents).toBe(2_000_000);
  });
  it('comprueba ambas orientaciones y admite ancho no configurado', () => {
    expect(rollFit(1400, 3000, 1600)).toBe('normal');
    expect(rollFit(1800, 1400, 1600)).toBe('rotated');
    expect(rollFit(1800, 3000, 1600)).toBe('no_fit');
    expect(rollFit(1800, 3000, null)).toBe('unknown');
  });
});

describe('disponibilidad LED y eventos', () => {
  const config = {
    widthMm: 3000,
    heightMm: 2000,
    panelAreaMm2: 500_000,
    pixelsPerPanel: 32_768,
  };
  const window = {
    startsAt: '2026-10-25T12:00:00Z',
    endsAt: '2026-10-25T16:00:00Z',
  };
  const controllers = [
    { id: 'tb20', name: 'TB20 Plus', maxPixels: 650_000, isActive: true },
    { id: 'nova', name: 'Nova VX600', maxPixels: 650_000, isActive: true },
  ];
  it('calcula 12 paneles y 393.216 px; dos pantallas caben si hay dos controladores', () => {
    const first = ledAvailability(
      config,
      {
        totalPanels: 24,
        reservations: [],
        controllers,
        controllerReservations: [],
      },
      window,
    );
    expect(first).toMatchObject({
      requiredPanels: 12,
      requiredPixels: 393_216,
      availablePanels: 24,
      available: true,
    });
    const second = ledAvailability(
      config,
      {
        totalPanels: 24,
        reservations: [{ ...window, panels: 12 }],
        controllers,
        controllerReservations: [{ controllerId: 'tb20', ...window }],
      },
      window,
    );
    expect(second.available).toBe(true);
    expect(second.controllers.map((controller) => controller.id)).toEqual([
      'nova',
    ]);
  });
  it('sólo resta reservas del salón en las fechas reales', () => {
    const salon = {
      startsAt: '2026-10-26T12:00:00Z',
      endsAt: '2026-10-26T16:00:00Z',
      panels: 6,
    };
    const capacity = {
      totalPanels: 24,
      reservations: [salon],
      controllers,
      controllerReservations: [{ controllerId: 'tb20', ...salon }],
    };
    expect(ledAvailability(config, capacity, window).availablePanels).toBe(24);
    expect(ledAvailability(config, capacity, salon).availablePanels).toBe(18);
  });
  it('rechaza falta de paneles, controladores ocupados o capacidad insuficiente', () => {
    const baseCapacity = {
      totalPanels: 12,
      reservations: [],
      controllers: [controllers[0]],
      controllerReservations: [],
    };
    expect(
      ledAvailability(
        config,
        { ...baseCapacity, reservations: [{ ...window, panels: 1 }] },
        window,
      ).available,
    ).toBe(false);
    expect(
      ledAvailability(
        config,
        {
          ...baseCapacity,
          controllerReservations: [{ controllerId: 'tb20', ...window }],
        },
        window,
      ).available,
    ).toBe(false);
    expect(
      ledAvailability(
        config,
        {
          ...baseCapacity,
          controllers: [{ ...controllers[0], maxPixels: 300_000 }],
        },
        window,
      ).available,
    ).toBe(false);
    expect(
      ledAvailability(
        config,
        {
          ...baseCapacity,
          controllerReservations: [
            {
              controllerId: 'tb20',
              startsAt: window.endsAt,
              endsAt: '2026-10-25T18:00:00Z',
            },
          ],
        },
        window,
      ).available,
    ).toBe(true);
  });
  it('incluye buffers y separa los viáticos', () => {
    const expanded = effectiveWindow(window.startsAt, window.endsAt, 30, 60);
    expect(expanded.startsAt).toBe('2026-10-25T11:30:00.000Z');
    expect(expanded.endsAt).toBe('2026-10-25T17:00:00.000Z');
    expect(quoteEventService('Cabina', 5_000_000, 200_000)).toMatchObject({
      totalCents: 5_200_000,
      lines: [{ code: 'service' }, { code: 'travel' }],
    });
  });
});

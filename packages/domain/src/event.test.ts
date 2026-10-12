import { describe, expect, it } from 'vitest';
import {
  eventStatusBlocksResources,
  eventTotals,
  normalizeEventDetails,
  normalizeEventServiceItemDetails,
  parseEventStatus,
  reservationsOverlap,
  type EventServiceItem,
  type ResourceReservation,
} from './event';

const reservation = (resourceId: string, startsAt: string, endsAt: string) =>
  ({
    id: crypto.randomUUID(),
    businessId: 'business',
    eventId: 'event',
    resourceId,
    startsAt,
    endsAt,
    priceCents: 10_000,
    notes: null,
    isActive: true,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  }) satisfies ResourceReservation;

describe('events and resource reservations', () => {
  it('requires end after start and accepts crossing midnight', () => {
    expect(() =>
      normalizeEventDetails({
        customerId: 'customer',
        eventTypeId: null,
        title: 'Casamiento',
        startsAt: '2026-11-21T23:00:00.000Z',
        endsAt: '2026-11-21T22:00:00.000Z',
        venueName: null,
        venueAddress: null,
        notes: null,
      }),
    ).toThrow(/posterior/i);
    expect(
      normalizeEventDetails({
        customerId: 'customer',
        eventTypeId: null,
        title: 'Casamiento',
        startsAt: '2026-11-21T23:00:00.000Z',
        endsAt: '2026-11-22T05:00:00.000Z',
        venueName: null,
        venueAddress: null,
        notes: null,
      }).endsAt,
    ).toBe('2026-11-22T05:00:00.000Z');
  });

  it('calculates service, resource and event totals in cents', () => {
    const detail = normalizeEventServiceItemDetails({
      sourceServiceId: null,
      name: 'Fotografía',
      description: null,
      quantity: 2,
      unitPriceCents: 12_500,
    });
    const service: EventServiceItem = {
      id: 'service',
      businessId: 'business',
      eventId: 'event',
      ...detail,
      isActive: true,
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
    };
    expect(
      eventTotals(
        [service],
        [reservation('cabina', '2026-11-21T22:00:00Z', '2026-11-22T02:00:00Z')],
      ),
    ).toEqual({
      servicesCents: 25_000,
      resourcesCents: 10_000,
      totalCents: 35_000,
    });
  });

  it('detects overlap for one resource and allows contiguous or different resources', () => {
    const current = reservation(
      'cabina',
      '2026-11-21T22:00:00Z',
      '2026-11-22T02:00:00Z',
    );
    expect(
      reservationsOverlap(
        current,
        reservation('cabina', '2026-11-21T23:00:00Z', '2026-11-22T01:00:00Z'),
      ),
    ).toBe(true);
    expect(
      reservationsOverlap(
        current,
        reservation('cabina', '2026-11-22T02:00:00Z', '2026-11-22T03:00:00Z'),
      ),
    ).toBe(false);
    expect(
      reservationsOverlap(
        current,
        reservation('pantalla', '2026-11-21T23:00:00Z', '2026-11-22T01:00:00Z'),
      ),
    ).toBe(false);
  });

  it('only reserved and completed events block resources', () => {
    expect(eventStatusBlocksResources('inquiry')).toBe(false);
    expect(eventStatusBlocksResources('quoted')).toBe(false);
    expect(eventStatusBlocksResources('reserved')).toBe(true);
    expect(eventStatusBlocksResources('completed')).toBe(true);
    expect(eventStatusBlocksResources('cancelled')).toBe(false);
  });

  it('accepts only the five supported event states', () => {
    expect(
      ['inquiry', 'quoted', 'reserved', 'completed', 'cancelled'].map(
        parseEventStatus,
      ),
    ).toEqual(['inquiry', 'quoted', 'reserved', 'completed', 'cancelled']);
    expect(() => parseEventStatus('paid')).toThrow(/inválido/i);
  });
});

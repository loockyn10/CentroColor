import { describe, expect, it } from 'vitest';
import {
  comparePhotoProductionQueue,
  isPhotoJobOverdue,
  isPhotoServiceSelectable,
  normalizePhotoJobItemDetails,
  normalizePhotoServiceDetails,
  photoJobTotal,
  photoCopiesMismatch,
  sanitizeDriveName,
} from './photo';

describe('trabajos fotográficos', () => {
  it('valida cantidad, precio, dimensiones y calcula snapshots', () => {
    const item = normalizePhotoJobItemDetails({
      photoServiceId: null,
      serviceNameSnapshot: ' Restauración ',
      quantity: 2,
      unitPriceCents: 1500,
      notes: null,
      widthMm: 100,
      heightMm: 150,
      isActive: true,
    });
    expect(item.serviceNameSnapshot).toBe('Restauración');
    expect(item.totalCents).toBe(3000);
    expect(
      photoJobTotal([
        {
          ...item,
          id: 'i',
          businessId: 'b',
          photoJobId: 'j',
          createdAt: '',
          updatedAt: '',
        },
      ]),
    ).toBe(3000);
    expect(() =>
      normalizePhotoJobItemDetails({ ...item, quantity: 0 }),
    ).toThrow('cantidad');
    expect(() =>
      normalizePhotoJobItemDetails({ ...item, unitPriceCents: -1 }),
    ).toThrow();
    expect(() =>
      normalizePhotoServiceDetails({
        code: null,
        name: 'x',
        serviceType: 'print',
        widthMm: 100,
        heightMm: null,
        defaultUnitPriceCents: 0,
        workflowRoute: 'lab',
        requiresCustomerFiles: true,
      }),
    ).toThrow('ambas');
  });

  it('mantiene snapshot aunque cambie el catálogo y permite concepto custom', () => {
    const original = normalizePhotoJobItemDetails({
      photoServiceId: 's',
      serviceNameSnapshot: '10x15',
      quantity: 1,
      unitPriceCents: 500,
      notes: null,
      widthMm: 100,
      heightMm: 150,
      isActive: true,
    });
    const custom = normalizePhotoJobItemDetails({
      photoServiceId: null,
      serviceNameSnapshot: 'Retoque especial',
      quantity: 1,
      unitPriceCents: 450,
      notes: null,
      widthMm: null,
      heightMm: null,
      isActive: true,
    });
    expect(original.unitPriceCents).toBe(500);
    expect(custom.photoServiceId).toBeNull();
    expect(isPhotoServiceSelectable({ isActive: false })).toBe(false);
  });

  it('detecta atraso y ordena urgentes primero', () => {
    const base = {
      businessId: 'b',
      branchId: 'r',
      customerId: 'c',
      status: 'received' as const,
      promisedAt: '2026-01-01T10:00:00Z',
      notes: null,
      sourceAppointmentId: null,
      sourceEventId: null,
      fileIntakeStatus: 'awaiting_files' as const,
      driveFolderId: null,
      driveEditedFolderId: null,
      createdBy: 'u',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '',
    };
    const normal = { ...base, id: 'n', priority: 'normal' as const };
    const urgent = {
      ...base,
      id: 'u',
      priority: 'urgent' as const,
      promisedAt: null,
    };
    expect(isPhotoJobOverdue(normal, new Date('2026-01-02T00:00:00Z'))).toBe(
      true,
    );
    expect(comparePhotoProductionQueue(urgent, normal)).toBeLessThan(0);
    expect(
      isPhotoJobOverdue(
        { ...normal, status: 'delivered' },
        new Date('2026-01-02T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('valida copies y sanitiza nombres de carpetas', () => {
    expect(
      photoCopiesMismatch({ quantity: 3 }, [
        { copies: 2, status: 'uploaded' },
        { copies: 1, status: 'uploaded' },
        { copies: 9, status: 'failed' },
      ]),
    ).toEqual({ copies: 3, expected: 3, mismatch: false });
    expect(
      photoCopiesMismatch({ quantity: 4 }, [{ copies: 3, status: 'uploaded' }])
        .mismatch,
    ).toBe(true);
    expect(sanitizeDriveName(' Restauración: Juan/Pérez ')).toBe(
      'Restauracion Juan Perez',
    );
  });
});

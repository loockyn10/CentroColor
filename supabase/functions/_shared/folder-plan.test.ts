import { describe, expect, it } from 'vitest';
import { jobFolderPlan, routeFolderPlan } from './folder-plan';

describe('estructura Drive', () => {
  it('produce claves deterministas e independientes del nombre visible', () => {
    const first = jobFolderPlan(
      '12345678-aaaa',
      'Juan Pérez',
      '2026-10-16T12:00:00Z',
    );
    const retry = jobFolderPlan(
      '12345678-aaaa',
      'Juan Pérez renombrado',
      '2026-10-16T12:00:00Z',
    );
    expect(first.map((x) => x.key)).toEqual(retry.map((x) => x.key));
    expect(first.map((x) => x.name)).toEqual([
      'Trabajos',
      '2026',
      'Octubre',
      'CC-12345678 - Juan Pérez',
    ]);
  });
  it('enruta lab, edición y otros sin inferir por tipo o nombre', () => {
    expect(routeFolderPlan('lab', 'i1', '10x15').route.name).toBe(
      'Para imprimir',
    );
    expect(routeFolderPlan('editing', 'i2', 'Restauración').route.name).toBe(
      'Para editar',
    );
    expect(routeFolderPlan('other', 'i3', 'Escaneo').route.name).toBe('Otros');
  });
});

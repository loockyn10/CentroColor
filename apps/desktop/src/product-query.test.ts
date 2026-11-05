import { describe, expect, it } from 'vitest';
import { productListQuery } from './product-query';

describe('consulta del listado de Productos (SQLite)', () => {
  it('siempre excluye lo eliminado y nunca lo confunde con inactivo', () => {
    const { sql } = productListQuery('b', '', 100);
    expect(sql).toContain('deleted_at IS NULL');
    // Sin filtro de estado se ven activos e inactivos.
    expect(sql).not.toContain('is_active = ?');
  });

  it('«Inactivo» filtra por is_active y además excluye la Papelera', () => {
    const { sql, args } = productListQuery('b', '', 100, {
      status: 'inactive',
    });
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('is_active = ?');
    expect(args).toEqual(['b', '%%', '%%', 0, 100]);
  });

  it('combina búsqueda, categoría y estado', () => {
    const { sql, args } = productListQuery('b', 'alb_um', 20, {
      categoryId: 'cat-1',
      status: 'active',
    });
    expect(sql).toContain('category_id = ?');
    expect(sql).toContain('is_active = ?');
    // El guion bajo del usuario se escapa para que LIKE no lo trate como comodín.
    expect(args).toEqual(['b', '%alb\\_um%', '%alb\\_um%', 'cat-1', 1, 20]);
  });

  it('«Sin categoría» no agrega parámetros', () => {
    const { sql, args } = productListQuery('b', '', 5, { uncategorized: true });
    expect(sql).toContain('category_id IS NULL');
    expect(args).toEqual(['b', '%%', '%%', 5]);
  });

  it('limpiar filtros equivale a la consulta sin filtros', () => {
    expect(productListQuery('b', '', 100, {})).toEqual(
      productListQuery('b', '', 100),
    );
  });
});

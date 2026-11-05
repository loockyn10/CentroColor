import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BackButton,
  DatePicker,
  DateTimePicker,
  DeleteDialog,
  FilterBar,
  FilterSelect,
  PageHeader,
  Select,
  optionsFromChildren,
} from './index';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);

describe('Select propio: estructura accesible', () => {
  const options = createElement(
    Select,
    { value: 'b', onChange: () => undefined, label: 'Tipo' },
    createElement('option', { value: 'a' }, 'Sin tipo'),
    createElement('option', { value: 'b' }, 'Retiro'),
    createElement('option', { value: 'c', disabled: true }, 'Bloqueado'),
  );

  it('es un combobox con etiqueta, valor visible y lista cerrada', () => {
    const html = render(options);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Tipo"');
    expect(html).toContain('Retiro'); // valor elegido
    expect(html).not.toContain('role="listbox"'); // la lista sólo existe abierta
    expect(html).not.toContain('<select'); // nada nativo
  });

  it('convierte <option> (también en fragmentos y listas) a opciones', () => {
    const parsed = optionsFromChildren([
      createElement('option', { key: 1, value: 1 }, 'Uno'),
      createElement('option', { key: 2, disabled: true }, 'Dos'),
    ]);
    expect(parsed).toEqual([
      { value: '1', label: 'Uno', disabled: undefined },
      { value: 'Dos', label: 'Dos', disabled: true },
    ]);
  });

  it('un valor desconocido muestra el texto guía en vez de romper', () => {
    const html = render(
      createElement(Select, {
        value: 'x',
        onChange: () => undefined,
        options: [{ value: 'a', label: 'A' }],
        placeholder: 'Elegir…',
      }),
    );
    expect(html).toContain('Elegir…');
  });

  it('required agrega validación nativa invisible y disabled bloquea el control', () => {
    const html = render(
      createElement(Select, {
        value: '',
        onChange: () => undefined,
        required: true,
        disabled: true,
        options: [{ value: 'a', label: 'A' }],
      }),
    );
    expect(html).toContain('required');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-required="true"');
  });
});

describe('DatePicker propio', () => {
  it('muestra la fecha como dd/mm/aaaa y abre un diálogo, no un input nativo', () => {
    const html = render(
      createElement(DatePicker, {
        value: '2026-11-05',
        onChange: () => undefined,
        label: 'Desde',
      }),
    );
    expect(html).toContain('05/11/2026');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Desde: 05/11/2026"');
    expect(html).not.toContain('type="date"');
  });
  it('vacío muestra el texto guía; DateTimePicker incluye la hora', () => {
    expect(
      render(
        createElement(DatePicker, { value: '', onChange: () => undefined }),
      ),
    ).toContain('dd/mm/aaaa');
    expect(
      render(
        createElement(DateTimePicker, {
          value: '2026-11-05T14:30',
          onChange: () => undefined,
        }),
      ),
    ).toContain('05/11/2026 14:30');
  });
});

describe('Volver y filtros', () => {
  it('PageHeader con onBack muestra «Volver» antes del título; sin onBack no', () => {
    const withBack = render(
      createElement(PageHeader, {
        title: 'Venta A1B2',
        onBack: () => undefined,
        backLabel: 'Ventas',
      }),
    );
    expect(withBack).toContain('Volver');
    expect(withBack).toContain('aria-label="Volver a Ventas"');
    expect(withBack.indexOf('Volver')).toBeLessThan(
      withBack.indexOf('Venta A1B2'),
    );
    const root = render(createElement(PageHeader, { title: 'Ventas' }));
    expect(root).not.toContain('Volver');
  });
  it('BackButton es un botón con texto visible', () => {
    const html = render(
      createElement(BackButton, { onClick: () => undefined }),
    );
    expect(html).toContain('<button');
    expect(html).toContain('>Volver<');
  });
  it('FilterBar ofrece «Limpiar» sólo con filtros activos', () => {
    const bar = (dirty: boolean) =>
      render(
        createElement(
          FilterBar,
          { onClear: () => undefined, dirty },
          createElement(FilterSelect, {
            label: 'Estado',
            allLabel: 'Todos los estados',
            value: '',
            onChange: () => undefined,
            options: [{ value: 'a', label: 'Activos' }],
          }),
        ),
      );
    expect(bar(false)).not.toContain('Limpiar');
    expect(bar(true)).toContain('Limpiar');
    // El disparador abreviado dice «Estado: Todos», sin repetir «estados».
    expect(bar(false)).toContain('Todos');
    expect(bar(false)).toContain('Estado');
  });
});

describe('DeleteDialog: lenguaje de usuario', () => {
  it('confirma con texto corto, sin términos técnicos', () => {
    const html = render(
      createElement(DeleteDialog, {
        open: true,
        what: 'este producto',
        listName: 'Productos',
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    // renderToStaticMarkup no monta efectos, pero el Sheet abierto sí se pinta.
    expect(html).toContain('¿Eliminar este producto?');
    expect(html).toContain('Dejará de aparecer en Productos');
    expect(html).toContain('Configuración → Papelera');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Eliminar');
    for (const technical of ['deleted_at', 'tombstone', 'soft delete', 'FK'])
      expect(html).not.toContain(technical);
  });
  it('concuerda el género al restaurar', () => {
    const f = render(
      createElement(DeleteDialog, {
        open: true,
        what: 'esta categoría',
        listName: 'Categorías',
        gender: 'f',
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(f).toContain('Podés restaurarla');
  });
});

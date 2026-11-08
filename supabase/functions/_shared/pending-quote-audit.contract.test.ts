// Auditoría del cero de relleno de los pedidos «pendientes de presupuestar»: los ítems de un pedido sin
// importe guardan unit_price_cents = 0 sólo porque la columna es NOT NULL. Este archivo fija, sobre el
// código real, dónde el cero NO puede leerse como dinero: cobros, saldos, cuentas, pantallas de
// producción, sincronización con Desktop. (El comportamiento de la base se prueba con migraciones reales
// en professional-request.handlers.test.ts y desktop-quote-status.sqlite.test.ts.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('el cero de relleno no entra en cobros, saldos ni cuentas', () => {
  it('las dos implementaciones de cuentas marcan el pedido pendiente y lo excluyen de saldos y deudas', () => {
    for (const path of [
      'apps/web/src/supabase-work-payment-repository.ts',
      'apps/desktop/src/sqlite-work-payment-repository.ts',
    ]) {
      const text = source(path);
      // El estado se lee del pedido, no se deduce del total.
      expect(text).toMatch(/quote_status/);
      expect(text).toMatch(/pendingQuote/);
      // Ni deuda (listOutstanding) ni fuente del saldo del cliente (getCustomerAccount).
      expect(text).toMatch(/!x\.pendingQuote && x\.balanceCents > 0/);
      expect(text).toMatch(/!x\.pendingQuote &&\s*\(x\.balanceCents > 0/);
    }
  });

  it('el panel de cuenta no dice «Pagado» ni ofrece cobrar un pedido pendiente', () => {
    const text = source('packages/features/src/payments.tsx');
    const pending = text.indexOf('if (account.pendingQuote)');
    const paid = text.indexOf('>Pagado<');
    expect(pending).toBeGreaterThan(-1);
    expect(paid).toBeGreaterThan(pending);
  });

  it('postWorkPayment rechaza un pedido pendiente antes de llegar a ningún repositorio', () => {
    expect(source('packages/application/src/payment.ts')).toMatch(
      /account\?\.pendingQuote/,
    );
  });
});

describe('estados bloqueados mientras falta el presupuesto', () => {
  it('Pedidos y Producción usan la misma regla del dominio (en proceso, listo y entregado)', () => {
    for (const path of [
      'packages/features/src/photo.tsx',
      'packages/features/src/photo-production.tsx',
    ])
      expect(source(path)).toMatch(/isStatusBlockedByPendingQuote\(/);
    expect(source('packages/domain/src/photo.ts')).toMatch(
      /pendingQuoteBlockedStatuses = \[\s*'in_progress',\s*'ready',\s*'delivered',\s*\]/,
    );
  });

  it('la base y SQLite de Desktop tienen la misma lista de estados bloqueados', () => {
    expect(
      source(
        'supabase/migrations/20261108010000_professional_requests_hardening.sql',
      ),
    ).toMatch(/new\.status in \('in_progress', 'ready', 'delivered'\)/);
    expect(
      source('apps/desktop/src-tauri/migrations/0022_pending_quote_in_progress.sql'),
    ).toMatch(/NEW\.status IN \('in_progress','ready','delivered'\)/);
    // Y la 0022 está registrada en Tauri (si no, el instalador no la ejecuta).
    expect(source('apps/desktop/src-tauri/src/lib.rs')).toMatch(
      /version: 22,[^\n]*0022_pending_quote_in_progress\.sql/,
    );
  });
});

describe('sincronización con Desktop', () => {
  it('Desktop nunca envía quote_status ni decide el presupuesto: sólo lo recibe', () => {
    const push = source('apps/desktop/src/cloud-photo-sync-adapter.ts');
    // El payload de subida del pedido no incluye la columna; el que baja sí la lee.
    const payloadStart = push.indexOf("t === 'photo_job'");
    const payloadEnd = push.indexOf('const decode');
    expect(push.slice(payloadStart, payloadEnd)).not.toMatch(/quote_status/);
    expect(push).toMatch(/quoteStatus: r\.quote_status \?\? 'quoted'/);
  });
});

describe('el cliente de la solicitud nunca se elige solo', () => {
  it('el panel no tiene cliente confirmado por defecto y la base no acepta un presupuesto sin cliente', () => {
    const panel = source('packages/features/src/photo-quote.tsx');
    expect(panel).toMatch(/useState<string \| null>\(null\)/);
    expect(panel).toMatch(/disabled=\{busy \|\| !confirmedId \|\| !effectiveListId\}/);
    const sql = source(
      'supabase/migrations/20261108010000_professional_requests_hardening.sql',
    );
    expect(sql).toMatch(/p_price_list_id uuid, p_customer_id uuid\n\) returns jsonb/);
    expect(sql).toMatch(/Confirmá el cliente antes de presupuestar/);
    // La función anónima ya no busca clientes por teléfono.
    const start = sql.slice(
      sql.indexOf('create or replace function public.cc_professional_request_start'),
      sql.indexOf('drop function public.quote_photo_job'),
    );
    expect(start.length).toBeGreaterThan(1000);
    expect(start).not.toMatch(/phone_match_key/);
  });
});

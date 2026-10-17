import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Button, Chip, Sheet, StatusBadge, useToast } from '../ui';
import { ars, customers, jobBalance, plural, type Customer } from '../data';
import { JobDrawer, PageHead, useMedia } from './shared';

type F = 'all' | 'balance' | 'active' | 'company';

export function Customers() {
  const { jobs } = useStore();
  const [q, setQ] = useState('');
  const [f, setF] = useState<F>('all');
  const [sel, setSel] = useState<string | null>(customers[0].id);
  const [sheet, setSheet] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const wide = useMedia('(min-width: 1100px)');

  const stats = (c: Customer) => {
    const mine = jobs.filter((j) => j.customer === c.name);
    return {
      mine,
      active: mine.filter((j) => j.status !== 'delivered').length,
      balance: mine
        .filter(
          (j) => j.status !== 'awaiting_payment' && j.status !== 'delivered',
        )
        .reduce((n, j) => n + jobBalance(j), 0),
    };
  };

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return customers.filter((c) => {
      const s = stats(c);
      return (
        (!n || (c.name + c.phone).toLowerCase().includes(n)) &&
        (f === 'all' ||
          (f === 'balance' && s.balance > 0) ||
          (f === 'active' && s.active > 0) ||
          (f === 'company' && c.kind === 'Empresa'))
      );
    });
  }, [q, f, jobs]);

  const current = customers.find((c) => c.id === sel) ?? null;
  const pick = (id: string) => {
    setSel(id);
    if (!wide) setSheet(true);
  };

  return (
    <>
      <PageHead title={<>Clientes</>}>
        <Button variant="primary" icon="plus">
          Nuevo cliente
        </Button>
      </PageHead>
      <div className="split">
        <div>
          <div className="search-wrap" style={{ marginBottom: 12 }}>
            <Icon name="search" />
            <input
              className="input input--search"
              type="search"
              placeholder="Nombre o teléfono…"
              aria-label="Buscar clientes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div
            className="chips chips--scroll"
            role="group"
            aria-label="Filtros"
            style={{ marginBottom: 12 }}
          >
            <Chip
              pressed={f === 'all'}
              onClick={() => setF('all')}
              count={customers.length}
            >
              Todos
            </Chip>
            <Chip pressed={f === 'active'} onClick={() => setF('active')}>
              Con trabajo activo
            </Chip>
            <Chip pressed={f === 'balance'} onClick={() => setF('balance')}>
              Con saldo
            </Chip>
            <Chip pressed={f === 'company'} onClick={() => setF('company')}>
              Empresas
            </Chip>
          </div>
          <ul className="clist">
            {list.map((c) => {
              const s = stats(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="crow"
                    aria-current={sel === c.id && wide}
                    onClick={() => pick(c.id)}
                  >
                    <span className="avatar" aria-hidden="true">
                      {c.name[0]}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>{c.name}</strong>
                      <span
                        className="muted mono"
                        style={{ fontSize: '0.8rem' }}
                      >
                        {c.phone}
                      </span>
                    </span>
                    <span
                      style={{ display: 'grid', gap: 2, justifyItems: 'end' }}
                    >
                      {s.balance > 0 && (
                        <span
                          className="txt-warn"
                          style={{ fontSize: '0.85rem' }}
                        >
                          Saldo {ars(s.balance)}
                        </span>
                      )}
                      {s.active > 0 && (
                        <span className="meta">
                          {plural(s.active, 'trabajo', 'trabajos')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {list.length === 0 && (
              <div className="empty">
                <Icon name="search" size={32} />
                Sin resultados
              </div>
            )}
          </ul>
        </div>

        {wide && current && (
          <div
            className="card card--pad"
            style={{ position: 'sticky', top: 84 }}
          >
            <CustomerFicha c={current} onJob={setJob} />
          </div>
        )}
      </div>

      {!wide && (
        <Sheet
          open={sheet && !!current}
          onClose={() => setSheet(false)}
          title={current?.name ?? ''}
          eyebrow="Ficha de cliente"
          variant="side"
        >
          {current && (
            <CustomerFicha
              c={current}
              onJob={(id) => {
                setSheet(false);
                setJob(id);
              }}
              bare
            />
          )}
        </Sheet>
      )}
      <JobDrawer jobId={job} onClose={() => setJob(null)} />
    </>
  );
}

function CustomerFicha({
  c,
  onJob,
  bare,
}: {
  c: Customer;
  onJob: (id: string) => void;
  bare?: boolean;
}) {
  const { jobs } = useStore();
  const toast = useToast();
  const mine = jobs.filter((j) => j.customer === c.name);
  const balance = mine
    .filter((j) => j.status !== 'awaiting_payment' && j.status !== 'delivered')
    .reduce((n, j) => n + jobBalance(j), 0);
  const spent = c.purchases.reduce((n, p) => n + p.amount, 0);
  const active = mine.filter((j) => j.status !== 'delivered').length;
  return (
    <div className="stack">
      {!bare && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span
            className="avatar"
            style={{
              width: 56,
              height: 56,
              fontSize: '1.4rem',
              background: 'var(--ink-900)',
              color: 'var(--y-500)',
            }}
          >
            {c.name[0]}
          </span>
          <div>
            <h2 style={{ fontSize: '1.5rem' }}>{c.name}</h2>
            <span className="meta">
              {c.kind} · {c.since}
            </span>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="primary"
          icon="chat"
          onClick={() =>
            toast(`Se abriría WhatsApp con ${c.name} (simulado)`, 'chat')
          }
        >
          WhatsApp
        </Button>
        <Button size="sm" icon="camera">
          Nuevo trabajo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="phone"
          aria-label={`Llamar a ${c.name}`}
          onClick={() => toast(`Llamar a ${c.phone} (simulado)`, 'phone')}
        >
          <span className="mono">{c.phone}</span>
        </Button>
        {c.email && (
          <Button
            size="sm"
            variant="ghost"
            icon="mail"
            aria-label={`Escribir a ${c.email}`}
            onClick={() => toast(`Escribir a ${c.email} (simulado)`, 'mail')}
          >
            Email
          </Button>
        )}
      </div>
      <div className="cf-stats">
        <div>
          <span className="k">Compras</span>
          <span className="v">{ars(spent)}</span>
        </div>
        <div>
          <span className="k">Saldo</span>
          <span className={`v ${balance > 0 ? 'txt-warn' : ''}`}>
            {ars(balance)}
          </span>
        </div>
        <div>
          <span className="k">Activos</span>
          <span className="v">{active}</span>
        </div>
      </div>
      {c.notes && <p className="cf-notes">{c.notes}</p>}
      <section>
        <h3 className="eyebrow" style={{ marginBottom: 6 }}>
          Trabajos
        </h3>
        {mine.length === 0 ? (
          <p className="muted">Todavía no tiene trabajos fotográficos.</p>
        ) : (
          <ul className="mini-list">
            {mine.map((j) => (
              <li key={j.id}>
                <span className="mini-body">
                  <strong>{j.title}</strong>
                  <span className="mono">{j.id}</span>
                </span>
                <StatusBadge status={j.status} />
                <Button size="sm" variant="ghost" onClick={() => onJob(j.id)}>
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="eyebrow" style={{ marginBottom: 6 }}>
          Compras recientes
        </h3>
        <ul className="mini-list">
          {c.purchases.map((p) => (
            <li key={p.date + p.what}>
              <span
                className="mini-time"
                style={{ width: 92, fontSize: '0.8rem' }}
              >
                {p.date}
              </span>
              <span className="mini-body">
                <strong>{p.what}</strong>
              </span>
              <span className="mono">{ars(p.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

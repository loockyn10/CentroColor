import { useState } from 'react';
import { Icon } from '../icons';
import { Badge, Button, Segmented, Sheet, useToast } from '../ui';
import {
  WEEK_DAYS,
  TODAY_INDEX,
  ars,
  events as seed,
  resourceBookings,
  resources,
  type EventItem,
  type EventStatus,
} from '../data';
import { PageHead } from './shared';

const FLOW: EventStatus[] = [
  'consulta',
  'presupuestado',
  'reservado',
  'realizado',
];
const LABEL: Record<EventStatus, string> = {
  consulta: 'Consulta',
  presupuestado: 'Presupuestado',
  reservado: 'Reservado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};
const TONE: Record<
  EventStatus,
  'neutral' | 'amber' | 'green' | 'blue' | 'red-soft'
> = {
  consulta: 'neutral',
  presupuestado: 'amber',
  reservado: 'green',
  realizado: 'blue',
  cancelado: 'red-soft',
};
const ICON: Record<EventStatus, 'info' | 'receipt' | 'check' | 'star' | 'x'> = {
  consulta: 'info',
  presupuestado: 'receipt',
  reservado: 'check',
  realizado: 'star',
  cancelado: 'x',
};

const total = (e: EventItem) => e.services.reduce((n, s) => n + s.price, 0);

export function Events() {
  const toast = useToast();
  const [tab, setTab] = useState<'events' | 'resources'>('events');
  const [list, setList] = useState(seed);
  const [open, setOpen] = useState<string | null>(null);
  const sel = list.find((e) => e.id === open) ?? null;

  const move = (id: string, status: EventStatus) => {
    setList((l) => l.map((e) => (e.id === id ? { ...e, status } : e)));
    toast(`Evento → ${LABEL[status]}`, ICON[status]);
  };

  return (
    <>
      <PageHead title={<>Eventos</>}>
        <Segmented
          label="Sección"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'events', label: 'Eventos' },
            { value: 'resources', label: 'Recursos' },
          ]}
        />
        <Button variant="primary" icon="plus">
          Nuevo evento
        </Button>
      </PageHead>

      {tab === 'events' ? (
        <div className="ev-board">
          {FLOW.map((s) => {
            const items = list.filter((e) => e.status === s);
            return (
              <section key={s} className="ev-col" aria-label={LABEL[s]}>
                <div className="ev-col-head">
                  <h2>{LABEL[s]}</h2>
                  <span className="mono">{items.length}</span>
                </div>
                {items.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    className="ev-card"
                    onClick={() => setOpen(e.id)}
                  >
                    <strong>{e.name}</strong>
                    <span className="meta">{e.customer}</span>
                    <span className="meta">
                      <b>{e.when}</b> · {e.place}
                    </span>
                    <span className="foot">
                      <span className="meta">
                        {e.resources.length
                          ? e.resources.join(' · ')
                          : 'Sin recursos'}
                      </span>
                      <strong className="mono">
                        {total(e) ? ars(total(e)) : '—'}
                      </strong>
                    </span>
                  </button>
                ))}
                {items.length === 0 && (
                  <p className="meta" style={{ padding: 8 }}>
                    Sin eventos
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <section className="card card--pad" aria-labelledby="h-res">
          <div className="section-head">
            <h2 id="h-res">Disponibilidad · semana del 19 al 24 de octubre</h2>
          </div>
          <div className="table-wrap">
            <div
              className="res-grid"
              role="table"
              aria-label="Disponibilidad de recursos por día"
            >
              <div className="h" role="columnheader">
                Recurso
              </div>
              {WEEK_DAYS.map((d, i) => (
                <div
                  className="h"
                  role="columnheader"
                  key={d}
                  style={
                    i === TODAY_INDEX
                      ? { color: 'var(--ink-900)', fontWeight: 700 }
                      : undefined
                  }
                >
                  {d}
                </div>
              ))}
              {resources.map((r) => (
                <div key={r} style={{ display: 'contents' }} role="row">
                  <div className="r" role="rowheader">
                    {r}
                  </div>
                  {WEEK_DAYS.map((d, i) => {
                    const b = resourceBookings[r]?.find((x) => x.day === i);
                    return (
                      <div
                        key={d}
                        role="cell"
                        className="res-cell"
                        data-b={!!b}
                      >
                        {b ? (
                          <>
                            <Icon name="lock" size={14} />
                            &nbsp;{b.label}
                          </>
                        ) : (
                          <span className="muted">Libre</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="meta" style={{ marginTop: 12 }}>
            Solo Reservado y Realizado bloquean el recurso.
          </p>
        </section>
      )}

      <Sheet
        open={!!sel}
        onClose={() => setOpen(null)}
        title={sel?.name ?? ''}
        eyebrow={sel ? `${sel.customer} · ${sel.place}` : undefined}
        footer={
          sel && (
            <>
              {FLOW.indexOf(sel.status) >= 0 &&
                FLOW.indexOf(sel.status) < FLOW.length - 1 && (
                  <Button
                    variant="primary"
                    icon="check"
                    onClick={() =>
                      move(sel.id, FLOW[FLOW.indexOf(sel.status) + 1])
                    }
                  >
                    Pasar a {LABEL[FLOW[FLOW.indexOf(sel.status) + 1]]}
                  </Button>
                )}
              <Button
                variant="danger"
                icon="x"
                disabled={sel.status === 'cancelado'}
                onClick={() => move(sel.id, 'cancelado')}
              >
                Cancelar evento
              </Button>
            </>
          )
        }
      >
        {sel && (
          <>
            <Badge tone={TONE[sel.status]} icon={ICON[sel.status]} large>
              {LABEL[sel.status]}
            </Badge>
            <p>
              <Icon
                name="calendar"
                size={18}
                style={{ display: 'inline', verticalAlign: '-3px' }}
              />{' '}
              {sel.when}
            </p>
            <section>
              <h3 className="eyebrow" style={{ marginBottom: 6 }}>
                Servicios
              </h3>
              {sel.services.length === 0 ? (
                <p className="muted">Todavía no se cargaron servicios.</p>
              ) : (
                <ul className="order-lines">
                  {sel.services.map((s) => (
                    <li key={s.name}>
                      <span>{s.name}</span>
                      <span className="mono">{ars(s.price)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="order-total">
                <span className="eyebrow">Total</span>
                <b className="num">{ars(total(sel))}</b>
              </div>
            </section>
            <section>
              <h3 className="eyebrow" style={{ marginBottom: 6 }}>
                Recursos reservados
              </h3>
              <p>
                {sel.resources.length ? (
                  sel.resources.join(' · ')
                ) : (
                  <span className="muted">Ninguno</span>
                )}
              </p>
            </section>
          </>
        )}
      </Sheet>
    </>
  );
}

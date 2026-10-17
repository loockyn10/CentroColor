import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Badge, Button, Chip, Segmented, Sheet, useToast } from '../ui';
import {
  TODAY_INDEX,
  WEEK_DAYS,
  type ApptStatus,
  type Appointment,
} from '../data';
import { PageHead, useMedia } from './shared';

const LONG = [
  'Lunes 19',
  'Martes 20',
  'Miércoles 21',
  'Jueves 22',
  'Viernes 23',
  'Sábado 24',
];
const START_H = 9;
const END_H = 20;
const PX = 96;
const NOW = '14:20';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const end = (a: Appointment) => {
  const m = toMin(a.start) + a.minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const STATUS: Record<
  ApptStatus,
  {
    tone: 'yellow' | 'green' | 'red-soft' | 'neutral';
    icon: 'clock' | 'check' | 'x' | 'alert';
    label: string;
  }
> = {
  programado: { tone: 'yellow', icon: 'clock', label: 'Programado' },
  completado: { tone: 'green', icon: 'check', label: 'Completado' },
  ausente: { tone: 'red-soft', icon: 'alert', label: 'Ausente' },
  cancelado: { tone: 'neutral', icon: 'x', label: 'Cancelado' },
};

function StatusPill({ s }: { s: ApptStatus }) {
  const m = STATUS[s];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

export function Agenda() {
  const { appts, setAppt } = useStore();
  const toast = useToast();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(TODAY_INDEX);
  const [filter, setFilter] = useState<ApptStatus | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const wide = useMedia('(min-width: 768px)');

  const visible = useMemo(
    () => appts.filter((a) => filter === 'all' || a.status === filter),
    [appts, filter],
  );
  const dayAppts = (d: number) =>
    visible
      .filter((a) => a.day === d)
      .sort((a, b) => a.start.localeCompare(b.start));
  const sel = appts.find((a) => a.id === open) ?? null;

  const setStatus = (s: ApptStatus) => {
    if (!sel) return;
    setAppt(sel.id, s);
    toast(
      `Turno de ${sel.customer}: ${STATUS[s].label.toLowerCase()}`,
      STATUS[s].icon,
    );
    setOpen(null);
  };

  const dayTimeline = () => {
    const list = dayAppts(day);
    const hours = Array.from(
      { length: END_H - START_H },
      (_, i) => START_H + i,
    );
    return (
      <div className="card card--pad" style={{ paddingTop: 30 }}>
        <div className="day-grid" style={{ ['--px' as string]: `${PX}px` }}>
          <div className="day-hours" aria-hidden="true">
            {hours.map((h) => (
              <div key={h}>{String(h).padStart(2, '0')}:00</div>
            ))}
          </div>
          <div className="day-track" style={{ height: hours.length * PX }}>
            {day === TODAY_INDEX && (
              <div
                className="now-line"
                style={{ top: ((toMin(NOW) - START_H * 60) / 60) * PX }}
                aria-hidden="true"
              />
            )}
            {list.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`appt ${a.minutes <= 20 ? 'appt--short' : ''}`}
                data-s={a.status}
                style={{
                  top: ((toMin(a.start) - START_H * 60) / 60) * PX + 2,
                  height: Math.max(44, (a.minutes / 60) * PX - 4),
                }}
                onClick={() => setOpen(a.id)}
                aria-label={`${a.start} ${a.customer}, ${a.type}, ${STATUS[a.status].label}`}
              >
                <span className="t">
                  {a.start}–{end(a)} · {STATUS[a.status].label}
                </span>
                <strong>{a.customer}</strong>
                {a.minutes >= 45 && (
                  <span style={{ fontSize: 'var(--fs-sm)' }}>{a.type}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 && (
          <p className="muted" style={{ textAlign: 'center', paddingTop: 10 }}>
            Sin turnos con este filtro.
          </p>
        )}
      </div>
    );
  };

  const dayList = (d: number) => {
    const list = dayAppts(d);
    if (!list.length) return <p className="muted">Sin turnos.</p>;
    return (
      <ul className="agenda-list">
        {list.map((a) => (
          <li key={a.id}>
            <span className="mini-time" style={{ paddingTop: 12 }}>
              {a.start}
            </span>
            <button
              type="button"
              className="rcard"
              data-flag=""
              onClick={() => setOpen(a.id)}
              style={{ flex: 1 }}
            >
              <span
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <strong>{a.customer}</strong>
                <StatusPill s={a.status} />
              </span>
              <span className="muted">
                {a.type} · {a.minutes} min · hasta {end(a)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <PageHead title={<>Agenda de turnos</>}>
        <Segmented
          label="Vista"
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Día' },
            { value: 'week', label: 'Semana' },
          ]}
        />
        <Button variant="primary" icon="plus">
          Nuevo turno
        </Button>
      </PageHead>

      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        {view === 'day' ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              aria-label="Día anterior"
              disabled={day === 0}
              onClick={() => setDay(day - 1)}
            >
              <Icon name="chevL" />
            </Button>
            <div style={{ minWidth: 190, textAlign: 'center' }}>
              <strong
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.3rem',
                }}
              >
                {LONG[day]} de octubre
              </strong>
              {day === TODAY_INDEX && (
                <div>
                  <Badge tone="ink">Hoy</Badge>
                </div>
              )}
            </div>
            <Button
              aria-label="Día siguiente"
              disabled={day === 5}
              onClick={() => setDay(day + 1)}
            >
              <Icon name="chevR" />
            </Button>
            {day !== TODAY_INDEX && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDay(TODAY_INDEX)}
              >
                Ir a hoy
              </Button>
            )}
          </div>
        ) : (
          <strong
            style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem' }}
          >
            Semana del 19 al 24 de octubre
          </strong>
        )}
        <div className="chips" role="group" aria-label="Filtrar por estado">
          <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
            Todos
          </Chip>
          {(Object.keys(STATUS) as ApptStatus[]).map((s) => (
            <Chip
              key={s}
              pressed={filter === s}
              onClick={() => setFilter(s)}
              icon={STATUS[s].icon}
            >
              {STATUS[s].label}
            </Chip>
          ))}
        </div>
      </div>

      {view === 'day' ? (
        wide ? (
          dayTimeline()
        ) : (
          <div className="card card--pad">{dayList(day)}</div>
        )
      ) : wide ? (
        <div className="week">
          {WEEK_DAYS.map((label, d) => (
            <section
              className="wday"
              data-today={d === TODAY_INDEX}
              key={label}
              aria-label={LONG[d]}
            >
              <h3>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ padding: 0, minHeight: 28 }}
                  onClick={() => {
                    setDay(d);
                    setView('day');
                  }}
                >
                  {label}
                </button>
                {d === TODAY_INDEX && <Badge tone="ink">Hoy</Badge>}
              </h3>
              {dayAppts(d).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="wchip"
                  data-s={a.status}
                  onClick={() => setOpen(a.id)}
                >
                  <span className="mono" style={{ fontSize: '0.74rem' }}>
                    {a.start}
                  </span>
                  <strong>{a.customer}</strong>
                  <span style={{ fontSize: '0.78rem' }}>{a.type}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="stack">
          {WEEK_DAYS.map((label, d) => (
            <section
              key={label}
              className="card card--pad"
              style={
                d === TODAY_INDEX
                  ? { borderColor: 'var(--ink-900)', borderWidth: 2 }
                  : undefined
              }
            >
              <div className="section-head">
                <h2 style={{ fontSize: '1.1rem' }}>{LONG[d]}</h2>
                {d === TODAY_INDEX && <Badge tone="ink">Hoy</Badge>}
              </div>
              {dayList(d)}
            </section>
          ))}
        </div>
      )}

      <Sheet
        open={!!sel}
        onClose={() => setOpen(null)}
        variant="modal"
        title={sel?.customer ?? ''}
        eyebrow={
          sel ? `${LONG[sel.day]} · ${sel.start}–${end(sel)}` : undefined
        }
        footer={
          sel && (
            <>
              <Button
                variant="primary"
                icon="check"
                disabled={sel.status === 'completado'}
                onClick={() => setStatus('completado')}
              >
                Completar
              </Button>
              <Button
                icon="alert"
                disabled={sel.status === 'ausente'}
                onClick={() => setStatus('ausente')}
              >
                Ausente
              </Button>
              <Button
                variant="danger"
                icon="x"
                disabled={sel.status === 'cancelado'}
                onClick={() => setStatus('cancelado')}
              >
                Cancelar turno
              </Button>
            </>
          )
        }
      >
        {sel && (
          <>
            <StatusPill s={sel.status} />
            <dl className="kv">
              <div>
                <dt>Tipo</dt>
                <dd>{sel.type}</dd>
              </div>
              <div>
                <dt>Duración</dt>
                <dd>{sel.minutes} min</dd>
              </div>
              <div>
                <dt>Horario</dt>
                <dd className="mono">
                  {sel.start} – {end(sel)}
                </dd>
              </div>
            </dl>
            {sel.notes && (
              <div className="notice">
                <Icon name="info" />
                <span>
                  <strong>Notas</strong>
                  {sel.notes}
                </span>
              </div>
            )}
            <div className="notice">
              <Icon name="clock" />
              <span>
                Cancelar no elimina el turno: queda en el historial del cliente.
              </span>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

import { useState } from 'react';
import { Icon } from '../icons';
import { Badge, Button, Chip, Segmented, useToast } from '../ui';
import {
  ars,
  backs,
  frameJobsSeed,
  glasses,
  mouldings,
  quoteFrame,
} from '../data';
import { samplePhoto } from '../photos';
import { PageHead } from './shared';

const PRESETS: [number, number][] = [
  [20, 30],
  [30, 40],
  [40, 50],
  [50, 70],
];
const fmt = (n: number) => String(n).replace('.', ',');

export function Framing() {
  const toast = useToast();
  const [tab, setTab] = useState<'quote' | 'jobs'>('quote');
  const [w, setW] = useState('30');
  const [h, setH] = useState('40');
  const [moulding, setMoulding] = useState('v1');
  const [glass, setGlass] = useState('g1');
  const [back, setBack] = useState('b1');
  const [paint, setPaint] = useState(false);

  const wn = Math.max(0, Number(w.replace(',', '.')) || 0);
  const hn = Math.max(0, Number(h.replace(',', '.')) || 0);
  const valid = wn >= 5 && hn >= 5 && wn <= 200 && hn <= 200;
  const q = quoteFrame({
    wCm: wn,
    hCm: hn,
    mouldingId: moulding,
    glassId: glass,
    backId: back,
    paint,
  });

  return (
    <>
      <PageHead title={<>Cotizador de marcos</>}>
        <Segmented
          label="Sección"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'quote', label: 'Cotizador' },
            { value: 'jobs', label: 'Trabajos' },
          ]}
        />
      </PageHead>

      {tab === 'jobs' ? (
        <div className="card table-wrap">
          <table className="dt">
            <caption className="sr-only">Trabajos de marquetería</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Cliente y trabajo</th>
                <th scope="col">Etapa</th>
                <th scope="col">Entrega</th>
                <th scope="col" className="r">
                  Total
                </th>
                <th scope="col" className="r">
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody>
              {frameJobsSeed.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.id}</td>
                  <td>
                    <strong>{j.customer}</strong>
                    <div className="muted">{j.what}</div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        j.stage === 'Listo'
                          ? 'green'
                          : j.stage === 'En corte'
                            ? 'yellow'
                            : 'neutral'
                      }
                      icon={
                        j.stage === 'Listo'
                          ? 'check'
                          : j.stage === 'En corte'
                            ? 'ruler'
                            : 'receipt'
                      }
                    >
                      {j.stage}
                    </Badge>
                  </td>
                  <td>{j.due}</td>
                  <td className="r mono">{ars(j.total)}</td>
                  <td className="r mono">{ars(j.total - j.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="quote">
          <div className="stack">
            <section className="card card--pad" aria-labelledby="h-med">
              <h2
                id="h-med"
                className="card-title"
                style={{ marginBottom: 12 }}
              >
                1 · Medida de la obra (cm)
              </h2>
              <div className="dims">
                <div className="field">
                  <label htmlFor="fw">Ancho</label>
                  <input
                    id="fw"
                    className="input mono"
                    inputMode="decimal"
                    value={w}
                    onChange={(e) => setW(e.target.value)}
                    aria-invalid={!valid}
                  />
                </div>
                <span className="x" aria-hidden="true">
                  ×
                </span>
                <div className="field">
                  <label htmlFor="fh">Alto</label>
                  <input
                    id="fh"
                    className="input mono"
                    inputMode="decimal"
                    value={h}
                    onChange={(e) => setH(e.target.value)}
                    aria-invalid={!valid}
                  />
                </div>
              </div>
              {!valid && (
                <p className="err field" style={{ marginTop: 8 }}>
                  <span className="err">
                    <Icon name="alert" size={18} /> Ingresá medidas entre 5 y
                    200 cm.
                  </span>
                </p>
              )}
              <div className="chips" style={{ marginTop: 12 }}>
                {PRESETS.map(([a, b]) => (
                  <Chip
                    key={`${a}${b}`}
                    pressed={wn === a && hn === b}
                    onClick={() => {
                      setW(String(a));
                      setH(String(b));
                    }}
                  >
                    {a}×{b}
                  </Chip>
                ))}
              </div>
            </section>

            <section className="card card--pad" aria-labelledby="h-var">
              <h2
                id="h-var"
                className="card-title"
                style={{ marginBottom: 12 }}
              >
                2 · Varilla
              </h2>
              <div className="opt-cards">
                {mouldings.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="opt-card"
                    aria-pressed={moulding === m.id}
                    onClick={() => setMoulding(m.id)}
                  >
                    <span className="sw" style={{ background: m.swatch }} />
                    <strong>{m.name}</strong>
                    <span className="mono muted">{ars(m.pricePerM)} / m</span>
                  </button>
                ))}
              </div>
              <label className="check" style={{ marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={paint}
                  onChange={(e) => setPaint(e.target.checked)}
                />
                <span>
                  Pintar la varilla{' '}
                  <span className="muted">(+{ars(800)} por metro)</span>
                </span>
              </label>
            </section>

            <section className="card card--pad" aria-labelledby="h-mat">
              <h2
                id="h-mat"
                className="card-title"
                style={{ marginBottom: 12 }}
              >
                3 · Vidrio y fondo
              </h2>
              <div style={{ display: 'grid', gap: 14 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Vidrio
                  </div>
                  <Segmented
                    label="Vidrio"
                    value={glass}
                    onChange={setGlass}
                    options={glasses.map((g) => ({
                      value: g.id,
                      label: g.name,
                    }))}
                  />
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Fondo
                  </div>
                  <Segmented
                    label="Fondo"
                    value={back}
                    onChange={setBack}
                    options={backs.map((b) => ({ value: b.id, label: b.name }))}
                  />
                </div>
              </div>
            </section>
          </div>

          <aside className="stack" aria-label="Presupuesto">
            <div className="frame-viz">
              <FrameViz
                w={wn}
                h={hn}
                swatch={q.moulding.swatch}
                valid={valid}
              />
            </div>

            <div className="rule-note">
              <Icon name="ruler" />
              <span>
                <strong>
                  Varilla = 2 × ({fmt(wn)} + {fmt(hn)}) = {fmt(q.mouldingCm)}{' '}
                  cm.
                </strong>{' '}
                No se suma el ancho de la varilla. Vidrio y fondo: {fmt(wn)} ×{' '}
                {fmt(hn)} cm = {q.areaM2.toFixed(2).replace('.', ',')} m².
              </span>
            </div>

            <section className="card card--pad" aria-labelledby="h-q">
              <h2 id="h-q" className="card-title" style={{ marginBottom: 6 }}>
                Presupuesto
              </h2>
              <table className="q-table">
                <tbody>
                  {q.lines.map((l) => (
                    <tr key={l.key}>
                      <td>
                        <strong>{l.label}</strong>
                        <small>{l.detail}</small>
                      </td>
                      <td>{ars(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="q-total on-dark" style={{ marginTop: 14 }}>
                <span className="eyebrow" style={{ color: 'var(--y-300)' }}>
                  Total
                </span>
                <b className="num" aria-live="polite">
                  {valid ? ars(q.total) : '—'}
                </b>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 14,
                }}
              >
                <Button
                  variant="primary"
                  icon="check"
                  disabled={!valid}
                  onClick={() =>
                    toast(
                      `Presupuesto guardado: ${fmt(wn)}×${fmt(hn)} · ${ars(q.total)}`,
                      'receipt',
                    )
                  }
                >
                  Guardar presupuesto
                </Button>
                <Button
                  icon="chat"
                  disabled={!valid}
                  onClick={() =>
                    toast(
                      'Se enviaría el presupuesto por WhatsApp (simulado)',
                      'chat',
                    )
                  }
                >
                  Enviar
                </Button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function FrameViz({
  w,
  h,
  swatch,
  valid,
}: {
  w: number;
  h: number;
  swatch: string;
  valid: boolean;
}) {
  const max = 190;
  const s = valid ? max / Math.max(w, h) : 1;
  const iw = valid ? w * s : 120;
  const ih = valid ? h * s : 160;
  const t = 16; // grosor visual de la varilla (ilustrativo, no entra en el cálculo)
  const W = 360;
  const H = 300;
  const x = (W - iw) / 2;
  const y = (H - ih) / 2 + 6;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ maxWidth: 420 }}
      role="img"
      aria-label={`Marco de ${fmt(w)} por ${fmt(h)} centímetros`}
    >
      <defs>
        <clipPath id="c">
          <rect x={x} y={y} width={iw} height={ih} />
        </clipPath>
      </defs>
      {/* varilla */}
      <rect
        x={x - t}
        y={y - t}
        width={iw + 2 * t}
        height={ih + 2 * t}
        fill={swatch}
        stroke="#181613"
        strokeWidth="2.5"
        rx="2"
      />
      <rect
        x={x - t + 3}
        y={y - t + 3}
        width={iw + 2 * t - 6}
        height={ih + 2 * t - 6}
        fill="none"
        stroke="rgb(255 255 255 / 30%)"
        strokeWidth="1.5"
      />
      {/* obra */}
      <rect
        x={x}
        y={y}
        width={iw}
        height={ih}
        fill="#fff"
        stroke="#181613"
        strokeWidth="2"
      />
      <image
        href={samplePhoto(7)}
        x={x}
        y={y}
        width={iw}
        height={ih}
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#c)"
      />
      <path
        d={`M${x} ${y + ih * 0.5} L${x + iw * 0.5} ${y} L${x + iw * 0.72} ${y} L${x} ${y + ih * 0.78}Z`}
        fill="#fff"
        opacity=".16"
      />
      {/* cotas */}
      <g stroke="#181613" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d={`M${x - t} ${y - t - 14} H${x + iw + t}`} />
        <path
          d={`M${x - t} ${y - t - 20} v12 M${x + iw + t} ${y - t - 20} v12`}
        />
        <path d={`M${x - t - 14} ${y - t} V${y + ih + t}`} />
        <path
          d={`M${x - t - 20} ${y - t} h12 M${x - t - 20} ${y + ih + t} h12`}
        />
      </g>
      <g
        fontFamily="DM Mono, monospace"
        fontSize="14"
        fontWeight="500"
        fill="#181613"
        textAnchor="middle"
      >
        <rect
          x={W / 2 - 34}
          y={y - t - 30}
          width="68"
          height="20"
          rx="10"
          fill="#FFC914"
          stroke="#181613"
          strokeWidth="1.5"
        />
        <text x={W / 2} y={y - t - 15}>
          {fmt(w)} cm
        </text>
        <g transform={`translate(${x - t - 26} ${H / 2 + 6}) rotate(-90)`}>
          <rect
            x="-34"
            y="-14"
            width="68"
            height="20"
            rx="10"
            fill="#FFC914"
            stroke="#181613"
            strokeWidth="1.5"
          />
          <text x="0" y="1">
            {fmt(h)} cm
          </text>
        </g>
      </g>
    </svg>
  );
}

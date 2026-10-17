import { useState } from 'react';
import { Icon } from '../icons';
import { Link } from '../router';
import {
  Badge,
  Button,
  Chip,
  FilmStrip,
  Logo,
  Progress,
  Segmented,
  Stepper,
  StatusBadge,
  useToast,
} from '../ui';
import { JOB_FLOW } from '../data';

// ───────── contraste WCAG calculado en vivo ─────────
const lum = (hex: string) => {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const SWATCHES: {
  group: string;
  items: { name: string; hex: string; use: string }[];
}[] = [
  {
    group: 'Amarillo fotográfico',
    items: [
      { name: 'Sol', hex: '#FFC914', use: 'Marca, CTA, fondos de cabecera' },
      { name: 'Sol pulido', hex: '#F2B100', use: 'Presionado' },
      { name: 'Amarillo 300', hex: '#FFE066', use: 'Hover, halo de foco' },
      { name: 'Amarillo 100', hex: '#FFF1B8', use: 'Selección suave, avisos' },
      { name: 'Amarillo 50', hex: '#FFF9E0', use: 'Hover de filas' },
      { name: 'Ocre', hex: '#B88000', use: 'Solo bordes/detalles' },
    ],
  },
  {
    group: 'Grafito',
    items: [
      { name: 'Grafito 900', hex: '#181613', use: 'Texto, navegación, bordes' },
      { name: 'Grafito 800', hex: '#26231E', use: 'Superficies oscuras' },
      { name: 'Grafito 700', hex: '#3A362F', use: 'Líneas en oscuro' },
      { name: 'Grafito 500', hex: '#6A6458', use: 'Texto secundario' },
      { name: 'Grafito 300', hex: '#A39B8A', use: 'Deshabilitado' },
    ],
  },
  {
    group: 'Crema / papel',
    items: [
      { name: 'Papel 50', hex: '#FBF6E9', use: 'Fondo de página' },
      { name: 'Papel 0', hex: '#FFFDF8', use: 'Tarjetas' },
      { name: 'Papel 100', hex: '#F4ECD6', use: 'Hundido / tablas' },
      { name: 'Papel 200', hex: '#E8DDBD', use: 'Líneas suaves' },
      { name: 'Papel 300', hex: '#D4C598', use: 'Líneas firmes' },
    ],
  },
  {
    group: 'Rojo del logo y estados',
    items: [
      {
        name: 'Rojo revelado',
        hex: '#D7263D',
        use: 'Urgente, alertas puntuales',
      },
      { name: 'Rojo texto', hex: '#AB1A2D', use: 'Texto de error' },
      { name: 'Verde', hex: '#1E7B4F', use: 'Pagado, listo' },
      { name: 'Verde 100', hex: '#DCF1E4', use: 'Fondo de éxito' },
      { name: 'Azul', hex: '#1F4A99', use: 'Info, Drive' },
      { name: 'Azul 100', hex: '#DDE8FB', use: 'Fondo info' },
      { name: 'Ámbar', hex: '#8A5A00', use: 'Pendiente (texto)' },
      { name: 'Ámbar 100', hex: '#FFEEC2', use: 'Fondo pendiente' },
    ],
  },
];

const PAIRS: [string, string, string][] = [
  ['Texto grafito sobre amarillo Sol', '#181613', '#FFC914'],
  ['Texto grafito sobre papel', '#181613', '#FBF6E9'],
  ['Texto secundario sobre papel', '#6A6458', '#FBF6E9'],
  ['Amarillo sobre grafito (nav, totales)', '#FFC914', '#181613'],
  ['Papel sobre grafito', '#FBF6E9', '#181613'],
  ['Rojo texto sobre papel', '#AB1A2D', '#FBF6E9'],
  ['Blanco sobre rojo revelado', '#FFFFFF', '#D7263D'],
  ['Verde sobre verde 100', '#17653F', '#DCF1E4'],
  ['Ámbar sobre ámbar 100', '#8A5A00', '#FFEEC2'],
  ['Azul sobre azul 100', '#1F4A99', '#DDE8FB'],
];

export function DesignSystem() {
  const toast = useToast();
  const [seg, setSeg] = useState('a');
  const [copies, setCopies] = useState(3);
  const [chip, setChip] = useState(true);
  return (
    <div className="ds">
      <header className="ds-top on-yellow">
        <div className="ds-in">
          <Link to="/" className="frame-tag">
            ← Índice de la preview
          </Link>
          <div
            style={{
              display: 'flex',
              gap: 20,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Logo size={96} />
            <div>
              <h1 style={{ fontSize: 'clamp(2.2rem, 1.2rem + 4vw, 4rem)' }}>
                Sistema <span className="marker">CentroColor</span>
              </h1>
              <p style={{ fontWeight: 500, maxWidth: '60ch' }}>
                Amarillo fotográfico al frente, grafito para el contraste, crema
                para descansar la vista y el rojo del logo solo cuando hay que
                mirar. Motivos propios: la cinta de película, el número de
                fotograma y el resaltador.
              </p>
            </div>
          </div>
        </div>
      </header>
      <FilmStrip />

      <main className="ds-in ds-body">
        <section aria-labelledby="ds-pal">
          <h2 id="ds-pal">1 · Paleta</h2>
          <p className="muted">
            HEX exactos. El amarillo siempre lleva texto grafito; nunca texto
            amarillo sobre crema.
          </p>
          {SWATCHES.map((g) => (
            <div key={g.group} style={{ marginTop: 18 }}>
              <h3 className="eyebrow" style={{ marginBottom: 8 }}>
                {g.group}
              </h3>
              <div className="swatch-grid">
                {g.items.map((s) => {
                  const dark =
                    contrast(s.hex, '#181613') < contrast(s.hex, '#FFFFFF');
                  return (
                    <div className="swatch" key={s.hex + s.name}>
                      <div
                        className="swatch-chip"
                        style={{
                          background: s.hex,
                          color: dark ? '#fff' : '#181613',
                        }}
                      >
                        <span className="mono">{s.hex}</span>
                      </div>
                      <strong>{s.name}</strong>
                      <span className="muted">{s.use}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section aria-labelledby="ds-con">
          <h2 id="ds-con">2 · Contraste (WCAG, calculado)</h2>
          <div className="card table-wrap">
            <table className="dt">
              <caption className="sr-only">
                Pares de color y su contraste
              </caption>
              <thead>
                <tr>
                  <th scope="col">Par</th>
                  <th scope="col">Muestra</th>
                  <th scope="col" className="r">
                    Ratio
                  </th>
                  <th scope="col">Nivel</th>
                </tr>
              </thead>
              <tbody>
                {PAIRS.map(([label, fg, bg]) => {
                  const r = contrast(fg, bg);
                  return (
                    <tr key={label} style={{ cursor: 'default' }}>
                      <td>{label}</td>
                      <td>
                        <span
                          style={{
                            background: bg,
                            color: fg,
                            padding: '4px 12px',
                            borderRadius: 8,
                            fontWeight: 700,
                            border: '1.5px solid #181613',
                          }}
                        >
                          Aa 123
                        </span>
                      </td>
                      <td className="r mono">{r.toFixed(1)}:1</td>
                      <td>
                        {r >= 7 ? (
                          <Badge tone="green" icon="check">
                            AAA
                          </Badge>
                        ) : r >= 4.5 ? (
                          <Badge tone="green" icon="check">
                            AA
                          </Badge>
                        ) : (
                          <Badge tone="red" icon="x">
                            No cumple
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="ds-tipo">
          <h2 id="ds-tipo">3 · Tipografías</h2>
          <div className="ds-cols">
            <div className="card card--pad">
              <span className="eyebrow">
                Títulos y cifras · Bricolage Grotesque 600–800
              </span>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: '3.4rem',
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}
              >
                Imprimí tus fotos
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: '2.2rem',
                }}
              >
                $18.500 · 20×30 · CC-4F7K2
              </p>
              <p className="muted">
                Tiene carácter de cartelería sin ser retro: ancha, cálida, con
                terminaciones suaves.
              </p>
            </div>
            <div className="card card--pad">
              <span className="eyebrow">
                Interfaz y lectura · Figtree 400–800
              </span>
              <p style={{ fontSize: '1.125rem' }}>
                Elegí el tamaño, subí tus fotos y pasá a retirarlas por el
                local. Te avisamos por WhatsApp cuando estén listas. ¡Gracias,
                María!
              </p>
              <p style={{ fontSize: '1rem', fontWeight: 700 }}>
                Texto de botón y etiquetas en 700
              </p>
              <p className="muted">
                Geométrica, abierta y muy legible a 16 px. Soporta ñ, tildes y
                signos del español.
              </p>
            </div>
            <div className="card card--pad">
              <span className="eyebrow">Datos y marcas · DM Mono 400/500</span>
              <p className="mono" style={{ fontSize: '1.3rem' }}>
                CC-4F7K2 ▸ 7791234500011
              </p>
              <p className="mono">CENTROCOLORESPERANZA</p>
              <p className="muted">
                Códigos, alias, importes alineados con cifras tabulares y la
                numeración de fotograma.
              </p>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Escala: 12 / 14 / 16 / 18 / 22 / 28 / 32–44 / 46–102 px (hero).
            Cuerpo mínimo 16 px (evita zoom en iOS); texto utilitario 12 px solo
            en mono mayúsculas.
          </p>
        </section>

        <section aria-labelledby="ds-sup">
          <h2 id="ds-sup">4 · Superficies</h2>
          <div className="ds-cols">
            <div className="card card--pad">
              <strong>Tarjeta</strong>
              <p className="muted">
                Papel 0 · borde 1,5 px · sombra suave. Para leer.
              </p>
            </div>
            <div className="card card--pad card--sunken">
              <strong>Hundida</strong>
              <p className="muted">
                Papel 100 · sin sombra. Columnas, grupos, tablas.
              </p>
            </div>
            <div className="card card--pad card--outline">
              <strong>Pegatina</strong>
              <p className="muted">
                Borde grafito 2 px + sombra dura. Para lo accionable.
              </p>
            </div>
            <div className="card card--pad card--yellow">
              <strong>Marca</strong>
              <p>Amarillo Sol. Una por pantalla, para lo que importa.</p>
            </div>
            <div className="card card--pad card--dark on-dark">
              <strong>Grafito</strong>
              <p className="muted">Navegación, totales, estado «listo».</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="ds-btn">
          <h2 id="ds-btn">5 · Botones</h2>
          <div className="ds-row">
            <Button variant="primary" icon="check">
              Primario
            </Button>
            <Button>Secundario</Button>
            <Button variant="dark" icon="chat">
              Oscuro
            </Button>
            <Button variant="danger" icon="trash">
              Peligro
            </Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="primary" disabled>
              Deshabilitado
            </Button>
          </div>
          <div className="ds-row">
            <Button variant="primary" size="sm">
              Chico 40 px
            </Button>
            <Button variant="primary">Normal 48 px</Button>
            <Button variant="primary" size="lg" iconAfter="chevR">
              Grande 60 px
            </Button>
          </div>
          <p className="muted">
            Todos ≥ 40 px de alto (los de uso móvil, ≥ 48). Hover: sube;
            presionado: se hunde (sombra dura).
          </p>
        </section>

        <section aria-labelledby="ds-inp">
          <h2 id="ds-inp">6 · Campos y controles</h2>
          <div className="ds-cols">
            <div className="field">
              <label htmlFor="d1">Nombre</label>
              <input id="d1" className="input" placeholder="María González" />
            </div>
            <div className="field">
              <label htmlFor="d2">Con error</label>
              <input
                id="d2"
                className="input"
                aria-invalid="true"
                defaultValue="39"
              />
              <span className="err">
                <Icon name="alert" size={18} /> Ingresá un número válido.
              </span>
            </div>
            <div className="field">
              <label htmlFor="d3">Select</label>
              <select id="d3" className="select">
                <option>Efectivo</option>
                <option>Transferencia</option>
              </select>
            </div>
          </div>
          <div
            className="ds-row"
            style={{ marginTop: 16, alignItems: 'center' }}
          >
            <Stepper label="demo" value={copies} onChange={setCopies} />
            <Segmented
              label="demo"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'a', label: 'Día' },
                { value: 'b', label: 'Semana' },
              ]}
            />
            <Chip
              pressed={chip}
              onClick={() => setChip(!chip)}
              count={4}
              icon="alert"
            >
              Chip
            </Chip>
            <label className="check">
              <input type="checkbox" defaultChecked /> Casilla
            </label>
            <button
              type="button"
              role="switch"
              aria-checked="true"
              className="switch"
              aria-label="Interruptor"
            />
            <div style={{ width: 180 }}>
              <Progress value={64} yellow />
            </div>
          </div>
        </section>

        <section aria-labelledby="ds-bad">
          <h2 id="ds-bad">7 · Badges y estados (siempre ícono + texto)</h2>
          <div className="ds-row">
            {JOB_FLOW.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <div className="ds-row">
            <Badge tone="red" icon="bolt">
              Urgente
            </Badge>
            <Badge tone="red-soft" icon="clock">
              Atrasado
            </Badge>
            <Badge tone="amber" icon="hourglass">
              Esperando pago
            </Badge>
            <Badge tone="green" icon="check">
              Pagado
            </Badge>
            <Badge tone="blue" icon="cloud">
              Drive
            </Badge>
            <Badge icon="globe">Web</Badge>
            <Badge tone="ink" icon="sparkle">
              Personalizable
            </Badge>
            <Badge dashed icon="x">
              Sin archivos
            </Badge>
          </div>
          <p className="muted">
            Ningún estado depende solo del color: lleva palabra, ícono y, en
            tarjetas, un canto con patrón distinto.
          </p>
        </section>

        <section aria-labelledby="ds-marca">
          <h2 id="ds-marca">8 · Marca</h2>
          <div className="ds-cols">
            <div
              className="card card--pad on-yellow"
              style={{
                background: 'var(--y-500)',
                display: 'grid',
                placeItems: 'center',
                gap: 8,
              }}
            >
              <Logo size={120} />
              <span className="eyebrow" style={{ color: 'var(--ink-900)' }}>
                Sobre amarillo
              </span>
            </div>
            <div
              className="card card--pad card--dark on-dark"
              style={{ display: 'grid', placeItems: 'center', gap: 8 }}
            >
              <Logo size={120} />
              <span className="eyebrow">Sobre grafito</span>
            </div>
            <div
              className="card card--pad"
              style={{ display: 'grid', placeItems: 'center', gap: 8 }}
            >
              <Logo size={120} />
              <span className="eyebrow">Sobre crema</span>
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            <FilmStrip />
            <FilmStrip tone="cream" />
            <FilmStrip tone="dark" thin />
          </div>
          <div className="ds-row" style={{ marginTop: 16 }}>
            <span className="frame-tag">Número de fotograma</span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '2rem',
              }}
            >
              Un <span className="marker">resaltador</span> amarillo
            </span>
          </div>
          <div className="notice" style={{ marginTop: 16 }}>
            <Icon name="alert" />
            <span>
              <strong>Resolución del logo:</strong>
              El archivo disponible es de 1024×1024 px con fondo transparente.
              Alcanza para pantalla (hasta ~300 px a 3×), pero no para
              cartelería ni impresión, y su degradado/brillo exterior no es
              vectorial. Antes de producción conviene pedir el SVG/PDF vectorial
              y una versión plana (sin resplandor) para fondos oscuros.
            </span>
          </div>
        </section>

        <section aria-labelledby="ds-a11y">
          <h2 id="ds-a11y">9 · Foco y toques</h2>
          <div className="ds-row">
            <button
              type="button"
              className="btn btn--primary"
              id="focus-demo"
              onClick={() =>
                toast('Foco visible: aro grafito + halo amarillo', 'eye')
              }
            >
              Probá Tab hasta acá
            </button>
            <span className="muted">
              Aro grafito 3 px + halo amarillo; sobre fondos oscuros pasa a
              amarillo.
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}

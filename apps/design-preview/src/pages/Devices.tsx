import { Link, navigate, useLocation } from '../router';
import { Badge } from '../ui';

const ROUTES = [
  '/imprimir',
  '/imprimir/recibido',
  '/pedido/demo',
  '/panel',
  '/panel/pos',
  '/panel/trabajos',
  '/panel/produccion',
  '/panel/marqueteria',
  '/panel/agenda',
  '/diseno',
];

const FRAMES = [
  { name: 'Móvil', w: 390, h: 844, scale: 0.8 },
  { name: 'Tablet', w: 768, h: 1024, scale: 0.55 },
  { name: 'Desktop', w: 1440, h: 900, scale: 0.55 },
];

/** Compara la misma ruta en 390 / 768 / 1440 px usando iframes de la propia preview. */
export function Devices() {
  const { search } = useLocation();
  const ruta = search.get('ruta') ?? '/imprimir';
  return (
    <div
      style={{
        padding: '20px var(--gutter) 60px',
        maxWidth: 1800,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <Link to="/" className="btn btn--sm">
          ← Índice
        </Link>
        <h1 style={{ fontSize: '1.8rem' }}>Comparar tamaños</h1>
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="rt" className="sr-only">
            Ruta
          </label>
          <select
            id="rt"
            className="select"
            value={ruta}
            onChange={(e) => navigate(`/dispositivos?ruta=${e.target.value}`)}
          >
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Badge icon="info">
          Cada marco es una instancia independiente (su propio estado)
        </Badge>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 28,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        {FRAMES.map((f) => (
          <figure key={f.name} style={{ margin: 0 }}>
            <figcaption className="eyebrow" style={{ marginBottom: 8 }}>
              {f.name} · {f.w}×{f.h}
            </figcaption>
            <div
              style={{
                width: f.w * f.scale,
                height: f.h * f.scale,
                border: '3px solid var(--ink-900)',
                borderRadius: 18,
                overflow: 'hidden',
                boxShadow: 'var(--sh-hard)',
                background: '#fff',
              }}
            >
              <iframe
                title={`${ruta} en ${f.name}`}
                src={ruta}
                width={f.w}
                height={f.h}
                style={{
                  border: 0,
                  transform: `scale(${f.scale})`,
                  transformOrigin: '0 0',
                }}
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useStore } from '../store';
import { Badge, Button, Sheet, useToast } from '../ui';
import {
  BANK_ALIAS,
  PRINT_SIZES,
  ars,
  type Integration,
  type IntegrationState,
} from '../data';
import { PageHead } from './shared';

const META: Record<
  IntegrationState,
  { tone: 'green' | 'red' | 'neutral'; icon: IconName; label: string }
> = {
  connected: { tone: 'green', icon: 'check', label: 'Conectado' },
  attention: { tone: 'red', icon: 'alert', label: 'Requiere atención' },
  disconnected: { tone: 'neutral', icon: 'x', label: 'No conectado' },
};
const ICON: Record<Integration['id'], IconName> = {
  drive: 'cloud',
  whatsapp: 'chat',
  gmail: 'mail',
};

export function Settings() {
  const { integrations, setIntegration } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [fix, setFix] = useState<Integration | null>(null);
  const [off, setOff] = useState<Integration | null>(null);
  const [pub, setPub] = useState<Record<string, boolean>>({
    s1015: true,
    s1318: true,
    s1521: true,
    s2030: true,
    s3045: false,
    spola: true,
  });

  const run = (i: Integration, to: IntegrationState, msg: string) => {
    setBusy(i.id);
    window.setTimeout(() => {
      setIntegration(i.id, to);
      setBusy(null);
      toast(msg, to === 'connected' ? 'check' : 'info');
    }, 1100);
  };

  return (
    <>
      <PageHead title={<>Configuración e integraciones</>} />

      <div className="stack" style={{ gap: 28 }}>
        <section aria-labelledby="h-int">
          <div className="section-head">
            <h2 id="h-int">Integraciones</h2>
          </div>
          <div className="int-grid">
            {integrations.map((i) => {
              const m = META[i.state];
              const working = busy === i.id;
              return (
                <article
                  className="int"
                  data-s={i.state}
                  key={i.id}
                  aria-label={i.name}
                >
                  <div className="int-head">
                    <span className="int-ico">
                      <Icon name={ICON[i.id]} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <h3>{i.name}</h3>
                      <Badge tone={m.tone} icon={m.icon}>
                        {m.label}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <strong>{i.summary}</strong>
                    <p
                      className="muted"
                      style={{ marginTop: 4, fontSize: 'var(--fs-sm)' }}
                    >
                      {i.detail}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {i.state === 'connected' && (
                      <>
                        <Button
                          size="sm"
                          icon={working ? 'refresh' : 'refresh'}
                          disabled={working}
                          onClick={() =>
                            run(
                              i,
                              'connected',
                              `${i.name}: conexión verificada`,
                            )
                          }
                        >
                          {working ? 'Probando…' : 'Probar conexión'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setOff(i)}
                        >
                          Desconectar
                        </Button>
                      </>
                    )}
                    {i.state === 'attention' && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          icon="alert"
                          onClick={() => setFix(i)}
                        >
                          Resolver
                        </Button>
                        <Button
                          size="sm"
                          disabled={working}
                          onClick={() =>
                            run(
                              i,
                              'attention',
                              `${i.name}: sigue sin aprobarse la plantilla`,
                            )
                          }
                        >
                          {working ? 'Verificando…' : 'Reintentar'}
                        </Button>
                      </>
                    )}
                    {i.state === 'disconnected' && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="link"
                        disabled={working || i.id === 'gmail'}
                        onClick={() =>
                          run(i, 'connected', `${i.name} conectado`)
                        }
                      >
                        {working
                          ? 'Conectando…'
                          : i.id === 'gmail'
                            ? 'Próximamente'
                            : 'Conectar'}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="cols-2">
          <section className="card card--pad" aria-labelledby="h-pub">
            <div className="section-head">
              <h2 id="h-pub">Tamaños visibles en /imprimir</h2>
              <Badge icon="globe">
                {Object.values(pub).filter(Boolean).length} de{' '}
                {PRINT_SIZES.length}
              </Badge>
            </div>
            {PRINT_SIZES.map((s) => (
              <div className="toggle-row" key={s.id}>
                <span>
                  <strong>{s.name}</strong>{' '}
                  <span className="muted">
                    · {s.tagline} · {ars(s.price)}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={pub[s.id]}
                  aria-label={`Mostrar ${s.name} en la web`}
                  onClick={() => setPub((p) => ({ ...p, [s.id]: !p[s.id] }))}
                />
              </div>
            ))}
            <p
              className="muted"
              style={{ marginTop: 10, fontSize: 'var(--fs-sm)' }}
            >
              Es la misma lista de precios del catálogo de servicios
              fotográficos. Local de la preview: no cambia el portal.
            </p>
          </section>

          <section className="card card--pad" aria-labelledby="h-bank">
            <div className="section-head">
              <h2 id="h-bank">Datos de transferencia</h2>
            </div>
            <div className="field">
              <label htmlFor="alias">Alias bancario</label>
              <input
                id="alias"
                className="input mono"
                defaultValue={BANK_ALIAS}
                readOnly
              />
              <span className="hint">
                Se muestra al cliente después de confirmar su pedido.
              </span>
            </div>
            <div className="notice" style={{ marginTop: 14 }}>
              <Icon name="printer" />
              <span>
                <strong>
                  La impresión se realiza una vez acreditado el pago.
                </strong>
                Esta leyenda aparece en el portal y en el seguimiento.
              </span>
            </div>
          </section>
        </div>
      </div>

      <Sheet
        open={!!fix}
        onClose={() => setFix(null)}
        variant="modal"
        title="Resolver WhatsApp"
        eyebrow="Requiere atención"
        footer={
          <>
            <Button onClick={() => setFix(null)}>Cerrar</Button>
            <Button
              variant="primary"
              icon="check"
              onClick={() => {
                if (fix) setIntegration(fix.id, 'connected');
                setFix(null);
                toast('WhatsApp conectado (simulado)', 'check');
              }}
            >
              Marcar plantilla aprobada (demo)
            </Button>
          </>
        }
      >
        <ol className="xfer-steps" style={{ color: 'var(--text)' }}>
          <li>
            <b>1</b>
            <span>Entrá a Meta Business y abrí «Plantillas de mensajes».</span>
          </li>
          <li>
            <b>2</b>
            <span>
              Esperá la aprobación de <span className="mono">pedido_listo</span>{' '}
              (es_AR, categoría utilidad).
            </span>
          </li>
          <li>
            <b>3</b>
            <span>
              Volvé acá y tocá «Reintentar». Mientras tanto, los avisos quedan
              en cola.
            </span>
          </li>
        </ol>
      </Sheet>

      <Sheet
        open={!!off}
        onClose={() => setOff(null)}
        variant="modal"
        title={`¿Desconectar ${off?.name ?? ''}?`}
        footer={
          <>
            <Button onClick={() => setOff(null)}>Cancelar</Button>
            <Button
              variant="danger"
              icon="x"
              onClick={() => {
                if (off) setIntegration(off.id, 'disconnected');
                setOff(null);
                toast('Integración desconectada', 'info');
              }}
            >
              Desconectar
            </Button>
          </>
        }
      >
        <p>
          Los pedidos nuevos no podrán recibir fotos hasta que vuelvas a
          conectarla. Lo ya guardado no se borra.
        </p>
      </Sheet>
    </>
  );
}

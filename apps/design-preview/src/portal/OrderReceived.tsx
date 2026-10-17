import { useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import {
  Badge,
  Button,
  ButtonLink,
  FilmStrip,
  StatusBadge,
  useToast,
} from '../ui';
import { BANK_ALIAS, DEMO_JOB_ID, ars, jobCopies, plural } from '../data';
import { PortalShell } from './PortalShell';

export function OrderReceived() {
  const { jobs } = useStore();
  const toast = useToast();
  const [copied, setCopied] = useState<'alias' | 'amount' | null>(null);
  const job = jobs.find((j) => j.id === DEMO_JOB_ID) ?? jobs[0];
  const first = job.customer.split(' ')[0];
  const awaiting = job.status === 'awaiting_payment';

  const copy = async (text: string, key: 'alias' | 'amount', msg: string) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* el portapapeles puede no estar disponible: igual confirmamos visualmente */
    }
    setCopied(key);
    toast(msg, 'copy');
    window.setTimeout(() => setCopied(null), 2200);
  };

  return (
    <PortalShell>
      <div className="pt-page">
        <div className="rcv-title">
          <span className="stamp" aria-hidden="true">
            <Icon name="check" />
          </span>
          <div>
            <h1>
              Pedido <span className="marker">recibido</span>
            </h1>
            <p className="frame-tag code">
              Código {job.id} · Gracias, {first}
            </p>
          </div>
        </div>

        <div>
          <StatusBadge status={job.status} audience="public" large />
        </div>

        {awaiting ? (
          <section className="xfer on-dark" aria-labelledby="h-xfer">
            <FilmStrip tone="yellow" thin />
            <div className="xfer-in">
              <div>
                <h2 id="h-xfer" className="lbl">
                  Total a transferir
                </h2>
                <div className="amount num">{ars(job.total)}</div>
              </div>
              <div>
                <div className="lbl" style={{ marginBottom: 8 }}>
                  Transferí a este alias
                </div>
                <div className="alias-row">
                  <span className="alias" translate="no">
                    {BANK_ALIAS}
                  </span>
                  <Button
                    variant="primary"
                    icon={copied === 'alias' ? 'check' : 'copy'}
                    onClick={() => copy(BANK_ALIAS, 'alias', 'Alias copiado')}
                  >
                    {copied === 'alias' ? 'Copiado' : 'Copiar alias'}
                  </Button>
                </div>
              </div>
              <ol className="xfer-steps">
                <li>
                  <b>1</b>
                  <span>
                    Transferí <strong>{ars(job.total)}</strong> al alias de
                    arriba.{' '}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm on-dark"
                      style={{
                        minHeight: 32,
                        padding: '0 6px',
                        textDecoration: 'underline',
                      }}
                      onClick={() =>
                        copy(String(job.total), 'amount', 'Monto copiado')
                      }
                    >
                      {copied === 'amount' ? 'Monto copiado ✓' : 'Copiar monto'}
                    </button>
                  </span>
                </li>
                <li>
                  <b>2</b>
                  <span>Cuando se acredite, empezamos a imprimir.</span>
                </li>
              </ol>
            </div>
          </section>
        ) : (
          <div className="callout callout--wa" role="status">
            <Icon name="check" />
            <div>
              <strong>Transferencia acreditada</strong>
            </div>
          </div>
        )}

        {awaiting && (
          <div className="callout" role="note">
            <Icon name="printer" />
            <div>
              <strong>
                La impresión se realiza una vez acreditado el pago.
              </strong>
            </div>
          </div>
        )}

        <div className="callout callout--wa">
          <Icon name="chat" />
          <div>
            <strong>
              Te avisaremos por WhatsApp cuando tu pedido esté listo.
            </strong>
            <p className="mono">{job.phone}</p>
          </div>
        </div>

        <section className="card card--pad" aria-labelledby="h-det">
          <div className="section-head">
            <h2 id="h-det">Tu pedido</h2>
            <Badge icon="image">{plural(job.files, 'foto', 'fotos')}</Badge>
          </div>
          <ul className="order-lines">
            {job.lines.map((l) => (
              <li key={l.label}>
                <div>
                  <span className="sz">{l.label}</span>
                  <div className="muted">
                    {plural(l.copies, 'copia', 'copias')}
                  </div>
                </div>
                <span className="mono">{ars(l.price)}</span>
              </li>
            ))}
          </ul>
          <div className="order-total">
            <span className="eyebrow">
              Total · {plural(jobCopies(job), 'copia', 'copias')}
            </span>
            <b className="num">{ars(job.total)}</b>
          </div>
        </section>

        <div className="row-actions">
          <ButtonLink
            to="/pedido/demo"
            variant="primary"
            size="lg"
            iconAfter="chevR"
          >
            Seguir mi pedido
          </ButtonLink>
          <ButtonLink to="/imprimir" size="lg" icon="plus">
            Hacer otro pedido
          </ButtonLink>
        </div>
      </div>
    </PortalShell>
  );
}

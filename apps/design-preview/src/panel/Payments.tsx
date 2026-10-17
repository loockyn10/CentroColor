import { useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Button, useToast } from '../ui';
import { BANK_ALIAS, ars, jobBalance, plural } from '../data';
import { ConfirmTransferSheet, JobDrawer, PageHead } from './shared';

export function Payments() {
  const { jobs, confirmTransfer } = useStore();
  const toast = useToast();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const awaiting = jobs.filter((j) => j.status === 'awaiting_payment');
  const withBalance = jobs.filter(
    (j) =>
      j.status !== 'awaiting_payment' &&
      j.status !== 'delivered' &&
      jobBalance(j) > 0,
  );
  const job = jobs.find((j) => j.id === confirm) ?? null;

  return (
    <>
      <PageHead title="Cobros">
        <span className="meta">
          Alias <strong className="mono">{BANK_ALIAS}</strong>
        </span>
      </PageHead>

      <div className="stack" style={{ gap: 28 }}>
        <section aria-labelledby="h-wait">
          <div className="section-head">
            <h2 id="h-wait">Esperando transferencia</h2>
            <span className="meta">
              {plural(awaiting.length, 'pedido', 'pedidos')} ·{' '}
              <strong className="mono">
                {ars(awaiting.reduce((n, j) => n + j.total, 0))}
              </strong>
            </span>
          </div>
          {awaiting.length === 0 ? (
            <div className="card empty">
              <Icon name="check" size={32} />
              <strong style={{ color: 'var(--text)' }}>
                No hay transferencias por confirmar
              </strong>
            </div>
          ) : (
            <ul className="oplist oplist-card tray">
              {awaiting.map((j) => (
                <li key={j.id}>
                  <div className="op" data-flag="pay">
                    <button
                      type="button"
                      className="op-open"
                      onClick={() => setOpen(j.id)}
                    >
                      <span className="who">{j.customer}</span>
                      <span className="what">{j.title}</span>
                      <span className="meta">
                        <span className="amt">{ars(j.total)}</span>
                        <span className="sep">·</span>
                        {j.created.toLowerCase()}
                      </span>
                    </button>
                    <div className="go">
                      <Button
                        variant="primary"
                        icon="check"
                        onClick={() => setConfirm(j.id)}
                      >
                        Confirmar
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-bal">
          <div className="section-head">
            <h2 id="h-bal">Saldos pendientes</h2>
            <span className="meta">
              <strong className="mono">
                {ars(withBalance.reduce((n, j) => n + jobBalance(j), 0))}
              </strong>
            </span>
          </div>
          <div className="card table-wrap">
            <table className="dt">
              <caption className="sr-only">
                Trabajos con saldo pendiente
              </caption>
              <thead>
                <tr>
                  <th scope="col">Trabajo</th>
                  <th scope="col" className="r col-wide">
                    Total
                  </th>
                  <th scope="col" className="r col-wide">
                    Pagado
                  </th>
                  <th scope="col" className="r">
                    Saldo
                  </th>
                  <th scope="col">
                    <span className="sr-only">Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {withBalance.map((j) => (
                  <tr key={j.id} onClick={() => setOpen(j.id)}>
                    <td>
                      <strong>{j.customer}</strong>
                      <div className="meta">{j.title}</div>
                    </td>
                    <td className="r mono col-wide">{ars(j.total)}</td>
                    <td className="r mono col-wide">{ars(j.paid)}</td>
                    <td className="r mono">
                      <strong>{ars(jobBalance(j))}</strong>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        icon="cash"
                        onClick={() => {
                          confirmTransfer(j.id);
                          toast(
                            `Cobro registrado: ${ars(jobBalance(j))}`,
                            'cash',
                          );
                        }}
                      >
                        Cobrar saldo
                      </Button>
                    </td>
                  </tr>
                ))}
                {withBalance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No hay saldos pendientes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ConfirmTransferSheet job={job} onClose={() => setConfirm(null)} />
      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  searchCustomers,
  type CustomerRepository,
  type PhotoJobSummary,
  type PhotoRepository,
} from '@centrocolor/application';
import type { Customer } from '@centrocolor/domain';
import { Icon } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

/** Buscador global del encabezado: clientes y pedidos de laboratorio. `/` enfoca el campo. */
export function GlobalSearch({
  customerRepository,
  photoRepository,
  onOpenCustomer,
  onOpenJob,
  onDone,
}: {
  customerRepository: CustomerRepository;
  photoRepository?: PhotoRepository;
  onOpenCustomer: (customerId: string) => void;
  onOpenJob: (jobId: string) => void;
  /** Se llama tras elegir un resultado (cierra la hoja de búsqueda móvil). */
  onDone?: () => void;
}) {
  const { businessId, branchId } = useBusinessContext();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<PhotoJobSummary[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const needle = query.trim();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key === '/' &&
        !/INPUT|TEXTAREA|SELECT/.test(target.tagName) &&
        !target.isContentEditable
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, []);

  useEffect(() => {
    if (!needle) {
      setCustomers([]);
      setJobs([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void searchCustomers(customerRepository, businessId, needle)
        .then((rows) => live && setCustomers(rows.slice(0, 4)))
        .catch(() => live && setCustomers([]));
      if (photoRepository && branchId)
        void photoRepository
          .listJobs(businessId, branchId, { search: needle, limit: 4 })
          .then((rows) => live && setJobs(rows.slice(0, 4)))
          .catch(() => live && setJobs([]));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [needle, customerRepository, photoRepository, businessId, branchId]);

  const choose = (action: () => void) => {
    setOpen(false);
    setQuery('');
    action();
    onDone?.();
  };

  return (
    <div className="top-search" ref={wrap}>
      <Icon name="search" />
      <input
        ref={input}
        className="input"
        type="search"
        placeholder="Buscar cliente o pedido…"
        aria-label="Buscar en todo el panel"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      />
      {open && needle && (
        <div className="search-pop" role="listbox" aria-label="Resultados">
          {customers.length + jobs.length === 0 && (
            <div className="grp-label">Sin resultados para «{needle}»</div>
          )}
          {customers.length > 0 && <div className="grp-label">Clientes</div>}
          {customers.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => choose(() => onOpenCustomer(customer.id))}
            >
              <span>{customer.fullName}</span>
              <span className="muted mono">{customer.phone ?? ''}</span>
            </button>
          ))}
          {jobs.length > 0 && <div className="grp-label">Pedidos</div>}
          {jobs.map((row) => (
            <button
              key={row.job.id}
              type="button"
              onClick={() => choose(() => onOpenJob(row.job.id))}
            >
              <span>
                {row.customerName} ·{' '}
                <span className="muted">{row.itemSummary}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

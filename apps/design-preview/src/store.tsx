import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  DEMO_JOB_ID,
  JOB_FLOW,
  apptSeed,
  integrationsSeed,
  jobsSeed,
  products as productsSeed,
  type ApptStatus,
  type Appointment,
  type Integration,
  type IntegrationState,
  type Job,
  type JobLine,
  type JobStatus,
  type Product,
} from './data';

// Estado en memoria compartido entre el portal y el panel: lo que se confirma en /imprimir
// aparece en la cola del panel y lo que se avanza en el panel se ve en /pedido/demo.

interface State {
  jobs: Job[];
  appts: Appointment[];
  products: Product[];
  integrations: Integration[];
  salesToday: number;
  salesCount: number;
}

type Action =
  | { t: 'job-status'; id: string; status: JobStatus }
  | { t: 'job-pay'; id: string }
  | { t: 'job-urgent'; id: string }
  | { t: 'job-wa'; id: string }
  | {
      t: 'order';
      customer: string;
      phone: string;
      email: string;
      notes: string;
      lines: JobLine[];
      total: number;
      files: number;
    }
  | { t: 'appt'; id: string; status: ApptStatus }
  | { t: 'stock'; id: string; delta: number }
  | { t: 'sale'; total: number; items: { id: string; qty: number }[] }
  | { t: 'integration'; id: Integration['id']; state: IntegrationState }
  | { t: 'reset' };

const initial = (): State => ({
  jobs: jobsSeed.map((j) => ({ ...j, lines: j.lines.map((l) => ({ ...l })) })),
  appts: apptSeed.map((a) => ({ ...a })),
  products: productsSeed.map((p) => ({ ...p })),
  integrations: integrationsSeed.map((i) => ({ ...i })),
  salesToday: 148300,
  salesCount: 17,
});

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'job-status':
      return {
        ...s,
        jobs: s.jobs.map((j) => {
          if (j.id !== a.id) return j;
          const next = { ...j, status: a.status };
          // Regla de negocio: la transferencia se acredita al pasar de "esperando" a "recibido".
          if (
            j.status === 'awaiting_payment' &&
            a.status !== 'awaiting_payment'
          )
            next.paid = Math.max(next.paid, next.total);
          if (a.status === 'ready' && j.whatsapp === 'none')
            next.whatsapp = 'queued';
          if (a.status === 'delivered') next.paid = next.total;
          if (a.status === 'awaiting_payment') {
            next.paid = 0;
            next.whatsapp = 'none';
          }
          return next;
        }),
      };
    case 'job-pay':
      return {
        ...s,
        jobs: s.jobs.map((j) =>
          j.id === a.id
            ? {
                ...j,
                paid: j.total,
                status: j.status === 'awaiting_payment' ? 'received' : j.status,
              }
            : j,
        ),
      };
    case 'job-wa':
      return {
        ...s,
        jobs: s.jobs.map((j) =>
          j.id === a.id ? { ...j, whatsapp: 'sent' } : j,
        ),
      };
    case 'job-urgent':
      return {
        ...s,
        jobs: s.jobs.map((j) =>
          j.id === a.id ? { ...j, urgent: !j.urgent } : j,
        ),
      };
    case 'order': {
      // El pedido nuevo reemplaza al pedido demo (mismo código) para que /pedido/demo lo muestre.
      const job: Job = {
        id: DEMO_JOB_ID,
        customer: a.customer,
        phone: a.phone,
        origin: 'web',
        lane: 'lab',
        title: a.lines
          .map((l) =>
            l.copies === 1
              ? `1 foto ${l.label}`
              : `${l.copies} fotos ${l.label}`,
          )
          .join(' + '),
        lines: a.lines,
        total: a.total,
        paid: 0,
        status: 'awaiting_payment',
        urgent: false,
        dueIn: 2,
        drive: 'ok',
        files: a.files,
        created: 'Recién',
        notes: [a.notes, a.email && `Email: ${a.email}`]
          .filter(Boolean)
          .join(' · '),
        whatsapp: 'none',
      };
      return {
        ...s,
        jobs: [job, ...s.jobs.filter((j) => j.id !== DEMO_JOB_ID)],
      };
    }
    case 'appt':
      return {
        ...s,
        appts: s.appts.map((x) =>
          x.id === a.id ? { ...x, status: a.status } : x,
        ),
      };
    case 'stock':
      return {
        ...s,
        products: s.products.map((p) =>
          p.id === a.id && p.stock !== null
            ? { ...p, stock: Math.max(0, p.stock + a.delta) }
            : p,
        ),
      };
    case 'sale':
      return {
        ...s,
        salesToday: s.salesToday + a.total,
        salesCount: s.salesCount + 1,
        products: s.products.map((p) => {
          const it = a.items.find((i) => i.id === p.id);
          return it && p.stock !== null
            ? { ...p, stock: Math.max(0, p.stock - it.qty) }
            : p;
        }),
      };
    case 'integration':
      return {
        ...s,
        integrations: s.integrations.map((i) =>
          i.id === a.id ? { ...i, state: a.state } : i,
        ),
      };
    case 'reset':
      return initial();
  }
}

interface Ctx extends State {
  setJobStatus: (id: string, status: JobStatus) => void;
  advanceJob: (id: string) => JobStatus | null;
  confirmTransfer: (id: string) => void;
  toggleUrgent: (id: string) => void;
  sendWhatsapp: (id: string) => void;
  placeOrder: (o: Omit<Extract<Action, { t: 'order' }>, 't'>) => void;
  setAppt: (id: string, status: ApptStatus) => void;
  adjustStock: (id: string, delta: number) => void;
  completeSale: (total: number, items: { id: string; qty: number }[]) => void;
  setIntegration: (id: Integration['id'], state: IntegrationState) => void;
  reset: () => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  const advanceJob = useCallback(
    (id: string) => {
      const j = state.jobs.find((x) => x.id === id);
      if (!j) return null;
      const i = JOB_FLOW.indexOf(j.status);
      const next = JOB_FLOW[Math.min(JOB_FLOW.length - 1, i + 1)];
      if (next === j.status) return null;
      dispatch({ t: 'job-status', id, status: next });
      return next;
    },
    [state.jobs],
  );

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      setJobStatus: (id, status) => dispatch({ t: 'job-status', id, status }),
      advanceJob,
      confirmTransfer: (id) => dispatch({ t: 'job-pay', id }),
      toggleUrgent: (id) => dispatch({ t: 'job-urgent', id }),
      sendWhatsapp: (id) => dispatch({ t: 'job-wa', id }),
      placeOrder: (o) => dispatch({ t: 'order', ...o }),
      setAppt: (id, status) => dispatch({ t: 'appt', id, status }),
      adjustStock: (id, delta) => dispatch({ t: 'stock', id, delta }),
      completeSale: (total, items) => dispatch({ t: 'sale', total, items }),
      setIntegration: (id, st) => dispatch({ t: 'integration', id, state: st }),
      reset: () => dispatch({ t: 'reset' }),
    }),
    [state, advanceJob],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore fuera de StoreProvider');
  return ctx;
}

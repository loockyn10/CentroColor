import {
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react';

// Router mínimo con History API: rutas reales (/imprimir, /pedido/demo, /panel/...)
// sin dependencias nuevas. La preview no tiene backend, así que alcanza con esto.

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emit);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => window.location.pathname + window.location.search;

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const current = getSnapshot();
  if (to === current) return;
  const samePath = to.split('?')[0] === current.split('?')[0];
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  if (!samePath) window.scrollTo({ top: 0, behavior: 'instant' });
  emit();
}

export function useLocation() {
  const full = useSyncExternalStore(subscribe, getSnapshot, () => '/');
  const [path, search = ''] = full.split('?');
  const normalized =
    path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return { path: normalized, search: new URLSearchParams(search) };
}

export function Link({
  to,
  onClick,
  children,
  ...rest
}: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      rest.target === '_blank'
    )
      return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

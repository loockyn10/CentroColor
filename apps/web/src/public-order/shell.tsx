import { useEffect, type ReactNode } from 'react';
import './public-order.css';

/** Title and robots policy for a public page. Tracking pages must never be indexed. */
export function useDocumentMeta(title: string, noindex: boolean) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    if (noindex) document.head.appendChild(meta);
    return () => {
      document.title = previous;
      if (noindex) meta.remove();
    };
  }, [title, noindex]);
}

/** Plain storefront chrome: brand only. No administrative navigation. */
export function PublicShell({
  children,
  businessName,
}: {
  children: ReactNode;
  businessName?: string;
}) {
  return (
    <div className="po-page">
      <header className="po-brand">
        <span className="po-logo" aria-hidden="true">
          ◐
        </span>
        <strong>{businessName || 'CentroColor'}</strong>
      </header>
      <main className="po-main">{children}</main>
      <footer className="po-footer">
        <small>
          {businessName || 'CentroColor'} · Revelado e impresión de fotos
        </small>
      </footer>
    </div>
  );
}

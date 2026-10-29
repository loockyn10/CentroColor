import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './icons';

export type MessageTone = 'success' | 'error' | 'info';
export type Flash = { tone: MessageTone; text: string };

/**
 * Mensaje en línea: éxito, error o información. Un éxito nunca se pinta como error.
 * `error` usa role="alert"; el resto, role="status".
 */
export function InlineMessage({
  tone = 'info',
  children,
}: {
  tone?: MessageTone;
  children: ReactNode;
}) {
  return (
    <p
      className={`inline-message inline-message--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon
        name={
          tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'
        }
        size={18}
      />
      <span>{children}</span>
    </p>
  );
}

/** Estado de un mensaje transitorio: los éxitos se descartan solos. */
export function useFlash(successMs = 4000) {
  const [current, setCurrent] = useState<Flash | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    setCurrent(null);
  }, []);
  const error = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setCurrent({ tone: 'error', text });
  }, []);
  const info = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setCurrent({ tone: 'info', text });
  }, []);
  const success = useCallback(
    (text: string) => {
      window.clearTimeout(timer.current);
      setCurrent({ tone: 'success', text });
      timer.current = window.setTimeout(() => setCurrent(null), successMs);
    },
    [successMs],
  );
  return { current, error, info, success, clear };
}

export function FlashMessage({
  flash,
}: {
  flash: ReturnType<typeof useFlash>;
}) {
  return flash.current ? (
    <InlineMessage tone={flash.current.tone}>
      {flash.current.text}
    </InlineMessage>
  ) : null;
}

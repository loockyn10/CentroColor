import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '@centrocolor/ui';
import { visibleRows } from './model';

/**
 * A long list of equal-height rows that only keeps the visible ones in the DOM. 500 photos are
 * about twenty rows (and twenty thumbnails), not five hundred.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  maxHeight,
  label,
  getKey,
  renderRow,
}: {
  items: T[];
  rowHeight: number;
  maxHeight: number;
  label: string;
  getKey: (item: T) => string;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(maxHeight);
  const frame = useRef<number | null>(null);

  const height = Math.min(maxHeight, items.length * rowHeight);
  useLayoutEffect(() => {
    setViewport(height);
  }, [height]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setScrollTop(host.current?.scrollTop ?? 0);
    });
  }, []);

  const { start, end } = visibleRows(
    scrollTop,
    viewport,
    rowHeight,
    items.length,
  );
  return (
    <div
      ref={host}
      className="vl"
      role="list"
      aria-label={label}
      style={{ height }}
      onScroll={onScroll}
    >
      <div className="vl-spacer" style={{ height: items.length * rowHeight }}>
        {items.slice(start, end).map((item, offset) => {
          const index = start + offset;
          return (
            <div
              key={getKey(item)}
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={items.length}
              className="vl-row"
              style={{ top: index * rowHeight, height: rowHeight }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── thumbnails ───────────────────────────── */

type Job = {
  file: File;
  resolve: (bitmap: ImageBitmap | null) => void;
  cancelled: boolean;
};
const THUMB = 48;
const MAX_DECODING = 2;
const waiting: Job[] = [];
let decoding = 0;

function pump() {
  while (decoding < MAX_DECODING && waiting.length) {
    const job = waiting.shift()!;
    if (job.cancelled) {
      job.resolve(null);
      continue;
    }
    decoding += 1;
    // Decoded at thumbnail size by the browser: a 30 MB export never becomes a 30 MB bitmap.
    createImageBitmap(job.file, {
      resizeWidth: THUMB * 2,
      resizeQuality: 'low',
    })
      .then((bitmap) => job.resolve(job.cancelled ? null : bitmap))
      .catch(() => job.resolve(null))
      .finally(() => {
        decoding -= 1;
        pump();
      });
  }
}

function requestThumbnail(file: File) {
  const job: Job = { file, resolve: () => undefined, cancelled: false };
  const promise = new Promise<ImageBitmap | null>((resolve) => {
    job.resolve = resolve;
  });
  if (typeof createImageBitmap !== 'function') job.resolve(null);
  else {
    waiting.push(job);
    pump();
  }
  return { promise, cancel: () => (job.cancelled = true) };
}

/**
 * Small preview drawn on a canvas. Rows scrolled past before their turn never decode, two at a
 * time otherwise, and formats the browser cannot decode (HEIC, TIFF) keep the icon.
 */
export function Thumbnail({ file }: { file: File }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const request = requestThumbnail(file);
    let live = true;
    void request.promise.then((bitmap) => {
      if (!bitmap) return;
      const target = canvas.current;
      const context = live ? target?.getContext('2d') : null;
      if (target && context) {
        const scale = Math.max(
          target.width / bitmap.width,
          target.height / bitmap.height,
        );
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        context.drawImage(
          bitmap,
          (target.width - w) / 2,
          (target.height - h) / 2,
          w,
          h,
        );
        setReady(true);
      }
      bitmap.close();
    });
    return () => {
      live = false;
      request.cancel();
    };
  }, [file]);
  return (
    <span className="pro-thumb" aria-hidden="true">
      <canvas
        ref={canvas}
        width={THUMB * 2}
        height={THUMB * 2}
        hidden={!ready}
      />
      {!ready && <Icon name="image" size={22} />}
    </span>
  );
}

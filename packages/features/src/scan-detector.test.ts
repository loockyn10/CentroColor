import { describe, expect, it } from 'vitest';
import { ScanDetector, scanBlockReason, type ScanFeed } from './scan-detector';

/** Teclea `text` con `gap` ms entre teclas y devuelve el resultado de cada tecla. */
function type(
  detector: ScanDetector,
  text: string,
  start: number,
  gap: number,
  terminator = 'Enter',
): { feeds: ScanFeed[]; end: number } {
  const feeds: ScanFeed[] = [];
  let time = start;
  for (const key of text) {
    feeds.push(detector.feed({ key, time }));
    time += gap;
  }
  if (terminator) feeds.push(detector.feed({ key: terminator, time }));
  return { feeds, end: time };
}

describe('detector de lector HID', () => {
  it('reconoce una ráfaga rápida terminada en Enter y la consume', () => {
    const detector = new ScanDetector();
    const { feeds } = type(detector, '7791234567890', 1000, 8);
    const last = feeds.at(-1)!;
    expect(last.scan).toBe('7791234567890');
    expect(last.swallow).toBe(true);
    expect(feeds.filter((feed) => feed.scan !== null)).toHaveLength(1);
  });

  it('retiene las teclas desde la tercera y marca el inicio de la ráfaga', () => {
    const detector = new ScanDetector();
    const { feeds } = type(detector, '7791', 0, 5, '');
    expect(feeds.map((feed) => feed.swallow)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(feeds[0]!.burstStart).toBe(true);
    expect(feeds[1]!.burstStart).toBe(false);
  });

  it('la escritura humana lenta no dispara un escaneo', () => {
    const detector = new ScanDetector();
    const { feeds } = type(detector, '1234567890', 0, 180);
    expect(feeds.every((feed) => feed.scan === null && !feed.swallow)).toBe(
      true,
    );
  });

  it('un Enter normal (sin ráfaga) pasa intacto al formulario', () => {
    const detector = new ScanDetector();
    expect(detector.feed({ key: 'Enter', time: 5000 })).toEqual({
      swallow: false,
      scan: null,
      burstStart: false,
    });
    const { feeds } = type(detector, '12', 6000, 5);
    expect(feeds.at(-1)).toMatchObject({ scan: null, swallow: false });
  });

  it('una ráfaga demasiado corta no cuenta como código', () => {
    const detector = new ScanDetector();
    const { feeds } = type(detector, '123', 0, 5);
    expect(feeds.at(-1)!.scan).toBeNull();
  });

  it('terminador lento tras una ráfaga rápida no escanea', () => {
    const detector = new ScanDetector();
    const { feeds, end } = type(detector, '77912345', 0, 5, '');
    expect(feeds.every((feed) => feed.scan === null)).toBe(true);
    expect(detector.feed({ key: 'Enter', time: end + 400 }).scan).toBeNull();
  });

  it('CRLF (Enter + Enter o Ctrl+J) genera exactamente una acción', () => {
    const detector = new ScanDetector();
    const { feeds, end } = type(detector, '7791234567890', 0, 6);
    expect(feeds.at(-1)!.scan).toBe('7791234567890');
    const second = detector.feed({ key: 'Enter', time: end + 3 });
    expect(second).toEqual({ swallow: true, scan: null, burstStart: false });
    const ctrlJ = detector.feed({ key: 'j', ctrlKey: true, time: end + 6 });
    expect(ctrlJ.scan).toBeNull();
    expect(ctrlJ.swallow).toBe(true);
  });

  it('dos escaneos seguidos del mismo código son dos acciones', () => {
    const detector = new ScanDetector();
    const first = type(detector, '7791234567890', 0, 6);
    const second = type(detector, '7791234567890', first.end + 300, 6);
    expect(first.feeds.at(-1)!.scan).toBe('7791234567890');
    expect(second.feeds.at(-1)!.scan).toBe('7791234567890');
  });

  it('un Enter humano tiempo después de un escaneo no se descarta', () => {
    const detector = new ScanDetector();
    const { end } = type(detector, '7791234567890', 0, 6);
    expect(detector.feed({ key: 'Enter', time: end + 500 }).swallow).toBe(
      false,
    );
  });

  it('teclas de control cortan la ráfaga', () => {
    const detector = new ScanDetector();
    detector.feed({ key: '7', time: 0 });
    detector.feed({ key: '7', time: 5 });
    detector.feed({ key: 'ArrowLeft', time: 10 });
    detector.feed({ key: '9', time: 12 });
    detector.feed({ key: '1', time: 14 });
    expect(detector.feed({ key: 'Enter', time: 16 }).scan).toBeNull();
  });
});

describe('política de bloqueo del escaneo', () => {
  it('no descarta trabajo: modal, alta en curso o campo en edición lo frenan', () => {
    const free = { modalOpen: false, editingField: false, altaActive: false };
    expect(scanBlockReason(free)).toBeNull();
    expect(scanBlockReason({ ...free, modalOpen: true })).toBe('modal');
    expect(scanBlockReason({ ...free, altaActive: true })).toBe('alta');
    expect(scanBlockReason({ ...free, editingField: true })).toBe('editing');
  });
});

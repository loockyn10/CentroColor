/**
 * Detector de lectores HID «keyboard wedge»: lógica pura, sin DOM. Un lector escribe el código como
 * una ráfaga de teclas separadas por pocos milisegundos y termina con Enter (CR, LF o CRLF); una
 * persona no llega a ese ritmo. Se acepta sólo una ráfaga completa y rápida terminada en Enter.
 */

export type ScanKey = {
  key: string;
  /** Marca de tiempo en milisegundos (`KeyboardEvent.timeStamp`). */
  time: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
};

export type ScanFeed = {
  /** El evento debe cancelarse (el DOM no debe recibir la tecla). */
  swallow: boolean;
  /** Código completo, sólo cuando la ráfaga terminó. */
  scan: string | null;
  /** Primer carácter de una ráfaga posible: el llamador puede guardar el estado del campo. */
  burstStart: boolean;
};

export type ScanDetectorOptions = {
  /** Separación máxima entre teclas de una ráfaga. */
  maxGapMs?: number;
  /** Largo mínimo del código. */
  minLength?: number;
  /** Largo máximo (coincide con la validación de barcode del dominio). */
  maxLength?: number;
};

const PASS: ScanFeed = { swallow: false, scan: null, burstStart: false };

export class ScanDetector {
  private buffer = '';
  private lastTime = Number.NEGATIVE_INFINITY;
  private lastScanTime = Number.NEGATIVE_INFINITY;
  private readonly maxGap: number;
  private readonly minLength: number;
  private readonly maxLength: number;

  constructor(options: ScanDetectorOptions = {}) {
    this.maxGap = options.maxGapMs ?? 50;
    this.minLength = options.minLength ?? 4;
    this.maxLength = options.maxLength ?? 128;
  }

  reset() {
    this.buffer = '';
    this.lastTime = Number.NEGATIVE_INFINITY;
  }

  feed(input: ScanKey): ScanFeed {
    const { key, time } = input;
    const lineFeed =
      key === 'Enter' ||
      key === '\n' ||
      key === '\r' ||
      (input.ctrlKey === true && key.toLowerCase() === 'j');
    if (lineFeed) return this.terminate(time);
    if (key.length !== 1 || input.altKey || input.metaKey || input.ctrlKey) {
      // Modificadores solos (Shift, etc.) no rompen la ráfaga; otras teclas sí.
      if (key === 'Shift' || key === 'CapsLock' || key === 'AltGraph')
        return PASS;
      this.reset();
      return PASS;
    }
    if (input.repeat) {
      this.reset();
      return PASS;
    }
    const continuing =
      this.buffer !== '' && time - this.lastTime <= this.maxGap;
    this.buffer = continuing ? this.buffer + key : key;
    this.lastTime = time;
    if (this.buffer.length > this.maxLength) {
      this.reset();
      return PASS;
    }
    // Con dos separaciones rápidas ya no hay duda de que es un lector: se retienen las teclas
    // siguientes. Las dos primeras ya llegaron al campo y el llamador las restituye al terminar.
    return {
      swallow: this.buffer.length >= 3,
      scan: null,
      burstStart: !continuing,
    };
  }

  private terminate(time: number): ScanFeed {
    const complete =
      this.buffer.length >= this.minLength &&
      time - this.lastTime <= this.maxGap;
    if (complete) {
      const scan = this.buffer;
      this.buffer = '';
      this.lastTime = Number.NEGATIVE_INFINITY;
      this.lastScanTime = time;
      return { swallow: true, scan, burstStart: false };
    }
    // Segundo terminador de un lector CRLF: pertenece al mismo escaneo, no genera otro.
    if (this.buffer === '' && time - this.lastScanTime <= this.maxGap) {
      this.lastScanTime = time;
      return { swallow: true, scan: null, burstStart: false };
    }
    this.reset();
    return PASS;
  }
}

export type ScanBlockInput = {
  /** Hay un diálogo modal abierto. */
  modalOpen: boolean;
  /** El foco está en un campo de texto de un formulario con contenido escrito. */
  editingField: boolean;
  /** Hay un alta de producto originada por escáner en curso. */
  altaActive: boolean;
};

export type ScanBlockReason = 'modal' | 'editing' | 'alta';

/** Política conservadora: un escaneo nunca descarta trabajo sin guardar. */
export function scanBlockReason(input: ScanBlockInput): ScanBlockReason | null {
  if (input.modalOpen) return 'modal';
  if (input.altaActive) return 'alta';
  if (input.editingField) return 'editing';
  return null;
}

export const scanBlockMessages: Record<ScanBlockReason, string> = {
  modal: 'Cerrá el diálogo abierto para escanear.',
  alta: 'Guardá o cancelá el alta del producto antes de escanear otro código.',
  editing: 'Terminá el formulario en edición antes de escanear.',
};

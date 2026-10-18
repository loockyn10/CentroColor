import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { scanBarcode, type ProductRepository } from '@centrocolor/application';
import { Notice } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { ScanCoordinator, type ScanState } from './scan-coordinator';
import {
  ScanDetector,
  scanBlockMessages,
  scanBlockReason,
} from './scan-detector';

const ScannerContext = createContext<ScanCoordinator | null>(null);

const idleState: ScanState = { cartQueue: [], alta: null, notice: null };
const noSubscribe = () => () => undefined;

/** Coordinador del escáner global, o `null` fuera del panel (portales públicos, pruebas). */
export function useScanCoordinator(): ScanCoordinator | null {
  return useContext(ScannerContext);
}

export function useScanState(): ScanState {
  const coordinator = useContext(ScannerContext);
  return useSyncExternalStore(
    coordinator?.subscribe ?? noSubscribe,
    coordinator?.getState ?? (() => idleState),
  );
}

type FieldState = { element: HTMLElement; value: string };

function isTextField(
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes(
    element.type,
  );
}

function snapshotField(target: EventTarget | null): FieldState | null {
  if (isTextField(target as Element | null))
    return {
      element: target as HTMLElement,
      value: (target as HTMLInputElement).value,
    };
  if (target instanceof HTMLSelectElement)
    return { element: target, value: target.value };
  if (target instanceof HTMLElement && target.isContentEditable)
    return { element: target, value: target.textContent ?? '' };
  return null;
}

/** Devuelve el campo a su valor previo a la ráfaga (los 2 primeros caracteres llegan antes de saber). */
function restoreField(saved: FieldState) {
  const { element, value } = saved;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.value === value) return;
    const proto = Object.getPrototypeOf(element) as object;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (element instanceof HTMLSelectElement) {
    if (element.value !== value) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (element.textContent !== value) {
    element.textContent = value;
  }
}

function editingField(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const inForm = active.closest('form, [role="dialog"]') !== null;
  if (isTextField(active))
    return inForm && active.type !== 'search' && active.value.trim() !== '';
  return (
    active instanceof HTMLElement &&
    active.isContentEditable &&
    (active.textContent ?? '').trim() !== ''
  );
}

/**
 * Escáner HID global del panel interno. Se monta únicamente dentro de `PanelShell` (autenticado);
 * las rutas públicas se resuelven antes y nunca lo incluyen.
 */
export function GlobalScannerProvider({
  productRepository,
  activePage,
  onNavigate,
  children,
}: PropsWithChildren<{
  productRepository: ProductRepository;
  activePage: string;
  onNavigate: (page: string) => void;
}>) {
  const { businessId } = useBusinessContext();
  const page = useRef(activePage);
  const coordinator = useRef<ScanCoordinator | null>(null);
  const deps = {
    lookup: (barcode: string) =>
      scanBarcode(productRepository, businessId, barcode),
    navigate: (target: string) => {
      page.current = target;
      onNavigate(target);
    },
    activePage: () => page.current,
  };
  coordinator.current ??= new ScanCoordinator(deps);
  coordinator.current.deps = deps;
  const scanner = coordinator.current;

  useEffect(() => {
    page.current = activePage;
    scanner.pageChanged(activePage);
  }, [activePage, scanner]);

  useEffect(() => {
    const detector = new ScanDetector();
    let saved: FieldState | null = null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      const fed = detector.feed({
        key: event.key,
        time: event.timeStamp,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
      });
      if (fed.burstStart) saved = snapshotField(event.target);
      if (fed.swallow) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (fed.scan === null) return;
      const field = snapshotField(document.activeElement);
      if (saved) restoreField(saved);
      saved = null;
      const reason = scanBlockReason({
        modalOpen: document.querySelector('[aria-modal="true"]') !== null,
        editingField: field !== null && editingField(),
        altaActive: scanner.getState().alta !== null,
      });
      if (reason) scanner.notify(scanBlockMessages[reason]);
      else void scanner.enqueue(fed.scan);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [scanner]);

  return (
    <ScannerContext.Provider value={scanner}>
      <ScannerNotice />
      {children}
    </ScannerContext.Provider>
  );
}

function ScannerNotice() {
  const scanner = useScanCoordinator();
  const { notice } = useScanState();
  useEffect(() => {
    if (!notice || !scanner) return;
    const timer = setTimeout(() => scanner.dismissNotice(notice.id), 6000);
    return () => clearTimeout(timer);
  }, [notice, scanner]);
  if (!notice) return null;
  return (
    <Notice tone="alert" icon="info">
      {notice.text}
    </Notice>
  );
}

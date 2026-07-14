/**
 * Nonce-gated internal custom event bus (Y1).
 *
 * The presentflow custom-event bus (bible-next / bible-prev / voice-command,
 * etc.) was previously dispatchable by any script running in the page, which
 * meant an XSS or a browser extension could drive the projector. We now
 * require every dispatched event to carry a module-local nonce; handlers
 * verify it and drop anything else on the floor.
 *
 * The nonce is a JS Symbol created once per module instance — it cannot be
 * cloned across window/postMessage boundaries and is not enumerable in JSON.
 */

const INTERNAL_NONCE: symbol = Symbol("presentflow.internal-nonce.v1");

export type InternalEventDetail<T = unknown> = { nonce: symbol; payload?: T };

/** Dispatch an internal event with the module-local nonce attached. */
export function dispatchInternal<T = unknown>(name: string, payload?: T): void {
  if (typeof window === "undefined") return;
  try {
    const detail: InternalEventDetail<T> = { nonce: INTERNAL_NONCE, payload };
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch { /* ignore */ }
}

/** Type guard — true if the event carries our internal nonce. */
export function isInternalEvent(ev: Event): boolean {
  const detail = (ev as CustomEvent<InternalEventDetail>).detail;
  return !!detail && detail.nonce === INTERNAL_NONCE;
}

/** Extract the typed payload from an internal event, or undefined. */
export function internalPayload<T = unknown>(ev: Event): T | undefined {
  if (!isInternalEvent(ev)) return undefined;
  return (ev as CustomEvent<InternalEventDetail<T>>).detail.payload;
}

/** Test-only accessor — returns the module nonce so tests can dispatch valid events. */
export function __getInternalNonceForTest(): symbol { return INTERNAL_NONCE; }

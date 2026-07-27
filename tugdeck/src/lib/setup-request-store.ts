/**
 * setup-request-store — the on-demand channel into TugSetup ([L02]).
 *
 * TugSetup normally opens on its own terms: a first run, or an app that isn't
 * set up yet. The Tug-menu "Set Up Tug…" item is the other way in — the user
 * asking for the wizard on an app that is already set up. That request can't be a
 * prop (TugSetup is mounted once at the deck root with no parent to pass one)
 * and it isn't derivable from auth or the deck, so it lives here.
 *
 * Two pieces of state, because the request and the open wizard have different
 * lifetimes:
 *   - `nonce` — a monotonic "Set Up Tug… was invoked" signal. A nonce, not a
 *     boolean, so repeated invocations each fire with nothing to reset.
 *     `TugSetupRequest` watches it and runs the gate (confirm → interrupt).
 *   - `onDemand` — whether the wizard is currently open by request. TugSetup
 *     ORs it into its own `open` derivation and clears it on Done.
 *
 * @module lib/setup-request-store
 */

import { useSyncExternalStore } from "react";

class SetupRequestStore {
  private _nonce = 0;
  private _onDemand = false;
  private readonly _listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getNonce = (): number => this._nonce;

  getOnDemand = (): boolean => this._onDemand;

  request(): void {
    this._nonce += 1;
    this.emit();
  }

  setOnDemand(open: boolean): void {
    if (this._onDemand === open) return;
    this._onDemand = open;
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this._listeners]) listener();
  }
}

const setupRequestStore = new SetupRequestStore();

/** Request the setup wizard (from the Tug menu). Runs the gate first. */
export function requestSetup(): void {
  setupRequestStore.request();
}

/** Open the wizard on demand — called once the gate has cleared. */
export function openSetupOnDemand(): void {
  setupRequestStore.setOnDemand(true);
}

/** Close an on-demand wizard (the Done button). */
export function closeSetupOnDemand(): void {
  setupRequestStore.setOnDemand(false);
}

/** React read of the setup-request nonce ([L02]); changes on each request. */
export function useSetupRequest(): number {
  return useSyncExternalStore(
    setupRequestStore.subscribe,
    setupRequestStore.getNonce,
  );
}

/** React read of whether the wizard is open by request ([L02]). */
export function useSetupOnDemand(): boolean {
  return useSyncExternalStore(
    setupRequestStore.subscribe,
    setupRequestStore.getOnDemand,
  );
}

/**
 * `local-model-store.ts` — app-scoped snapshot of everything the deck knows
 * about on-device inference: which model the user picked, what tugcast has on
 * disk, how a download is going, and whether the host can answer right now.
 *
 * Three sources feed one snapshot. Configuration comes from the
 * `dev.tugtool.local-model` tugbank domain and re-derives on a DEFAULTS push,
 * so a flip anywhere is live everywhere. Inventory and download progress come
 * from tugcast's `local_model_*` CONTROL frames. Readiness comes from asking
 * the host directly, since only it knows what its backends can do.
 *
 * **Laws.** [L02] — all of it is external state and reaches React only through
 * `useSyncExternalStore` via {@link useLocalModel}; snapshots are frozen and
 * referentially stable between folds. [L24] — configuration lives in tugbank,
 * never in component state.
 *
 * **Degradation.** Every field has an answer that means "nothing installed,
 * carry on": no selection reads as `auto`, an empty inventory is normal, and
 * availability starts not-ready. A consumer that renders the idle snapshot
 * correctly needs no further failure handling.
 *
 * @module lib/local-model-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "../connection";
import { FeedId } from "../protocol";
import { getTugbankClient } from "./tugbank-singleton";
import {
  isLocalModelBridgeAvailable,
  requestAvailability,
  type LocalModelAvailability,
} from "./local-model-bridge";

/** Tugbank domain and keys — mirrored in `tugcast/src/local_model.rs`. */
export const LOCAL_MODEL_DOMAIN = "dev.tugtool.local-model";
export const MODEL_KEY = "model";
export const SHELL_ROUTING_KEY = "shell-routing";
export const PULSE_OVERVIEW_KEY = "pulse-overview";

/** `model` values with meaning beyond "a catalog id". */
export const MODEL_AUTO = "auto";
export const MODEL_DECLINED = "";

export type LocalModelState = "installed" | "downloading" | "available";

/** One catalog entry as tugcast reports it. */
export interface LocalModelEntry {
  id: string;
  displayName: string;
  recommended: boolean;
  /** Whether setup may surface this entry. Non-offered entries still work. */
  offered: boolean;
  notes: string;
  totalBytes: number;
  state: LocalModelState;
  receivedBytes: number | null;
}

/** Live progress for the download in flight, if any. */
export interface LocalModelDownload {
  model: string;
  file: string;
  fileIndex: number;
  fileCount: number;
  receivedBytes: number;
  totalBytes: number;
}

export interface LocalModelSnapshot {
  /** The `model` default: a catalog id, `auto`, or `""` when declined. */
  selection: string;
  shellRoutingEnabled: boolean;
  pulseOverviewEnabled: boolean;
  models: readonly LocalModelEntry[];
  download: LocalModelDownload | null;
  /** The last terminal download outcome, for surfacing an error. */
  lastError: string | null;
  availability: LocalModelAvailability;
}

const EMPTY_MODELS: readonly LocalModelEntry[] = Object.freeze([]);
const NOT_READY: LocalModelAvailability = Object.freeze({
  ready: false,
  reason: "not yet queried",
});

export const IDLE_LOCAL_MODEL_SNAPSHOT: LocalModelSnapshot = Object.freeze({
  selection: MODEL_AUTO,
  shellRoutingEnabled: true,
  pulseOverviewEnabled: true,
  models: EMPTY_MODELS,
  download: null,
  lastError: null,
  availability: NOT_READY,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Configuration reads — absent always means the permissive default.
// ---------------------------------------------------------------------------

/** The `model` default. Absent reads as `auto`, per Spec S06. */
export function readSelection(): string {
  const client = getTugbankClient();
  if (!client) return MODEL_AUTO;
  const entry = client.get(LOCAL_MODEL_DOMAIN, MODEL_KEY);
  if (entry === undefined || entry.kind !== "string") return MODEL_AUTO;
  return typeof entry.value === "string" ? entry.value : MODEL_AUTO;
}

/** A tenant kill switch. Absent — and any non-bool — reads as enabled. */
export function readTenantEnabled(key: string): boolean {
  const client = getTugbankClient();
  if (!client) return true;
  const entry = client.get(LOCAL_MODEL_DOMAIN, key);
  if (entry === undefined) return true;
  return entry.value !== false;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class LocalModelStore {
  private readonly conn: TugConnection;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void> = [];
  private readonly decoder = new TextDecoder();
  private snapshot: LocalModelSnapshot = IDLE_LOCAL_MODEL_SNAPSHOT;

  constructor(conn: TugConnection) {
    this.conn = conn;
    this.disposers.push(
      conn.onFrame(FeedId.CONTROL, (payload) => this.onControl(payload)),
    );

    const client = getTugbankClient();
    if (client) {
      this.disposers.push(
        client.onDomainChanged((domain) => {
          if (domain !== LOCAL_MODEL_DOMAIN) return;
          this.commit({ ...this.snapshot, ...this.readConfig() });
        }),
      );
    }

    this.snapshot = Object.freeze({ ...this.snapshot, ...this.readConfig() });
    this.conn.sendControlFrame("local_model_list");
    void this.refreshAvailability();

    // A model can arrive, or be deleted, while the window is in the
    // background — re-ask on the way back rather than trusting a stale yes.
    const onFocus = (): void => {
      void this.refreshAvailability();
    };
    globalThis.addEventListener?.("focus", onFocus);
    this.disposers.push(() => globalThis.removeEventListener?.("focus", onFocus));
  }

  /** Re-query the host. Cheap, and the only authority on readiness. */
  async refreshAvailability(): Promise<void> {
    if (!isLocalModelBridgeAvailable()) return;
    const availability = await requestAvailability();
    this.commit({ ...this.snapshot, availability });
  }

  private readConfig(): Pick<
    LocalModelSnapshot,
    "selection" | "shellRoutingEnabled" | "pulseOverviewEnabled"
  > {
    return {
      selection: readSelection(),
      shellRoutingEnabled: readTenantEnabled(SHELL_ROUTING_KEY),
      pulseOverviewEnabled: readTenantEnabled(PULSE_OVERVIEW_KEY),
    };
  }

  private onControl(payload: Uint8Array): void {
    let body: unknown;
    try {
      body = JSON.parse(this.decoder.decode(payload));
    } catch {
      return;
    }
    if (!isRecord(body) || typeof body.action !== "string") return;

    switch (body.action) {
      case "local_model_inventory": {
        const raw = Array.isArray(body.models) ? body.models : [];
        const models = raw.filter(isRecord).map((entry) =>
          Object.freeze({
            id: str(entry.id),
            displayName: str(entry.displayName),
            recommended: entry.recommended === true,
            offered: entry.offered === true,
            notes: str(entry.notes),
            totalBytes: num(entry.totalBytes),
            state: str(entry.state, "available") as LocalModelState,
            receivedBytes:
              typeof entry.receivedBytes === "number" ? entry.receivedBytes : null,
          }),
        );
        // An inventory naming nothing as downloading is the authority that
        // the download ended, whether or not the result frame was seen.
        const stillDownloading = models.some((m) => m.state === "downloading");
        this.commit({
          ...this.snapshot,
          models: Object.freeze(models),
          download: stillDownloading ? this.snapshot.download : null,
        });
        return;
      }
      case "local_model_download_progress": {
        this.commit({
          ...this.snapshot,
          download: Object.freeze({
            model: str(body.model),
            file: str(body.file),
            fileIndex: num(body.fileIndex),
            fileCount: num(body.fileCount),
            receivedBytes: num(body.receivedBytes),
            totalBytes: num(body.totalBytes),
          }),
        });
        return;
      }
      case "local_model_download_result": {
        const ok = body.ok === true;
        this.commit({
          ...this.snapshot,
          download: null,
          lastError: ok ? null : str(body.error, "download failed"),
        });
        // A finished download changes what the host can do.
        void this.refreshAvailability();
        return;
      }
      default:
        return;
    }
  }

  /** Ask tugcast to acquire a model. Progress arrives on CONTROL. */
  download(modelId: string): void {
    this.commit({ ...this.snapshot, lastError: null });
    this.conn.sendControlFrame("local_model_download", { model: modelId });
  }

  cancelDownload(): void {
    this.conn.sendControlFrame("local_model_download_cancel");
  }

  delete(modelId: string): void {
    this.conn.sendControlFrame("local_model_delete", { model: modelId });
  }

  private commit(next: LocalModelSnapshot): void {
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }

  getSnapshot = (): LocalModelSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    for (const fn of this.disposers) fn();
    this.disposers.length = 0;
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton + hooks
// ---------------------------------------------------------------------------

let _activeStore: LocalModelStore | null = null;

export function attachLocalModelStore(conn: TugConnection): LocalModelStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new LocalModelStore(conn);
  return _activeStore;
}

export function getLocalModelStore(): LocalModelStore | null {
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetLocalModelStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/** The whole snapshot. Returns the idle one when nothing is attached. */
export function useLocalModel(): LocalModelSnapshot {
  return useSyncExternalStore(
    (listener) => _activeStore?.subscribe(listener) ?? (() => {}),
    () => _activeStore?.getSnapshot() ?? IDLE_LOCAL_MODEL_SNAPSHOT,
    () => IDLE_LOCAL_MODEL_SNAPSHOT,
  );
}

/**
 * Whether a given tenant should use the model right now: its kill switch is
 * on AND the host says it can answer. A narrow boolean selector, so a
 * subscriber re-renders on readiness changes rather than on download progress.
 */
export function useLocalModelReady(tenant: "shell-routing" | "pulse-overview"): boolean {
  const readyFor = (snapshot: LocalModelSnapshot): boolean => {
    if (!snapshot.availability.ready) return false;
    return tenant === "shell-routing"
      ? snapshot.shellRoutingEnabled
      : snapshot.pulseOverviewEnabled;
  };
  return useSyncExternalStore(
    (listener) => _activeStore?.subscribe(listener) ?? (() => {}),
    () => (_activeStore === null ? false : readyFor(_activeStore.getSnapshot())),
    () => false,
  );
}

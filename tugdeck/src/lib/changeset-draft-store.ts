/**
 * Changeset draft overlay store — the live presentation layer over the
 * maintained-draft engine's CONTROL frames (Spec S10, [P24]).
 *
 * The persisted draft rides the aggregate snapshot (`entry.draft`), which is
 * the source of truth. While the engine is regenerating, it broadcasts
 * `changeset_draft_state` (drafting → ready/error) and `changeset_draft_delta`
 * (accumulated text) frames so a visible card fills in live. This store keys
 * those by `(project_dir, owner_kind, owner_id)` and exposes them to the card
 * via `useSyncExternalStore` ([L02]); the streaming text is a nicety over the
 * persisted message, never a replacement.
 *
 * Attached once at boot with {@link attachChangesetDraftStore}; consumed via
 * {@link useChangesetDraft}.
 *
 * @module lib/changeset-draft-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "../connection";
import type { ChangesetDraftSelection } from "./changeset-types";
import { FeedId } from "../protocol";

export type DraftOverlayPhase = "idle" | "drafting" | "ready" | "error";

/** The live overlay for one entry's draft regeneration. */
export interface DraftOverlay {
  phase: DraftOverlayPhase;
  /** Accumulated streamed text of the in-flight generation; "" until deltas. */
  text: string;
  /** Error detail when `phase === "error"`. */
  detail: string | null;
}

const IDLE: DraftOverlay = Object.freeze({ phase: "idle", text: "", detail: null });

function overlayKey(projectDir: string, ownerKind: string, ownerId: string): string {
  return `${projectDir}|${ownerKind}|${ownerId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class ChangesetDraftStore {
  private readonly _connection: TugConnection;
  private readonly _unsubscribe: () => void;
  private readonly _listeners = new Set<() => void>();
  private _overlays = new Map<string, DraftOverlay>();
  private readonly _decoder = new TextDecoder();

  constructor(connection: TugConnection) {
    this._connection = connection;
    this._unsubscribe = connection.onFrame(FeedId.CONTROL, (payload) =>
      this._onControl(payload),
    );
  }

  /**
   * Request an on-demand draft for one entry ([P05], Spec S01). Fires the
   * `changeset_draft_request` CONTROL verb; the reply rides the existing
   * `changeset_draft_state`/`changeset_draft_delta` stream this store already
   * consumes. `force` is the confirmed Regenerate — the only path that
   * overwrites an edited draft ([P03]); a non-forced request on an edited
   * draft replies `ready` without a scribe call.
   */
  requestDraft(
    projectDir: string,
    ownerKind: string,
    ownerId: string,
    force = false,
  ): void {
    this._connection.sendControlFrame("changeset_draft_request", {
      project_dir: projectDir,
      owner_kind: ownerKind,
      owner_id: ownerId,
      force,
    });
  }

  /**
   * Cancel an in-flight Auto-Message generation for one entry ([P06]). Fires
   * the `changeset_draft_cancel` CONTROL verb; the backend aborts only that
   * draft's headless scribe child (never the session's turn) and replies a
   * terminal `cancelled` `changeset_draft_state`, which this store folds back
   * to the idle overlay.
   */
  cancelDraft(projectDir: string, ownerKind: string, ownerId: string): void {
    this._connection.sendControlFrame("changeset_draft_cancel", {
      project_dir: projectDir,
      owner_kind: ownerKind,
      owner_id: ownerId,
    });
  }

  /**
   * Partially upsert one entry's persisted draft ([P02], Spec S01): the
   * composer's debounced message edits (`edited: true` — the [P03] pin
   * rides the write), immediate selection-disposition writes, and the
   * post-landing `clear`. Absent fields leave the stored value untouched;
   * `selection: null` clears the overrides.
   */
  setDraft(
    projectDir: string,
    ownerKind: string,
    ownerId: string,
    fields: {
      message?: string;
      selection?: ChangesetDraftSelection | null;
      edited?: boolean;
      clear?: boolean;
    },
  ): void {
    this._connection.sendControlFrame("changeset_draft_set", {
      project_dir: projectDir,
      owner_kind: ownerKind,
      owner_id: ownerId,
      ...(fields.message !== undefined ? { message: fields.message } : {}),
      ...(fields.selection !== undefined ? { selection: fields.selection } : {}),
      edited: fields.edited === true,
      ...(fields.clear === true ? { clear: true } : {}),
    });
  }

  private _onControl(payload: Uint8Array): void {
    let body: unknown;
    try {
      body = JSON.parse(this._decoder.decode(payload));
    } catch {
      return;
    }
    if (!isRecord(body) || typeof body.action !== "string") return;
    const action = body.action;
    if (action !== "changeset_draft_state" && action !== "changeset_draft_delta") return;
    const projectDir = typeof body.project_dir === "string" ? body.project_dir : null;
    const ownerKind = typeof body.owner_kind === "string" ? body.owner_kind : null;
    const ownerId = typeof body.owner_id === "string" ? body.owner_id : "";
    if (projectDir === null || ownerKind === null) return;
    const key = overlayKey(projectDir, ownerKind, ownerId);

    if (action === "changeset_draft_delta") {
      const text = typeof body.text === "string" ? body.text : "";
      const prev = this._overlays.get(key);
      this._set(key, { phase: "drafting", text, detail: prev?.detail ?? null });
      return;
    }
    // changeset_draft_state
    const state = typeof body.state === "string" ? body.state : "";
    const prev = this._overlays.get(key);
    if (state === "drafting") {
      // A fresh generation — reset the streamed text.
      this._set(key, { phase: "drafting", text: "", detail: null });
    } else if (state === "ready") {
      this._set(key, { phase: "ready", text: prev?.text ?? "", detail: null });
    } else if (state === "error") {
      const detail = typeof body.detail === "string" ? body.detail : "draft failed";
      this._set(key, { phase: "error", text: prev?.text ?? "", detail });
    } else if (state === "cancelled") {
      // A user cancel ([P06]): the generation was aborted mid-stream. Fold
      // straight back to idle — the composer reverts to its persisted message
      // (no partial draft is kept).
      this._set(key, IDLE);
    }
  }

  private _set(key: string, overlay: DraftOverlay): void {
    this._overlays.set(key, overlay);
    for (const listener of [...this._listeners]) listener();
  }

  overlay(projectDir: string, ownerKind: string, ownerId: string): DraftOverlay {
    return this._overlays.get(overlayKey(projectDir, ownerKind, ownerId)) ?? IDLE;
  }

  dispose(): void {
    this._unsubscribe();
    this._listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };
}

let _activeStore: ChangesetDraftStore | null = null;

export function attachChangesetDraftStore(conn: TugConnection): ChangesetDraftStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new ChangesetDraftStore(conn);
  return _activeStore;
}

/**
 * The attached draft store singleton, or null before boot / in fixtures.
 * Mirrors `getChangesetVerbStore` — the imperative peer of the
 * `useChangesetDraft` hook, for non-React callers (the
 * `ChangesRouteController`).
 */
export function getChangesetDraftStore(): ChangesetDraftStore | null {
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetChangesetDraftStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/** Test-only: feed a CONTROL frame body as if it arrived over the wire. */
export function _ingestDraftFrameForTest(body: unknown): void {
  if (_activeStore === null) return;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  // Reach the private handler through the same path onFrame would.
  (_activeStore as unknown as { _onControl(p: Uint8Array): void })._onControl(bytes);
}

/**
 * React hook: the live draft overlay for one entry plus its bound on-demand
 * trigger ([P05]). Returns the idle overlay + a no-op `requestDraft` when no
 * store is attached (gallery / fixtures).
 */
export function useChangesetDraft(
  projectDir: string,
  ownerKind: string,
  ownerId: string,
): DraftOverlay & { requestDraft: () => void } {
  const overlay = useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.overlay(projectDir, ownerKind, ownerId) ?? IDLE,
    () => IDLE,
  );
  const requestDraft = (): void => {
    _activeStore?.requestDraft(projectDir, ownerKind, ownerId);
  };
  return { ...overlay, requestDraft };
}

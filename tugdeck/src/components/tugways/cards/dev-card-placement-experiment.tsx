/**
 * dev-card-placement-experiment.tsx — dev-only A/B harness for the
 * tide card's display-only placement zones (Z0, Z1-assistant, Z2, Z3,
 * Z4B). Lets us answer "which datum reads best in which zone" without
 * an HMR loop per swap.
 *
 * The placement mapping ({ zone → datum }) persists through tugbank
 * (per the project policy: no `localStorage` / `sessionStorage` /
 * `IndexedDB`). HMR reloads preserve the experiment state because the
 * mapping survives in the tugbank cache; a hard reload re-reads it
 * from the server-pushed DEFAULTS frame.
 *
 * Control surface — a window-global exposed in dev builds only:
 *
 *   ```js
 *   window.tugTidePlacement.set({ Z2: "window", Z4B: "phase" })
 *   window.tugTidePlacement.set({ Z1: "perTurnDuration" })
 *   window.tugTidePlacement.clear()                  // wipe to empty defaults
 *   window.tugTidePlacement.get()                    // read current mapping
 *   window.tugTidePlacement.datums                   // list available datums
 *   window.tugTidePlacement.zones                    // list configurable zones
 *   ```
 *
 * The shim is gated by `import.meta.env.DEV`; production bundles
 * strip the entire branch through Vite constant folding so neither
 * the global nor the harness ship.
 *
 * Conformance:
 *  - [L02] `useTidePlacementSlots` subscribes to the tugbank-backed
 *    store via `useTugbankValue`; no React-state mirror.
 *  - [L06] Slot content is React nodes computed from the mapping. The
 *    renderer components themselves (in `dev-card-telemetry-renderers`)
 *    own all DOM. No appearance state in React beyond the slot node
 *    identity.
 *
 * @module components/tugways/cards/dev-card-placement-experiment
 */

import React, { useCallback, useMemo } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import type { TaggedValue } from "@/lib/tugbank-client";
import { useTugbankValue } from "@/lib/use-tugbank-value";

import {
  TideTelemetryCumulativeActiveMs,
  TideTelemetryCumulativeTokens,
  TideTelemetryPerTurnCost,
  TideTelemetryPerTurnDuration,
  TideTelemetryPerTurnTtft,
  TideTelemetryPhase,
  TideTelemetryStatusRow,
  TideTelemetryWindowUtilization,
} from "./dev-card-telemetry-renderers";
import type { ScrollToRowHandler } from "./dev-card-telemetry-popovers";
import type {
  TideTurnTrailingContext,
  TideTurnTrailingRenderer,
} from "./dev-card";

// ---------------------------------------------------------------------------
// Datums + zones
// ---------------------------------------------------------------------------

/** Session-scoped datums — eligible for zones Z0 / Z2 / Z3 / Z4B. */
export type SessionDatum =
  | "window"
  | "tokens"
  | "active"
  | "phase"
  | "statusRow";

/** Per-turn datums — eligible for zone Z1 (assistant half only). */
export type TurnDatum =
  | "perTurnDuration"
  | "perTurnCost"
  | "perTurnTtft";

const SESSION_DATUMS: ReadonlyArray<SessionDatum> = [
  "window",
  "tokens",
  "active",
  "phase",
  "statusRow",
];

const TURN_DATUMS: ReadonlyArray<TurnDatum> = [
  "perTurnDuration",
  "perTurnCost",
  "perTurnTtft",
];

/**
 * Mapping serialized into tugbank as a `kind:"json"` value. Each
 * field defaults to `null` (empty slot). `Z0` is reserved by the
 * placement contract — it's settable for completeness, but the
 * default content stays empty until a card-level metadata story
 * arrives.
 */
export interface PlacementMap {
  Z0?: SessionDatum | null;
  Z2?: SessionDatum | null;
  Z3?: SessionDatum | null;
  Z4B?: SessionDatum | null;
  Z1?: TurnDatum | null;
}

/**
 * Empty placement mapping — every zone unset. Exported for tests
 * that need a stable "no mapping" baseline.
 */
export const EMPTY_PLACEMENT_MAP: PlacementMap = Object.freeze({
  Z0: null,
  Z2: null,
  Z3: null,
  Z4B: null,
  Z1: null,
});

export const PLACEMENT_EXPERIMENT_DOMAIN =
  "dev.tugtool.tide.placement-experiment";
export const PLACEMENT_EXPERIMENT_KEY = "mapping";

// ---------------------------------------------------------------------------
// Tugbank persistence
// ---------------------------------------------------------------------------

function isSessionDatum(v: unknown): v is SessionDatum {
  return (
    v === "window" ||
    v === "tokens" ||
    v === "active" ||
    v === "phase" ||
    v === "statusRow"
  );
}

function isTurnDatum(v: unknown): v is TurnDatum {
  return (
    v === "perTurnDuration" ||
    v === "perTurnCost" ||
    v === "perTurnTtft"
  );
}

export function parsePlacementEntry(entry: TaggedValue | undefined): PlacementMap {
  if (entry === undefined) return EMPTY_PLACEMENT_MAP;
  const value = entry.value;
  if (value === null || typeof value !== "object") return EMPTY_PLACEMENT_MAP;
  const r = value as Record<string, unknown>;
  return {
    Z0: isSessionDatum(r.Z0) ? r.Z0 : null,
    Z2: isSessionDatum(r.Z2) ? r.Z2 : null,
    Z3: isSessionDatum(r.Z3) ? r.Z3 : null,
    Z4B: isSessionDatum(r.Z4B) ? r.Z4B : null,
    Z1: isTurnDatum(r.Z1) ? r.Z1 : null,
  };
}

function writePlacement(next: PlacementMap): void {
  const tagged: TaggedValue = { kind: "json", value: next };
  const client = getTugbankClient();
  if (client && typeof client.setLocalValue === "function") {
    client.setLocalValue(PLACEMENT_EXPERIMENT_DOMAIN, PLACEMENT_EXPERIMENT_KEY, tagged);
  }
  fetch(
    `/api/defaults/${PLACEMENT_EXPERIMENT_DOMAIN}/${encodeURIComponent(PLACEMENT_EXPERIMENT_KEY)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tagged),
    },
  ).catch((err) => {
    console.warn(`[dev-placement-experiment] PUT failed:`, err);
  });
}

function readPlacementSync(): PlacementMap {
  const client = getTugbankClient();
  if (!client) return EMPTY_PLACEMENT_MAP;
  return parsePlacementEntry(client.get(PLACEMENT_EXPERIMENT_DOMAIN, PLACEMENT_EXPERIMENT_KEY));
}

// ---------------------------------------------------------------------------
// Slot resolution
// ---------------------------------------------------------------------------

export interface TideCardPlacementSlots {
  headerContent?: React.ReactNode;
  statusBarContent?: React.ReactNode;
  promptStatusContent?: React.ReactNode;
  promptIndicatorsContent?: React.ReactNode;
  renderTurnTrailing?: TideTurnTrailingRenderer;
}

export interface UseTidePlacementSlotsInput {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Forwarded to {@link TideTelemetryStatusRow} when it occupies Z2 —
   * lets the status row's Time / Tokens popovers scroll the transcript
   * on a `#NNNN` entry-number click. The tide card supplies it from
   * the transcript's imperative handle.
   */
  onScrollToRow?: ScrollToRowHandler;
}

/**
 * Resolve the current placement mapping into ReactNode slots for the
 * tide card. Returns empty slots in production builds (or whenever
 * the mapping is empty in dev).
 *
 * Z0 is reserved by the placement contract — even when set in the
 * mapping, the resolver leaves the header slot empty by default to
 * preserve the contract until card-level metadata lands as content.
 * Override the gate by setting `Z0` to a session datum explicitly;
 * the harness honors the mapping but the production default keeps
 * the slot quiet.
 */
export function useTidePlacementSlots(
  input: UseTidePlacementSlotsInput,
): TideCardPlacementSlots {
  const mapping = useTugbankValue<PlacementMap>(
    PLACEMENT_EXPERIMENT_DOMAIN,
    PLACEMENT_EXPERIMENT_KEY,
    parsePlacementEntry,
    EMPTY_PLACEMENT_MAP,
  );

  const { codeSessionStore, sessionMetadataStore, onScrollToRow } = input;

  // Effective Z2 — explicit mapping wins, but a null / unset value
  // falls back to `statusRow` (the Step 20.4 HMR-study outcome).
  // The placement-experiment console controls still work normally;
  // setting Z2 to a different datum overrides this default.
  const effectiveZ2: SessionDatum | null =
    mapping.Z2 ?? "statusRow";

  const sessionNode = useCallback(
    (datum: SessionDatum | null | undefined): React.ReactNode => {
      if (datum === null || datum === undefined) return null;
      switch (datum) {
        case "window":
          return (
            <TideTelemetryWindowUtilization
              codeSessionStore={codeSessionStore}
              sessionMetadataStore={sessionMetadataStore}
            />
          );
        case "tokens":
          return (
            <TideTelemetryCumulativeTokens
              codeSessionStore={codeSessionStore}
            />
          );
        case "active":
          return (
            <TideTelemetryCumulativeActiveMs
              codeSessionStore={codeSessionStore}
            />
          );
        case "phase":
          return <TideTelemetryPhase codeSessionStore={codeSessionStore} />;
        case "statusRow":
          return (
            <TideTelemetryStatusRow
              codeSessionStore={codeSessionStore}
              sessionMetadataStore={sessionMetadataStore}
              onScrollToRow={onScrollToRow}
            />
          );
      }
    },
    [codeSessionStore, sessionMetadataStore, onScrollToRow],
  );

  const renderTurnTrailing = useMemo<TideTurnTrailingRenderer | undefined>(
    () => {
      const datum = mapping.Z1;
      if (datum === null || datum === undefined) return undefined;
      return (ctx: TideTurnTrailingContext): React.ReactNode => {
        if (ctx.half !== "assistant" || ctx.turn === undefined) return null;
        switch (datum) {
          case "perTurnDuration":
            return <TideTelemetryPerTurnDuration turn={ctx.turn} />;
          case "perTurnCost":
            return <TideTelemetryPerTurnCost turn={ctx.turn} />;
          case "perTurnTtft":
            return <TideTelemetryPerTurnTtft turn={ctx.turn} />;
        }
      };
    },
    [mapping.Z1],
  );

  return {
    headerContent: sessionNode(mapping.Z0),
    statusBarContent: sessionNode(effectiveZ2),
    promptStatusContent: sessionNode(mapping.Z3),
    promptIndicatorsContent: sessionNode(mapping.Z4B),
    renderTurnTrailing,
  };
}

// ---------------------------------------------------------------------------
// Dev-only window-global control surface
// ---------------------------------------------------------------------------

/**
 * Window-global API exposed in dev builds only. Driven manually from
 * the browser console during the HMR study; production bundles strip
 * the entire installer through Vite's `import.meta.env.DEV` constant
 * folding so nothing related to it ships.
 */
export interface TideTidePlacementGlobal {
  /** Read the current mapping (live snapshot, no subscription). */
  get(): PlacementMap;
  /** Merge a partial mapping into the current state. */
  set(patch: Partial<PlacementMap>): PlacementMap;
  /** Reset every zone to empty. */
  clear(): PlacementMap;
  /** Catalog of available session-scoped datums. */
  readonly datums: {
    session: ReadonlyArray<SessionDatum>;
    turn: ReadonlyArray<TurnDatum>;
  };
  /** Catalog of configurable zones. */
  readonly zones: ReadonlyArray<"Z0" | "Z1" | "Z2" | "Z3" | "Z4B">;
}

interface WindowWithPlacement {
  tugTidePlacement?: TideTidePlacementGlobal;
}

/**
 * Install the dev-only `window.tugTidePlacement` shim. Idempotent —
 * the second call no-ops. Call once from `main.tsx` inside an
 * `import.meta.env.DEV` guard.
 */
export function installTidePlacementGlobal(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as WindowWithPlacement;
  if (w.tugTidePlacement !== undefined) return;
  const api: TideTidePlacementGlobal = {
    get(): PlacementMap {
      return readPlacementSync();
    },
    set(patch: Partial<PlacementMap>): PlacementMap {
      const current = readPlacementSync();
      const next: PlacementMap = { ...current, ...patch };
      writePlacement(next);
      return next;
    },
    clear(): PlacementMap {
      writePlacement(EMPTY_PLACEMENT_MAP);
      return EMPTY_PLACEMENT_MAP;
    },
    datums: { session: SESSION_DATUMS, turn: TURN_DATUMS },
    zones: ["Z0", "Z1", "Z2", "Z3", "Z4B"],
  };
  w.tugTidePlacement = api;
}

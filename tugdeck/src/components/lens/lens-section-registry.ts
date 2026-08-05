/**
 * lens-section-registry.ts — the Lens section contract + registry.
 *
 * A section is one reorderable/collapsible unit in the Lens stack. Its
 * definition separates a **band descriptor** (`kind`, `title`, `glyph`,
 * and the REQUIRED `collapsedSummary` factory — the hallmark that makes
 * a stack of sections beat a tab bar) from a **host-agnostic body**: the
 * body imports nothing from `lens/`; everything it needs arrives via the
 * `host` argument. That keeps a section renderable as its own deck card
 * in the future without reaching into panel internals ([P07]).
 *
 * @module components/lens/lens-section-registry
 */

import type React from "react";

/**
 * What a section body receives from the Lens. Minimal by design — no
 * panel internals leak through ([P07]).
 */
export interface LensSectionHost {
  /** The Lens card's id (the registered `"lens"` singleton). */
  lensCardId: string;
  /** The FocusManager group this section's focusables belong to. */
  focusGroup: string;
}

/**
 * A registered Lens section. `collapsedSummary` is REQUIRED — a
 * collapsed section is a one-line live summary, never a dead title.
 */
export interface LensSectionDefinition {
  /** Stable id, e.g. "log", "telemetry". */
  kind: string;
  /** Human-facing band title. */
  title: string;
  /** Band glyph. */
  glyph: React.ReactNode;
  /**
   * REQUIRED live one-line summary shown in the band when the section is
   * collapsed. Subscribes to the same store the body reads.
   */
  collapsedSummary: (host: LensSectionHost) => React.ReactNode;
  /** The section body. Host-agnostic — imports nothing from `lens/`. */
  body: (host: LensSectionHost) => React.ReactNode;
  /**
   * Optional right-aligned controls contributed to the band's actions
   * cluster, LEFT of the fold-cue chevron ([P06]) — the registry-driven
   * equivalent of the transcript's body-kind actions portal. Sessions
   * supplies Expand-all / Collapse-all; the other sections supply none
   * (chevron only).
   */
  headerActions?: (host: LensSectionHost) => React.ReactNode;
  /**
   * Whether the band carries a `TugFilterField` that trims this section's list.
   * The band owns the field and writes `lens-filter-store`; the body reads the
   * query back and passes it into its data source. A section whose list can
   * grow without bound opts in; a fixed-size section leaves it off.
   */
  filterable?: boolean;
  /**
   * The focus orders this section's BODY puts in the walk, top to bottom.
   * Defaults to `[0]` — one stop, the list, which is what nearly every section
   * is. A body that stacks more than one navigable control declares them all
   * (Layouts has two radio groups), because the Lens's arrow plane is built out
   * of rows and a body that is two rows tall must say so or its second control
   * is only reachable by Tab.
   */
  bodyFocusOrders?: readonly number[];

  // Reserved capability hooks — declared, not implemented ([P07]).
  findSegments?: unknown;
  followBottom?: unknown;
  responderNeeds?: unknown;
}

/** Module-level registry, keyed by `kind`. Insertion order is the
 *  default (registration) order for sections the store has never
 *  ordered. */
const registry = new Map<string, LensSectionDefinition>();

/**
 * Register a Lens section. A duplicate `kind` overwrites and warns
 * (mirrors `registerCard`).
 */
export function registerLensSection(def: LensSectionDefinition): void {
  if (registry.has(def.kind)) {
    console.warn(
      `[lens-section-registry] Duplicate registration for kind "${def.kind}". Overwriting.`,
    );
  }
  registry.set(def.kind, def);
}

/** All registered sections, keyed by `kind`, in registration order. */
export function getRegisteredLensSections(): ReadonlyMap<
  string,
  LensSectionDefinition
> {
  return registry;
}

/**
 * Resolve the section render order (pure): start from the persisted
 * `sectionOrder` (keeping only kinds that are actually registered), then
 * append any registered-but-unordered kinds in their registration order.
 * Every registered section renders — the Lens has no hidden sections.
 * Unknown persisted kinds are ignored — the persisted list tolerates
 * removed section kinds without crashing ([P03]).
 */
export function resolveSectionRenderOrder(
  registeredKinds: readonly string[],
  sectionOrder: readonly string[],
): string[] {
  const registered = new Set(registeredKinds);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const kind of sectionOrder) {
    if (!registered.has(kind) || seen.has(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }
  for (const kind of registeredKinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }
  return out;
}

/**
 * Move the item at `from` to index `to` in a copy of `arr` (pure). Used
 * by drag-reorder to compute the new section order. Out-of-range indices
 * are clamped; the input is never mutated.
 */
export function moveInArray<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const clampedTo = Math.max(0, Math.min(to, out.length - 1));
  const [item] = out.splice(from, 1);
  out.splice(clampedTo, 0, item);
  return out;
}

/** The FocusManager group name for a section's focusables. */
export function sectionFocusGroup(kind: string): string {
  return `lens-section-${kind}`;
}

/**
 * The band's stops, ordered ahead of the body's list (which is `0`) so the walk
 * runs down the section the way the eye does: the band itself, then its actions
 * cluster left-to-right, then the rows. Fractional orders keep the cluster
 * between the filter field and the list without renumbering either.
 *
 * The band being a stop at all is what puts a section's fold within reach of the
 * keyboard: arrow onto the band, arrow on to its chevron, Space. A collapsed
 * section renders no body and no filter, so its band and chevron are the only
 * stops it has — which is exactly enough to open it again.
 */
export const LENS_BAND_FOCUS_ORDER = -2;
/** The band's filter field, when the section is filterable. */
export const LENS_BAND_FILTER_FOCUS_ORDER = -1;
/** A section's contributed header controls, left of the fold chevron. */
export const LENS_BAND_ACTION_FOCUS_ORDER = -0.75;
/** The fold chevron — the band's last stop, at its right edge. */
export const LENS_BAND_FOLD_FOCUS_ORDER = -0.5;

/**
 * Test seam — clear the registry so a test starts from a known state.
 * @internal
 */
export function _clearLensSectionsForTest(): void {
  registry.clear();
}

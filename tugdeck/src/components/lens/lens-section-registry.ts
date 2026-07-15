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
 * Resolve the visible section render order (pure): start from the
 * persisted `sectionOrder` (keeping only kinds that are actually
 * registered), append any registered-but-unordered kinds in their
 * registration order, then drop the hidden kinds. Unknown persisted
 * kinds are ignored — the persisted lists tolerate removed section
 * kinds without crashing ([P03]).
 */
export function resolveSectionRenderOrder(
  registeredKinds: readonly string[],
  sectionOrder: readonly string[],
  hiddenSections: readonly string[],
): string[] {
  const registered = new Set(registeredKinds);
  const hidden = new Set(hiddenSections);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const kind of sectionOrder) {
    if (!registered.has(kind) || seen.has(kind)) continue;
    seen.add(kind);
    if (!hidden.has(kind)) out.push(kind);
  }
  for (const kind of registeredKinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    if (!hidden.has(kind)) out.push(kind);
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
 * Test seam — clear the registry so a test starts from a known state.
 * @internal
 */
export function _clearLensSectionsForTest(): void {
  registry.clear();
}

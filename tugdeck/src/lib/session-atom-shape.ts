/**
 * session-atom-shape.ts — what a session atom's `type` and `value` are made of.
 *
 * A leaf: no imports, so the two chip renderers, the clipboard writer, and the
 * transcript walkers can all read the same rules without any of them importing
 * each other. `session-atom.ts` re-exports the whole surface, so a caller that
 * already speaks to that module keeps its one import.
 *
 * @module lib/session-atom-shape
 */

/** The atom `type` a session reference wears. */
export const SESSION_ATOM_TYPE = "session";

/** Whether an atom segment's `type` names a session. */
export function isSessionAtomType(type: string): boolean {
  return type === SESSION_ATOM_TYPE;
}

/**
 * The callsign inside a session atom's value — `quirky-hull` out of
 * `tugtool/quirky-hull`.
 *
 * The callsign is what the atom **displays** (Spec S05's title grammar carries
 * no project prefix) and what it **resolves through**: the ledger answers a
 * callsign on `resolve_sessions`, which is how a chip holding no id reaches one
 * and so shows a live dot. The `project/` run stays in the value, the tooltip,
 * the citation, and the wire marker.
 *
 * Pure. A value with no `/` is already a callsign and returns unchanged.
 */
export function sessionAtomCallsign(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

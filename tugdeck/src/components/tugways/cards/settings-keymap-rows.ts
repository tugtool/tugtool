/**
 * settings-keymap-rows.ts — the Keyboard pane's row model.
 *
 * A pure projection from the command registry, the keymap registry, and the
 * override store into the rows the pane renders. Pure on purpose: every
 * interesting question the pane answers — which chord is live, which one is
 * shadowed and by what, which rows the user may change — is a question about
 * data, and keeping it out of the component is what lets those answers be
 * tested without mounting anything.
 *
 * Grouping is by the menu a command's item lives in, read off the item
 * identifier's namespace (`file.save` → File). The frontend does not hold the
 * host's menu tree, but the identifier prefix is the same fact spelled where
 * this side can see it, and a command with no menu item groups under "Other
 * Commands" — which is the honest name for it, since those are exactly the
 * commands the menu bar does not show.
 *
 * @module components/tugways/cards/settings-keymap-rows
 */

import type { CommandBinding, CommandEntry } from "../command-registry";
import { COMMANDS, isCommandLocked } from "../command-registry";
import { formatChord } from "../chord-format";
import type { KeymapRegistry, ResolutionLayer } from "../keymap-registry";
import { keymapRegistry } from "../keymap-registry";

/** One of a command's chords, with whether pressing it reaches the command. */
export interface KeymapRowBinding {
  readonly binding: CommandBinding;
  /** The rendered chord — the one renderer, never a second spelling. */
  readonly label: string;
  /** Pressing this fires this command. */
  readonly active: boolean;
  /** What takes the chord instead. Absent on a live binding. */
  readonly shadowedBy?: { readonly commandId: string; readonly layer: ResolutionLayer };
  /**
   * The binding is live only inside a responder or a focus mode. Shown with
   * its scope named and not rebindable here ([Q03]) — a scoped default lives
   * in a component's render, so an override would have to be reconciled at
   * registration time, and that machinery waits until it is wanted.
   */
  readonly scoped: boolean;
}

export interface KeymapRow {
  readonly commandId: string;
  readonly title: string;
  /** The menu this command lives in, or `"Other Commands"`. */
  readonly group: string;
  readonly menuItemId?: string;
  /** Policy says this one is not the user's to change ([P12]). */
  readonly locked: boolean;
  /** The user has given this command a keyboard of its own. */
  readonly overridden: boolean;
  /** Every binding, in the order the command declares them. */
  readonly bindings: readonly KeymapRowBinding[];
}

/** Menu-identifier namespace → the menu's name, as the menu bar spells it. */
const GROUP_TITLES: Readonly<Record<string, string>> = {
  app: "Tug",
  file: "File",
  edit: "Edit",
  session: "Session",
  view: "View",
  window: "Window",
  maker: "Maker",
  help: "Help",
};

/** The catch-all: commands that are real and reachable, but not on a menu. */
export const UNGROUPED = "Other Commands";

/** Which group a command's row belongs to. */
export function groupForEntry(entry: CommandEntry): string {
  if (entry.menuItemId === undefined) return UNGROUPED;
  const namespace = entry.menuItemId.split(".")[0];
  return GROUP_TITLES[namespace] ?? UNGROUPED;
}

/** Group ordering — the menu bar's, then the commands that are on no menu. */
export const GROUP_ORDER: readonly string[] = [
  ...Object.values(GROUP_TITLES),
  UNGROUPED,
];

/**
 * Whether a row belongs in the pane at all.
 *
 * Parameterized families are out ([P05]): their payloads are discovered at
 * runtime, so there is no fixed row to rebind — "Theme" is not a command, it
 * is however many themes are on disk. `internal` entries are out too: they
 * exist so the command has a name, but their own comments say no door leads
 * anywhere yet, and a pane that offered a chord for a command nothing
 * performs would be recording dead keystrokes. Everything else is in,
 * including the `native` rows: Quit and Hide are commands the user can look
 * up even though the mechanism will refuse to move them, and a keyboard pane
 * that hid them would be answering "what does ⌘Q do" with silence.
 */
function isListedEntry(entry: CommandEntry): boolean {
  return entry.parameterized !== true && entry.internal !== true;
}

/**
 * Does this row match a query? Title and chord both, because a person
 * arrives at this pane from either end — "what is Save As bound to" and
 * "what has ⌘K".
 */
export function rowMatches(row: KeymapRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (row.title.toLowerCase().includes(q)) return true;
  if (row.commandId.toLowerCase().includes(q)) return true;
  return row.bindings.some((b) => b.label.toLowerCase().includes(q));
}

/**
 * Build every row, grouped and ordered the way the pane shows them.
 *
 * `overridden` names the commands carrying a user override; it is passed in
 * rather than read, so this stays a function of its arguments and the pane's
 * store subscription stays the pane's business.
 */
export function buildKeymapRows(
  overridden: ReadonlySet<string>,
  registry: KeymapRegistry = keymapRegistry,
  entries: readonly CommandEntry[] = COMMANDS,
): KeymapRow[] {
  const rows: KeymapRow[] = [];
  for (const entry of entries) {
    if (!isListedEntry(entry)) continue;
    const resolved = registry.bindingsFor(entry.id);
    rows.push({
      commandId: entry.id,
      title: entry.title,
      group: groupForEntry(entry),
      ...(entry.menuItemId !== undefined ? { menuItemId: entry.menuItemId } : {}),
      locked: isCommandLocked(entry.id),
      overridden: overridden.has(entry.id),
      bindings: resolved.map((r) => ({
        binding: r.binding,
        label: formatChord(r.binding.chord),
        active: r.active,
        ...(r.shadowedBy !== undefined ? { shadowedBy: r.shadowedBy } : {}),
        scoped: r.binding.scope.kind !== "global",
      })),
    });
  }
  const groupRank = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  rows.sort((a, b) => {
    const ga = groupRank.get(a.group) ?? GROUP_ORDER.length;
    const gb = groupRank.get(b.group) ?? GROUP_ORDER.length;
    if (ga !== gb) return ga - gb;
    return a.title.localeCompare(b.title);
  });
  return rows;
}

/** A row in the pane's flat list: a group heading, or a command. */
export type KeymapListItem =
  | {
      readonly kind: "group";
      readonly id: string;
      readonly title: string;
      /**
       * The first heading in the list. Sections are separated by space above
       * the heading, and the first one has nothing to be separated from — a
       * windowed list cannot ask CSS for `:first-child`, since that reads
       * against the rendered window rather than the data.
       */
      readonly first: boolean;
    }
  | { readonly kind: "command"; readonly id: string; readonly row: KeymapRow };

/**
 * Flatten rows into the list's items, dropping any group the filter emptied.
 *
 * A heading over nothing is a lie about what the list holds, and under a
 * narrow query most of them are empty — so the headings follow the filter
 * rather than standing over it.
 */
export function buildKeymapListItems(
  rows: readonly KeymapRow[],
  query: string,
): KeymapListItem[] {
  const items: KeymapListItem[] = [];
  let group: string | null = null;
  for (const row of rows) {
    if (!rowMatches(row, query)) continue;
    if (row.group !== group) {
      group = row.group;
      items.push({
        kind: "group",
        id: `group:${group}`,
        title: group,
        first: items.length === 0,
      });
    }
    items.push({ kind: "command", id: row.commandId, row });
  }
  return items;
}

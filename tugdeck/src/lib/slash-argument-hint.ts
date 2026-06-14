/**
 * slash-argument-hint.ts — the pure rule deciding what argument placeholder
 * a just-accepted slash-command atom should show.
 *
 * After the user accepts a command atom that takes arguments, the prompt
 * entry paints a ghost placeholder after it (`/devise ┆ type arguments…`)
 * so the next thing to type is obvious. This module owns the *decision* —
 * given what we know about a command, what hint (if any) to show — kept
 * pure and DOM-free so it is unit-testable; the editor extension
 * (`tug-text-editor/argument-hint-extension.ts`) owns the rendering and the
 * store lookup that feeds this.
 *
 * Hint source, in order:
 *  - an explicit `argumentHint` the emitter shipped in the command catalog
 *    (`<idea> → <output-path>`), when present; else
 *  - a **generic** slot for command shapes that take free-text arguments —
 *    skills and agents always do; a local (graphical) command opts in via
 *    its registry `takesArgs` flag.
 *
 * A command that takes no arguments (a bare local toggle, an unknown shape)
 * gets `null` — no placeholder.
 *
 * @module lib/slash-argument-hint
 */

/** The generic placeholder shown when a command takes args but ships no hint. */
export const GENERIC_ARGUMENT_HINT = "type arguments…";

/** What {@link resolveArgumentHint} needs to know about a command. */
export interface ArgumentHintCommand {
  /** Command name / atom value, e.g. `"tugplug:devise"` or `"rewind"`. */
  readonly name: string;
  /** Catalog category, when the command came from claude's reported catalog. */
  readonly category?: "local" | "agent" | "skill";
  /** Explicit argument hint the emitter shipped, when present. */
  readonly argumentHint?: string;
  /** For a local (graphical) registry command — whether it accepts trailing args. */
  readonly takesArgs?: boolean;
}

/**
 * Decide the argument placeholder for a command, or `null` when it takes no
 * arguments. An explicit `argumentHint` wins; otherwise a skill / agent (or a
 * `takesArgs` local) gets the generic slot. Pure.
 */
export function resolveArgumentHint(cmd: ArgumentHintCommand): string | null {
  const explicit = cmd.argumentHint?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;
  if (cmd.category === "skill" || cmd.category === "agent") {
    return GENERIC_ARGUMENT_HINT;
  }
  if (cmd.takesArgs === true) return GENERIC_ARGUMENT_HINT;
  return null;
}

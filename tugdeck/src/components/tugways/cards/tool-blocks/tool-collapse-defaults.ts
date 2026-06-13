/**
 * `tool-collapse-defaults.ts` — the single, plainly-editable source of
 * truth for which tool blocks mount **collapsed** in the transcript
 * ([P06]/[P07]).
 *
 * The transcript dispatch site (`CodeRowBody` in `dev-card-transcript`)
 * reads `collapseDefaultFor(toolName)` and wraps a block in
 * `ToolBlockHistoryCollapse` (default-collapsed, body materializes on
 * expand) when it returns `true` — applied **live and historical**, the
 * same for an in-flight call and a replayed one. The seed collapses the
 * noisy file/shell I/O the user rarely needs to watch and leaves the
 * content-bearing tools expanded. Flip an entry to change a default.
 *
 * This governs **whole-block** collapse only (header vs header+body). It
 * is deliberately separate from a tool block's own *body-internal* fold
 * (`ToolBlockChrome`'s `fold` / a body kind's size-threshold collapse),
 * which is a finer affordance keyed on content size, not tool kind.
 *
 * Keys are lowercased wire tool names (`message.toolName`). Unknown
 * tools default to **expanded** (`false`).
 *
 * @module components/tugways/cards/tool-blocks/tool-collapse-defaults
 */

/**
 * Tool kind → collapsed-by-default. Seeded per [P07]: the noisy
 * file/shell tools collapse; the content the user is actively reading
 * stays expanded. The expanded entries equal the unknown-tool default
 * (`false`) but are listed explicitly so the policy reads as a complete
 * table at a glance.
 */
export const TOOL_COLLAPSE_DEFAULTS: Readonly<Record<string, boolean>> = {
  // Noisy file/shell I/O — collapse ([P07]). The collapsed header alone
  // (tool + target + one-line result) is enough; the body is one click
  // away.
  read: true,
  grep: true,
  glob: true,
  bash: true,
  edit: true,
  multiedit: true, // wire alias of Edit — same file-mutation family
  write: true,
  // Content the user is actively reading — leave expanded ([P07]).
  skill: false,
  agent: false, // canonical kind for the `Task` wire tool
  askuserquestion: false,
  webfetch: false,
  websearch: false,
};

/**
 * Whether a tool block of `toolName` mounts collapsed by default.
 * Case-insensitive; unknown tools default to expanded.
 */
export function collapseDefaultFor(toolName: string): boolean {
  return TOOL_COLLAPSE_DEFAULTS[toolName.toLowerCase()] ?? false;
}

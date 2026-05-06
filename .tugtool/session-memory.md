# Session Memory — text-editing-keybindings-b63f4bb-1

## Project map
Substrate-local text-editing keybindings (Ctrl-U/W, Alt-F/B). Key files:
- `tugdeck/src/components/tugways/action-vocabulary.ts` — `TUG_ACTIONS`; derived `TugAction` union picks up new entries.
- `tugdeck/src/components/tugways/text-editing-keybindings.ts` — Step 1 registry + matcher.
- `tugdeck/src/components/tugways/use-text-input-responder.tsx` — Step 2 (DONE); native `<input>`/`<textarea>` wiring; useLayoutEffect keydown listener.
- `tugdeck/src/components/tugways/tug-text-editor.tsx` + `tug-text-editor/keymap.ts` — Step 3 (DONE); CM6 keymap + responder handlers.
- `tugdeck/src/components/tugways/keybinding-map.ts` — global capture-phase map (NOT extended by this plan, [DM01]).

## Files touched
- action-vocabulary.ts — Step 1; +4 TUG_ACTIONS + section comment.
- text-editing-keybindings.ts — Step 1 NEW; EditingKeybinding interface, get/setEditingKeybindings, matchEditingKeybinding.
- __tests__/text-editing-keybindings.test.ts — Step 1 NEW; 18 matcher tests.
- use-text-input-responder.tsx — Step 2; findLineStart helper (exported), 4 handlers, chain-dispatch wrappers, keydown listener.
- src/__tests__/tug-input.test.tsx — Step 2; chain-dispatch membership block + extended disabled-guard test.
- src/__tests__/find-line-start.test.ts — Step 2 NEW; pure-logic unit tests.
- tug-text-editor.tsx — Step 3; +49; imports cursorGroupBackward/cursorGroupForward/deleteGroupBackward/deleteLineBoundaryBackward; 4 responder handlers (handleDeleteToLineStart, handleDeleteWordBackward, handleMoveWordForward, handleMoveWordBackward) registered on actions map.
- tug-text-editor/keymap.ts — Step 3; +57/-14; imports keymap from @codemirror/view + 6 commands from @codemirror/commands; tugTextEditorKeymap now returns Prec.high([domEventHandlers, keymap.of([...])]).

## Patterns established
- Section header `// ---- Editing motion / deletion ----` for new TUG_ACTIONS, payload comments adjacent.
- `EditingKeybinding` interface drops `preventDefaultOnMatch`/`value`/`scope` from KeyBinding; adds `shiftExtends` per [DM05].
- Mutable registry per [DM06]: `let EDITING_KEYBINDINGS` + `get/setEditingKeybindings`; matcher reads at call time per [L07].
- Step 2 (native): DELETE_* uses `setSelectionRange` + `execCommand("delete")` per [DM03] (NSUndoManager). MOVE_* handlers carry internal `(shift: boolean)` param (Option (a)); chain `actions` map registers wrappers pinning shift=false.
- Step 2 keystroke listener: `useLayoutEffect` per [L03], gated on `disabled`; null match → return (no preventDefault) so AppKit handles platform bindings.
- Step 3 (CM6): keymap.of entries use `{key, run, shift}` slot for shift-extends per [DM05]; `Ctrl-u`/`Ctrl-w`/`Alt-f`/`Alt-b` dispatch deleteLineBoundaryBackward/deleteGroupBackward/cursorGroupForward/cursorGroupBackward (with selectGroupForward/selectGroupBackward as shift slots).
- Step 3 responder handlers: one-line each, mirror existing handleSelectAll/handleUndo shape — `view.focus(); cmd(view);`. Chain dispatch never extends selection (no native event), uses collapsed `cursorGroup*` per [DM05].
- tugTextEditorKeymap now wraps an array `Prec.high([domEventHandlers, keymap.of(...)])` instead of a single `Prec.high(domEventHandlers)`.

## Build / test notes
- `bun x tsc --noEmit` (tugdeck): exit 0.
- `bun test` (tugdeck): 3042 pass / 11720 expects / 183 files (~11s).
- `bun run audit:tokens lint`: zero violations.
- `cargo nextest run` (tugrust): 1256 pass / 9 skipped (~5s).

## Hints for upcoming steps
- Step 4: app-test smokes for tug-input, tug-textarea, tug-text-editor. Each smoke: Ctrl-U + Ctrl-W + Ctrl-A canary + Cmd-Z. Use `just app-test <file>`; never hand-rolled bun test with TUGAPP_* env vars. Recipe ends with greppable `VERDICT: PASS|FAIL` line.
- Step 4 also flips plan status to `shipped` and walks tuglaws/action-naming/component-authoring/responder-chain against the diff.
- Plan file at `.tugtool/tugplan-text-editing-keybindings.md`; anchors `#step-1`..`#step-4`; decisions `[DM01]`..`[DM06]`.
- For tug-text-editor app-test: typeahead's `Prec.highest` keymap doesn't intercept Ctrl-U/W/Alt-F/B (only Enter/Tab/Arrows/Escape during active session) — gap bindings fall through cleanly. Confirm in dev server.

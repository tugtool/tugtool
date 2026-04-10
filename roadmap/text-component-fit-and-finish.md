# Text Component Fit-and-Finish

Fit-and-finish changes for text display and editing components: tug-input, tug-value-input, tug-textarea, tug-prompt-input, and tug-markdown-view.

## Items

### 1. tug-markdown-view: right-click context menu

**Current state:** No context menu, no responder registration. Uses SelectionGuard for CSS Custom Highlight API selection rendering (read-only).

**Goal:** Adopt the right-click editing menu popup used by the other text components. Since tug-markdown-view is read-only, only **copy** and **select all** should appear. Copy is enabled only when there is a ranged selection.

**Approach:** Can't reuse `useTextInputResponder` (that targets native `<input>`/`<textarea>`). Needs its own contextmenu handler modeled on tug-prompt-input's pattern — register as a responder with `copy` and `selectAll` handlers, show `TugEditorContextMenu` with those two items, sample SelectionGuard state at menu-open time to drive copy enablement.

**Key files:**
- `tugdeck/src/components/tugways/tug-markdown-view.tsx`
- `tugdeck/src/components/tugways/tug-editor-context-menu.tsx`
- `tugdeck/src/components/tugways/selection-guard.ts`

---

### 2. Selection repositioning on right-click

**Current state:** tug-prompt-input captures pre-right-click selection and restores it (defeating WebKit's smart-click word expansion). Native input components (`useTextInputResponder`) sample native selection at menu time with no repositioning logic.

**Goal:** Three-case behavior for all text components:

1. **Caret + click near caret (within ~1em):** Keep caret where it is, open menu.
2. **Range + click inside range:** Keep range as-is, open menu.
3. **Otherwise:** Move selection to click point and expand to word bounds.

**Approach:** Use `caretPositionFromPoint` / `caretRangeFromPoint` to determine click position relative to current selection. For native inputs, compare against `selectionStart`/`selectionEnd` positions. For tug-prompt-input's contentEditable, same DOM API works. For tug-markdown-view, selection model differs (Custom Highlight API) so word-expansion works through SelectionGuard/range APIs.

Cross-cutting concern: each component type has a different selection model but should share the same behavioral logic. Consider a shared utility that takes a selection-model adapter.

**Key files:**
- `tugdeck/src/components/tugways/use-text-input-responder.tsx`
- `tugdeck/src/components/tugways/tug-prompt-input.tsx`
- `tugdeck/src/components/tugways/tug-markdown-view.tsx`

---

### 3. Content and selection persistence across tab changes

**Current state:** Only tug-prompt-input persists via `useTugcardPersistence` (saves engine state including text, atoms, selection). TugInput, TugValueInput, and TugTextarea have no persistence — content and selection are lost on tab switch.

**Goal:** All text components save and restore their editing contents and selection per tab/card across tab changes.

**Approach:** Each component adopts `useTugcardPersistence` with `onSave`/`onRestore` callbacks. For native inputs: save `{ value, selectionStart, selectionEnd }`, restore on activation. The tug-card.tsx plumbing already supports this; components just need to opt in.

**Key files:**
- `tugdeck/src/components/tugways/tug-input.tsx`
- `tugdeck/src/components/tugways/tug-value-input.tsx`
- `tugdeck/src/components/tugways/tug-textarea.tsx`
- `tugdeck/src/components/tugways/use-tugcard-persistence.tsx`
- `tugdeck/src/components/tugways/tug-card.tsx`

---

### 4. Undo stack persistence across tab changes

**Current state:** All components use `document.execCommand("undo")` — the browser's native undo stack. When tug-prompt-input deactivates and restores, it rebuilds DOM content but the undo stack is lost. Native inputs likewise lose their undo stack when DOM is torn down.

**Goal:** Undo history survives tab switches.

**Approach options:**

- **Custom undo stack:** Replace `execCommand("undo/redo")` with an application-level undo manager that records operations and can be serialized per tab. Significant change to tug-text-engine and potentially all input components.
- **DOM preservation:** Instead of destroying and rebuilding DOM on tab switch, keep deactivated tab DOM alive but hidden. The native undo stack survives because elements persist. Trades memory for simplicity.

**Key files:**
- `tugdeck/src/lib/tug-text-engine.ts`
- `tugdeck/src/components/tugways/tug-prompt-input.tsx`
- `tugdeck/src/components/tugways/use-text-input-responder.tsx`
- `tugdeck/src/components/tugways/tug-card.tsx`

---

### 5. select-all broken in tug-prompt-input (keyboard and context menu)

**Root cause (confirmed):** `tug-text-engine.ts:420` had `document.execCommand("select-all")` — the kebab-case action name leaked into an execCommand call. The browser's `document.execCommand` API uses its own camelCase command vocabulary (`"selectAll"`, `"insertText"`, `"forwardDelete"`, etc.). The hyphenated `"select-all"` is not a recognized command and WebKit silently ignores it.

**Fix:** Change `document.execCommand("select-all")` to `document.execCommand("selectAll")` at `tug-text-engine.ts:420`.

**Why the Swift Edit menu still worked:** `NSText.selectAll(_:)` goes through WebKit's native editing command infrastructure, bypassing JavaScript entirely. The keyboard (⌘A) and context menu paths both route through the responder chain → handler continuation → `engine.selectAll()` → `document.execCommand(...)`, hitting the broken string.

**How the bug happened:** The action naming convention (tuglaws/action-naming.md) mandates kebab-case for action names on the responder chain wire format: `TUG_ACTIONS.SELECT_ALL = "select-all"`. The `document.execCommand` API uses a different vocabulary with different casing: `"selectAll"`, `"insertText"`, `"forwardDelete"`, etc. These are two separate namespaces that happen to describe overlapping concepts. The kebab-case action name was mistakenly used where the camelCase execCommand name was needed.

**Prevention:** Add explicit guidance to tuglaws docs and action-vocabulary.ts making the namespace boundary clear. Two naming systems coexist in the editing code — action names (kebab-case, ours) and execCommand names (camelCase, the browser's) — and they must never be mixed. See conventions below.

**Conventions to add:**

1. **action-naming.md** — new section: "Action Names vs. Browser Command Names." Explicitly call out that `document.execCommand` has its own vocabulary (`"selectAll"`, `"insertText"`, `"delete"`, `"undo"`, `"redo"`, `"forwardDelete"`, `"insertHTML"`, `"insertLineBreak"`) that uses camelCase. Action names and execCommand names describe overlapping concepts but are separate namespaces with different casing rules. Action names flow through the responder chain; execCommand names flow to the browser. Never use one where the other is expected.

2. **action-vocabulary.ts** — add a comment block near the clipboard/editing constants noting the namespace boundary: the `TUG_ACTIONS` kebab-case strings are dispatched through the chain; the browser's `document.execCommand` calls use a separate camelCase vocabulary. The two must not be mixed.

3. **responder-chain.md** — in the section on handlers that call `document.execCommand` (the two-phase continuation pattern for editing), note that the execCommand string is *not* the action name — it is a browser API identifier with its own casing convention.

4. **component-authoring.md** — in the editing/text component guidance, note the same boundary.

**Key files:**
- `tugdeck/src/lib/tug-text-engine.ts` (line 420 — the fix site)
- `tuglaws/action-naming.md` (new section)
- `tuglaws/responder-chain.md` (amendment)
- `tuglaws/component-authoring.md` (amendment)
- `tugdeck/src/components/tugways/action-vocabulary.ts` (comment addition)

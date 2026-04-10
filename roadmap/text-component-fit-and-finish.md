# Text Component Fit-and-Finish

Fit-and-finish changes for text display and editing components: tug-input, tug-value-input, tug-textarea, tug-prompt-input, and tug-markdown-view.

## Items

### 6. Unified text selection adapter (foundational — do first)

**Problem:** Items 1–4 all touch selection behavior, but the five text components use three different selection models:

| Model | Components | Selection representation | Selection query | Word-at-point | Save/restore |
|-------|-----------|------------------------|-----------------|---------------|-------------|
| **Native input** | tug-input, tug-textarea, tug-value-input | `selectionStart`/`selectionEnd` integers | `start !== end` | Not implemented | Not implemented |
| **TugTextEngine** | tug-prompt-input | Flat text offsets `{ start, end }` | `end > start` | `selectWordAtPoint` via `Selection.modify` | `captureState`/`restoreState` via `useTugcardPersistence` |
| **SelectionGuard** | tug-markdown-view (via card boundary) | Path-based `SavedSelection` (anchorPath[], focusPath[]) | Not directly exposed | Not implemented | `saveSelection`/`restoreSelection` per card |

Items 1–4 each need a subset of selection operations. When the needs are cross-tabulated, it becomes clear that several operations are required uniformly across all three models:

| Operation | Item 1 (md-view menu) | Item 2 (right-click reposition) | Item 3 (tab persistence) | Needed by |
|-----------|----------------------|-------------------------------|-------------------------|-----------|
| Has ranged selection? | Copy enablement | Case 1 vs 2 vs 3 | — | All 3 models |
| Get selected text | Copy handler | — | — | md-view, engine |
| Caret/range geometry | — | Proximity + within-range checks | — | All 3 models |
| Set caret to point | — | Case 3 | — | All 3 models |
| Expand to word at point | — | Case 3 | — | All 3 models |
| Save/restore selection | — | — | Per-tab persistence | Native (new), others (done) |
| Select all | Handler | — | — | md-view (new) |

Without a shared abstraction, each of items 1–4 will re-derive the same "how do I query/manipulate selection in this component type?" logic with ad-hoc branching. The right-click repositioning logic (item 2) is especially vulnerable — the three-case algorithm is identical across all components, but the selection model access is different each time.

**Proposal: `TextSelectionAdapter` interface.**

A small interface that each component family implements, providing a uniform API for the operations that items 1–4 need. The adapter does not replace the underlying selection model — it is a thin bridge so shared behavioral logic can work uniformly.

```ts
interface TextSelectionAdapter {
  /** True when there is a non-collapsed selection. */
  hasRangedSelection(): boolean;

  /** The currently selected text, or empty string if no ranged selection. */
  getSelectedText(): string;

  /**
   * DOMRect of the caret (collapsed selection) or null.
   * Used by item 2 case 1: "is the click near the caret?"
   */
  getCaretRect(): DOMRect | null;

  /**
   * Array of DOMRects covering the ranged selection, or empty.
   * Used by item 2 case 2: "is the click inside the selection?"
   */
  getSelectionRects(): DOMRect[];

  /**
   * Place the caret at the given viewport coordinates.
   * Used by item 2 case 3 before word expansion.
   */
  setCaretToPoint(clientX: number, clientY: number): void;

  /**
   * Expand the current caret to word boundaries.
   * Used by item 2 case 3 after setCaretToPoint.
   */
  expandToWord(): void;

  /** Select all content. */
  selectAll(): void;
}
```

Three implementations, each wrapping its native model:

1. **`NativeInputSelectionAdapter`** — wraps `<input>` / `<textarea>` elements.
   - `hasRangedSelection` → `el.selectionStart !== el.selectionEnd`
   - `getSelectedText` → `el.value.slice(el.selectionStart, el.selectionEnd)`
   - `getCaretRect` → use `caretPositionFromPoint` or create a hidden span/range at the caret offset to measure geometry. Alternatively, for native inputs, `el.getBoundingClientRect()` combined with character offset heuristics may suffice for the ~1em proximity check.
   - `getSelectionRects` → native inputs don't expose per-character rects easily; for the "click within range" check, a reasonable approximation is whether the click's character offset falls between `selectionStart` and `selectionEnd` (geometric check not needed — offset comparison suffices).
   - `setCaretToPoint` → `el.setSelectionRange(offset, offset)` where offset is derived from click coordinates (this is the trickiest part — native inputs don't have `caretPositionFromPoint` that resolves into them; we may need to use `el.setSelectionRange` with an offset computed from the input's text metrics).
   - `expandToWord` → compute word boundaries from `el.value` at current `selectionStart`, then `el.setSelectionRange(wordStart, wordEnd)`.
   - `selectAll` → `el.select()`

2. **`EngineSelectionAdapter`** — wraps `TugTextEngine`.
   - `hasRangedSelection` → `engine.getSelectedRange()` with `end > start`
   - `getSelectedText` → extract from engine state using range
   - `getCaretRect` / `getSelectionRects` → use `window.getSelection().getRangeAt(0).getBoundingClientRect()` / `getClientRects()` (the engine's contentEditable participates in the standard DOM Selection API)
   - `setCaretToPoint` → `caretRangeFromPoint` → `engine.setSelectedRange`
   - `expandToWord` → `Selection.modify("move", "backward", "word")` + `Selection.modify("extend", "forward", "word")` (already used by `selectWordAtPoint`)
   - `selectAll` → `engine.selectAll()`

3. **`HighlightSelectionAdapter`** — wraps SelectionGuard + DOM Selection for read-only views.
   - `hasRangedSelection` → check `window.getSelection()` for a non-collapsed range within the boundary element
   - `getSelectedText` → `window.getSelection().toString()`
   - `getCaretRect` / `getSelectionRects` → from `window.getSelection().getRangeAt(0)`
   - `setCaretToPoint` → `caretPositionFromPointCompat` → `Selection.setBaseAndExtent`
   - `expandToWord` → `Selection.modify` (same as engine, since this is standard DOM Selection)
   - `selectAll` → create a Range spanning the boundary element, `Selection.addRange`

**What the adapter does NOT cover:**

- **Content persistence (item 3).** Each component's content serialization is model-specific (`TugTextEditingState` for the engine, `{ value, selectionStart, selectionEnd }` for native inputs, nothing for read-only markdown-view). The adapter doesn't try to unify these — `useTugcardPersistence` already has the right shape for per-component save/restore callbacks.
- **Undo stack (item 4).** This is about DOM lifecycle, not selection model.
- **Context menu rendering.** The adapter provides the queries; the context menu component (`TugEditorContextMenu`) and its activation logic stay unchanged.

**How items 1–4 use the adapter:**

- **Item 1 (md-view context menu):** The `HighlightSelectionAdapter` provides `hasRangedSelection()` for copy enablement, `getSelectedText()` for the copy handler, and `selectAll()` for the select-all handler.
- **Item 2 (right-click repositioning):** A single shared utility function `repositionSelectionOnRightClick(adapter, clientX, clientY, emSize)` implements the three-case algorithm using the adapter interface. Every text component calls it from its contextmenu handler, passing its own adapter. One algorithm, three models, zero branching at the call site.
- **Item 3 (tab persistence):** Each component's `useTugcardPersistence` callbacks use the component's native API (not the adapter) for save/restore. The adapter is not involved.
- **Item 4 (undo):** Not involved.

**Implementation approach:**

The adapter is a plain object (not a class hierarchy, not a React hook). Each component creates one in its contextmenu handler or passes it as a ref. The interface is small enough that implementations are 5–15 lines each. The `repositionSelectionOnRightClick` utility is ~30 lines of pure logic against the interface.

File placement: `tugdeck/src/components/tugways/text-selection-adapter.ts` for the interface and the shared right-click utility. Each adapter implementation lives next to its consumer (inline in the hook or component, not in a separate file — they're too small to warrant their own module).

**Resolved questions:**

#### Q1: Native input caret-to-point

**Finding:** `caretPositionFromPoint` / `caretRangeFromPoint` do NOT resolve positions inside `<input>` or `<textarea>` elements. The text inside native inputs is rendered in a browser-internal context that the document-level hit-testing API cannot reach. The codebase confirms this: `caretPositionFromPointCompat` (selection-guard.ts) is only ever called for card content areas (contentEditable and markdown), never for native inputs.

**Solution: let the browser do the work.** On right-click, the browser's native mousedown handler fires *before* the contextmenu event and places the caret at the click point. At contextmenu time, `selectionStart`/`selectionEnd` already reflect where the browser resolved the click. We don't need to do our own coordinate-to-offset conversion — the browser already did it.

The three-case algorithm for native inputs becomes offset-based instead of geometric:

1. **Capture** the pre-right-click selection at `pointerdown` (button === 2), before the browser's mousedown moves it: `{ oldStart, oldEnd } = { selectionStart, selectionEnd }`.
2. **At `contextmenu`**, read where the browser placed the caret: `newOffset = selectionStart` (after the browser's mousedown collapsed it).
3. **Decide:**
   - **Case 1 (caret, click near):** Old selection was collapsed (`oldStart === oldEnd`) and `newOffset === oldStart` (same character position). Restore old caret — effectively a no-op since the positions match.
   - **Case 2 (range, click inside):** Old selection was ranged (`oldStart < oldEnd`) and `oldStart <= newOffset <= oldEnd`. Restore old range via `el.setSelectionRange(oldStart, oldEnd)`.
   - **Case 3 (otherwise):** Let the browser's new caret position stand. Expand to word boundaries by scanning `el.value` for word-boundary characters around `newOffset`, then `el.setSelectionRange(wordStart, wordEnd)`.

This is ~20 lines in `use-text-input-responder.tsx` and needs no geometric APIs, no canvas measurement, no hidden measurement spans. The browser's native hit-testing is the coordinate-to-offset converter.

**Impact on the adapter interface:** The geometric methods (`getCaretRect`, `getSelectionRects`) are not needed for native inputs. The `NativeInputSelectionAdapter` can still implement the full interface — `getCaretRect` would return the input element's bounding rect as a rough approximation — but the right-click repositioning logic for native inputs uses offset comparison, not geometric proximity. The shared `repositionSelectionOnRightClick` utility should accept *either* geometric or offset-based inputs, or the three-case logic should be a method on the adapter itself so each model implements it naturally.

**Revised adapter interface** (hybrid approach — shared decision logic with model-specific input):

```ts
interface TextSelectionAdapter {
  hasRangedSelection(): boolean;
  getSelectedText(): string;
  selectAll(): void;
  expandToWord(): void;

  /**
   * Classify a right-click relative to the current selection.
   * Each adapter implements this using the comparison method
   * natural to its model (geometric for contentEditable/highlight,
   * offset-based for native inputs).
   *
   * Returns the case that applies, so the caller can decide
   * whether to restore the pre-click selection or expand to word.
   */
  classifyRightClick(
    clientX: number,
    clientY: number,
    proximityThreshold: number,  // e.g. 1em in pixels
  ): "near-caret" | "within-range" | "elsewhere";

  /**
   * Place the caret at the given viewport coordinates and
   * expand to word boundaries. Used for the "elsewhere" case.
   * For native inputs, the browser already placed the caret
   * via mousedown — this just does the word expansion.
   */
  selectWordAtPoint(clientX: number, clientY: number): void;
}
```

The contentEditable and highlight adapters implement `classifyRightClick` using `Range.getBoundingClientRect()` / `getClientRects()` and distance checks. The native input adapter implements it using offset comparison against the browser-placed caret. Same interface, same caller code, different internal strategies.

#### Q2: tug-markdown-view's `selectAll` scope

**Finding:** The markdown view is virtualized. Only visible blocks plus ~2 viewport heights of overscan are in the DOM. All content IS in memory — pre-parsed HTML in `htmlCache` (never evicted) and raw text in `regionMap.text` — but creating a DOM Range spanning all content is impossible because most blocks don't have DOM nodes.

**Solution: logical select-all with data-model copy.**

For a read-only component, selection is fundamentally about *what gets copied*, not about DOM Range objects. The approach:

1. **Select-all sets a logical flag**, not a DOM selection. The component tracks a `selectAllActive` state (a ref, not React state — per L06, this is appearance).

2. **Visual feedback:** When `selectAllActive` is true, all visible blocks are painted as selected via CSS Highlights. As the user scrolls, newly-entering blocks also get the selection highlight. The visual effect is "everything is highlighted" even though only visible blocks are in the DOM.

3. **Copy from the data model.** The `copy` handler checks `selectAllActive`. If true, it extracts the full text from `regionMap.text` (or iterates `htmlCache` for formatted content) and writes it to the clipboard via `navigator.clipboard.writeText()` (or `write()` for rich content). No DOM Range needed.

4. **Clear on any selection change.** If the user clicks to place a caret or drags to make a partial selection after select-all, the `selectAllActive` flag clears and normal selection behavior resumes.

5. **Interaction with SelectionGuard.** SelectionGuard manages per-card selections via CSS Highlights and Range objects. The `selectAllActive` flag is a markdown-view-internal concept that sits above SelectionGuard. When active, the view tells SelectionGuard to paint all visible blocks as selected; when cleared, normal Range-based selection resumes.

**Implementation sketch:**

```
selectAll handler:
  selectAllRef.current = true
  paint all visible blocks into activeHighlight
  
scroll handler (existing RAF callback):
  if selectAllActive:
    paint entering blocks into activeHighlight too
    
copy handler:
  if selectAllActive:
    text = engine.regionMap.text (full content)
    navigator.clipboard.writeText(text)
  else:
    text = window.getSelection().toString() (normal)
    
pointerdown / selectionchange:
  selectAllRef.current = false (clear logical select-all)
```

This avoids materializing the full DOM (which defeats virtualization and could be very expensive for large documents), preserves the virtualization invariant, and gives the user the expected behavior: ⌘A highlights everything, ⌘C copies everything.

**Key files:**
- `tugdeck/src/components/tugways/text-selection-adapter.ts` (new — interface + shared utility)
- `tugdeck/src/components/tugways/use-text-input-responder.tsx` (native input adapter)
- `tugdeck/src/components/tugways/tug-prompt-input.tsx` (engine adapter)
- `tugdeck/src/components/tugways/tug-markdown-view.tsx` (highlight adapter)
- `tugdeck/src/components/tugways/selection-guard.ts` (may need minor additions for query support)

---

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

### 3. Content and selection persistence across tab changes — DEFERRED

Deferred: requires a proper document model for card content, not per-component save/restore into a key-value store. The single-slot persistence design (`useTugcardPersistence`) doesn't scale to cards with multiple inputs, and the right solution is a card-level content model that captures the full editing surface.

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

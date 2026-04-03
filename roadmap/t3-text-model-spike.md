# T3.0 Text Model Spike — Findings

*Spike conducted 2026-04-02. Three approaches tested in the Component Gallery.*

## Approaches Tested

### Approach A: Textarea + Overlay Mirror

Hidden `<textarea>` for input capture with transparent text. Visible mirror div positioned behind renders styled text + atom pills. Caret comes from the real textarea.

**Result: Non-functional.** Arrow keys cannot navigate past atoms. The textarea treats the atom placeholder character (U+FFFC) as a single character, but cursor movement in the textarea doesn't correspond to spatial positions in the overlay when atom pills have different visual widths than placeholder characters. Fundamental spatial correspondence problem with proportional fonts.

### Approach B: Thin contentEditable

`contentEditable` div with `role="textbox"` and `aria-multiline="true"`. Plain text nodes interspersed with inline `<span contentEditable="false">` atom pill elements.

**Result: Best of the three, but deeply flawed.** See detailed findings below.

### Approach C: Hidden Textarea + Rendered Div

Hidden `<textarea>` captures all keyboard input. Separate visible div renders content (text + atoms). The textarea is the input device; the div is the display.

**Result: Fundamentally sound architecture, but the spike implementation had no blinking insertion point.** Implementing a correct cursor requires building a document model with position ↔ pixel mapping, which is essentially building a text engine. Abandoned early — "colossal pain to implement" per user assessment. However, this is exactly what ProseMirror, CodeMirror 6, and Lexical do (all MIT licensed), and is the correct architecture.

---

## Approach B Detailed Findings

### What Worked

| Feature | Status | Notes |
|---------|--------|-------|
| Basic typing | OK | English text input works |
| Arrow key movement | OK | Cursor moves past atoms |
| Shift+arrow selection | OK | Selection extends correctly |
| Japanese IME composition | OK | Hiragana → kanji conversion works, composition underline appears correctly |
| VoiceOver | OK | Atom labels announced when cursor enters atom (role="img" + aria-label) |
| Auto-resize | OK | Grows from 1 row up to maxRows, caps with overflow scroll |
| Drag-and-drop | OK | Files from Finder create file atoms |
| Paste as plain text | OK | `clipboardData.getData("text/plain")` + `document.execCommand("insertText")` strips formatting |

### What Failed

| Issue | Severity | Root Cause |
|-------|----------|------------|
| **Spurious marked text** | Critical | macOS/WebKit treats contentEditable text as having an active input session. US keyboard typing appears "marked" (underlined) as if IME composition is active. This is the platform's text input system getting confused about the editing context — exactly the problem UITextInput was designed to solve. |
| **Cmd+A selects entire page** | High | SelectionGuard and/or the card responder chain captures Cmd+A before the contentEditable's keydown handler fires. `stopPropagation()` on the keydown handler doesn't help because the event is handled at a higher level (capture phase or document listener). |
| **Click+drag to select text doesn't work** | High | Likely related to the SelectionGuard's pointer tracking (L12). The guard intercepts pointer events for its clamping logic, interfering with native contentEditable selection gestures. |
| **Cursor enters atom interior** | High | Despite `contentEditable="false"` on atom spans, the browser allows the caret to be placed inside the atom's child spans after `execCommand('insertHTML')`. The atom is not truly atomic from the browser's perspective. |
| **Insertion point after atom insertion is wrong** | High | After `execCommand('insertHTML')`, the caret lands inside the atom span rather than after it. No reliable way to force caret position after execCommand — the browser's editing engine decides. |
| **Undo repositions atoms instead of removing them** | High | `execCommand('insertHTML')` does integrate with the browser undo stack, but undo doesn't cleanly reverse the operation — it moves the atom rather than removing it. The browser's undo model doesn't match our semantic intent. |
| **Enter during IME composition submits instead of accepting** | High | `e.isComposing` on KeyboardEvent was supposed to catch this, but macOS WebKit doesn't reliably set it for all composition states. The platform's text input system handles Enter → composition acceptance before the web event fires. UITextInput solves this with `markedTextRange` — if marked text exists, Enter goes to the input method, period. |
| **Return and Enter are conflated** | Medium | Physically separate keys: Return (`e.code === "Enter"`) and numpad Enter (`e.code === "NumpadEnter"`). They're distinguishable via `e.code` but the spike treated them as the same key. Design requirement: Return and Enter should be independently configurable (submit vs newline). |

### What Was Not Tested

- Chinese pinyin IME (only Japanese was tested)
- Screen reader with atom selection/deletion flow
- Multiple atoms adjacent (no text between them)
- Very long text performance (scrolling + many atoms)
- Undo across multiple operations (type → insert atom → type → undo → undo → undo)

---

## Key Insights

### 1. contentEditable is an Input Capture Surface, Not a Document Model

All three major editor frameworks (ProseMirror, CodeMirror 6, Lexical — all MIT) use contentEditable but treat the DOM as an output channel. They maintain their own document model as source of truth and re-render the DOM from it. Our spike let the browser DOM *be* the document, which is why undo, atom positioning, and selection all broke — we were fighting the browser's editing engine instead of owning the document model.

### 2. The Browser's Editing Engine is Not Controllable

`document.execCommand` is the only way to integrate with the browser's undo stack, but its behavior is underspecified, browser-dependent, and produces side effects we can't predict (cursor placement, DOM mutations, undo semantics). You cannot build reliable atom/pill behavior on top of it.

### 3. UITextInput Concepts Are the Right Model

The spike's failures map exactly to problems UITextInput solves:
- **Marked text** → `markedTextRange` / `setMarkedText:selectedRange:` — explicit marked text management, not browser guessing
- **Insertion point** → `selectedTextRange` — we own cursor position, not the browser
- **Composition vs commit** → `hasText` / `insertText:` / `markedTextRange` — clear boundary between composing and committed text
- **Return vs Enter** → UITextInput never conflates these; they're distinct input events
- **Atomic inline elements** → `textRange(from:to:)` treats non-text ranges as atomic units
- **Undo** → The text input system reports operations; the app owns the undo stack

### 4. Atom Atomicity Requires Document Model Ownership

`contentEditable="false"` is a suggestion, not an enforcement. The browser can and does place the caret inside "non-editable" spans after certain operations. True atomicity requires a document model where atoms are opaque nodes — the cursor can be before or after an atom, never inside it. This must be enforced by *our* code, not the browser's.

### 5. SelectionGuard Conflicts with contentEditable

The card system's SelectionGuard (L12) intercepts pointer events and selection changes at the document level to enforce card-scoped selection. This directly conflicts with contentEditable's native selection handling. Any text input component needs to either (a) be exempted from SelectionGuard, or (b) manage its own selection entirely (which a proper text engine does anyway).

---

## Decision: Pivot to Approach C Done Properly

**The spike validates Approach C — hidden textarea + rendered view — as the correct architecture, but it must be done with a proper document model and text engine, not as a hack.**

Architecture (inspired by UITextInput, informed by ProseMirror/CM6/Lexical):

1. **Document Model** — Array of segments: `TextSegment` (string) and `AtomSegment` (type + label + value). The source of truth. Never derived from the DOM.

2. **Input Capture** — contentEditable div as the input surface (not a hidden textarea — CM6 switched to contentEditable for better IME support). But we treat it as an input device only. All DOM mutations from user input are intercepted, translated to document model operations, and then the DOM is re-rendered from the model. The browser never "owns" the document.

3. **Selection/Cursor** — We own the selection state: `{ anchor: DocPosition, focus: DocPosition }`. A `DocPosition` is `{ segmentIndex, offset }` where atoms have offset 0 (before) or 1 (after). The cursor is rendered by us as a positioned DOM element or via the browser's native caret (if we can control it reliably).

4. **Composition (IME)** — Track marked text explicitly: `markedRange: { start: DocPosition, end: DocPosition } | null`. During composition, the marked text is rendered with platform-appropriate styling. Composition events (`compositionstart`, `compositionupdate`, `compositionend`) update the marked range. Enter during active marked text goes to the IME — period.

5. **Undo** — We own the undo stack. Each operation (insert text, insert atom, delete, etc.) is recorded. Cmd+Z pops the stack and re-renders. The browser's undo stack is not used.

6. **Return vs Enter** — Distinguished via `e.code`: `"Enter"` (Return key) vs `"NumpadEnter"` (Enter key). Independently configurable actions.

**Reference implementations to study (all MIT):**
- ProseMirror `prosemirror-view` — input handling, composition tracking, DOM ↔ model reconciliation
- CodeMirror 6 `@codemirror/view` — input handling, contentEditable as input surface, state management
- Lexical `lexical` — editor state, DOM reconciliation, node model (DecoratorNode is their "atom")

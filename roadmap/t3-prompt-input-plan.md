# T3.2 Tactical Plan: tug-prompt-input

*Tactical execution plan for building the tug-prompt-input component. Companion to the T3.2 section in [tide.md](tide.md).*

---

## Principle: the browser is the engine

WebKit's native contentEditable with `<img>` atoms handles text editing correctly. We do not maintain a parallel document model, reconciler, or mutation observer. The DOM is the source of truth. Our code is a thin event-handling layer — a few focused customizations on top of WebKit's editing.

This principle was validated by the IMG atom spike (2026-04-05). The spike proved:

- `<img src="data:image/svg+xml,...">` atoms are replaced elements — WebKit navigates them atomically, positions the caret correctly before/after them, and handles selection natively.
- No `contentEditable="false"` needed. No ZWSP. No anchor spans. No domPosition/flatFromDOM mapping. No reconciler.
- Native undo/redo via `execCommand`. Native IME. Native arrow navigation. Native click-to-position.
- ~300 lines of focused event handling vs 1800+ lines of the old engine.

---

## What Failed (and Why)

The original TugTextEngine architecture used `contentEditable="false"` spans for atom badges. This caused WebKit's caret renderer to misposition the caret near atoms. We spent days building increasingly complex workarounds:

- ZWSP cursor anchors + ce=false anchor spans (broke trailing newlines)
- rootPosition (WebKit rendered caret at height 0)
- Ce=true badges with real text (caret entered the badge text)
- Custom caret rendering plans (would break IME)

**Root cause:** `contentEditable="false"` inline elements create "non-editable islands" that WebKit's editing code cannot handle correctly. Every major web editor (ProseMirror, Lexical, Slate) fights the same bugs. The solution is not more workarounds — it's eliminating ce=false from the text flow entirely.

**The fix:** atoms as `<img>` elements. Images are replaced elements — WebKit already knows how to lay them out and navigate around them. Twenty years of browser engineering handles the caret correctly.

---

## What We Need

A thin event-handling layer on top of native contentEditable. Seven focused behaviors:

### 1. Atom creation and rendering

Atoms are `<img src="data:image/svg+xml,...">` elements with `data-atom-*` attributes. Each atom SVG contains:
- Rounded rect background with border
- Lucide-style icon (file, command, doc, link, image)
- Label text, measured via canvas `measureText` for accurate width

Creation: `createAtomImgElement(type, label, value)` → `HTMLImageElement`.

**Theming:** Data URI SVGs are isolated from the page's CSS cascade — `currentColor`, `var()`, and CSS custom properties do not cross into them. Colors are read live from theme tokens via `getComputedStyle(document.documentElement).getPropertyValue('--tug7-...')` at atom creation time. No hardcoded hex values in the builder — always token lookups. Atoms created under the current theme automatically match it. For theme changes to update existing atoms, see Step 6.

### 2. Clipboard (copy / cut / paste)

- **Copy**: intercept `copy` event. Write `text/html` (preserving atom `<img>` tags with `data-atom-*` attributes) and `text/plain` (atom labels as text) to clipboard.
- **Cut**: write to clipboard (same as copy), then `document.execCommand("delete")` for undo-stack-compatible deletion.
- **Paste**: check `text/html` for `data-atom-label` markers. If present, `e.preventDefault()` + `document.execCommand("insertHTML", false, content)`. Otherwise let browser handle natively. Both paths are undoable.

### 3. Drag and drop

- `dragover`: `e.preventDefault()`, `dropEffect = "copy"`
- `drop`: read `dataTransfer.files`, position caret at drop point via `document.caretRangeFromPoint(e.clientX, e.clientY)`, build atom HTML for each file, insert via `document.execCommand("insertHTML")`.

### 4. Option+Arrow word boundaries at atoms

Native `Selection.modify("move", dir, "word")` skips over images. Intercept Option+Arrow:
1. Record caret position before the move (as a Range)
2. Let `sel.modify` do the native word move
3. Check if any atom `<img>` is between the before and after positions using `Range.compareBoundaryPoints`
4. If so, clamp to the first atom boundary crossed

### 5. Click on atom → select

Click handler: if `e.target` is an `<img data-atom-label>`, create a Range that selects the entire image and set it as the selection. The image shows as selected; backspace deletes it.

### 6. Return / Enter key configuration

Keydown handler for Enter:
- Read `data-return-action` / `data-enter-action` from the editor element (set by React via data attributes, L06 compliant)
- Distinguish Return (main keyboard) from Enter (numpad) via `e.code`
- Shift inverts the action
- `e.isComposing` → ignore (IME gets the key)
- Submit action → fire `onSubmit` callback
- Newline action → `document.execCommand("insertLineBreak")`

### 7. Selection guard integration

The app's selection guard uses CSS Custom Highlights for cross-card selection management. Without mitigation, this causes visual selection artifacts during arrow navigation near images.

**Fix:** suppress Custom Highlights inside the editor via CSS:
```css
.tug-prompt-input-editor ::selection,
.tug-prompt-input-editor::selection {
  background-color: Highlight;
  color: HighlightText;
}
.tug-prompt-input-editor::highlight(card-selection),
.tug-prompt-input-editor ::highlight(card-selection) {
  background-color: transparent !important;
  color: inherit !important;
}
.tug-prompt-input-editor::highlight(inactive-selection),
.tug-prompt-input-editor ::highlight(inactive-selection) {
  background-color: transparent !important;
  color: inherit !important;
}
```

**Critical:** do NOT use `-webkit-user-modify: read-write-plaintext-only`. It strips `<img>` elements from `execCommand("insertHTML")`, breaking atom paste. Standard contentEditable with the Custom Highlight suppression above is correct.

---

## ContentEditable Setup

The editor div:
```html
<div
  contenteditable
  class="tug-prompt-input-editor"
  style="line-height: 24px"  /* accommodates 22px atom images without layout shift */
  data-return-action="submit"
  data-enter-action="submit"
>
```

No `-webkit-user-modify`. No `white-space: pre-wrap` (standard contentEditable handles whitespace). Line breaks via `<br>` (native `insertLineBreak` behavior).

---

## Read API (getText / getAtoms)

Read directly from the DOM. No parallel model.

- **getText()**: walk `editor.childNodes`. Text nodes → their content. `<img data-atom-label>` → U+FFFC. `<br>` → `\n`. Join.
- **getAtoms()**: `editor.querySelectorAll("img[data-atom-label]")` → map to `AtomSegment` objects from data attributes.
- **getSelectedRange()**: use `window.getSelection()` and a DOM walk to compute flat offsets. Same flat offset convention: text chars = 1, atoms = 1.

These are computed on demand, not maintained as state.

---

## What We're Removing

The following infrastructure from the old TugTextEngine is no longer needed:

- **Segment array as source of truth** — DOM is the source of truth
- **MutationObserver + handleMutations** — no model to sync
- **Reconciler (reconcile method)** — no model to render
- **domPosition / flatFromDOM mapping** — no parallel model to map between
- **ZWSP cursor anchors** — atoms are `<img>`, caret works natively
- **ce=false anchor spans** — no ce=false elements in the flow
- **rootPosition helper** — was compensating for ce=false caret issues
- **selectionchange handler for caret fixup** — caret positions correctly natively
- **Arrow key interception for basic navigation** — browser handles it (we only intercept Option+Arrow for word boundaries)
- **Two-step atom deletion state (highlightedAtomIndices)** — click selects the image natively, backspace deletes it
- **hasAdjacentAtom / needsZWSP logic** — no ZWSP, no anchors
- **Badge DOM creation (createAtomBadgeDOM)** — replaced by createAtomImgElement

---

## What We're Keeping (adapted)

- **Typeahead state machine** — `@` trigger, query filtering, accept/cancel/navigate. Tightly coupled to cursor position. Adapted to work with DOM-based cursor position instead of flat offset model.
- **Completion provider interface** — `(query: string) => CompletionItem[]` callback.
- **Drop handler interface** — `(files: FileList) => AtomSegment[]` callback.
- **Tugbank persistence** [L23] — serialize editor innerHTML + selection. Restore on mount.
- **Delegate API surface** — `getText()`, `getAtoms()`, `insertAtom()`, `focus()`, `clear()`, `getSelectedRange()`, `setSelectedRange()`. Implementations read/write DOM directly.

## What We're Removing (obsolete infrastructure)

The following was built to test and support the parallel editing engine. The engine is gone; the infrastructure goes with it.

- **TEOI (Text Editing Operation Inventory)** — formal catalog of editing operations as state machine transitions on a segment model. No segment model anymore.
- **TEOE (Text Editing Operation Examples)** — concrete test triples with incoming/outgoing `TugTextEditingState`. No `TugTextEditingState` anymore.
- **`tug-text-editing-operations.ts`** — the TEOI/TEOE framework, builder helpers, operation taxonomy. All of it.
- **`tug-integration-tests.ts`** — 154 integration tests that tested the old engine's model state, domPosition, flatFromDOM, ZWSP handling, etc. Not applicable to the new architecture.
- **`tug-text-visible-units.ts`** — visible units as pure functions over `Segment[]`. Needs reimplementation for DOM traversal if we want Option+Delete granularity.
- **`tug-atom-dom-tests.ts`** — tested the old ce=false badge DOM structure.
- **`/api/eval` test pipeline** — `__runIntegrationTests`, `__runTEOETests`, `__runIMETests`, `__runAtomDOMTests`, `__getTestDelegate`. The formal test suites are removed; the `/api/eval` endpoint itself stays as a general debugging tool.
- **`/api/key` (simulateKey)** — trusted key event simulation via NSEvent. Was needed because we intercepted arrow keys. We don't intercept basic navigation anymore.
- **Clone-and-marker caret measurement** — was compensating for unreliable caret positioning near ce=false elements. With `<img>` atoms, caret positions correctly. If we need caret measurement later, we can rebuild it, but it's not part of the core architecture.

---

## Principle: the spike is frozen

The IMG atom spike in `gallery-prompt-input.tsx` (the "IMG Atom Spike" section) is a **read-only reference** for the new architecture. It contains the proven patterns for atom creation, clipboard handling, drag & drop, word boundaries, key configuration, and selection guard integration.

The spike is preserved exactly as-is while we clean up and reimplement. None of the fresh tug-prompt-input implementation imports or depends on the spike code. The spike is a reference, not a dependency. Implementation code goes into proper standalone component locations (`tug-prompt-input.tsx`, `tug-prompt-input.css`, and supporting modules).

Once the properly-refactored tug-prompt-input is working and verified, the spike section is retired and deleted from the gallery card.

---

## Execution Order

### Step 1: Clean up — remove obsolete infrastructure

Remove the dead code from the old engine-based architecture. This comes first so we have a clean codebase before building the replacement.

- Delete `lib/tug-text-editing-operations.ts` (TEOI/TEOE framework)
- Delete `lib/tug-integration-tests.ts` (old integration test suite)
- Delete `lib/tug-atom-dom-tests.ts` (old atom DOM tests)
- Delete `lib/tug-text-visible-units.ts` (segment-model visible units)
- Remove `simulateKey` message handler from `MainWindow.swift` (trusted key events no longer needed — registration in `setupWebView`, handler in `userContentController`, teardown in `cleanupMessageHandlers`)
- Remove `loadLocalFile` method from `MainWindow.swift` (spike-only, not needed going forward)
- Remove `/api/key` endpoint from `tugcast/src/server.rs`
- Remove `__runIntegrationTests`, `__runTEOETests`, `__runIMETests`, `__runAtomDOMTests`, `__getTestDelegate` from gallery card (keep `/api/eval` endpoint as general debugging tool)
- Remove old `TugTextEditingState`, `captureEditingState`, `formatEditingState` from the engine (no parallel state model)
- Clean up gallery card: remove TEOE test runner UI, atom DOM test runner UI, integration test runner buttons. Keep the spike section and the interactive editor section.

### Step 2: Strip TugTextEngine

Gut the engine down to what we actually need. Remove:
- Segment array, normalizeSegments, cloneSegments
- MutationObserver + handleMutations + rebuildFromDOM
- Reconciler (reconcile method, domNodes, domChildren)
- domPosition, flatFromDOM, segmentPosition, rootPosition, hasAdjacentAtom
- ZWSP infrastructure, anchor span creation
- Arrow key interception for basic navigation (keep Option+Arrow for word boundaries)
- selectionchange handler for caret fixup
- highlightedAtomIndices, two-step deletion state
- Badge DOM creation (createAtomBadgeDOM)
- Kill ring, transpose, openLine (reimplement later if needed, directly on DOM)

Keep the shell: React component, useLayoutEffect setup, imperative handle, props interface, auto-resize, placeholder.

### Step 3: Implement the new architecture

Write the seven event handlers fresh, referencing the spike but not importing from it. Code goes into proper component locations:

- **`tug-prompt-input.tsx`** — React component with contentEditable div, event handler setup in useLayoutEffect, imperative handle for parent access
- **`tug-prompt-input.css`** — styling, `::selection` override, Custom Highlight suppression, line-height for stable layout
- **`lib/tug-atom-img.ts`** (new) — `createAtomImgElement`, `atomImgHTML`, SVG builder, canvas text measurement, icon paths. Standalone module, no dependency on the old tug-atom badge code.

The event handlers:
1. Atom creation and insertion (via execCommand insertHTML)
2. Clipboard (copy/cut/paste with atom preservation)
3. Drag & drop (files → atom images at drop point)
4. Option+Arrow (word boundary clamping at atoms)
5. Click on atom (select entire image)
6. Return/Enter (submit vs newline via data attributes)
7. Rich text blocking (see below)
8. Change detection (see below)
9. CSS setup (Custom Highlight suppression — in CSS file, not JS)

**Rich text blocking:** Without `-webkit-user-modify: read-write-plaintext-only`, the editor is a rich text surface. Users can paste formatted HTML from other apps, and Cmd+B/I/U could apply formatting. Block this:
- `beforeinput` handler: reject formatting inputTypes (`formatBold`, `formatItalic`, `formatUnderline`, etc.)
- Paste handler: when pasting non-atom HTML, strip all markup and insert as plain text via `execCommand("insertText")`
- This keeps the editor plaintext-with-atoms — no rich text leaks in

**Change detection:** Without MutationObserver, we need to know when content changes (for tugbank persistence, typeahead query updates, `onChange` callback). Use the `input` event — fires on every content change in contentEditable, including typing, deletion, paste, and execCommand operations. Lightweight, no DOM diffing.

**IME guards:** Every intercepted keydown handler must check `e.isComposing` and bail out during IME composition. This applies to: Option+Arrow, Return/Enter, and any future key handlers. Missing this would break Japanese, Chinese, Korean, and other IME-based input.

Read API: `getText()`, `getAtoms()`, `getSelectedRange()` — read directly from the DOM on demand.

### Step 4: Typeahead

Port the typeahead state machine. Adapted for DOM-based cursor position:
- `@` trigger detection via the `input` event (same change detection as above)
- Cursor-relative position: walk DOM backward from caret to find the `@` character and extract the query
- Popup positioned near cursor
- Completion provider callback
- Tab/Enter accepts, Escape cancels, arrow keys navigate
- Accepted completion → insert atom image at cursor

### Step 5: Persistence

Serialize editor state to tugbank on meaningful changes (detected via `input` event):
- **Not raw innerHTML** — data URIs are huge and WebKit may normalize HTML across sessions
- Lightweight representation: `{ text: string, atoms: { position: number, type: string, label: string, value: string }[] }`
- `text` contains plain text with U+FFFC at atom positions (same convention as before)
- On restore: rebuild the DOM from text + atom metadata, recreating atom `<img>` elements at the correct positions
- Cursor position: save as flat offset, restore via DOM walk
- Must survive reload, app quit, `just app` [L23]

### Step 6: Theme change handling

Atom SVG colors are baked into the data URI at creation time. When the theme changes:
- Walk the DOM for all `img[data-atom-label]` elements
- Read the atom metadata from data attributes
- Rebuild each atom's SVG with the new theme colors
- Replace the `src` attribute

This can be triggered by a theme change observer or callback from the theme system.

### Step 7: Testing

Simple, direct tests on the real editor. A test function that exercises the editor and reports pass/fail results — not a formal state-machine framework, but not "no tests" either:

- Type text, check DOM content via `getText()`
- Insert atom, check it appears via `getAtoms()`
- Cut/paste atom, check round-trip
- Option+Arrow near atoms, check caret stops at boundary
- Drag file, check atom created
- Return key, check newline or submit
- Paste rich HTML from external source, verify only plain text arrives (no formatting)
- IME composition, verify no interference from event handlers
- Theme change, verify atom colors update

Tests run in the gallery card on the real component.

### Step 8: Option+Delete and editing granularity

Option+Delete (word deletion) and other granularity operations need DOM-based boundary detection. This is real work — not a small remaining item:

- Walk the DOM backward/forward from cursor, counting characters, treating atoms and whitespace as boundaries
- Handle: Option+Delete (word backward), Option+Fn+Delete (word forward), Cmd+Delete (line backward)
- Atoms are word boundaries — Option+Delete from after an atom deletes the atom
- Emacs bindings (Ctrl+K/Y/T/O) adapted similarly

### Step 9: Remaining features

- Prefix detection (first-character routing)
- History navigation (up/down at document boundaries)
- Text truncation for long atom labels
- Auto-resize (1 row → maxRows)

### Step 10: Retire the spike

Once tug-prompt-input is working and verified with all the above features, remove the spike section from the gallery card. The gallery card's interactive editor section remains as the testing surface for the real component.

---

## Key Lessons

### The browser is smarter than us

We spent days building a parallel document model, reconciler, and caret fixup layer. The browser does all of this correctly for `<img>` elements. The lesson: use the browser's editing engine, don't replace it. Customize at the edges (clipboard, word boundaries, key config), not at the core (caret movement, undo, selection).

### contentEditable="false" is poison for inline elements

It works for block-level non-editable regions. For inline elements in a text flow, it breaks caret navigation in every browser. The entire web editing ecosystem (ProseMirror, Lexical, Slate) struggles with this. The fix: don't use it. Use `<img>` replaced elements instead.

### `-webkit-user-modify: read-write-plaintext-only` blocks image operations

It strips `<img>` elements from `execCommand("insertHTML")`, breaking atom paste. It also prevents the browser from inserting images via drop. Standard contentEditable with CSS Custom Highlight suppression is the correct setup.

### The selection guard's CSS Custom Highlights cause visual artifacts

The app's selection guard paints selection via the CSS Custom Highlight API. Inside a contentEditable with images, this causes spurious selection highlighting during arrow navigation. The fix: suppress Custom Highlights inside the editor element and re-enable native `::selection`.

### Tests must verify what the user sees

Automated tests that check model state but not visual behavior are dangerous — they pass while the product is broken. The clone-and-marker technique for caret measurement, and testing on the real interactive editor, are essential.

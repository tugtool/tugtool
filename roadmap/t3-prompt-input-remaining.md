# T3.2 Remaining: Prompt Input Completion

*Final items for tug-prompt-input before moving to T3.3 (Stores) and T3.4 (tug-prompt-entry).*

---

## Audit: T3.2 Exit Criteria

Status of each exit criterion from [tide.md](tide.md) T3.2:

| Criterion | Status | Notes |
|-----------|--------|-------|
| Text input with atoms: caret, selection, undo/redo | ✅ Done | Native WebKit, `<img>` replaced elements |
| Atoms render as `<img>` with SVG: icons, text, theme | ✅ Done | tug-atom-img.ts, regenerateAtoms on theme change |
| Auto-resize (1 row → maxRows) | ✅ Done | autoResize(), growDirection prop |
| Prefix detection identifies route | ❌ Not started | First-character routing (`>`, `$`, `:`, `/`) |
| `@` file completion works | ✅ Done | CompletionProvider interface, mock in gallery |
| `/` slash command completion works | ❌ Not started | Needs a second trigger character + provider |
| Drag-and-drop file → atom | ✅ Done | Drop caret, caretRangeFromPoint, atom insertion |
| Copy/cut/paste preserves atoms | ✅ Done | HTML + plain text clipboard, insertHTML |
| Option+Arrow stops at atom boundaries | ✅ Done | Range.compareBoundaryPoints clamping |
| History navigation works | ✅ Done | HistoryProvider, Cmd+Up/Down |
| IME composition works | ✅ Done | _composing + _compositionJustEnded |
| Return/Enter key config with Shift | ✅ Done | Native newline, configurable submit/newline |
| No -webkit-user-modify | ✅ Done | Standard contentEditable |
| CSS Custom Highlight suppression | ✅ Done | ::highlight(card-selection) transparent |
| Token-compliant styling | ✅ Done | focusStyle, borderless, selection tokens |
| Gallery card with testing surface | ✅ Done | Spike retired, clean gallery card |
| Editing state persists [L23] | ✅ Done | captureState/restoreState via tugbank |

**Two gaps:** prefix detection and `/` slash command completion.

---

## Item 1: Slash Command Completion

**Goal:** Add a `/` trigger for command completion, parallel to the existing `@` trigger for file completion.

**Design:**

The engine already has `CompletionProvider` for `@`. Rather than adding a second provider interface, generalize the typeahead system to support multiple trigger characters, each with its own provider.

**Approach A — multiple providers (recommended):**
- New engine config: `completionProviders: Map<string, CompletionProvider>` replacing the single `completionProvider`
- `detectTypeaheadTrigger` checks the character before the caret against all registered triggers
- The rest of the typeahead state machine is unchanged — it already tracks `anchorOffset`, `query`, `filtered`, `selectedIndex`
- The component prop becomes `completionProviders?: Record<string, CompletionProvider>`

**Approach B — single provider with trigger:**
- Keep single `completionProvider` but pass the trigger character to it: `(trigger: string, query: string) => CompletionItem[]`
- Provider decides what to return based on trigger
- Simpler engine change, but conflates two data sources

Recommendation: **Approach A.** Clean separation. Each trigger maps to exactly one provider. When T3.3 connects real data sources, the wiring is obvious.

**Component prop change:**
```typescript
// Before
completionProvider?: CompletionProvider;
// After  
completionProviders?: Record<string, CompletionProvider>;
```

**Gallery card mock:**
```typescript
const providers = {
  "@": galleryFileCompletionProvider,
  "/": galleryCommandCompletionProvider,
};
```

The gallery card already has `TYPEAHEAD_FILES` for `@`. Add a `TYPEAHEAD_COMMANDS` array for `/` with mock slash commands.

---

## Item 2: Prefix Detection

**Goal:** First-character routing for tug-prompt-entry integration.

**Design:**

When the user types as the first character of the document:
- `>` → AI route (Claude Code)
- `$` → shell route (future)
- `:` → surface command route (local)
- `/` → slash command mode (implies `>` route)

The prefix character is consumed (not displayed) and the route is communicated to the parent via a callback.

**Engine additions:**
- `onRouteChange?: (route: string) => void` callback
- In the `input` event handler, after content changes, check if the document starts with a route prefix
- If the first character matches a route prefix, remove it from the DOM (via execCommand delete) and fire `onRouteChange`

**Component prop:**
```typescript
onRouteChange?: (route: string) => void;
```

**Note:** This is a thin integration point. The actual route state lives in tug-prompt-entry (T3.4), not in the input. The input just detects the prefix and notifies.

---

## Item 3: Maximize Mode

**Goal:** Allow the prompt input to expand beyond its `maxRows` limit to fill available space, for serious prompt authoring.

**Rationale:** Prompt authoring is a first-class activity. Cramped input fields are a relic of form-based UIs. When the user wants to write a detailed prompt, the input should be able to grow to fill the available vertical space — potentially the entire card height — scrolling only when *that* bound is exceeded.

**Design:**

New prop: `maximized?: boolean` (default `false`).

When `maximized` is true:
- The `maxHeight` constraint is replaced by the available height of the containing block
- The editor grows to fill the container, minus any siblings (toolbar, route indicator, etc.)
- Scrolling only kicks in when the content exceeds the container's available height
- The `growDirection` prop still applies (upward or downward growth)

**Implementation approach:**

CSS-driven with a data attribute (L06):
- `data-maximized="true"` on the editor element
- CSS: `.tug-prompt-input-editor[data-maximized]` sets `flex: 1; min-height: 0;` and the parent container uses `display: flex; flex-direction: column;`
- The `autoResize` method skips its height calculation when maximized — CSS flex handles it
- `overflow-y: auto` always, since the flex container constrains the height

**Toggle mechanism:**
- The parent (tug-prompt-entry or gallery card) controls the `maximized` prop
- Keyboard shortcut: Cmd+Shift+M (or similar) toggles maximize — handled by the parent, not the input
- Visual affordance: a maximize/minimize button in the prompt entry toolbar

**Container requirement:**
- The prompt input's parent must be a flex column container with a defined height for maximize to work
- This is naturally the case inside tug-prompt-entry (which fills a card's content area)

---

## Execution Order

1. **Slash command completion** — generalizes the existing typeahead to multiple triggers. Low risk, builds directly on proven infrastructure.
2. **Prefix detection** — thin notification layer. Minimal engine change.
3. **Maximize mode** — CSS-driven expansion. The autoResize change is small; the real work is ensuring the flex container layout works in the gallery card and future prompt entry.

All three items prepare tug-prompt-input for integration into T3.4 (tug-prompt-entry).

---

## Exit Criteria (for this remaining work)

- `/` trigger opens command completion with a separate provider
- Multiple trigger characters work simultaneously (`@` and `/`)
- First-character prefix detection fires `onRouteChange` callback
- Route prefixes are consumed (not displayed in the editor)
- `maximized` prop expands the editor to fill available container space
- Gallery card demonstrates all three features with mock data
- Existing features (atoms, clipboard, IME, history, drag-drop) unaffected

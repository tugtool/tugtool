# TugPromptEntry — polish + split-pane integration

**Status:** Drafting (rev 2 — user review applied)

**Parent roadmap:** [tide.md § T3.4.b](tide.md#t3-4-b-prompt-entry) — lands **between** T3.4.b (the base component) and T3.4.c (the Tide card / real backend wiring). Scoped to make the gallery card drive visible polish on the component before the real Tide mount; keeps backend composition unchanged.

**Why this is a separate doc:** `tugplan-tug-prompt-entry.md` shipped a component that assumed a self-contained card wrapper. Once the gallery card hosts the entry inside a `TugSplitPane`, several assumptions break:
- The entry's outer border competes with the pane's frame.
- The entry's fixed-height chrome doesn't stretch, so most of the pane is empty.
- The input's fixed `maxRows` ceiling never exercises the pane's vertical budget.
- The split pane's grabber pill dominates the UI on cards where it shouldn't.

These are layout/integration issues — not defects in the component itself — so they get their own plan rather than retrofitting the original.

---

## Requirements (from user review of gallery card)

1. **Hide the box border on the lower pane.** When `TugPromptEntry` fills a pane, its outer `1px border` is redundant with the pane's surrounding chrome and reads as a double-stroke.
2. **Entry always fills its split pane.** The entry should stretch to fill the pane's height, not hug its content at the top.
3. **Tools pinned to bottom.** The route indicator + submit button row sits at the *bottom* of the entry, not immediately beneath the input. The gap between the input and the toolbar is empty input space (or transcript overflow, in T3.4.c).
4. **Input fills the space between the top of the entry and the toolbar.** Scrolling only starts when the input can no longer grow its containing pane.
5. **Input grows upward on Return, pushing its pane upward.** *(New feature.)* Adding a line to the input should expand the input's height; that expansion should push the split-pane sash upward, reducing the top pane's size. The input does not scroll internally until the pane is at its max allowed size.
6. **Bottom pane max 85% of the split pane's height.** Hard cap; when the pane hits 85%, further input growth switches to internal scrolling.
7. **Split pane — option to hide the grabber pill.** The grip pill on the sash is too prominent for this card. Add a prop to hide it (the sash line itself stays draggable; only the pill visual is suppressed).

**Added in rev 2 (user review):**

8. **File completion (`@`) must work in the gallery card.** The current card wires `fileCompletionProvider: () => []`, so `@`-trigger completion lists nothing. Wire the same provider the `gallery-prompt-input` card uses (`FileTreeStack` → file provider + command provider for `/`).
9. **TugBox needs a "zero-padding" option applied to the entry pane's box.** The entry-pane currently uses a plain `<div>` with `padding: var(--tug-space-sm)`. Swap it for a `TugBox` set to no inset so the entry truly fills the pane from edge to edge. (Existing `inset={false}` prop covers this — verify it fully zeros padding rather than just toggling a modifier class.)

---

## Track A — TugSplitPane polish {#track-a}

Scope: `tug-split-pane.tsx` + `.css`, and the gallery card's usage. Small, self-contained, non-breaking.

**A1. `showHandle` prop on `TugSplitPane`.**
- Signature: `showHandle?: boolean` (default `true`).
- Rendering: when `false`, the interleaved `<Separator>` still renders with its full hit area and keyboard affordance, but the handle pill (`.tug-split-sash-handle`) is visually suppressed (`display: none` or `visibility: hidden` — leaning `display: none` so the pill doesn't reserve space).
- Accessibility: the sash keeps its role/aria; only the decorative pill is hidden. The sash line (`::before`) stays visible so users still see *where* to drag.
- CSS approach: add `data-handle-hidden` attribute on `.tug-split-pane` or on each `.tug-split-sash`; style rule hides `.tug-split-sash-handle` when set. The handle's child `.tug-split-sash-grip` is inside the pill, so one selector covers both.

**A2. Gallery card uses `maxSize="85%"` on the bottom panel.** No new API — `TugSplitPanel` already supports `maxSize`. One-line change in `gallery-prompt-entry.tsx`.

**A3. Gallery card passes `showHandle={false}`.** One-prop change after A1 lands.

**Acceptance:**
- Dragging still works; sash line still visible.
- Gallery card: pill is gone; bottom panel can't exceed 85%.
- Other cards using `TugSplitPane` unaffected (`showHandle` defaults to `true`).

**Open questions:** none significant. `showHandle` is the standard name; alternatives (`hideGrabber`, `noHandle`) all work — going with `showHandle` for consistency with the existing React convention ("show/hide as boolean prop").

---

## Track B — TugPromptEntry as pane-filler {#track-b}

Scope: `tug-prompt-entry.tsx` + `.css`, and the gallery card's wrapper CSS. Bigger than Track A but still a layout reshuffle — no new feature.

**B1. Entry fills its container.**
- `.tug-prompt-entry` gets `flex: 1 1 auto; min-height: 0; height: 100%` so it stretches in a flex-column parent.
- Gallery card's `.gallery-prompt-entry-entry-pane` already is `display: flex; flex-direction: column`; the entry child just needs the flex grow.

**B2. Toolbar pinned to bottom.**
- Entry is already `display: flex; flex-direction: column`. Give the input wrapper `flex: 1 1 auto` so it consumes remaining space; the toolbar (second flex child) naturally stays at the bottom.
- No change to JSX order — the toolbar is already the second child.

**B3. Input fills the wrapper.**
- Pass `maximized` to `TugPromptInput` from inside the entry. The prop already exists and handles the flex chain (`.tug-prompt-input[data-maximized]` → `flex: 1`, editor → `flex: 1; overflow-y: auto`).
- When `maximized`, the input's editor takes all remaining space and scrolls internally when content overflows — exactly matching requirement #4.

**B4. Hide the entry's outer border when pane-filling.**

Two options:

- **(B4a) Unconditional removal.** Drop the `border` + `border-radius` + `padding` from `.tug-prompt-entry` entirely. Rationale: a component's outer chrome is a host concern; the entry was never meant to be used standalone anyway (the card always wraps it). Simpler, but a behavior change for anyone mounting the entry without a card.
- **(B4b) Prop-gated.** Add `chromeless?: boolean` (default `false`) that strips the outer border + radius + padding. The gallery card passes `chromeless`; future callers keep the current look unless they opt in.

**Recommendation: (B4a).** The outer border was added speculatively and turns out to always be double-stroke when used in practice. The component's real contract is "fill my parent"; the parent (card / pane / sheet) owns any framing.

**B5. Gallery card wrapper CSS.**
- Drop the extra padding on `.gallery-prompt-entry-entry-pane` (or reduce it) so the entry sits flush with the pane edges, letting the pane's frame do the visual separation.

**B6. Entry pane is a `TugBox` with `inset={false}` (rev 2).**
- Replace the plain `<div className="gallery-prompt-entry-entry-pane">` with `<TugBox inset={false} variant="plain">`. The existing `inset?: boolean` prop on `TugBox` already supports zero padding — verify the CSS fully zeros padding on `.tug-box[data-inset="false"]` (or the equivalent selector) rather than just nudging it down.
- If verification shows the prop doesn't fully zero padding, fix `tug-box.css` as part of this ticket — do not paper over it with a one-off override in the card.
- `variant="plain"` keeps the box invisible (it's a functional wrapper, not a framed surface).

**Acceptance:**
- Entry fills the bottom panel vertically.
- Toolbar sits at the pane's bottom edge regardless of input content.
- Single-line input: entry is mostly empty space above a single line of text; toolbar at bottom.
- Multi-line input (via `maximized` + natural content growth): the editor fills the available space and scrolls internally when overfull.
- No double border.

**Open questions:**
- **B4 choice.** Going with B4a unless a current caller depends on the outer border. A quick grep confirmed the only current caller is the gallery card itself.
- **Token pairing fallout.** If B4a removes the border, the `@tug-pairings` entry for `.tug-prompt-entry (border) — unified outer ring` disappears. That's one pairing fewer, no violation — but update the compact + expanded blocks and step-7's grep invariants won't regress.

---

## Track C — Content-driven panel sizing in TugSplitPane {#track-c}

**User directive (rev 2): the feature lives inside TugSplitPane. The card is a consumer that supplies inputs; it does not implement policy.** That flips my earlier recommendation. The card should be able to opt in with a prop or two and let the split pane do the work.

Scope: `tug-split-pane.tsx` (+ `.css`), with minimal opt-in from the consumer. `TugPromptInput` / `TugPromptEntry` remain unchanged by this track — the split panel observes the DOM directly.

### Goal

Adding a line to the input expands the input's rendered height; that expansion propagates upward through the entry to the split panel, causing the panel to grow toward `maxSize` and the sibling panel to shrink. When the user submits (input clears, scrollHeight collapses back), the sash **animates back to the user-set position**. The user-set position is remembered across typing sessions but not across page reloads unless `storageKey` is set.

### Sizing model (the rule in one line)

```
panel.currentSize = clamp( max(userSetSize, contentNeededSize), minSize, maxSize )
```

- `userSetSize` — the size the user last dragged the sash to. Defaults to `defaultSize`. Remembered for the panel's lifetime; persisted via `storageKey` when set.
- `contentNeededSize` — the natural size of the panel's content (from ResizeObserver).
- When content shrinks below `userSetSize`, the panel returns to `userSetSize` (animated, per requirement #5). This is the "prompt-by-prompt allowance": temporary expansion past `userSetSize`, automatic return afterward.
- When `contentNeededSize` exceeds `maxSize`, the content's own `overflow` (the input's `maximized` mode from Track B) scrolls internally.

### Proposed API

**C1. `TugSplitPanel` gains a content-observation prop.**

```tsx
interface TugSplitPanelProps {
  // ...existing...

  /**
   * Ref to an element whose `scrollHeight` (horizontal-sash pane) or
   * `scrollWidth` (vertical-sash pane) drives this panel's minimum
   * content-needed size. When set, the panel installs a `ResizeObserver`
   * on the element and resizes itself so the panel is at least as large
   * as the observed element, clamped by `minSize` / `maxSize`.
   *
   * The panel's `userSetSize` (from manual drags) is preserved — the
   * panel's effective size is `max(userSet, contentNeeded)` clamped to
   * the configured bounds. When content shrinks below `userSet`, the
   * panel animates back to `userSet`.
   *
   * The observation is DOM-driven [L22] — no React state is pulled
   * through `useSyncExternalStore` just to fire an imperative resize.
   */
  autoSizeFromRef?: React.RefObject<HTMLElement | null>;

  /**
   * Duration (ms) of the shrink-back animation when content shrinks
   * below `userSetSize`. Growth is immediate (no animation); only the
   * return-to-user-size transition animates. Set to 0 to disable.
   * @default 200
   */
  autoSizeReturnDuration?: number;
}
```

**C2. Gallery card wiring (tiny).**

```tsx
const editorRef = useRef<HTMLElement | null>(null);
// ...
<TugPromptEntry
  // (new in rev 2: expose the editor element through the existing delegate)
  inputMeasureRef={editorRef}
  ...
/>
// ...
<TugSplitPanel
  defaultSize="30%"
  minSize="15%"
  maxSize="85%"
  autoSizeFromRef={editorRef}
>
  { /* entry */ }
</TugSplitPanel>
```

One prop on the panel plus one ref thread — that's it. All policy lives in the panel.

**C3. Thin ref pass-through on `TugPromptEntry` / `TugPromptInput`.**

The split panel needs a ref to the element it's observing — concretely, the input's editor `<div>`. Options:

- **(C3a) Expose `inputMeasureRef` prop on TugPromptEntry** that forwards to TugPromptInput which attaches it to the editor element. Zero logic — it is a plumb-through ref. Pairs with the existing `getEditorElement()` method on the input delegate, but a ref is cheaper than imperative calls in this case because ResizeObserver needs the Node directly.
- **(C3b) TugSplitPanel accepts a `measureSource` that can be either a ref or a function returning a px number.** Lets the consumer use `() => entryDelegateRef.current?.getEditorElement()?.scrollHeight ?? 0` instead of wiring a ref. More flexible but adds a second contract.

**Recommendation: C3a.** One contract, law-aligned (the panel observes a DOM node directly — no callback round-trip).

**C4. Animation.**

- **Growth direction (expanding past userSetSize):** instant. Setting an interactive input taller as the user types should not visibly lag behind the keystrokes.
- **Shrink-back direction (returning to userSetSize):** animated over `autoSizeReturnDuration` ms.
- **Mechanism:** per [L13], use CSS `transition` on the library's resize hook if possible; fall back to [TugAnimator](../tugdeck/src/components/tugways/tug-animator.tsx) driving frame-by-frame calls to `panel.resize(pct)` with a cubic-ease curve. **Not** `requestAnimationFrame` directly [L13].
- **Accessibility:** respect `prefers-reduced-motion` — when the user prefers reduced motion, skip the transition and snap to `userSetSize`.

**C5. User-drag vs. content-driven sizing (C5c policy).**

- The panel observes the library's own layout-change events (already wired via `onLayoutChanged` inside TugSplitPane) to update its `userSetSize` ref whenever the user releases a drag.
- When content grows and forces the sash above `userSetSize`, the drag handle remains interactive — the user can still drag, and a drag mid-grow commits a new `userSetSize`.
- Persistence: when `storageKey` is set, `userSetSize` is saved via the existing tugbank channel. The content-driven instantaneous size is **not** persisted — only the user's anchor.

### What does NOT need to ship in Track C

- No new state in `TugPromptEntry` or `TugPromptInput`. They stay pass-throughs (C3 adds a thin ref prop).
- No new engine-level feature. The engine already surfaces editor `scrollHeight`; the split panel observes it directly via ResizeObserver.
- No changes to `CodeSessionStore`, the route indicator, the submit flow, or the toolbar.

### Resolved (rev 2) open questions

- **Where does policy live?** ✅ TugSplitPane/TugSplitPanel. Card just wires a ref + prop.
- **ResizeObserver performance?** ✅ Accept the risk; smoke-test as part of C1. Modern browsers coalesce RO callbacks off the main-thread paint cycle; a single observer on a single editor is negligible.
- **Persistence interaction?** ✅ Persist only `userSetSize`. Content-driven expansion is ephemeral and does not write to tugbank. On mount, read `userSetSize` via the existing `storageKey` path and use it as the anchor; first content observation may grow past it immediately.

### Remaining open questions

- **Chrome offset.** The ResizeObserver sees the editor's `scrollHeight`, but the panel needs to size itself to hold the editor *plus* the toolbar *plus* any entry padding. Two options:
  - (a) Consumer passes `autoSizeChromeOffset={px}` alongside the ref.
  - (b) Panel observes its whole content wrapper (so chrome is included automatically) but then needs a way to distinguish natural content height from stretch-to-fill height — not trivial when the content is `flex: 1`.
  - Leaning (a) — explicit and simple, even though it asks the consumer for one constant.
- **Multiple content sources.** What if a future card wants both panels content-driven? The current design assumes at most one content-driven panel per group (the library enforces a single anchor per drag). If we ever need multi-source, revisit — not a blocker for T3.4.b/c.

---

## Track D — File completion in the gallery card (rev 2) {#track-d}

Scope: `gallery-prompt-entry.tsx` only. Adopt the provider wiring the `gallery-prompt-input` card already uses.

**D1. Wire a real `fileCompletionProvider`.**

The existing gallery card mock services use `fileCompletionProvider: () => []`. The `gallery-prompt-input` card already sets up a `FileTreeStack`-backed provider; reuse that pattern in `buildMockServices()`:

```tsx
const fileTreeStack = createFileTreeStack(/* test fixture or the same source as gallery-prompt-input */);
return {
  // ...
  fileCompletionProvider: fileTreeStack.provider,
};
```

**D2. Optional: command completion for `/` trigger.**

`gallery-prompt-input` also wires a command completion provider for `/`. `TugPromptEntry` today accepts only a single `fileCompletionProvider`. Two choices:

- **(D2a) Keep the entry at file-only for now.** Command completion is T10 territory; the entry plan already left a `localCommandHandler` seam. Don't add `@`-family multi-trigger now.
- **(D2b) Generalize the prop.** Rename `fileCompletionProvider` → `completionProviders: Record<string, CompletionProvider>` on `TugPromptEntry` to match what `TugPromptInput` already takes. The gallery card would pass both providers; future callers get symmetry with the underlying component.

**Recommendation: D2b.** The entry's current `fileCompletionProvider` is already a narrowed version of the input's `completionProviders`; the narrowing was speculative (T3.4.b didn't exercise multi-trigger) and will be un-done by T10 anyway. One generalize-now beats a rename-later. Preserves the existing call site by accepting either shape during a deprecation window if that's cleaner.

**D3. Gallery card's mock fixture matches the `gallery-prompt-input` card.**

Whatever source the sister card uses (a mock file tree, a fixture subdirectory), the entry card uses the same so both demo the same `@`-trigger experience.

**Acceptance:**
- Type `@` in the entry; completion menu opens with file results.
- Type `/` (if D2b lands); command completion menu opens.
- Keyboard navigation + accept/cancel match `gallery-prompt-input`'s behavior.

**Open questions:**
- **D2a vs D2b**: ship-able either way; recommend D2b.
- **Is there a shared helper for "build a mock file completion provider" both gallery cards can import?** If `gallery-prompt-input`'s `fileTreeStackRef` setup is self-contained, extract it into `cards/gallery-mock-completion.ts` (or similar) so both cards import the same factory. Mechanical refactor, easy to defer.

---

## Delivery order and rough sizing

| # | Track | Change | Size | Risk |
|---|------|--------|------|------|
| 1 | A1 | `showHandle` prop on `TugSplitPane` | XS (~20 LOC + one CSS rule) | Low |
| 2 | A2+A3 | Gallery card uses `maxSize="85%"` + `showHandle={false}` | XS (2 prop additions) | Low |
| 3 | B1+B2+B3 | Entry fills + toolbar pinned + input `maximized` | S (flex tweaks) | Low |
| 4 | B4 | Remove outer border + update pairings | S (CSS + pairings doc) | Low |
| 5 | B5+B6 | Gallery wrapper as `TugBox inset={false}` | XS (+ verify/fix TugBox if needed) | Low |
| 6 | D1 | Wire real `fileCompletionProvider` in gallery card | XS–S (reuse sister-card fixture) | Low |
| 7 | D2b | Generalize entry's completion prop → `completionProviders` map | S | Low |
| 8 | C1 | `TugSplitPanel.autoSizeFromRef` + sizing model | M (ResizeObserver + drag-anchor + clamp) | Med |
| 9 | C3a | Thin `inputMeasureRef` plumb-through on entry + input | XS | Low |
| 10 | C2 | Gallery card wires the ref + prop | XS | Low |
| 11 | C4 | Shrink-back animation (CSS or TugAnimator, respects `prefers-reduced-motion`) | S | Med |
| 12 | C5 | Drag-vs-content anchor persistence (storageKey writes only `userSetSize`) | S | Low |

**Commit grouping (proposal):**
- **Commit 1 — Polish:** items 1–7 (Track A + B + D). Pure layout, visibility, and wiring. No new machinery.
- **Commit 2 — Content-driven sizing:** items 8–12 (Track C). Introduces ResizeObserver + the sizing model + animation. Separate so it can be reviewed in isolation and reverted independently if the ergonomics turn out wrong.

## Tests

- **Track A:** snapshot the gallery card; confirm `.tug-split-sash-handle` is not in the DOM (or is `display: none`). Unit: `showHandle={true}` default keeps the pill.
- **Track B:** rendering test — entry root has no `border` computed style (when B4a lands); entry + toolbar both render; input's wrapper has `data-maximized`.
- **Track C:** unit — mounting the input with a known `scrollHeight` fires `onDesiredHeightChange` with the matching value. Integration — simulate content growth and assert the bottom panel's `resize()` is called with a clamped value. The C5c rule: simulate a manual drag to a larger size, then content growth; assert no override.

## Out of scope

- **Transcript / message-list surface in the top pane.** That's T3.4.c's territory; this plan leaves the top panel empty.
- **Re-wiring the existing `growDirection="up"` prop.** The prop stays untouched; Track C works independently of it (though it reads nicest with `growDirection="up"` so the input's top edge rises while the bottom stays anchored to the toolbar).
- **Sash persistence.** Whatever `storageKey` behavior the gallery card picks is its own choice; this plan does not add or remove it.

## Where to land

- New work lives on `main` (no worktree needed per current workflow).
- Commits are small-batched by track: one "polish" commit for Tracks A + B + D, one "content-driven sizing" commit for Track C.
- No migration / feature flag — the component's caller set is small enough (gallery card + forthcoming Tide card) that changes apply to all callers immediately.

---

## Appendix — Tuglaws compliance review {#law-review}

User asked for an explicit check against [tuglaws.md](../tuglaws/tuglaws.md) for the content-driven sizing approach. Verdict: compliant, with implementation guardrails listed below.

| Law | Applies? | How this plan complies |
|---|---|---|
| **L01** one root.render | Indirect | No change — everything routes through the existing `root.render` at app mount. |
| **L02** external state via `useSyncExternalStore` | **Yes, and deliberately avoided** | Panel size is DOM-observable external state. We do **not** pull it through `useSyncExternalStore` to render against it — that would force a React commit on every `scrollHeight` tick, which is exactly what L22 warns against. The panel observes the DOM directly and imperatively calls the library's `resize()`. `storageKey`-persisted `userSetSize` *is* read via `useSyncExternalStore` (that path already exists in `TugSplitPane`) because it drives a React-owned prop (`defaultSize`); the content-driven tick does not. |
| **L03** useLayoutEffect for event-dependent registrations | **Yes** | The `ResizeObserver` install happens in `useLayoutEffect` so the observer is wired before the first paint can fire a size event. Same pattern the split pane already uses for its library-handle ref. |
| **L04** never measure child DOM inline after child setState | N/A | No parent effect triggers a child `setState` here. The DOM measurement is always done asynchronously by the RO callback. |
| **L05** no RAF for React-state-dependent ops | **Yes** | The shrink-back animation is driven by CSS transition or TugAnimator (see C4). No `requestAnimationFrame` inside the sizing loop. |
| **L06** appearance state in DOM, not React | **Yes** | Panel size is *data* by the L06 test ("does any non-rendering consumer depend on this state?" — yes: persistence, drag handlers, and the content-driven resize policy all consume it). Data is allowed to flow through React when needed. The ephemeral *mid-transition* size while the shrink animation runs is appearance — no React state update for it; the animation writes directly. |
| **L07** handlers read current state via refs | **Yes** | The panel stores `userSetSize`, `maxSize`, `minSize`, the library's `PanelImperativeHandle`, and the content-source element in refs. The RO callback reads all of them via refs — no stale closure. |
| **L08** mutation-transaction zone rules | Partial | The drag interaction is already a *continuous* control (every intermediate size is committed) — L08 does not apply to it per the law's "continuous controls" carve-out. The content-driven resize is likewise a continuous write — no draft/commit split. |
| **L09 / L10** card chrome vs card content | N/A | Not a card-level change. |
| **L11** controls emit, responders own state | **Declared exempt** | TugSplitPane already declares itself L11-exempt in its module docstring ("TugSplitPane is a layout primitive, not a control"). Adding content-driven sizing stays inside that carve-out — it is still a layout primitive, the callback-free. |
| **L13** CSS / TugAnimator / RAF carve-outs | **Yes** | Shrink-back animation goes through CSS transition first, TugAnimator as a fallback. No RAF. Reduced-motion respected. |
| **L15–L18, L20** token laws | **Yes** | Any new CSS (the `showHandle={false}` rule, the border removal on `.tug-prompt-entry`) stays within the existing split-pane / prompt-entry token slots. No cross-component token reach-ins. Pairings get updated where the declarations change (Track B's border removal; any new handle-visibility rule has no color declaration so no `@tug-pairings` change needed). |
| **L19** component authoring guide | **Yes** | New props (`showHandle`, `autoSizeFromRef`, `autoSizeReturnDuration`) follow the existing TugSplitPane prop style: JSDoc, `@selector` / `@default` tags, data-attribute mirroring where visual. |
| **L20** composed children keep their tokens | **Yes** | `TugPromptEntry`-in-`TugSplitPanel` composition is unchanged; neither reaches into the other's tokens. |
| **L21** third-party licensing | N/A | No new dependency. `react-resizable-panels` is already in use. |
| **L22** direct DOM updates observe the store, not React-state round-trip | **Yes, primary law governing this design** | The `ResizeObserver` → `panel.resize()` path is exactly the DOM-driven observer pattern L22 endorses. We do **not** pull the content height into React state via `useSyncExternalStore` just to trigger a resize — that would inject React's scheduling (re-render → paint → effect) between the content change and the resize call, producing exactly the kind of frame delay L22 warns about. |
| **L23** internal ops preserve user-visible state | **Yes** | The resize never clobbers scroll position, selection, or focus. The library's `resize()` preserves the underlying DOM; our content observer does not rebuild or remount anything. User's drag-set anchor is preserved across every content tick (that is the whole point of the sizing model). |

**Implementation guardrails (carry forward into the coder's step):**

1. `ResizeObserver` install site: `useLayoutEffect`, empty deps aside from the ref contents — subscribe once per panel lifetime.
2. Policy params (`userSetSize`, `maxSize`, `minSize`, panel handle, source ref) live in refs. No closures over React state.
3. The resize call path is purely imperative: RO callback → compute target pct → `panelHandle.current?.resize(pct)`. No React setState on this path.
4. The shrink-back animation uses CSS `transition` on a declarative property the library honors, or TugAnimator driving a target value. **Never** `requestAnimationFrame` inside the plan's sizing code.
5. Persistence writes only happen in the existing `handleLayoutChanged` path (user drag released), not in the content-driven RO callback.
6. Tests cover the ref-based observer path end-to-end with a fake `ResizeObserver` shim so there is no happy-dom flakiness.

### Specific answer to "does `onDesiredHeightChange` comply with tuglaws?"

Under the rev-2 architecture, `onDesiredHeightChange` **no longer exists**. The pivot to "TugSplitPane owns the feature" eliminated the callback. That was the right call on L22 grounds: the callback design routed a DOM-observable signal through user-space React callbacks before re-entering the DOM as an imperative resize. The new architecture keeps the entire observation → resize loop inside the panel's own DOM-driven subsystem, which is exactly the L22 shape.

If we had kept the callback approach, it would have been *defensible* but awkward: the consumer would have had to use refs (L07) and useLayoutEffect (L03) and keep the callback off the React render path (L22), which is a lot of ceremony to put on every consumer. The panel-owns-it design makes the law-compliant path the default.

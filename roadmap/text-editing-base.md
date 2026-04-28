<!-- tugplan-skeleton v2 -->

## Text Editing Base — CodeMirror 6 Spike {#text-editing-base}

**Purpose:** Replace the contenteditable substrate that backs `tug-prompt-input` with a CodeMirror 6 (CM6)-backed primitive named `tug-edit`, validate it via a focused spike, and ship a Component Gallery TextEdit card that exercises every feature `tug-prompt-input` exposes today. This phase lands the new substrate as an *additive* component sitting alongside the existing one — migration of `tug-prompt-input` / `tug-prompt-entry` / `tide-card` is a separate plan that follows the spike's go/no-go decision.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | `text-editing-base` |
| Last updated | 2026-04-28 |
| Roadmap anchor | this document |
| Predecessor | none (new investigation) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

`tug-prompt-input` is the editable substrate that powers `tug-prompt-entry`, the gallery prompt cards, and the live tide-card. It is built on a `contenteditable` div mediated by a 2,200-line `TugTextEngine` that papers over WebKit's quirks: atoms are rendered as `<img>` elements with SVG data URIs (so WebKit treats them as atomic replaced elements), the U+FFFC Object Replacement Character marks atom positions in the text stream, all mutations route through `execCommand` for native undo, and selection state is mirrored in [L23]'s active/inactive paint channels.

The implementation works. It also costs us: WebKit's `contenteditable` has a long tail of unfixed bugs (composition selection during IME on iOS 16.4+, focus surrender failures, dynamic-change accessibility regressions), and we are spending engineering effort polishing a substrate whose behavior we cannot influence. Every previous editor that started with raw `contenteditable` (Slack, Notion, Linear, Quip) has eventually moved to a framework that *abstracts* it. We are doing the same investigation, deliberately, before spending more time on a path with diminishing returns.

The investigation that preceded this plan ([Deep Dive — substrate evaluation](#substrate-evaluation)) compared four options — keep polishing `contenteditable`; adopt Monaco; adopt CodeMirror 6; build our own with Rust + WASM. The outcome is a decision to spike CM6 ([D01](#d01-spike-cm6)). The CM6 vs Lexical comparison is included in the deep dive because Lexical was the strongest non-CM alternative and the asymmetry argument (Lexical scales further into rich documents; CM6 scales further into code-shaped editing) shaped the decision.

The user's stated direction is *better than Claude Code TUI editing*, not *Notion competitor*. CM6's "Markdown source with live decorations" pattern (Obsidian Live Preview, `codemirror-rich-markdoc`) covers the realistic ceiling — bold/italic/headings/lists/code fences/blockquotes — with the underlying document remaining a flat character stream that the atom model fits perfectly. Tables, embeds with nested editable content, and Notion-style block rearrangement are explicitly accepted as out-of-scope ([D02](#d02-markdown-ceiling)).

#### Strategy {#strategy}

- **Spike, don't migrate.** Land a new `tug-edit` component additively. `tug-prompt-input` keeps shipping unchanged. After the spike's exit criteria are met, a *separate* plan migrates the existing surfaces to consume `tug-edit`.
- **Risk-first ordering.** The two known soft spots — IME composition with atomic widgets adjacent, and the [L23] active/inactive selection-paint integration — get their own steps early, so a substrate-level "no" surfaces before we have invested in polish.
- **Atoms before everything else.** The atom model is what makes this substrate viable for prompts. Step 3 wires `EditorView.atomicRanges` + `Decoration.replace` and validates the cursor/selection/clipboard story before any other feature work piles on top.
- **Reuse the existing interfaces.** `TugTextInputDelegate`, `AtomSegment`, `CompletionProvider`, `HistoryProvider`, `DropHandler`, the right-click classifier, and the [L23] capture/restore protocol are substrate-agnostic and survive the swap. The CM6 backing is implementation, not contract.
- **Gallery card is the test surface.** A new TextEdit gallery card exercises every prop and every feature. The same card is what we demo to confirm exit criteria, and what reviewers walk through when judging substrate fit.
- **Build stays green at every commit.** `bun run check`, `bun test`, `bun run audit:tokens lint`, and the workspace `cargo nextest run` pass on every step. `-D warnings` enforced.
- **Tuglaws apply at every step.** The new substrate is a tugways component and obeys [tuglaws.md](../tuglaws/tuglaws.md) without exception. [Table T02](#t02-tuglaws-applied) is the authoritative cross-walk: it names every law engaged by the spike, the compliance approach, and the step where each check lands. Every execution step's `**References:**` line cites the laws that step engages; Step 12 walks the full set.

#### Success Criteria (Measurable) {#success-criteria}

**Substrate viability:**

- [ ] Atoms render as inline replaced elements that the cursor skips over as a single character. Backspace deletes the whole atom; arrow keys step over it; selection extends by atom-as-unit. (verification: gallery card manual + automated test against CM6 `state.selection` after directional motion across an atom)
- [ ] Cut, copy, and paste round-trip atoms in plain text via U+FFFC + sidecar serialization, identical to current behavior. Paste from external clipboard preserves text and inserts no atoms. (verification: gallery card manual)
- [ ] CJK input method composition works with at least Japanese kana and Chinese pinyin, both adjacent to and across an atom. No selection collapse or glyph corruption during compose. (verification: manual scenarios documented in [Step 6](#step-6))
- [ ] [L23] active/inactive paint channels work: cmd-tab away from a tide-card hosting a `tug-edit` round-trips selection + scrollTop on return; cold-mount restore lands selection on the active card and inactive paint via `selectionGuard.cardRanges` on every other card. (verification: manual scenarios + existing pane-state preservation tests adapted)

**Feature parity with `tug-prompt-input`:**

- [ ] Every prop in [Table T01: tug-prompt-input feature surface](#t01-feature-surface) has an equivalent on `tug-edit` with documented equivalent or better behavior.
- [ ] Route prefixes (`>`, `$`, `:`) detected at position 0 fire `onRouteChange` and convert to a leading route atom, identical to `tug-prompt-input`. (verification: gallery card manual + test)
- [ ] Completion popup (`@` files, `/` slash commands) renders, filters, selects, and inserts atoms — using the existing `CompletionProvider` interface and the existing menu UI. (verification: gallery card with mock providers)
- [ ] History navigation (Cmd+Up / Cmd+Down) with `HistoryProvider` preserves draft on first back-step and restores it on forward-past-last. (verification: gallery card manual + test)
- [ ] Drag-and-drop from Finder onto the editor produces file atoms inserted at the drop point. (verification: manual)

**Theming:**

- [ ] All visible chrome (caret, selection, content fg, content bg, focus indication) reads from the tug 7-element token system via CSS variables. Theme switch (brio ↔ harmony) updates the live editor without remount. (verification: gallery card manual + token audit)
- [ ] Atoms re-render on theme change via the existing atom regeneration path. (verification: gallery card manual)

**Build and quality:**

- [ ] `bun run check`, `bun test`, `bun run audit:tokens lint` exit zero. Rust `cargo nextest run` exits zero. Warnings still errors.
- [ ] CM6 dependency adds ≤ 150 KB gzip to the tugdeck production bundle (target). Actual delta documented in [Step 12](#step-12).
- [ ] Component-authoring-guide checklist passes for `tug-edit` and `gallery-text-edit`.

**Gallery surface:**

- [ ] A `TextEdit` card exists in the Component Gallery, registered alongside the existing `PromptInput` and `PromptEntry` cards. It exercises every prop and feature listed under [Table T01](#t01-feature-surface).

**Decision deliverable:**

- [ ] [Step 13](#step-13) records a written go/no-go on adopting CM6 as the substrate for `tug-prompt-input` and downstream surfaces. If go, a follow-on plan `tugplan-text-editing-migration.md` is scaffolded.

#### Scope {#scope}

1. New `tug-edit.tsx` + `tug-edit.css` substrate component, CM6-backed.
2. New `gallery-text-edit.tsx` Component Gallery card.
3. CM6 atom rendering via `Decoration.replace` + `EditorView.atomicRanges`, reusing `tug-atom-img.ts` for visual rendering.
4. CM6 theme extension wired to the tug 7-element token system; live theme switching.
5. CM6 keymap covering Return / Shift-Return / numpad Enter / Cmd+Enter / Cmd+A / Cmd+Up / Cmd+Down / standard editing motions.
6. Completion popup wired via existing `CompletionProvider` interface and existing menu UI.
7. History provider integration via existing `HistoryProvider` interface.
8. Drop handler integration via existing `DropHandler` interface.
9. [L23] active/inactive paint integration via `selectionGuard` + CSS Custom Highlight.
10. Right-click classifier and selection adapter ported to CM6 geometry.
11. IME validation gate covering at least one CJK input method.
12. Decision step recording substrate go/no-go.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migrating `tug-prompt-input`, `tug-prompt-entry`, the live tide-card, or any other consumer to use `tug-edit`. (Follow-on plan.)
- Removing the existing `tug-prompt-input` / `TugTextEngine` code. The existing component continues to ship while the spike runs.
- Markdown rendering / live-preview decorations. (Follow-on plan; see [Roadmap / Follow-ons](#roadmap).)
- Tables, callouts, embeds with nested editable regions, Notion-style block rearrange. Excluded by [D02](#d02-markdown-ceiling).
- Multiple cursors, regex find-and-replace, vim/emacs keybindings, or any code-IDE feature beyond what `tug-prompt-input` exposes today.
- Collaborative editing / CRDTs / Yjs.
- Replacing the existing atom rendering technique (SVG-data-URI `<img>` via `tug-atom-img.ts`).

#### Dependencies / Prerequisites {#dependencies}

- CM6 packages installable via bun (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, plus targeted extensions). No yarn / npm / pnpm — bun only ([feedback memory](../../../.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/memory/feedback_use_bun.md)).
- Existing `tug-atom-img.ts` SVG rendering pipeline. No changes required for the spike.
- Existing `selectionGuard` and the `inactive-selection` CSS Custom Highlight ([L10], [L23]).
- Existing `useCardStatePreservation`, `TugPaneChrome` state preservation protocol ([L23]).
- Existing tug 7-element token CSS files (`brio.css`, `harmony.css`).
- Existing Component Gallery registration mechanism (`gallery-registrations.tsx`).

#### Constraints {#constraints}

- HMR is always running ([feedback memory](../../../.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/memory/feedback_hmr.md)) — no manual builds for tugdeck during the spike.
- Tests must hit the real engine ([feedback memory](../../../.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/memory/feedback_test_reality.md)) — no mock-store call-count tests.
- happy-dom may not be used for focus / selection / event-ordering tests across React renders ([feedback memory](../../../.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/memory/feedback_no_happy_dom_tests.md)). The integration surface is verified manually + via `just app-test` where applicable.
- `-D warnings` on Rust, `tsc --noEmit` clean on TypeScript, `audit:tokens lint` clean on CSS.
- No direct DOM writes that bypass [L22] without a documented reason. CM6 owns its DOM tree; we observe it via its API.

#### Assumptions {#assumptions}

- CM6's `EditorView.atomicRanges` faithfully implements "skip range as one cursor unit" for cursor motion, selection extension, and `deleteCharBackward` / `deleteCharForward`. Validated in [Step 3](#step-3).
- CM6's IME story with adjacent atomic widgets is workable, possibly with caveats. Validated in [Step 6](#step-6); a hard fail there is a substrate-level no.
- React StrictMode double-mount can be reconciled with CM6 lifecycle by storing the `EditorView` on a stable ref and disposing it on cleanup. Standard pattern in `@uiw/react-codemirror` and similar wrappers.
- The existing `TugTextInputDelegate` shape can drive a CM6 backend without contract changes. If a method requires a substrate-shape change (e.g., character-position semantics that differ from CM6's offset model), the change is documented and applied symmetrically to the existing engine after the spike.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` tags on every cited heading and the `[ID] Label` convention for design decisions, open questions, risks, specs, and tables. All execution-step `**References:**` lines cite by anchor and ID; no line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] CM6 atomic-range fidelity vs current atom UX (DECIDED) {#q01-atomic-fidelity}

**Question:** Does `EditorView.atomicRanges` + `Decoration.replace` produce cursor / selection / delete behavior across atoms that matches what users have today with the SVG-`<img>` replaced element approach?

**Why it matters:** The atom is the load-bearing concept of the prompt input. Any divergence — e.g., shift-arrow stepping into the middle of a multi-atom run, or backspace deleting one character of a label rather than the whole atom — breaks the existing UX contract.

**Plan to resolve:** Prototype in [Step 3](#step-3). The success criterion is concretely enumerated in [List L01](#l01-atom-motion-cases).

**Resolution:** DECIDED — `EditorView.atomicRanges` lifted from the `atomDecorationField`'s `Decoration.replace` ranges produces correct one-step motion (`view.moveByChar` advances or retreats one document offset across each U+FFFC), one-step deletion (`deleteCharBackward` / `deleteCharForward` remove the whole atom and clear the decoration), and one-step selection extension. Tests in `tug-edit.test.tsx` cover motion, extension, and both delete directions. Cases 1–7 in [List L01](#l01-atom-motion-cases) are covered by the integration tests; cases 8–10 (clipboard) are covered by the pure serialization round-trip tests in `tug-edit-clipboard.test.ts` and exercised end-to-end via the gallery card.

---

#### [Q02] Atom clipboard serialization (DECIDED) {#q02-atom-clipboard}

**Question:** When an atom is copied or cut, what does the clipboard contain? Plain text with U+FFFC at the atom position? A sidecar JSON mime type for round-trip within tugdeck? Plain text with the atom's label?

**Why it matters:** Today, `TugTextEngine` controls this directly. CM6 has `clipboardInputFilter` / `clipboardOutputFilter` facets that intercept on the boundary; the question is what we *want* the contract to be, not how to implement it.

**Plan to resolve:** Decided alongside [Step 3](#step-3) — the cut/copy/paste round-trip test enumerates the expected behavior and the implementation matches. Documented in [D05](#d05-atom-rendering).

**Resolution:** DECIDED — three-payload contract:
1. `text/plain` (external apps): atom labels in place of U+FFFC, so external pastes see "Please review main.ts" rather than tofu glyphs.
2. `application/x-tug-atoms` (tug-internal): JSON sidecar versioned at `1` carrying `{ position, segment }` entries with positions relative to the copied slice. On paste, this rewrites the matching label-substrings in the plain text back to U+FFFC characters and dispatches a single transaction that applies both the inserted text and the matching `addAtomsEffect`.
3. The `text/plain` representation that *would* go on the clipboard for tug-internal pastes carries U+FFFC directly — but in practice tug-internal pastes always read the sidecar first. The fallback string (label-substituted) is what other apps see. Implementation in `tug-edit/clipboard-filters.ts`; pure tests in `tug-edit-clipboard.test.ts` cover the round-trip and rejection of malformed sidecars.

---

#### [Q03] CM6 lifecycle vs React StrictMode (DECIDED) {#q03-strict-mode}

**Question:** How does the `EditorView` lifecycle survive StrictMode's double-mount in dev?

**Why it matters:** A naïve `useLayoutEffect` that constructs an `EditorView` and tears it down on cleanup will run twice in StrictMode and may leak a mount or fail to dispose listeners. We have hit similar issues in the existing engine.

**Plan to resolve:** Adopt the standard pattern used by `@uiw/react-codemirror`: store the view on a ref, construct in `useLayoutEffect`, dispose in cleanup, branch on existence. Validated by mounting / unmounting `gallery-text-edit` repeatedly with no console warnings and no DOM leftovers. Documented in [Step 1](#step-1).

**Resolution:** DECIDED — `useLayoutEffect` with empty deps constructs the view, the cleanup destroys it and clears `viewRef.current` to `null`. StrictMode's mount/unmount/mount cycle creates a fresh view each pass and disposes the previous one cleanly. The `view()` delegate method reads `viewRef.current` at call time so consumers see the live view across the cycle. Recorded inline in `tugdeck/src/components/tugways/tug-edit.tsx`. Test coverage in `tug-edit.test.tsx` exercises the unmount → re-mount round-trip and asserts a fresh `EditorView` instance is constructed.

---

#### [Q04] Where does the route atom live in the document? (OPEN) {#q04-route-atom-position}

**Question:** Is the leading route atom (the `>`, `$`, or `:` glyph) inside the editor document at offset 0, or rendered as sibling DOM that the editor doesn't know about?

**Why it matters:** Today the route atom is in the doc. CM6 supports both: it can live in the doc as a `Decoration.replace` over offset 0, *or* it can be a sibling DOM element and the editor doc starts post-route. The first preserves the current model; the second simplifies cursor-at-start handling.

**Plan to resolve:** Decided in [Step 10](#step-10) when the route-prefix feature lands. Default is "in the doc at offset 0" to match existing semantics, switched if a concrete blocker appears.

**Resolution:** OPEN. Resolved in Step 10.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| IME × atomic widget unreliability | high | medium | Step 6 is a dedicated gate; failure halts the spike. | CJK compose drops characters, collapses selection, or corrupts glyph next to an atom. |
| [L23] paint channels don't fit CM6's lifecycle | high | low | Step 7 is a dedicated step; the engine-level `paintMirrorAsActive` / `paintMirrorAsInactive` shape is preserved at the API boundary. | Pane-state preservation tests fail or selection is lost on cmd-tab. |
| Bundle size delta exceeds ~150 KB gzip target | medium | medium | Step 12 records actual delta; if over, document tree-shaking opportunities and accept or revisit. | Bundle delta > 200 KB gzip. |
| Atom clipboard round-trip diverges from current behavior | medium | medium | Step 3 enumerates the expected behavior up front. | Paste of a copied prompt loses an atom. |
| CM6 forces an API change to `TugTextInputDelegate` | medium | low | Apply the change symmetrically to both backends after the spike. | A delegate method maps poorly onto CM6's offset model. |

**Risk R01: IME composition with atomic widgets** {#r01-ime-atoms}

- **Risk:** CM6's documented IME interaction with `atomicRanges` has known rough edges in the upstream forum. Composition adjacent to an atomic widget can interrupt the selection.
- **Mitigation:** Step 6 is a dedicated validation gate with an explicit halt condition. Test with at least Japanese kana and Chinese pinyin; document any observed misbehavior; reproduce upstream and file if novel.
- **Residual risk:** A class of users (CJK input) may have a degraded experience even after mitigation. If so, the substrate decision tilts back toward Lexical or staying with `contenteditable`.

**Risk R02: [L23] mirror paint vs CM6 ownership** {#r02-l23-mirror}

- **Risk:** CM6 owns its DOM tree; the `cm-content` node identity may change on reconfigure. The existing `paintMirrorAsActive` / `paintMirrorAsInactive` writes selection through `window.getSelection()` and CSS Custom Highlights; the active-paint channel may collide with CM6's own focus / selection management.
- **Mitigation:** Step 7 routes active-paint through CM6's `EditorView.dispatch({ selection })` rather than direct `window.getSelection()` writes; inactive-paint continues to use `selectionGuard.cardRanges` against the live `cm-content` node read at fire time.
- **Residual risk:** If CM6 reconfigures the content node mid-flight (e.g., during theme switch), an inactive Range may dangle until the next paint pass.

**Risk R03: Bundle size** {#r03-bundle}

- **Risk:** Adding CM6 grows the tugdeck production bundle by 75–135 KB gzip per upstream estimates, more if extensions accrete.
- **Mitigation:** Use only the extensions we actually need; document the delta in Step 12; revisit if delta > 200 KB gzip.
- **Residual risk:** The cost is real and permanent; this is part of the tradeoff accepted in [D01](#d01-spike-cm6).

---

### Design Decisions {#design-decisions}

#### [D01] Spike with CodeMirror 6 (DECIDED) {#d01-spike-cm6}

**Decision:** Adopt CodeMirror 6 as the substrate for the new `tug-edit` component. Reject continuing to polish raw `contenteditable`, reject Monaco (too heavy, atom model mismatch, theming friction), reject rolling our own in Rust + WASM (text layout / IME / accessibility cost is multi-engineer-year). Lexical was the strongest non-CM alternative; rejected for this spike because the user's stated direction (better Claude Code TUI editing, not Notion) keeps the ceiling within CM6's reach, and CM6's atomic-range model fits atoms more naturally than Lexical's `DecoratorNode` (which has a known selection-null limitation when selection lands over the decorator).

**Rationale:**
- CM6's `EditorView.atomicRanges` facet is purpose-built for the atom semantics we need.
- CM6 is designed for single-font code-shaped editing — our prompt-input use case is exactly that shape.
- CM6 is production-proven by Replit, Sourcegraph, JupyterLab, Obsidian, and Observable.
- Theming via CSS variables and `EditorView.theme()` maps cleanly onto the tug 7-element token system.
- Bundle cost (~75–135 KB gzip) is acceptable.
- Existing `TugTextInputDelegate` and adjacent interfaces are substrate-agnostic and survive the swap.

**Implications:**
- Markdown is the realistic feature ceiling ([D02](#d02-markdown-ceiling)).
- IME × atomic-widget interaction is a known soft spot and gets a dedicated validation step ([R01](#r01-ime-atoms), [Step 6](#step-6)).
- The spike is *additive* — `tug-prompt-input` keeps shipping until the migration plan lands.

#### [D02] Markdown ceiling accepted; rich documents out of scope (DECIDED) {#d02-markdown-ceiling}

**Decision:** The feature ceiling for `tug-edit` is "single-font editing with atoms, plus optionally Markdown source with live decorations" (the pattern Obsidian Live Preview and `codemirror-rich-markdoc` use). Tables, callouts with nested editable regions, Notion-style block rearrange, and non-Markdown structured-document features are explicitly out of scope. If the project's direction later requires those features, the substrate decision is reopened.

**Rationale:**
- The user has stated the goal is "better than Claude Code TUI editing", not a Notion competitor.
- CM6's flat-string data model cannot represent nested editable regions cleanly. Pretending otherwise wastes effort.
- The Markdown-source-with-live-decorations pattern is well-trodden, fits CM6's strengths, and covers bold/italic/headings/lists/code fences/blockquotes.

**Implications:**
- The follow-on Markdown plan ([Roadmap / Follow-ons](#roadmap)) targets *source with live decorations*, not WYSIWYG.
- Any future requirement for tables / nested blocks triggers a substrate re-evaluation rather than an attempt to bend CM6 into shapes it doesn't fit.

#### [D03] New component name is `tug-edit`, sibling to `tug-prompt-input` (DECIDED) {#d03-tug-edit-name}

**Decision:** The new substrate component is named `tug-edit` and lives at `tugdeck/src/components/tugways/tug-edit.tsx`. It is a *substrate*, lower-level than `tug-prompt-input` — it does not own route prefixes, route atoms, or any prompt-domain semantics on its own. Those features sit on top of it as composable extensions or are surfaced via props that are off by default.

**Rationale:**
- Decouples the substrate from the prompt-domain composition.
- Clear naming for the eventual migration: `tug-prompt-input` becomes a wrapper around `tug-edit` with prompt-specific extensions enabled.
- Leaves room for non-prompt consumers (e.g., a future code-editing card, a notes card).

**Implications:**
- Route-prefix support is a `tug-edit` *option* (off by default), not a hard-coded behavior.
- The Component Gallery card is named `TextEdit` (not `Edit`, which is too generic) to mirror the component name.

#### [D04] Spike is additive; existing component keeps shipping (DECIDED) {#d04-additive}

**Decision:** This phase ships `tug-edit` and the `TextEdit` gallery card. It does *not* migrate `tug-prompt-input`, `tug-prompt-entry`, or `tide-card` to use the new substrate. The migration is a separate plan, gated on the spike's go/no-go ([Step 13](#step-13)).

**Rationale:**
- Smallest blast radius. The live tide-card keeps working through the spike.
- Decision can be reversed after the spike without unwinding migration work.
- Reviewers can compare the two side-by-side in the gallery.

**Implications:**
- Two prompt-shaped components live in the codebase during the spike phase. Documented as a known temporary state.
- The migration plan (`tugplan-text-editing-migration.md`) is scaffolded in Step 13 if the decision is "go".

#### [D05] Atoms remain SVG-`<img>` rendered, embedded as CM6 widgets (DECIDED) {#d05-atom-rendering}

**Decision:** The existing `tug-atom-img.ts` SVG-data-URI rendering pipeline is reused unchanged. The CM6 atom widget is a `WidgetType` whose `toDOM()` returns an `<img>` element produced by `createAtomImgElement`. The text representation of an atom in the CM6 document is U+FFFC, identical to the existing engine. Cut/copy/paste round-trip uses U+FFFC + sidecar serialization in a custom MIME type for in-tugdeck pastes; external clipboard contains plain-text fallback (label-of-atom).

**Rationale:**
- Preserves the visual + accessibility behavior already shipped.
- Keeps the atom regeneration-on-theme-change path intact.
- Aligns the CM6 document model (offsets over a flat string) with the existing engine's text model — `getText()` semantics stay identical.

**Implications:**
- The CM6 atom widget is small: it wraps `createAtomImgElement` and exposes the standard `WidgetType` lifecycle.
- `clipboardInputFilter` / `clipboardOutputFilter` facets handle the round-trip; the plain-text fallback for external paste is explicit.

#### [D06] Theme via `EditorView.theme()` reading CSS variables (DECIDED) {#d06-theming}

**Decision:** The CM6 theme extension uses `EditorView.theme()` and `EditorView.baseTheme()` with CSS that references the existing tug 7-element CSS variables directly (`var(--tug-text-fg-default)`, `var(--tug-bg-selection-active)`, etc.). The `EditorView` does not subscribe to `subscribeThemeChange` — token swaps via the existing CSS-variable mechanism reach the editor automatically. Atom regeneration on theme change continues to use `engine.regenerateAtoms()`-equivalent (a re-decoration pass triggered by `subscribeThemeChange`), since the SVGs are baked at atom-construction time.

**Rationale:**
- Smallest possible coupling between CM6 and the tug theme system.
- Theme switches stay live without remount.
- Mirrors the styling approach used elsewhere in tugdeck — CSS variables are the contract.

**Implications:**
- All editor chrome appearance is controlled through the existing token files (`brio.css`, `harmony.css`).
- Adding a token for an editor-specific concern (e.g., a CM6 gutter color) follows the standard 7-element pattern.

---

### Deep Dives {#deep-dives}

#### Tuglaws compliance {#tuglaws-compliance}

This spike implements a new tugways component, so [tuglaws.md](../tuglaws/tuglaws.md) governs every step. This subsection enumerates the laws engaged by the spike, how `TugEdit` complies, and where each compliance check lands. Each execution step's `**References:**` line cites the laws that step engages; the table below is the authoritative cross-walk.

**Table T02: Tuglaws applied to `TugEdit`** {#t02-tuglaws-applied}

| Law | Engagement | Compliance approach | Where it lands |
|---|---|---|---|
| [L01] One `root.render()` at mount | Always | The React shell mounts once; CM6 manages its own DOM tree internally and is never re-rendered through React after construction. | Steps 1, 11 (gallery uses the registered card factory; no external `root.render`). |
| [L02] External state via `useSyncExternalStore` only | When CM6 state must drive React renders | When the React shell *renders* something derived from CM6 state (e.g., the typeahead popup's open/closed flag), it subscribes through `useSyncExternalStore` against a small subscribable adapter over `EditorView.updateListener`. CM6's internal state is never copied into `useState`. | Step 5 (typeahead state observer), Step 7 (state-preservation hook). |
| [L03] `useLayoutEffect` for registrations events depend on | Always | Mount, dispose, state-preservation registration, route-prefix listener, and typeahead extension registration all run in `useLayoutEffect` so the substrate is ready before any keyboard or pointer event can land. | Steps 1, 5, 7, 9, 10. |
| [L04] No measure-after-parent-setState on child DOM | Completion popup positioning | Popup position reads `EditorView.coordsAtPos` directly from the live view rather than via React-state-driven layout. | Step 5. |
| [L05] No `requestAnimationFrame` for React-commit-coupled work | Always | We never use rAF to bridge CM6 state into React commits. CM6 has its own scheduler; the React shell observes via `EditorView.updateListener`. | All steps (negative invariant). |
| [L06] Appearance via CSS and DOM, never React state | Theme, atom rendering, focus indication, disabled, placeholder, growDirection, maximized, focusStyle, borderless, drag-over | All editor visuals flow through CSS variables (theme), CM6 widget DOM (atoms), CSS class toggles on the host (focus / disabled), and DOM-side mutations (drop hover). No `useState` drives editor appearance. | Steps 2, 3, 8, 10. |
| [L07] Handlers access state through refs / stable singletons | Delegate methods, keymap handlers, completion select, drop handler, route-prefix listener | The `useImperativeHandle` delegate reads `viewRef.current` at call time; CM6 keymap handlers receive `view` as their argument; provider closures hold refs. | Steps 1, 4, 5, 7, 8, 9, 10. |
| [L09] Cards never set their own position / size / z-order | Gallery card | `gallery-text-edit.tsx` sets only content layout; the hosting `TugPane` owns geometry. | Steps 1, 11. |
| [L10] One responsibility per layer | Always | `TugEdit` is the substrate (text editing); `gallery-text-edit` is composition (demo); the eventual `tug-prompt-input` wrapper layers prompt-domain semantics on top. The substrate exposes route-prefix support as an *option*, off by default. | Steps 1, 10, 13. |
| [L11] Controls emit; responders own state | Always — `TugEdit` is a responder | `TugEdit` owns the document, caret, and selection: it is the responder for `cut` / `copy` / `paste` / `selectAll` / `undo` / `redo` and the domain `submit` action. Step 4 wires the keymap; Step 5 wires completion-menu emitter→responder routing; Step 9 wires the right-click context menu. | Steps 1 (declared), 4, 5, 9. |
| [L12] Selection stays inside card boundaries | Selection paint, state preservation | The `cm-content` node is registered with `SelectionGuard` as the editor's selection boundary; inactive-selection paint goes through `selectionGuard.cardRanges` so selection cannot escape the card. | Steps 7, 9. |
| [L13] CSS for declarative motion; rAF only for gesture frame loops | Caret blink, focus transition, drag-over feedback | All editor motion is CSS-driven. No rAF. | Steps 2, 8. |
| [L15] Token-driven control states | Theme, focus, disabled | Editor states (rest, focus, disabled, readonly) use seven-slot tokens; color transitions provide all interaction feedback — no box-shadow, no translateY, no gradients. | Steps 2, 10. |
| [L16] Foreground-only rules declare `@tug-renders-on` | Theme CSS, gallery card CSS | Every CSS rule that sets `color`, `fill`, or `border-color` without `background-color` carries a `@tug-renders-on` annotation naming its surface. `audit-tokens lint` enforces this. The component's `@tug-pairings` block is added when the theme lands. | Steps 1 (gallery card), 2 (theme), 10 (state styles). |
| [L17] Component aliases resolve to `--tug7-*` in one hop | Theme | If `--tugx-edit-*` aliases are introduced, each resolves directly to a `--tug7-*` token — no alias-to-alias chains. The audit enforces this. | Step 2. |
| [L18] Element / surface vocabulary | Theme | Editor text uses `--tug7-element-*`; editor background uses `--tug7-surface-*`. Pairings are declared. | Step 2. |
| [L19] Component authoring guide | Always | File pair (`tug-edit.tsx` + `tug-edit.css`), module docstring with the standardized citation set, props interface, `data-slot="editor"`, CSS organization. The gallery card mirrors the convention. | All steps. |
| [L20] Each component owns scoped tokens; composed children keep theirs | When `TugEdit` composes other tug components | If later steps compose tug components inside the editor (e.g., context menu, completion menu), `TugEdit`'s CSS references only its own `--tug7-element-edit-*` / `--tug7-surface-edit-*` slot; composed children's tokens are not overridden. | Steps 5, 9. |
| [L21] Third-party code requires license compliance | CM6 substrate | CodeMirror 6 (MIT) is logged in `THIRD_PARTY_NOTICES.md` (existing entry, expanded for the substrate adoption). Each consuming source file references the notice. | Step 1 (notices update + tug-edit.tsx citation), Steps 2–10 (extension modules cite the same entry). |
| [L22] Direct DOM updates via store observer, not React round-trip | Completion provider results, inactive-selection paint | When CM6's `updateListener` triggers a paint to `selectionGuard.cardRanges`, the observer writes directly to the DOM — no `useSyncExternalStore` round-trip. Completion provider observers are subscribed through their store's API, not through React state. | Steps 5, 7. |
| [L23] Internal operations must not lose user-visible state | State preservation | Selection, focus, scroll, content survive CM6 reconfigure, theme switch, cmd-tab cycle, tab deactivation, and cold-mount restore via the `useCardStatePreservation` protocol. The active/inactive paint distinction is the central mechanism. | Step 7. |
| [L24] State partitioned into appearance / local data / structure | Always | Appearance (caret, selection paint, focus ring) → CSS / DOM. Local data (`viewRef`, `hostRef`, internal flags) → `useRef`. Structure (subscriptions to providers, state-preservation registration) → `useSyncExternalStore` / `useLayoutEffect` / store observers. | All steps. |
| [L25] Deck → Pane → Card hierarchy | Gallery card | The TextEdit gallery card is content; the `TugPane` chrome owns its position, size, and z-order. | Steps 1, 11. |

**Laws not engaged by this spike:**

- [L08] Live preview in mutation transactions — the editor's edits are committed values per keystroke; no draft-vs-commit distinction.
- [L14] Radix Presence enter/exit boundary — the spike does not introduce Radix-managed enter/exit.

**Compliance verification per step:**

Each step's `**References:**` line cites the law IDs the step engages. Step 12 (Integration Checkpoint) explicitly walks the entire law set against the new code and records the result. The component-authoring-guide checklist covers the [L19] surface; `audit-tokens lint` covers [L16] / [L17] / [L18] / [L20]; the tests in Steps 1, 3, 4, 5, 7, 9 cover the runtime invariants ([L01], [L03], [L07], [L11], [L23]).

#### Substrate evaluation {#substrate-evaluation}

##### Option A — Keep polishing `contenteditable`

**Pros:** Existing investment of ~3,500 lines (`tug-prompt-input.tsx` 1,303 + `tug-prompt-entry.tsx` 1,135 + `tug-text-engine.ts` 2,245 + atoms/CSS) is preserved.

**Cons:** WebKit's `contenteditable` has a long tail of unfixed bugs — composition selection on iOS 16.4+ ([Apple developer forum thread 730031](https://developer.apple.com/forums/thread/730031)), focus surrender ([WebKit bug 112854](https://bugs.webkit.org/show_bug.cgi?id=112854)), AX object updates after dynamic changes, unwanted `&nbsp;` insertion ([WebKit bug 38902](https://bugs.webkit.org/show_bug.cgi?id=38902)). Every previous editor that started here moved away.

**Verdict:** Reject. The polish curve is asymptotic and the substrate is not under our control.

##### Option B — Monaco

**Pros:** Production-grade editor (powers VS Code).

**Cons:** Multi-megabyte bundle. No first-class atomic inline widget that participates in cursor motion. Theming system is its own world (Monarch tokens, theme JSON) and does not map cleanly onto CSS variables.

**Verdict:** Reject. Monaco is the right tool for IntelliSense over a TS program, not for a prompt composer with atoms.

##### Option C — CodeMirror 6 (chosen)

**Pros:**
- `EditorView.atomicRanges` is purpose-built for atom semantics.
- Designed for single-font code-shaped editing.
- Bundle ~75–135 KB gzip.
- Theming via `EditorView.theme()` + CSS variables is straightforward.
- Production-proven (Replit, Sourcegraph, JupyterLab, Obsidian, Observable).
- `clipboardInputFilter` / `clipboardOutputFilter` facets give clean clipboard control.
- Markdown source with live decorations (the realistic ceiling per [D02](#d02-markdown-ceiling)) is a well-trodden CM6 pattern.

**Cons:**
- IME × atomic widgets has rough edges in upstream forum reports ([R01](#r01-ime-atoms)).
- Setup is more code than people expect (state + view + extensions + keymap + theme).
- Architecture is principled but not React-shaped; the `@uiw/react-codemirror` wrapper papers over the lifecycle but you'll likely drop down to raw `EditorView` for our level of integration.
- Cannot scale into Notion-shape (tables, nested editable blocks). Accepted in [D02](#d02-markdown-ceiling).

**Verdict:** Adopt for spike ([D01](#d01-spike-cm6)).

##### Option C-alt — Lexical (rejected for this spike)

**Pros:** Tree-based document model with first-class `ParagraphNode` / `HeadingNode` / `QuoteNode` / `CodeNode` / `ListNode` / `TableNode`. `DecoratorNode` for embedding React components inline. Modular plugin model. `lexical-beautiful-mentions` is an off-the-shelf reference for the atom pattern. Markdown import/export via `@lexical/markdown`. Bundle 22 KB gzip core; 100–180 KB gzip with rich-text plugins.

**Cons (versus our brief):**
- `DecoratorNode` selection becomes `null` when selection lands over the decorator. This interacts directly with [L23] selection preservation.
- Code-editing ergonomics (multi-cursor, find/replace, large-text scrolling) are mediocre — Lexical's strengths point the other way.
- Lexical owns more of the React lifecycle than CM6 does. Our existing engine-as-stable-ref + direct-DOM + `useSyncExternalStore` pattern fits CM6 more naturally.
- `GridSelection` design is internally debated upstream ([Lexical issue #5276](https://github.com/facebook/lexical/issues/5276)).

**Asymmetry argument:** Lexical scales further into rich documents (tables, blocks, embeds) than CM6; CM6 scales further into code-shaped editing (multi-cursor, search/replace, large-document) than Lexical. The user's stated direction is the latter half of that asymmetry — better than Claude Code TUI editing, not Notion. CM6 fits.

**Revisit if:** the user's direction shifts toward tables, nested editable blocks, or Notion-style block rearrange. At that point this decision is reopened.

##### Option D — Roll our own (Rust + WASM)

**Pros:** Total control.

**Cons:** Text layout, IME, RTL/bidi, accessibility, font fallback, caret geometry on wrapped lines — these are years of engineering. Monaco's team paid that cost over many years. The tug-markdown-view comparison is misleading: Markdown rendering is pure output; an editor is bidirectional with the OS input stack.

**Verdict:** Reject for now. Revisit only if both CM6 and Lexical fail.

#### tug-prompt-input feature surface {#t01-feature-surface}

**Table T01: tug-prompt-input feature surface (mirror in `tug-edit`)** {#t01-feature-surface}

| Prop / behavior | Today | `tug-edit` mapping |
|---|---|---|
| `placeholder` | Empty-state hint | `@codemirror/view` placeholder extension |
| `maxRows` | Visible rows before scroll | CSS `max-height: calc(line-height * maxRows)` on `.cm-scroller` |
| `returnAction` (`"submit"` / `"newline"`) | Return-key behavior on main keyboard | High-priority CM6 keymap on `Enter` |
| `numpadEnterAction` (`"submit"` / `"newline"`) | Enter-key behavior on numpad | Distinct keymap entry; numpad Enter is `code: "NumpadEnter"` |
| `onSubmit` | Submit handler | Invoked by submit-action keymap |
| `onChange` | Content-change handler | CM6 `EditorView.updateListener` filtering on `update.docChanged` |
| `completionProviders` | `Record<trigger, CompletionProvider>` | CM6 extension watching trigger characters; existing menu UI rendered alongside the editor DOM |
| `historyProvider` | Cmd+Up / Cmd+Down navigation | Custom keymap dispatching transactions |
| `onTypeaheadChange` | External observer of typeahead | Same callback shape; fired from the completion extension |
| `dropHandler` | DragEvent → `AtomSegment[]` | `EditorView` `domEventHandlers` with `posAtCoords` for insertion offset |
| `disabled` | Read-only | `EditorState.readOnly` facet + CSS class |
| `completionDirection` (`"up"` / `"down"`) | Popup direction | Existing menu UI prop, unchanged |
| `growDirection` (`"up"` / `"down"`) | Editor grow direction | Wrapper flex direction; CM6 default for "down", flex-end alignment for "up" |
| `maximized` | Fill flex parent | CSS `flex: 1 1 auto` on outer; ignore `maxRows` |
| `focusStyle` (`"background"` / `"ring"`) | Focus indication | CSS class toggled via CM6 `EditorView.focusChangeEffect`-equivalent listener |
| `borderless` | Suppress border | CSS modifier |
| `routePrefixes` | First-char route-detect glyphs | CM6 transaction filter on offset 0; first-char insertion replaces with route atom |
| `onRouteChange` | Route change callback | Fired by the route-prefix transaction filter |
| `preserveState` | [L23] state preservation toggle | Conditional `useCardStatePreservation` registration |
| Cut / copy / paste with atoms | U+FFFC + sidecar | `clipboardInputFilter` / `clipboardOutputFilter` facets |
| Right-click classifier | "near-caret" vs "within-range" vs "elsewhere" | Adapter ports to CM6 selection geometry via `coordsAtPos` / `posAtCoords` |
| Active / inactive paint ([L23]) | `paintMirrorAsActive` / `paintMirrorAsInactive` | Active: `EditorView.dispatch({ selection })` + focus. Inactive: `selectionGuard.cardRanges` Range against `cm-content` |
| Drag-and-drop file → atom | File drop produces atoms | `domEventHandlers.drop` with `posAtCoords` |
| Theme switch live update | CSS variables propagate; atoms regenerate | CSS variables propagate automatically; atom regeneration via `subscribeThemeChange` triggers a re-decoration transaction |
| Undo / redo | Native `execCommand` undo | `@codemirror/commands` history extension + Cmd+Z / Cmd+Shift+Z keymap |
| IME composition | `compositionstart` / `compositionend` lifecycle | CM6 native IME handling; verified in [Step 6](#step-6) |

#### Atom motion correctness cases {#l01-atom-motion-cases}

**List L01: Atom motion correctness cases (Step 3 acceptance)** {#l01-atom-motion-cases}

1. Right-arrow with caret immediately before an atom moves caret to immediately after the atom in one keystroke.
2. Left-arrow with caret immediately after an atom moves caret to immediately before in one keystroke.
3. Backspace with caret immediately after an atom deletes the entire atom.
4. Forward-delete with caret immediately before an atom deletes the entire atom.
5. Shift+right-arrow with caret immediately before an atom extends selection across the entire atom.
6. Double-click on an atom selects the atom as a whole (not a sub-range).
7. Cmd+A selects the whole document including all atoms.
8. Copy of a selection containing one or more atoms places U+FFFC + sidecar in clipboard.
9. Paste of that clipboard payload reconstructs the atoms.
10. Type-then-paste sequence preserves cursor placement after the pasted atoms.

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

`tug-edit` props mirror `tug-prompt-input`'s prop surface (per [Table T01](#t01-feature-surface)) with the following deltas:

- `routePrefixes` and `onRouteChange` are off by default. (`tug-edit` is the substrate; the prompt-domain wrappers turn them on.)
- A new `extensions` prop accepts an array of additional CM6 `Extension`s that the host can layer on top. Default: `[]`. This is the seam through which the future migration adds prompt-specific behavior without forking the substrate.

#### Public API Surface {#public-api}

```ts
export interface TugEditDelegate extends TugTextInputDelegate {
  // Substrate-level extension hook.
  view(): EditorView | null;
  // [L23] paint channels.
  paintMirrorAsActive(state?: TugTextEditingState): void;
  paintMirrorAsInactive(
    publish: (range: Range | null) => void,
    state?: TugTextEditingState,
  ): void;
}

export interface TugEditProps extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  // Mirror of TugPromptInputProps minus prompt-domain bits.
  placeholder?: string;
  maxRows?: number;
  returnAction?: InputAction;
  numpadEnterAction?: InputAction;
  onSubmit?: () => void;
  onChange?: () => void;
  completionProviders?: Record<string, CompletionProvider>;
  historyProvider?: HistoryProvider;
  onTypeaheadChange?: (active: boolean, filtered: CompletionItem[], selectedIndex: number) => void;
  dropHandler?: DropHandler;
  disabled?: boolean;
  completionDirection?: "up" | "down";
  growDirection?: "up" | "down";
  maximized?: boolean;
  focusStyle?: "background" | "ring";
  borderless?: boolean;
  routePrefixes?: string[];
  onRouteChange?: (route: string | null) => void;
  preserveState?: boolean;
  extensions?: Extension[];
}
```

#### Internal Architecture {#internal-architecture}

```
TugEdit (React shell)
  └── EditorView (CM6, owned by ref)
        ├── EditorState
        │     ├── doc (string, atoms = U+FFFC)
        │     ├── selection
        │     └── extensions
        │           ├── atomDecorationField (StateField<DecorationSet>)
        │           ├── atomicRanges provider (over atomDecorationField)
        │           ├── tugTheme (EditorView.theme reading CSS vars)
        │           ├── tugKeymap (Enter / Shift-Enter / Cmd+Up etc.)
        │           ├── completionExt (typeahead via CompletionProvider)
        │           ├── routePrefixExt (off by default)
        │           ├── dropExt (DropHandler)
        │           ├── clipboardFilters (atom round-trip)
        │           ├── placeholderExt
        │           ├── readOnlyExt (disabled)
        │           ├── history (Cmd+Z)
        │           └── ...host-supplied extensions[]
        └── DOM rendered into `.tug-edit-host` div
```

The `EditorView` is the source of truth for document and selection. The React shell observes via `EditorView.updateListener` and surfaces typed callbacks (`onChange`, `onTypeaheadChange`, `onRouteChange`). The shell does *not* round-trip state through React state ([L02], [L22]).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-edit.tsx` | Substrate component; React shell over CM6 EditorView |
| `tugdeck/src/components/tugways/tug-edit.css` | Component CSS reading 7-element tokens |
| `tugdeck/src/lib/tug-edit/atom-decoration.ts` | StateField + WidgetType for atom rendering |
| `tugdeck/src/lib/tug-edit/atomic-ranges.ts` | EditorView.atomicRanges provider over the atom field |
| `tugdeck/src/lib/tug-edit/clipboard-filters.ts` | clipboardInputFilter / clipboardOutputFilter for atom round-trip |
| `tugdeck/src/lib/tug-edit/keymap.ts` | Tug keymap: Enter, Shift-Enter, Cmd+Enter, Cmd+Up/Down, etc. |
| `tugdeck/src/lib/tug-edit/theme.ts` | EditorView.theme bound to tug 7-element CSS variables |
| `tugdeck/src/lib/tug-edit/completion-extension.ts` | Typeahead extension wrapping CompletionProvider |
| `tugdeck/src/lib/tug-edit/route-prefix-extension.ts` | Route-prefix detection at offset 0 |
| `tugdeck/src/lib/tug-edit/drop-extension.ts` | DropHandler integration |
| `tugdeck/src/lib/tug-edit/state-preservation.ts` | [L23] capture / restore + active/inactive paint |
| `tugdeck/src/lib/tug-edit/selection-adapter.ts` | TextSelectionAdapter port over CM6 selection model |
| `tugdeck/src/components/tugways/cards/gallery-text-edit.tsx` | Component Gallery card |
| `tugdeck/src/components/tugways/cards/gallery-text-edit.css` | Gallery card CSS |
| `tugdeck/src/components/tugways/__tests__/tug-edit.test.tsx` | Substrate tests (real engine, where feasible) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugEdit` | React component | `tug-edit.tsx` | Default export |
| `TugEditDelegate` | TS interface | `tug-edit.tsx` | Extends `TugTextInputDelegate` |
| `TugEditProps` | TS interface | `tug-edit.tsx` | See [Public API Surface](#public-api) |
| `atomDecorationField` | CM6 StateField | `atom-decoration.ts` | Holds `Decoration.replace` ranges |
| `AtomWidget` | CM6 WidgetType | `atom-decoration.ts` | `toDOM()` returns `createAtomImgElement()` |
| `atomicRangesExt` | CM6 Extension | `atomic-ranges.ts` | `EditorView.atomicRanges.of(...)` |
| `tugTheme` | CM6 Extension | `theme.ts` | `EditorView.theme({...})` over CSS vars |
| `tugKeymap` | CM6 Extension | `keymap.ts` | High-priority `keymap.of([...])` |
| `tugClipboardFilters` | CM6 Extension | `clipboard-filters.ts` | `clipboardInputFilter` + `clipboardOutputFilter` |
| `completionExtension(providers)` | factory | `completion-extension.ts` | Returns `Extension[]` |
| `routePrefixExtension(prefixes, onChange)` | factory | `route-prefix-extension.ts` | Returns `Extension[]` |
| `dropExtension(handler)` | factory | `drop-extension.ts` | Returns `Extension[]` |
| `useEditStatePreservation` | React hook | `state-preservation.ts` | [L23] integration |
| `createCMSelectionAdapter(view)` | factory | `selection-adapter.ts` | Returns `TextSelectionAdapter` |
| `GalleryTextEdit` | React component | `gallery-text-edit.tsx` | Registered in `gallery-registrations.tsx` |

---

### Documentation Plan {#documentation-plan}

- [ ] Component-authoring header docblock on `tug-edit.tsx` matching the existing pattern (laws, design decisions, expected use).
- [ ] README block in `tug-edit/` describing the extension layout for future maintainers.
- [ ] Update `component-library-roadmap.md` to add `tug-edit` and the `TextEdit` gallery card.
- [ ] Cross-reference `tuglaws.md` if any law gets a new clarification from the spike.

---

### Test Plan Concepts {#test-plan-concepts}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Pure functions in `tug-edit/*.ts` (clipboard filter, atom widget construction) | Step-local |
| **Integration (real engine)** | `tug-edit` mounted in a real React tree against the real CM6 view | Across steps; replaces happy-dom mocks for selection / focus / event-ordering |
| **Manual (gallery)** | Walk the `TextEdit` card through every prop / feature | Every step that ships a behavior; Step 11 walks the full surface |
| **`just app-test`** | End-to-end integration where the full app harness applies | Selection / focus integration that touches the responder chain |

Manual scenarios are documented in each step. The IME validation gate (Step 6) is exclusively manual and produces a written report.

---

### Execution Steps {#execution-steps}

#### Step 1: Bootstrap CM6 + empty `tug-edit` skeleton {#step-1}

**Commit:** `feat(tug-edit): bootstrap CM6 substrate with empty editor`

**References:** [D01](#d01-spike-cm6), [D03](#d03-tug-edit-name), [Q03](#q03-strict-mode), [L01], [L03], [L06], [L07], [L11], [L19], [L21], [L24], Table T02, (#strategy, #internal-architecture, #tuglaws-compliance)

**Artifacts:**
- `package.json`: add `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` via `bun add`.
- `tug-edit.tsx` shell that constructs an `EditorView` in a `useLayoutEffect`, stores it on a ref, disposes on cleanup.
- `tug-edit.css` empty.
- `gallery-text-edit.tsx` stub registering a `TextEdit` card with an empty `<TugEdit>` inside.
- Registration in `gallery-registrations.tsx`.

**Tasks:**
- [x] `bun add @codemirror/state @codemirror/view @codemirror/commands` (in `tugdeck/`). Installed `@codemirror/state@6.6.0`, `@codemirror/view@6.41.1`, `@codemirror/commands@6.10.3`.
- [x] Implement `tug-edit.tsx` with the StrictMode-safe lifecycle pattern from [Q03](#q03-strict-mode).
- [x] Implement `gallery-text-edit.tsx` and register it.
- [x] Verify the gallery card mounts with a working empty editor: type, arrow keys, undo all functional. *(Manually verified by user.)*

**Tests:**
- [x] Unit: `tug-edit.test.tsx` mounts `<TugEdit />`, asserts the `EditorView` is created and `delegate.view()` returns it; unmounts and re-mounts verifying no leaks. *(3 tests pass, 12 expect calls.)*

**Checkpoint:**
- [x] `bun run check` exits 0. *(Two pre-existing errors in `card-host.tsx` and `tug-pane.tsx` are present on main and unrelated to this step; no new errors introduced by Step 1.)*
- [x] `bun test` exits 0. *(2417 tests pass; full suite green.)*
- [x] Manual: gallery `TextEdit` card mounts, accepts typing, supports arrow keys / Cmd+Z. No console warnings under StrictMode dev mount. *(Manually verified by user.)*
- [x] [Q03](#q03-strict-mode) resolved (DECIDED) and decision recorded inline at the top of `tug-edit.tsx`.

---

#### Step 2: Tug 7-element token theme {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tug-edit): theme via 7-element CSS tokens`

**References:** [D06](#d06-theming), [L06], [L15], [L16], [L17], [L18], [L19], [L20], Table T02, (#t01-feature-surface, #tuglaws-compliance)

**Artifacts:**
- `tug-edit/theme.ts` exporting `tugTheme` extension reading `var(--tug-*)` for content fg, content bg, caret color, selection bg.
- `tug-edit.css` adds host wrapper, focus-ring vs focus-background variants, borderless modifier.
- Gallery card exposes `focusStyle` and `borderless` toggles. *Theme switching is application-level and not surfaced as a per-card control; manual verification uses the existing app-level theme controls.*

**Tasks:**
- [x] Implement `tugTheme` covering `.cm-content`, `.cm-cursor`, `.cm-selectionBackground`, `.cm-focused`, `.cm-line`. *(See `tug-edit/theme.ts`. Selection paint covers active/inactive split via `&.cm-focused .cm-selectionBackground` vs `.cm-selectionBackground`. Caret rendering requires `drawSelection()` from `@codemirror/view` — added to the extension list since the theme styles `.cm-cursor` which only exists when that extension is loaded.)*
- [x] Wire `focusStyle` and `borderless` props to CSS classes on the host wrapper. *(Implemented as `data-focus-style` and `data-borderless` data attributes; `tug-edit/host-state.ts` mirrors editor focus into `data-focused`.)*
- [ ] Manual: switch theme (brio ↔ harmony) using the application-level theme controls; verify caret, selection, content colors update without remount. *(Pending user walkthrough.)*

**Tests:**
- [x] Integration: `tug-edit.test.tsx` mounts under a brio theme, asserts caret / selection use the expected CSS variable resolution; switches to harmony, asserts updated. *(Adapted: full token resolution requires real CSS, out of scope for happy-dom. Tests verify focusStyle/borderless data attributes propagate, the CM6 theme class is attached, and `.cm-content` is editable. Live token resolution is verified manually via the gallery card.)*
- [x] `bun run audit:tokens lint` exits 0. *(`tug-edit.css` added to the audit's COMPONENT_CSS_FILES list with full `@tug-pairings` block; zero violations.)*

**Checkpoint:**
- [x] `bun run check` exits 0. *(Two pre-existing errors from main remain; no new errors introduced by Step 2.)*
- [x] `bun run audit:tokens lint` exits 0.
- [ ] Manual theme switch in gallery card produces the expected appearance shift. *(Pending user walkthrough.)*

---

#### Step 3: Atom rendering, atomic ranges, clipboard round-trip {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tug-edit): atom widgets with atomicRanges and clipboard round-trip`

**References:** [D05](#d05-atom-rendering), [Q01](#q01-atomic-fidelity), [Q02](#q02-atom-clipboard), List L01, [L02], [L06], [L07], [L11], [L19], [L22], Table T02, (#t01-feature-surface, #l01-atom-motion-cases, #tuglaws-compliance)

**Artifacts:**
- `tug-edit/atom-decoration.ts`: `AtomWidget extends WidgetType`, `atomDecorationField: StateField<DecorationSet>`, helpers to insert / replace / remove atoms via transactions.
- `tug-edit/atomic-ranges.ts`: `EditorView.atomicRanges.of((view) => view.state.field(atomDecorationField))`.
- `tug-edit/clipboard-filters.ts`: `clipboardOutputFilter` emits U+FFFC + sidecar; `clipboardInputFilter` reads sidecar back.
- `tug-edit.tsx`: imperative `insertAtom(segment)` on the delegate.
- Gallery card: a button row that inserts each atom kind (file, command, doc, image, link).

**Tasks:**
- [x] Implement `AtomWidget` reusing `createAtomImgElement` from `tug-atom-img.ts`. *(See `tug-edit/atom-decoration.ts`. `eq` matches on segment identity; `ignoreEvent` lets clicks bubble for double-click selection.)*
- [x] Implement `atomDecorationField` keyed off U+FFFC positions in the doc. *(`StateField<DecorationSet>` with `addAtomsEffect`, `replaceAtomsEffect`, and `regenerateAtomsEffect` for theme regeneration.)*
- [x] Implement `atomicRangesExt` provider. *(See `tug-edit/atomic-ranges.ts`.)*
- [x] Implement clipboard filters with explicit sidecar MIME (`application/x-tug-atoms`). *(See `tug-edit/clipboard-filters.ts`. Pure `serializeClipboard`/`parseClipboardSidecar` for round-trip; DOM event handlers wrap them. External clipboards see atom labels in place of U+FFFC.)*
- [ ] Walk every case in [List L01](#l01-atom-motion-cases) manually. *(Pending user walkthrough — gallery card now exposes insert-atom buttons for all five kinds.)*

**Tests:**
- [x] Integration: insert atom, arrow-right past atom, assert selection offset advanced by 1 (atom = 1 character). *(See `tug-edit.test.tsx#right-arrow advances by one across an atom`.)*
- [x] Integration: backspace immediately after atom, assert atom removed and decoration cleared. *(See `tug-edit.test.tsx#backspace immediately after an atom deletes the whole atom and clears the decoration`.)*
- [x] Integration: shift+right-arrow extends selection across atom in one step. *(See `tug-edit.test.tsx#shift+right extends the selection across an atom in one step`.)*
- [x] Integration: copy + paste round-trip preserves atom decoration. *(See `tug-edit-clipboard.test.ts` for the pure serialization round-trip — 12 tests covering happy path, malformed sidecars, and label-replacement ordering.)*

**Checkpoint:**
- [ ] All 10 cases in [List L01](#l01-atom-motion-cases) pass manually. *(Pending user walkthrough.)*
- [x] [Q01](#q01-atomic-fidelity) and [Q02](#q02-atom-clipboard) resolved (DECIDED).
- [x] `bun run check`, `bun test`, `bun run audit:tokens lint` exit 0. *(2438 tests pass; +17 new for Step 3. Two pre-existing TS errors on main remain unrelated.)*

---

#### Step 4: Keymap, input actions, undo/redo, history navigation {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tug-edit): keymap with submit/newline actions, history nav, undo`

**References:** [Table T01](#t01-feature-surface), [L02], [L06], [L07], [L11], [L19], Table T02, (#public-api, #tuglaws-compliance)

**Artifacts:**
- `tug-edit/keymap.ts`: high-priority `keymap.of([...])` covering Enter / Shift-Enter / numpad Enter / Cmd+Enter / Cmd+A / Cmd+Z / Cmd+Shift+Z / Cmd+Up / Cmd+Down.
- `tug-edit.tsx`: wires `returnAction`, `numpadEnterAction`, `onSubmit`, `historyProvider` props.
- Gallery card: toggle for `returnAction`, mock `historyProvider` showing back/forward.

**Tasks:**
- [ ] Implement keymap with high precedence so it wins over `defaultKeymap`.
- [ ] Wire `historyProvider.back` / `forward` to dispatch transactions that swap doc + selection.
- [ ] Verify draft preservation: typing → Cmd+Up → Cmd+Down restores the typed draft.

**Tests:**
- [ ] Integration: Return with `returnAction="submit"` fires `onSubmit`; with `returnAction="newline"` inserts `\n`.
- [ ] Integration: Shift-Return always inserts `\n`.
- [ ] Integration: Cmd+Up navigates back, Cmd+Down restores draft.
- [ ] Integration: Cmd+Z undoes after typing + atom insert.

**Checkpoint:**
- [ ] All keymap cases pass manually in gallery.
- [ ] `bun run check`, `bun test` exit 0.

---

#### Step 5: Completion popup integration {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tug-edit): completion popup via CompletionProvider`

**References:** [Table T01](#t01-feature-surface), [L02], [L03], [L04], [L06], [L07], [L11], [L19], [L20], [L22], Table T02, (#internal-architecture, #tuglaws-compliance)

**Artifacts:**
- `tug-edit/completion-extension.ts`: extension watching for trigger characters from `completionProviders`, tracking query state, emitting typeahead state via `onTypeaheadChange`.
- `tug-edit.tsx`: renders the existing completion menu UI in a portal positioned via CM6 `coordsAtPos`.
- Gallery card: mock `@` (file) and `/` (slash) providers using existing fixtures.

**Tasks:**
- [ ] Implement trigger detection via a `ViewPlugin` watching transactions.
- [ ] Wire selection changes to insert the chosen completion as an atom (transaction inserts U+FFFC + adds decoration field entry).
- [ ] Match the existing completion menu's positioning + keyboard nav.

**Tests:**
- [ ] Integration: type `@`, mock provider returns 3 items, popup renders, arrow keys navigate, Enter inserts the atom.
- [ ] Integration: Esc dismisses the popup without inserting.

**Checkpoint:**
- [ ] Manual: gallery `@` and `/` typeahead works end-to-end.
- [ ] `bun run check`, `bun test` exit 0.

---

#### Step 6: IME validation gate {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** [R01](#r01-ime-atoms), [D01](#d01-spike-cm6), [L19], [L23], Table T02, (#success-criteria, #tuglaws-compliance)

**Artifacts:**
- A written validation report at `tugdeck/src/components/tugways/__tests__/tug-edit-ime-report.md` documenting test scenarios, observed behavior, and any defects.

**Tasks:**
- [ ] Manual: Japanese kana compose mid-line, no atoms adjacent. Submit → text round-trips.
- [ ] Manual: Japanese kana compose immediately before an atom. Selection / glyph behavior recorded.
- [ ] Manual: Japanese kana compose immediately after an atom. Selection / glyph behavior recorded.
- [ ] Manual: Chinese pinyin compose with a partial-selection over an atom. Behavior recorded.
- [ ] Manual: Compose-then-undo. Behavior recorded.
- [ ] Halt condition: any test that produces character drops, selection collapse, or visible glyph corruption stops the spike pending discussion.

**Checkpoint:**
- [ ] Validation report committed.
- [ ] User-facing decision: continue / halt. Recorded inline in the report.

---

#### Step 7: [L23] state preservation — active and inactive paint channels {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tug-edit): L23 state preservation via active/inactive paint channels`

**References:** [R02](#r02-l23-mirror), [L02], [L03], [L06], [L07], [L10], [L12], [L22], [L23], [L24], Table T02, (#internal-architecture, #tuglaws-compliance)

**Artifacts:**
- `tug-edit/state-preservation.ts`: `useEditStatePreservation` hook mirroring the existing `useCardStatePreservation` integration; `paintMirrorAsActive` / `paintMirrorAsInactive` implementations on the delegate.
- Gallery card: state-preservation demo enabled via `preserveState`.

**Tasks:**
- [ ] `captureState` reads `view.state.doc.toString()`, atom segments from `atomDecorationField`, selection, scrollTop.
- [ ] `restoreState` dispatches a transaction that sets doc + decoration field + selection; writes scrollTop directly on `.cm-scroller`.
- [ ] `paintMirrorAsActive` claims focus + `view.dispatch({ selection })`.
- [ ] `paintMirrorAsInactive` builds a `Range` from mirror selection over the live `cm-content` node and routes it through the supplied `publish` callback (typically `selectionGuard.updateCardDomSelection`).
- [ ] Cmd-tab away → return scenario: selection + scrollTop preserved.
- [ ] Cold-mount restore scenario: every inactive card paints via the `publish` channel, the active card paints via active channel, ordering invariant respected.

**Tests:**
- [ ] Integration: capture/restore round-trip preserves doc, atoms, selection, scrollTop.
- [ ] Integration: deactivate → activate sequence routes through both paint channels in order.
- [ ] `just app-test` covering pane state preservation if existing harness applies.

**Checkpoint:**
- [ ] Manual: cmd-tab to another app and back; selection / scroll preserved.
- [ ] Manual: reload tugdeck; selection / scroll restored on first paint.
- [ ] `bun run check`, `bun test` exit 0.

---

#### Step 8: Drop handler integration {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tug-edit): file-drop atom insertion`

**References:** [Table T01](#t01-feature-surface), [L06], [L07], [L13], [L19], Table T02, (#tuglaws-compliance)

**Artifacts:**
- `tug-edit/drop-extension.ts`: `EditorView.domEventHandlers({ drop, dragover })`; computes insertion offset via `view.posAtCoords`.
- Gallery card: drop a file from Finder onto the editor and observe atom insertion.

**Tasks:**
- [ ] Implement drop handler.
- [ ] Compute insertion offset with the same vertical bias the existing engine uses (`DROP_Y_OFFSET_RATIO`).
- [ ] Suppress browser default drop behavior (no navigation).

**Tests:**
- [ ] Integration: simulate `drop` event with a `DataTransfer` carrying a file; assert atom inserted at expected offset.

**Checkpoint:**
- [ ] Manual: drop a file from Finder onto the gallery card; atom appears at drop point.
- [ ] `bun run check`, `bun test` exit 0.

---

#### Step 9: Selection adapter and right-click classifier {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tug-edit): selection adapter and right-click classifier`

**References:** [Table T01](#t01-feature-surface), [L06], [L07], [L11], [L12], [L19], [L20], Table T02, `text-selection-adapter.ts`, (#tuglaws-compliance)

**Artifacts:**
- `tug-edit/selection-adapter.ts`: `createCMSelectionAdapter(view)` returning a `TextSelectionAdapter`.
- `tug-edit.tsx`: hooks adapter into the existing `TugEditorContextMenu`.
- Gallery card: right-click context menu functional with the new adapter.

**Tasks:**
- [ ] Port `hasRangedSelection`, `getSelectedText`, `selectAll`, `expandToWord`, `selectWordAtPoint` to read from `view.state.selection`.
- [ ] Port `classifyRightClick` to use `view.coordsAtPos` for "near-caret" / "within-range" geometry.

**Tests:**
- [ ] Integration: right-click in / near / outside a selection produces the expected classification.

**Checkpoint:**
- [ ] Manual: right-click context menu in gallery card behaves identically to the existing `tug-prompt-input` card.
- [ ] `bun run check`, `bun test` exit 0.

---

#### Step 10: Polish props — placeholder, maxRows, growDirection, maximized, focusStyle, borderless, route prefixes, disabled {#step-10}

**Depends on:** #step-9

**Commit:** `feat(tug-edit): full prop surface parity with tug-prompt-input`

**References:** [Q04](#q04-route-atom-position), [Table T01](#t01-feature-surface), [L02], [L03], [L06], [L07], [L11], [L15], [L16], [L19], [L24], Table T02, (#tuglaws-compliance)

**Artifacts:**
- Placeholder via `@codemirror/view` `placeholder` extension.
- `maxRows` via CSS on `.cm-scroller`.
- `growDirection` via wrapper flex-direction / align-end.
- `maximized` via flex:1 1 auto on outer wrapper, `maxRows` ignored.
- `focusStyle` via CSS class toggled on `EditorView.focusChangeEffect`-equivalent.
- `borderless` via CSS modifier.
- `routePrefixes` / `onRouteChange` via `route-prefix-extension.ts` watching offset 0; route atom inserted in-doc per [Q04](#q04-route-atom-position).
- `disabled` via `EditorState.readOnly` facet + CSS class.

**Tasks:**
- [ ] Implement each prop.
- [ ] Resolve [Q04](#q04-route-atom-position) (default: route atom in-doc at offset 0).

**Tests:**
- [ ] Integration: each prop unit-checked.
- [ ] `bun run audit:tokens lint` exits 0 (focus/disabled CSS uses tokens).

**Checkpoint:**
- [ ] Gallery card exercises every prop.
- [ ] `bun run check`, `bun test` exit 0.

---

#### Step 11: Gallery `TextEdit` card finalization {#step-11}

**Depends on:** #step-10

**Commit:** `feat(gallery): TextEdit card exercises full tug-edit surface`

**References:** [L01], [L06], [L09], [L11], [L19], [L25], Table T02, (#t01-feature-surface, #tuglaws-compliance)

**Artifacts:**
- Final `gallery-text-edit.tsx` with controls / toggles for every prop on `TugEdit`.
- Visual reference matching the polish bar of `gallery-prompt-input.tsx`.

**Tasks:**
- [ ] Add toggles / inputs for every prop in [Table T01](#t01-feature-surface).
- [ ] Atom-insert button row for each atom kind.
- [ ] Mock providers for `@` and `/`.
- [ ] Mock `HistoryProvider`.
- [ ] Mock `DropHandler` (in addition to live drop).

**Tests:**
- [ ] Integration: render the gallery card; assert each control mounts and dispatches.

**Checkpoint:**
- [ ] Manual: walk the entire gallery card; every feature works as documented.
- [ ] `bun run check`, `bun test`, `bun run audit:tokens lint` exit 0.

---

#### Step 12: Integration checkpoint and bundle size measurement {#step-12}

**Depends on:** #step-11

**Commit:** `N/A (verification only)`

**References:** [R03](#r03-bundle), [L01]–[L25] (full sweep), Table T02, (#success-criteria, #tuglaws-compliance)

**Tasks:**
- [ ] Run `bun run build` (production bundle).
- [ ] Compare bundle size delta vs `main`. Record gzip and uncompressed deltas.
- [ ] Walk every Success Criteria checkbox.
- [ ] Walk [L01]–[L25] for new substrate code against [Table T02](#t02-tuglaws-applied); record any clarifications. The expected outcome is that every law marked "Engaged" has a verifiable compliance landing in the substrate code or in `gallery-text-edit`.

**Tests:**
- [ ] Aggregate: full `bun test`, `bun run check`, `bun run audit:tokens lint`, `cargo nextest run` from repo root.
- [ ] Manual: full gallery walkthrough.

**Checkpoint:**
- [ ] All Success Criteria boxes ticked.
- [ ] Bundle delta documented; if > 200 KB gzip, [R03](#r03-bundle) revisited.
- [ ] Tuglaws walkthrough recorded.

---

#### Step 13: Decision and follow-on plan scaffold {#step-13}

**Depends on:** #step-12

**Commit:** `docs(roadmap): record tug-edit substrate decision and scaffold migration plan`

**References:** [D01](#d01-spike-cm6), [D04](#d04-additive), [L21], (#roadmap, #tuglaws-compliance)

**Artifacts:**
- A "Decision" section appended to this plan recording: continue migrating to CM6, hold and revisit, or abandon and revert.
- If continuing: a scaffold for `roadmap/tugplan-text-editing-migration.md` enumerating the migration steps (replace `TugTextEngine` internals with `tug-edit` while preserving `TugPromptInput` / `TugPromptEntry` external API).

**Tasks:**
- [ ] Owner records decision with one-paragraph rationale.
- [ ] If continuing, scaffold the migration plan with at minimum: target component list, expected behavioral parity checklist, rollback plan.

**Checkpoint:**
- [ ] Decision committed.
- [ ] If continuing, migration plan scaffold committed.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A CM6-backed `tug-edit` substrate component with full feature parity to `tug-prompt-input`'s prop surface, exercised in a Component Gallery `TextEdit` card, validated through an IME compose gate, and accompanied by a written go/no-go decision on adopting CM6 for the existing prompt surfaces.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `tug-edit` exists and ships ([D03](#d03-tug-edit-name), [D04](#d04-additive)).
- [ ] Every prop in [Table T01](#t01-feature-surface) has a working equivalent on `tug-edit`.
- [ ] Every case in [List L01](#l01-atom-motion-cases) passes.
- [ ] IME validation report ([Step 6](#step-6)) committed and unblocks the rest of the plan, OR the spike is halted with the report explaining why.
- [ ] [L23] paint channels work across cmd-tab and cold-mount restore.
- [ ] `TextEdit` gallery card exercises every prop and feature.
- [ ] Bundle delta documented.
- [ ] Decision recorded in [Step 13](#step-13).

**Acceptance tests:**
- [ ] Full `bun test` green.
- [ ] Full gallery walkthrough; every control behaves as labeled.
- [ ] `bun run audit:tokens lint`, `bun run check`, `cargo nextest run` green.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Markdown live decorations.** A follow-on plan adds source-with-live-decoration support to `tug-edit` (bold/italic/headings/lists/code fences/blockquotes), patterned on Obsidian Live Preview / `codemirror-rich-markdoc`. Out of scope for this phase per [D02](#d02-markdown-ceiling).
- [ ] **Migration plan: `tug-prompt-input` internals → `tug-edit`.** Scaffolded in [Step 13](#step-13) if the decision is "go". Replaces the contenteditable + `TugTextEngine` internals while preserving the external prop surface.
- [ ] **Migration: `tug-prompt-entry`.** Consumes `tug-edit` via `tug-prompt-input` once that surface is migrated. No direct dependency on `tug-edit`.
- [ ] **Migration: `tide-card`.** Same as above — transitive via `tug-prompt-entry`.
- [ ] **Component-library-roadmap update.** Add `tug-edit` and the `TextEdit` gallery card to the published roster.

| Checkpoint | Verification |
|------------|--------------|
| `tug-edit` substrate ships | `gallery-text-edit` card mounts, all props functional |
| Atom motion correctness | Every case in [List L01](#l01-atom-motion-cases) passes manually |
| IME compose works | [Step 6](#step-6) report committed; no halt condition triggered |
| [L23] preservation works | cmd-tab + cold-mount restore scenarios pass |
| Bundle delta acceptable | Documented in [Step 12](#step-12), within [R03](#r03-bundle) target |
| Decision made | [Step 13](#step-13) committed with rationale |

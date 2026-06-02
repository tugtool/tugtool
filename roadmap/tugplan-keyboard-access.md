<!-- devise-skeleton v4 -->

## Keyboard Access, Focus, and the Key-View Engine {#keyboard-access}

**Purpose:** Replace the app's tangled mix of borrowed-Radix focus, suppressed browser focus, and ad-hoc first-responder conventions with one app-owned focus engine — a "key view" that is always visible, an explicit app-authored Tab order with two modes (`standard` / `accessibility`), a single crisp focus-ring primitive, and a color contract where **accent (orange) = selection** and **action (blue) = focus**.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Focus, first-responder, and keyboard access in tugdeck are spread across three conflated axes that no part of the code names as distinct: the **responder chain's first responder** (action-routing target), **DOM focus** (`document.activeElement`, the keyboard target), and **visible focus indication** (a scatter of `:focus` / `:focus-visible` / `:focus-within` rules with no shared token). On top of that, ~14 components delegate focus management to Radix (`RovingFocus`, `FocusScope`, focus guards), while `data-tug-focus="refuse"` and `internal/safari-focus-shift.ts` patch around the parts of Radix we don't want. Inter-control Tab order is whatever the DOM emits — not under app control. The focus ring is rendered three different ways (indigo `accentCool`, the `link` color, the `accent` color) at three different widths/offsets. Selection currently wears the **action/blue** color (`--tug7-surface-selection-primary-normal-selected-rest`), so "selected" and "keyboard-target" are visually indistinguishable, and there is no coherent accessibility story.

This phase names the three axes, builds an app-owned **focus engine** (a "key view" with an explicit, mode-aware Tab walk integrated with the responder chain), establishes a single focus-ring primitive, and re-targets the color contract so **accent = selection** and **action = focus**. The default-button grep-and-poke stack is retired in favor of a chain-dispatched default action. Accessibility mode is built in-app now, with ARIA structured so a later OS/VoiceOver integration is additive rather than a rewrite.

#### Strategy {#strategy}

- **Name the axes, then build the engine.** Introduce a `FocusManager` co-located with the responder chain that owns the **key view** (the single keyboard-target element) and an explicit focusable registry — *before* changing any Tab behavior, so the foundation lands without a visible regression.
- **Model floating-surface focus traps on CFRunLoop modes.** The FocusManager holds a **stack of focus modes (scopes)**; the Tab walk only services focusables registered in the currently-active mode. Opening a sheet/alert/popover/menu/completion pushes a trapped mode; dismissing pops it. This subsumes the old default-button LIFO scoping. See [CFRunLoop mode model](#cfrunloop-model).
- **App-owned Tab walk, not native tabindex.** Intercept Tab / Shift-Tab as `focus-next` / `focus-previous` chain actions and advance the key view via the registry, honoring authored **order/group** and per-component **policy** (`accept` / `skip`). Text editors declare a transient "I consume Tab now" state (open completion / typeahead) that takes precedence.
- **Tame Radix, don't replace it.** Disable Radix focus management per primitive and drive focus from the FocusManager; modal trapping becomes a FocusManager scope, so there is one trap implementation.
- **One ring, two tiers.** A single `--tugx-focus-ring` token (action/blue, one width, one offset, `outline`-based) plus a Tier-1 always-on 1px hairline key-view marker. Delete every per-component ring rule.
- **Flip the color contract.** Re-point selection/selected/highlighted surfaces from blue to accent/orange across list rows, menus, popovers, and tab bars; reserve action/blue for focus. Validate with the token contrast audit.
- **Audit last.** Reclassify every first-responder / `refuse` site against the named axes once the engine exists, and finish with the accessibility-mode ARIA pass and the dual mode toggle (in-app setting + Swift host menu).

#### Success Criteria (Measurable) {#success-criteria}

- Pressing Tab / Shift-Tab moves the key view through an **app-authored order** (not DOM order); reordering a group in the focusable registry changes Tab order with no DOM move. (app-test: `just app-test` focus-walk scenario asserts visit order)
- The key view is **always** marked by a 1px hairline (Tier 1) regardless of pointer vs keyboard; keyboard navigation additionally shows the blue Tier-2 ring. (app-test asserts `data-key-view` present after both a click and a Tab)
- Opening a floating surface **traps** Tab within it; Tab from the last focusable cycles to the first; dismissing restores the prior key view. (app-test: open menu, Tab past end, assert wrap; close, assert key-view restored)
- A selected-and-focused list row renders **orange fill + blue ring** simultaneously and distinguishably. (app-test/visual: assert both tokens resolve on the row)
- `bun run audit:tokens pairings` passes after the selection→accent recolor with zero new contrast failures.
- No reference to `pushDefaultButton` / `peekDefaultButton` / `peekDefaultButtonInScope` / a `defaultButton` prop remains; Enter-outside-text still presses the active scope's default. (grep returns nothing; app-test dialog Enter still confirms)
- `data-keyboard-access` toggles `standard` ↔ `accessibility`; in `accessibility` mode every interactive affordance marked `skip` becomes Tab-reachable. (app-test asserts a `skip` control is unreachable in standard, reachable in accessibility)
- A component-registered keybinding fires only while that component is in context and is gone after it unmounts; an in-context binding overrides a global one; the static global shortcuts still fire. (app-test mounts/unmounts a component and asserts binding activation and precedence)
- From a focused list inside a sheet, Return fires the sheet's **default action** without moving focus to OK; Escape/⌘. fires cancel; a focused text editor still gets Return for submit/newline. (app-test asserts scope-routed commit keys with editor precedence intact)
- A primary CTA button stays blue (default-action affordance); UI selection is orange; text/character selection stays blue. (app-test/visual asserts the three roles resolve distinctly)
- `bunx tsc --noEmit` and `bun test` are clean; the workspace builds with `-D warnings`.

#### Scope {#scope}

1. A `FocusManager` (key view + focusable registry + focus-mode stack) co-located with the responder chain, plus a `useFocusable` hook.
2. A Tab / Shift-Tab pipeline stage dispatching `focus-next` / `focus-previous`, with editor Tab-consume precedence.
3. Floating-surface focus traps modeled on CFRunLoop modes.
4. Keyboard-access mode state (`standard` / `accessibility`), persisted via tugbank defaults, plus an in-app setting and a Swift host menu item.
5. A single `--tugx-focus-ring` focus-ring primitive + two-tier key-view indication; deletion of all per-component ring rules.
6. Color re-target: selection → accent/orange; focus → action/blue; rolled across list rows, menus, popovers, tab bars (option/radio already accent).
7. Radix focus-management taming across the focus-sensitive components.
8. Semantic commit keys (Return/Escape/⌘.) → scope `default-action` / `cancel-action`, independent of the key view; default-button stack retired.
9. First-responder / `refuse` audit and reclassification (split `refuse` into its two real meanings).
10. Accessibility-mode ARIA pass (interactive affordances only), AT-ready.
11. Dynamic, context-scoped keybinding registry: components attach/detach key→action bindings as they mount/unmount, resolved by responder/focus context.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full screen-reader / VoiceOver / OS-accessibility-tree integration (foundation only; additive later phase).
- Making **non-interactive** content (transcript prose, static text blocks) keyboard-landable — accessibility mode covers interactive affordances only ([P09]).
- Changing the responder chain's action-dispatch semantics, action vocabulary, or `useResponder` registration model (the focus engine is a sibling, not a rewrite).
- New theme palettes or a re-derivation of the OKLCH color space; only the selection/focus token *assignments* change.
- Touch / pointer-gesture accessibility.

#### Dependencies / Prerequisites {#dependencies}

- Responder chain (`responder-chain.ts`, `responder-chain-provider.tsx`, `use-responder.tsx`) — the FocusManager rides the same provider and capture-phase listeners.
- tugbank DEFAULTS feed + `/api/defaults/<domain>/<key>` PUT (`src/settings-api.ts`) for mode persistence.
- Token audit tooling (`bun run audit:tokens pairings`) for the recolor.
- Theme CSS files `styles/themes/brio.css`, `styles/themes/harmony.css` (hand-authored; no generation script).
- Swift host (Tug.app) for the menu-item toggle (small additive change; one step).

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** across the Rust workspace; tugdeck must keep `bunx tsc --noEmit` clean.
- Engine is always WebKit (WKWebView host) — `outline` follows `border-radius`; no cross-engine focus shims needed, but WebKit contentEditable/focus quirks are real.
- Tuglaws: [L02] external state via `useSyncExternalStore`; [L06]/[L24] appearance via CSS/DOM; [L03] registrations events depend on use `useLayoutEffect`; [L11] controls emit actions, responders own state; [L20] token sovereignty.
- No `localStorage` / `sessionStorage` / IndexedDB — mode state goes through tugbank defaults.
- AskUserQuestion ≤4 options per question (if any settings UI surfaces choices).
- No plan numbers, bug-history, or enumerations in code/comments.

#### Assumptions {#assumptions}

- `standard` is the default mode; `accessibility` is opt-in and changes behavior comprehensively ([P08]).
- Tab order is **group-level authored** (named groups + ordinals), not merely per-component `skip` ([P02]).
- Floating surfaces (menus, completion, popovers, sheets, alerts) **trap** focus and exit only on dismiss ([P03]).
- The 1px hairline is the Tier-1 starting treatment, expected to be tuned during implementation ([P05]).
- A `selected`/`focused` element legibly carries both colors at once; this is the motivating win of the split.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit and kebab-case. Plan-local decisions use `[P##]`; global decisions (if cited) use `[D##]`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Tier-1 key-view marker visual weight (OPEN) {#q01-tier1-weight}

**Question:** Is a 1px hairline (and in what token / color — neutral border vs faint action tint) the right always-on key-view treatment across both brio and harmony, or does it need a different weight per theme?

**Why it matters:** Too subtle and "where do keys go?" is unanswered at rest; too strong and it competes with the Tier-2 ring and with selection. It affects the focus-ring token set and the key-view CSS.

**Options (if known):**
- 1px neutral hairline (default), Tier-2 blue ring on keyboard nav.
- 1px faint action-tinted hairline.
- Per-theme weight via token override.

**Plan to resolve:** Prototype 2–3 treatments against both themes during [#step-6]; pick by eye, lock the token. Start from 1px hairline per [P05].

**Resolution:** OPEN → resolve in [#step-6].

#### [Q02] Editor Tab-consume handshake shape (OPEN) {#q02-editor-tab-handshake}

**Question:** How does a text editor tell the FocusManager "I'm consuming Tab right now" — a registry flag toggled on completion-open/close, or a per-dispatch veto where the editor's `focus-next` handler returns "handled" when a completion is open?

**Why it matters:** Determines whether the precedence lives in the FocusManager (flag) or in the editor's chain handler (veto). The veto keeps the editor self-contained and reuses the existing continuation/handled protocol; the flag centralizes precedence but adds editor→manager coupling.

**Options (if known):**
- Editor registers `consumesTab(): boolean` on its focusable record (flag).
- Editor handles `focus-next`/`focus-previous` as a chain action and returns handled when a completion/typeahead popup is open (veto), falling through otherwise.

**Plan to resolve:** Spike both against `tug-text-editor/completion-extension.ts` and `keymap.ts` in [#step-3]; prefer the veto if it cleanly replaces the `Prec.highest` Tab keymap ownership.

**Resolution:** OPEN → resolve in [#step-3].

#### [Q03] `accessibility` mode signal source (OPEN) {#q03-a11y-signal}

**Question:** Beyond the in-app setting and Swift menu item, should `accessibility` mode also auto-engage from an OS signal piped through the host (e.g., VoiceOver running)?

**Why it matters:** Auto-engage is a better default for real AT users, but there is no web media query for it and it requires a host→web channel. Guessing wrong adds a channel we don't use or omits one AT users expect.

**Options (if known):**
- In-app setting + Swift menu toggle only (this phase).
- Add a reserved host→web signal channel now, consume later.

**Plan to resolve:** Ship the explicit toggle in [#step-25]; reserve a channel name but defer auto-engage to the AT-integration follow-on.

**Resolution:** DEFERRED — explicit toggle this phase; OS auto-engage in the AT follow-on (see [#roadmap]).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Taming Radix breaks focus trapping / arrow nav in a primitive | high | med | Tame one component at a time behind app-test coverage; FocusManager supplies the trap | any primitive loses Escape/arrow/Tab behavior |
| App-owned Tab walk misses a native a11y semantic | med | med | Mirror native order semantics in the walk; accessibility-mode app-tests assert reachability | AT user reports an unreachable control |
| Selection→accent recolor fails contrast pairings | med | low | Run `audit:tokens pairings` in the recolor step; adjust tone/intensity, not the role | audit reports a new failure |
| Tab interception double-handles editor Tab (completion + walk) | med | med | Single precedence rule resolved in [Q02]; app-test both states | completion accept stops working |
| Mode state races boot (DEFAULTS feed arrives late) | low | med | Default `standard` until feed resolves; apply via `data-keyboard-access` on first paint like theme | flash of wrong mode |
| Dynamic keybinding shadows a global shortcut unexpectedly | med | low | Documented precedence (innermost-in-context → global); dev-warn on same-scope duplicate chords; registry queryable for conflict inspection | a known global stops firing in some context |
| Return ambiguous between editor submit and scope default-action | med | med | Text-context precedence: editor claims Return only when its key view owns it ([P12]/[Q02]); app-test both paths | editor submit or sheet default-action stops working |
| Selection recolor sweeps in text-selection or CTA blue | high | low | [P06]/Step 7 explicitly exclude `selection … plain` and keep `control-filled-action` CTA blue; app-test asserts text selection + CTA stay blue | text highlight or CTA turns orange |

**Risk R01: Radix taming regressions** {#r01-radix-taming}

- **Risk:** Disabling Radix focus management in a primitive removes a behavior (focus trap, roving arrows, Escape close) the FocusManager hasn't yet supplied.
- **Mitigation:** Per-component, behind app-test coverage; the FocusManager's mode scopes ([#cfrunloop-model]) provide trapping before Radix's is removed; arrows stay component-local.
- **Residual risk:** Subtle WebKit focus-restore timing in portaled surfaces may still need `safari-focus-shift`-style patches.

**Risk R02: Tab overload regressions** {#r02-tab-overload}

- **Risk:** Global Tab interception steals Tab from text-editing/completion or from the dev card's `⇧⇥` permission-mode cycle.
- **Mitigation:** Editor consume-precedence ([Q02]); `cycle-permission-mode` migrates into the same precedence model rather than a parallel `Prec.highest` keymap.
- **Residual risk:** Future editor sub-modes must remember to declare Tab consumption.

---

### Design Decisions {#design-decisions}

#### [P01] One app-owned FocusManager, co-located with the responder chain (DECIDED) {#p01-focus-manager}

**Decision:** Introduce a `FocusManager` that owns the **key view** (single keyboard-target element id), an explicit **focusable registry**, and a **focus-mode stack**. It lives alongside `ResponderChainManager` and rides `ResponderChainProvider`'s existing document capture-phase listeners — not a parallel provider.

**Rationale:**
- The key view is conceptually a sibling of first responder; both are promoted off the same DOM-walk and capture-phase listeners already installed in `responder-chain-provider.tsx`.
- Reusing the provider avoids a second set of document listeners and ordering hazards with the chain's capture-phase pipeline.
- An app-owned walk is the only way to decouple Tab order from DOM order, switch order by mode without re-render, and fold editor Tab-consumption into one rule (per the chosen "app-intercepted focus walk").

**Implications:**
- New `useFocusable` hook (sibling to `useResponder`) registers via `useLayoutEffect` ([L03]) and writes `data-tug-focusable` + ordering metadata.
- The manager stamps `data-key-view` on exactly one element at a time (structure zone), which CSS reads for Tier-1 indication.

#### [P02] Tab order is group-level authored, not DOM-derived (DECIDED) {#p02-authored-order}

**Decision:** Standard-mode Tab order is determined by **named focus groups + ordinals** declared at registration, not by DOM position or native `tabindex`.

**Rationale:**
- The requirement is explicit app control of order; DOM order couples order to layout.
- Group-level authoring ("prompt → toolbar → transcript") matches how the app reasons about regions and survives layout changes.

**Implications:**
- `useFocusable({ group, order, policy })`; the walk sorts by (group order, item order) within the active focus mode.
- Composite widgets (list, radio, option, tab bar) register as a **single** focus stop; arrows move within via component-local roving.

#### [P03] Floating-surface focus traps modeled on CFRunLoop modes (DECIDED) {#p03-cfrunloop-traps}

**Decision:** The FocusManager holds a **stack of focus modes (scopes)**. The Tab walk services only focusables registered in the **currently-active mode**. Opening a floating surface pushes a trapped mode; dismissing pops it.

**Rationale:**
- Mirrors CFRunLoop: a run loop runs in exactly one mode; only sources registered for that mode are serviced; modes nest as a stack. (<https://developer.apple.com/documentation/corefoundation/cfrunloop?language=objc>)
- Gives trapping, nesting, and "default action belongs to the active scope" for free — and subsumes the old default-button LIFO `peekDefaultButtonInScope` scoping.

**Implications:**
- `pushFocusMode(scopeId, { trapped })` / `popFocusMode(scopeId)` via `useLayoutEffect` on surface open/close.
- `default-action` ([P07]) resolves against the active mode, replacing pane-scoped default-button peeking.

#### [P04] App-intercepted Tab via `focus-next` / `focus-previous` chain actions (DECIDED) {#p04-tab-actions}

**Decision:** Tab / Shift-Tab are intercepted in the keyboard pipeline and dispatched as `focus-next` / `focus-previous`. The walk starts at the key view; a text editor advertising a Tab-consuming sub-state handles them first ([Q02]).

**Rationale:**
- Single code path for inter-control movement, mode switching, and editor precedence; no per-component Tab wiring.
- Replaces the editor's `Prec.highest` Tab keymap *as the owner* of Tab and folds the dev card's `⇧⇥` into the same precedence model.

**Implications:**
- New `TUG_ACTIONS.FOCUS_NEXT` / `FOCUS_PREVIOUS`; new pipeline stage in `responder-chain-provider.tsx`.
- `keybinding-map.ts` adds Tab / Shift-Tab; the existing `⇧⇥ cycle-permission-mode` is reconciled (it remains a key-card action but yields to the focus walk when no dev card consumes it).

#### [P05] One focus-ring primitive; two-tier key-view indication (DECIDED) {#p05-focus-ring}

**Decision:** A single `--tugx-focus-ring` token set (color = action/blue, one width, one offset, `outline`-based, clipping to `border-radius`) applied by one shared mechanism. **Tier 1**: an always-on 1px hairline on the key view (`data-key-view`). **Tier 2**: the blue ring on keyboard nav (`:focus-visible`).

**Rationale:**
- Crisp border/highlight, not a fuzzy bloated glow; `outline` is layout-free and follows radius on WebKit.
- Two tiers distinguish "where keys go" (always) from "I'm tabbing" (active), satisfying "focused element visible at all times" without a heavy ring after every click.

**Implications:**
- Delete per-component ring rules (indigo `accentCool` on checkbox/option-group/input, `link`-colored `--tugx-dialog-button-focus-ring` / `--tugx-idialog-focus-ring`, cue `accent`).
- New tokens authored in both `brio.css` and `harmony.css`.

#### [P06] Color contract: accent = selection, action = keyboard-active (DECIDED) {#p06-color-contract}

**Decision:** **accent/orange = selection** (the chosen item). **action/blue = the keyboard-active axis** — the surface the keyboard is currently empowering, expressed two ways: the **focus ring** (typing/arrows land here) and the **default-action affordance** (the CTA button Return fires, see [P12]). Re-point **UI-selection** surfaces (`selected`, `highlighted`, and the menus' *selection* usage of the shared `control-filled-action`) from blue to accent/orange across list rows, menus, popovers, and tab bars (option/radio already accent). **Text/character selection stays blue** — the `surface-selection-primary … plain` tokens are out of scope (see below).

**Rationale:**
- Today blue does double duty (UI selection *and* action), so selected ≠ focused is invisible. Moving UI selection to orange makes a selected-and-focused element legible, while blue gains a single sharp meaning — *the keyboard acts on this* — whether via focus (typing/arrows) or as the Return target ([P12]). This is why the CTA button stays blue.
- **Text selection is a different concept and must not move.** `surface-selection-primary-normal-plain-rest` (blue) / `-plain-inactive` (yellow) are the OS character-highlight, consumed by `tug-code-view.css`, `tug-markdown-view.css`, `tug-text-editor.css`, and `tug-pane.css`'s `::highlight(card-selection)`. WebKit substitutes the OS color on focused fields; recoloring it would be wrong and fights [L12].

**Implications:**
- Edit `--tug7-surface-selection-primary-normal-selected-*` and the menus' *selection* highlight; introduce an accent-based selection token for menus/lists rather than blanket-recoloring `control-filled-action`.
- **`control-filled-action` is shared** (CTA fill + menu transient): keep it blue for the CTA/activation use ([P12]); route the menu *selection* use to the accent selection token.
- Leave `surface-selection-primary-normal-plain-*` (text selection) at its current values.
- `bun run audit:tokens pairings` must pass; adjust tone/intensity within the role, not the role assignment ([L20]).

#### [P07] Default button retired for a chain-dispatched `default-action` (DECIDED) {#p07-default-action}

**Decision:** Remove the default-button element stack (`pushDefaultButton` / `popDefaultButton` / `peekDefaultButton` / `peekDefaultButtonInScope` and the `defaultButton` prop). The active focus mode declares a **default action**; Enter-outside-text dispatches `default-action`, resolved against the active scope.

**Rationale:**
- The grep-and-poke stack is exactly what the project wants retired; scoping already falls out of the focus-mode stack ([P03]).
- Aligns the "primary action of the active surface" with the chain instead of a side-channel element registry.

**Implications:**
- New `TUG_ACTIONS.DEFAULT_ACTION`; modal scaffolds (`TugConfirmPopover`, `TugAlert`, sheets) declare their default on the focus mode.
- Pipeline Stage 2 dispatches `default-action` instead of clicking a peeked element.
- **Extended by [P12]:** `default-action` is one of the *semantic commit keys* (Return/Escape/⌘.); the **blue CTA keeps `control-…-filled-action`** as its default-action affordance; non-modal default/cancel are pane-scoped via the chain walk from the first responder (correcting the "scoping falls out of the mode stack for free" overstatement, which holds only for modal scopes).

#### [P08] `standard` default; `accessibility` opt-in and comprehensive (DECIDED) {#p08-modes}

**Decision:** `standard` is the default keyboard-access mode; `accessibility` is opt-in and changes behavior comprehensively (ignores `skip`, asserts full interactive ARIA, makes every interactive affordance reachable/activatable). Mode is app state on `data-keyboard-access`, persisted via tugbank defaults, toggled by both an in-app setting and a Swift host menu item.

**Rationale:**
- Matches the request: easy keyboard use for most users, with a comprehensive mode for AT needs.
- Both toggle surfaces because the host menu is discoverable and the in-app setting is persistent.

**Implications:**
- tugbank default `dev.tugtool.app` / `keyboardAccess` (Value::String); read on boot like theme; `useSyncExternalStore` for React consumers, `data-keyboard-access` for CSS ([L02]/[L24]).
- The focus walk takes mode as a policy input; `skip` is honored in standard, ignored in accessibility.

#### [P09] Accessibility mode covers interactive affordances only (DECIDED) {#p09-interactive-only}

**Decision:** "Every element controllable/activatable" means every **interactive** element and affordance — not non-interactive content (transcript prose, static blocks).

**Rationale:**
- Bounds the audit; reading-navigation of static content is a separate AT concern (live regions / virtual cursor) belonging to the OS-integration follow-on.

**Implications:**
- The registry and ARIA pass enumerate interactive affordances; static content is excluded.

#### [P10] `refuse` splits into its two real meanings (DECIDED) {#p10-refuse-split}

**Decision:** The current `data-tug-focus="refuse"` bundle is split into its two independent concerns: **(a)** don't-steal-first-responder-on-click (chain promotion) and **(b)** focus-walk policy (`skip` vs `accept`). They are configured separately and mapped onto the focus engine during the audit.

**Rationale:**
- The two were fused because they happened to co-occur on button-class controls, but they are different axes; the new engine needs them separable (a control can be click-inert for first responder yet still Tab-reachable, and vice versa).

**Implications:**
- The audit ([#step-24]) reclassifies all 28 `data-tug-focus` sites; `TugIconButton` and friends keep no-steal-on-click but gain explicit focus policy.

#### [P11] Dynamic, context-scoped keybinding registry (DECIDED) {#p11-dynamic-keybindings}

**Decision:** Add a **dynamic keybinding registry** alongside the static `KEYBINDINGS` map. Components register key→action bindings at mount via `useKeybindings(...)` and unregister at unmount. A binding is **active only while its owning scope is in context** — on the walk path from the key view / first responder up through `parentId`, or in the currently-active focus mode. Stage 1 resolves dynamic in-context bindings **innermost-first**, then falls back to the static global map. All entries cite `TUG_ACTIONS.*` constants (never raw strings) and dispatch through the chain exactly as static bindings do.

**Rationale:**
- The requirement is that commands attach/detach from action-handling as components come and go; a static array cannot express that. A registry tied to `useLayoutEffect` mount/unmount can, with the timing guarantee responders already rely on ([L03]).
- Context-scoping is the keyboard analog of the responder chain (Cocoa's `performKeyEquivalent:` walking the chain): the same chord can mean different things depending on what the user is working with — no global dispatcher table.
- Composes with the CFRunLoop focus-mode model ([P03]): a floating surface's accelerators live only while its mode is current.
- Leaves action-naming.md intact — the registry changes *when/where a key is live*, not how actions are *named*; entries still reference `TUG_ACTIONS.*`.

**Implications:**
- New `use-keybindings.tsx` hook + a registry on the manager keyed by scope id and focus mode.
- Stage 1 consults the dynamic registry (in-context walk) before the static `KEYBINDINGS` fallback; precedence is innermost-in-context → … → outermost → global.
- The static map remains the **global base layer** (app-wide shortcuts like ⌘W); it is not migrated wholesale — dynamic bindings layer above it.
- The registry is queryable, enabling a later "active shortcuts" help surface / command palette and feeding accessibility discoverability.
- A duplicate chord at the same scope is a dev-mode warning (otherwise the last registration shadows silently).

---

#### [P12] Semantic commit keys; action color = keyboard-active affordance (DECIDED) {#p12-semantic-keys}

**Decision:** Treat **Return**, **Escape**, and **⌘.** as *semantic commit keys* that resolve to the active scope's declared **default action** (Return) and **cancel action** (Escape / ⌘.), **independent of which control holds the key view**. The `action`/blue color is **kept** on CTA buttons and defined as the **keyboard-active** affordance: blue marks where the keyboard is empowered — the focus ring (typing/arrows) and the default-action button (Return).

**Rationale:**
- A user arrow-navigating a list inside a sheet must be able to press Return to submit without moving focus to "OK." Routing Return to the scope's default action (not the key view) delivers exactly that — the Cocoa default-button / key-equivalent model.
- Keeping blue on CTA buttons preserves the learned "Return activates this" signal and unifies blue under one idea — *the keyboard is engaged with this control* — whether via focus or as the Return target. Orange stays purely about content choice.
- Dovetails with the CFRunLoop focus-mode stack ([P03]): a mode already scopes Tab; extending it to carry `defaultAction` + `cancelAction` makes Return/Escape resolve against the current mode for free, and removes the need for any default-button element stack.

**Implications:**
- Each focus mode (and the base/pane context) declares `defaultAction` and `cancelAction`; a pipeline stage routes Return → default and Escape/⌘. → cancel **against the active mode**, not the key view.
- **Text-context precedence** (same shape as Tab/[Q02]): when the key view is a text surface that owns Return (newline/submit) or Escape (dismiss completion), it claims the key first; otherwise the key falls through to the scope action.
- **Scoping (resolves F4):** modal scopes own these via the mode stack; a non-modal pane resolves default/cancel via the chain walk from the first responder's pane — not the global base mode.
- New actions `TUG_ACTIONS.DEFAULT_ACTION` and `CANCEL_ACTION`; the existing Escape/⌘. → `CANCEL_DIALOG` bindings fold into `cancel-action`. The CTA button keeps `control-…-filled-action` (blue) and registers itself as its scope's default-action affordance.
- Supersedes [P07]'s element-stack mechanism: there is no default-button registry; the scope declares an action and the blue CTA is its visual.

---

### Deep Dives (Optional) {#deep-dives}

#### The three axes, named {#three-axes}

| Axis | Owner after this plan | DOM signal | Visual |
|---|---|---|---|
| **Responder scope** (action routing) | `ResponderChainManager` (unchanged) | `data-responder-id`, `data-first-responder` | none directly |
| **Key view** (keyboard target) | `FocusManager` (new) | `data-key-view` (one at a time) | Tier-1 hairline + Tier-2 ring |
| **Selection** (chosen content) | components (CSS) | `aria-selected` / `data-selected` | accent/orange |

The key insight: first responder (chain) and key view (focus) usually agree but are independent — a focus-refusing control click keeps the key view put while routing an action. Naming them separately is what untangles the mess.

#### CFRunLoop mode model for focus traps {#cfrunloop-model}

A CFRunLoop runs in exactly one mode; only sources/timers registered for that mode are serviced; `kCFRunLoopCommonModes` is a pseudo-mode that aggregates several. We adopt the same shape:

- The FocusManager holds a **mode stack**. The top mode is "current."
- Each focusable registers into one or more modes (default: the base mode). A floating surface's contents register into the mode it pushes.
- The Tab walk enumerates only focusables in the current mode → natural trapping; Tab past the last wraps to the first **within the mode**.
- Pop on dismiss restores the prior mode and the prior key view.
- `default-action` resolves against the current mode (replacing `peekDefaultButtonInScope`).

This gives nesting (a popover inside a sheet pushes a mode atop the sheet's), and it means "trap" is not special-cased per surface — it is the default consequence of opening a mode.

#### Affected components inventory {#affected-inventory}

- **Radix-focus components to tame (~14):** radio-group, accordion, switch, popover, slider, checkbox, context-menu, tab-bar, sheet, alert, tooltip, label, internal/tug-button, internal/tug-popup-menu.
- **Per-component focus-ring rules to delete:** checkbox, option-group, input, dialog-button, inline-dialog, cue, tab-bar, choice-group, list-row, textarea, value-input, code-view, markdown-view, slider, menu, prompt-entry, split-pane, hue-strip, popover.
- **Selection-token recolor sites:** list-row, menu, editor-context-menu, list-view (the `selected`/`highlighted` surfaces → accent). **Excluded from recolor:** `surface-selection-primary-normal-plain-*` (text/character selection: code-view, markdown-view, text-editor, `::highlight(card-selection)`) stays blue; `control-…-filled-action` stays blue for the CTA/activation use ([P06], [P12]). `control-filled-action` is *shared* (CTA fill + menu transient) — only the menu *selection* use moves to the accent token.
- **Default-button sites:** `internal/tug-button.tsx`, `responder-chain-provider.tsx` (Stage 2), `responder-chain.ts` (stack), `tug-text-editor.tsx` + `tug-text-editor/keymap.ts` (submit-Enter defer), `cards/gallery-default-button.tsx`, `chrome/dev-question-dialog.tsx`.

#### Dynamic keybinding resolution {#keybinding-registry}

**Two layers, one pipeline.** Stage 1 (capture-phase keydown) resolves a chord in this order:

1. **Dynamic, in-context** — walk from the key view / first responder up through `parentId`; at each node, match the event against bindings that node (or the active focus mode) registered. Innermost match wins. This is the keyboard analog of the action walk.
2. **Static global** — fall back to `KEYBINDINGS` (`matchKeybinding`) for app-wide shortcuts.

The matched binding dispatches its `TUG_ACTIONS.*` action through the chain exactly as today (`sendToFirstResponderForContinuation`, honoring `preventDefaultOnMatch`, continuations, and the existing `scope: "first-responder" | "key-card"` *dispatch routing*).

**Activation context vs. dispatch routing** — two axes that must not be conflated:

- *Activation context* (new): is this binding live right now? Yes iff its scope is on the in-context walk path or its focus mode is current.
- *Dispatch routing* (existing `scope` field): once live and matched, where does the action walk from — `first-responder` (default) or `key-card`?

A dynamic binding is "live in context, then routed like any other action."

**API:**

```ts
useKeybindings([
  { key: "KeyB", meta: true, action: TUG_ACTIONS.TOGGLE_BOLD, preventDefaultOnMatch: true },
]);
```

- Registered against the calling component's responder scope (from `ResponderParentContext`) via `useLayoutEffect` ([L03]); cleanup unregisters.
- A mode-local variant registers into the active focus mode so the binding dies when the surface closes ([P03]).

**Manager surface:** `registerKeybinding(scopeId, binding)` / `unregisterKeybinding(scopeId, binding)`; `resolveKeybinding(event)` (in-context walk, then global); `activeKeybindings(scopeId?)` for the discoverability surface.

---

### Specification {#specification}

#### Terminology and Naming {#terminology}

- **Key view** — the single element (or none) that receives keystrokes; carries `data-key-view`.
- **Focusable** — an element registered via `useFocusable` with a group, order, and policy.
- **Focus mode (scope)** — a stack entry; only its focusables participate in the Tab walk while it is current.
- **Tier 1 / Tier 2** — always-on hairline marker / keyboard-nav blue ring.
- **`policy`** — `accept` (in the standard-mode walk) | `skip` (pointer-focusable, excluded from standard walk, included in accessibility).

#### Modes / Policies {#modes-policies}

| `data-keyboard-access` | Walk includes `skip`? | ARIA assertion | Default |
|---|---|---|---|
| `standard` | no | baseline | ✔ |
| `accessibility` | yes | full interactive ARIA | opt-in |

#### Public API Surface {#public-api}

- `useFocusable({ id, group, order, policy?, consumesTab? })` → `{ focusableRef }`.
- `FocusManager`: `setKeyView(id)`, `keyView()`, `focusNext()`, `focusPrevious()`, `pushFocusMode(scopeId, opts)`, `popFocusMode(scopeId)`, `registerFocusable(record)`, `unregisterFocusable(id)`, `setDefaultAction(scopeId, action)`, `resolveDefaultAction()`.
- New actions: `TUG_ACTIONS.FOCUS_NEXT`, `FOCUS_PREVIOUS`, `DEFAULT_ACTION`, `CANCEL_ACTION`.
- Scopes declare `defaultAction` / `cancelAction` (Return / Escape·⌘. targets) on their focus mode or pane. See [P12].
- `useKeybindings(bindings)` → registers/unregisters context-scoped bindings; manager `registerKeybinding` / `unregisterKeybinding` / `resolveKeybinding` / `activeKeybindings`. See [#keybinding-registry].

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Key-view id (which element is keyboard target) | structure | FocusManager registry; `useLayoutEffect` registration; stamps `data-key-view` | [L24], [L03] |
| Focus-mode stack (CFRunLoop scopes) | structure | FocusManager; `useLayoutEffect` push/pop on surface open/close | [L24], [L03] |
| Focusable records (group/order/policy/consumesTab) | structure | `useFocusable` + `useLayoutEffect`; `data-tug-focusable` attr | [L24], [L03] |
| Keyboard-access mode (`standard`/`accessibility`) | structure | tugbank DEFAULTS feed → `useSyncExternalStore`; `data-keyboard-access` on root | [L02], [L24] |
| Tier-1 hairline + Tier-2 ring rendering | appearance | CSS `:focus-visible` + `[data-key-view]`; `--tugx-focus-ring` token | [L06], [L24] |
| Selection color (accent/orange) | appearance | CSS tokens on `[data-selected]`/`[aria-selected]` | [L06], [L20] |
| Default / cancel action of active scope (Return / Escape·⌘. targets) | structure | FocusManager per mode/pane; declared at mount; dispatched as a chain action | [L11], [L24] |

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Migration:** the FocusManager lands inert (registry + key view, no Tab interception) in [#step-1]; Tab behavior flips in [#step-3]. Selection recolor and ring deletion are visible but non-breaking. Default-button retirement is a hard cutover gated by app-tests.
- **Rollback:** each step is a separate commit with a falsifiable checkpoint; the Tab interception stage can be disabled by removing the keybinding entries without reverting the registry.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/focus-manager.ts` | `FocusManager`: key view, focusable registry, focus-mode stack, default-action resolution |
| `tugdeck/src/components/tugways/use-focusable.tsx` | `useFocusable` hook (sibling to `useResponder`) |
| `tugdeck/src/components/tugways/__tests__/focus-walk.test.ts` | pure-logic bun:test for walk ordering / mode trapping / policy filtering |
| `tugdeck/styles/focus-ring.css` (or token block in theme files) | `--tugx-focus-ring` primitive + Tier-1/Tier-2 selectors |
| `tugdeck/src/components/tugways/use-keybindings.tsx` | `useKeybindings` hook + dynamic, context-scoped keybinding registration |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FocusManager` | class | `focus-manager.ts` | new |
| `useFocusable` | hook | `use-focusable.tsx` | new |
| `FOCUS_NEXT` / `FOCUS_PREVIOUS` / `DEFAULT_ACTION` / `CANCEL_ACTION` | const | `action-vocabulary.ts` | new actions |
| Tab / Shift-Tab + reconcile `⇧⇥` | entries | `keybinding-map.ts` | new bindings + precedence |
| Stage for `focus-next`/`focus-previous`/`default-action` | code | `responder-chain-provider.tsx` | replaces Stage 2 default-button click |
| `pushDefaultButton`/`popDefaultButton`/`peekDefaultButton*` | removal | `responder-chain.ts` | deleted |
| `--tugx-focus-ring-*`, `--tug7-surface-selection-*` reassignments | tokens | `brio.css` / `harmony.css` | recolor + ring |
| `data-keyboard-access` read/write | code | `settings-api.ts`, `main.tsx` | mode persistence |
| `useKeybindings` | hook | `use-keybindings.tsx` | dynamic context-scoped bindings |
| `registerKeybinding`/`unregisterKeybinding`/`resolveKeybinding`/`activeKeybindings` | methods | `focus-manager.ts` / `responder-chain.ts` | dynamic keybinding registry + in-context resolution |

---

### Documentation Plan {#documentation-plan}

- [ ] New tuglaw: `tuglaws/focus-engine.md` — the three axes, the key view, the CFRunLoop mode model, the two modes, the focus-ring primitive. (Important doc → tuglaws/, per project policy.)
- [ ] Update `tuglaws/responder-chain.md` — replace the "default button stack" section with the `default-action` model; cross-link the focus engine; note key view vs first responder.
- [ ] Update `tuglaws/token-naming.md` / `tuglaws/theme-engine.md` — record accent=selection / action=focus and the `--tugx-focus-ring` alias.
- [ ] Update `tuglaws/action-naming.md` — document the dynamic keybinding registry (register/unregister in context, still cite `TUG_ACTIONS.*`; activation-context vs. dispatch-routing) and the semantic commit keys `default-action` / `cancel-action` (Return / Escape·⌘. routed to scope, with text-context precedence).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (bun:test, pure-logic)** | Focus-walk ordering, mode trapping/wrap, policy filtering, default-action resolution | `focus-walk.test.ts` |
| **Integration (app-test, real app)** | Tab navigation, trap+restore, two-tier ring presence, selection+focus colors, default-action via Enter, mode toggle | `just app-test` |
| **Contract (token audit)** | Contrast pairings after recolor | `bun run audit:tokens pairings` |

#### What stays out of tests {#test-non-goals}

- No fake-DOM / jsdom render tests (happy-dom is deleted; banned pattern) — behavior is proven by real-app app-tests.
- No mock-store call-count tests for the FocusManager (banned pattern); the walk's *logic* is tested pure, its *behavior* in the real app.
- No screen-reader / VoiceOver assertions (out of scope this phase).

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. tugdeck has HMR — no manual builds. App-tests run via `just app-test <file>` and end with a greppable `VERDICT: PASS|FAIL`.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | FocusManager core + registry + useFocusable (inert) | pending | — |
| #step-2 | Keyboard-access mode state + persistence | pending | — |
| #step-3 | Tab pipeline: focus-next/previous + editor precedence | pending | — |
| #step-4 | Floating-surface focus traps (CFRunLoop modes) | pending | — |
| #step-5 | Dynamic context-scoped keybinding registry | pending | — |
| #step-6 | Focus-ring primitive + two-tier indication; delete per-component rings | pending | — |
| #step-7 | Recolor UI-selection → accent/orange | pending | — |
| #step-8 | Confine blue to the keyboard-active axis | pending | — |
| #step-9 | Tame internal/tug-button (base control focus) | pending | — |
| #step-10 | Tame TugCheckbox | pending | — |
| #step-11 | Tame TugSwitch | pending | — |
| #step-12 | Tame TugSlider | pending | — |
| #step-13 | Tame TugTabBar (roving) | pending | — |
| #step-14 | Tame TugRadioGroup (roving) | pending | — |
| #step-15 | Tame TugAccordion (roving) | pending | — |
| #step-16 | Tame TugTooltip | pending | — |
| #step-17 | Tame TugPopover (FocusScope → engine trap) | pending | — |
| #step-18 | Tame TugContextMenu | pending | — |
| #step-19 | Tame internal/tug-popup-menu | pending | — |
| #step-20 | Tame TugSheet (modal trap + restore) | pending | — |
| #step-21 | Tame TugAlert (modal dialog) | pending | — |
| #step-22 | Radix-taming integration checkpoint | pending | — |
| #step-23 | Semantic commit keys + scope default/cancel actions | pending | — |
| #step-24 | First-responder + refuse audit & reclassification | pending | — |
| #step-25 | Accessibility-mode ARIA pass + dual mode toggle | pending | — |
| #step-26 | Integration checkpoint | pending | — |

#### Step 1: FocusManager core + registry + `useFocusable` (inert) {#step-1}

**Commit:** `focus(engine): FocusManager, focusable registry, useFocusable — inert`

**References:** [P01] FocusManager, [P02] authored order, [P03] CFRunLoop traps, Spec (#public-api, #state-zone-mapping), (#three-axes, #cfrunloop-model)

**Artifacts:**
- `focus-manager.ts`, `use-focusable.tsx`; wiring into `responder-chain-provider.tsx`; `data-tug-focusable` / `data-key-view` attributes. No Tab interception yet.

**Tasks:**
- [ ] Implement `FocusManager` (key view, registry, focus-mode stack, default-action map) with no document Tab listener.
- [ ] `useFocusable({ id, group, order, policy?, consumesTab? })` registering via `useLayoutEffect` ([L03]); stamp `data-tug-focusable`. Tolerant pattern — silent no-op outside a provider, stable mount identity, like `useOptionalResponder` ([L26]).
- [ ] Manager stamps `data-key-view` on the current key view (seed from first responder / focusin).
- [ ] Expose via the existing provider context (sibling to `useResponderChain`).

**Tests:**
- [ ] `focus-walk.test.ts`: registry sorts by (group order, item order); mode filtering; wrap math; default-action resolution — pure-logic.

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean; `bun test` green.
- [ ] App still behaves as before (no Tab change); `data-key-view` present on the focused element in the running app.

#### Step 2: Keyboard-access mode state + persistence {#step-2}

**Depends on:** #step-1

**Commit:** `focus(mode): keyboard-access standard|accessibility state + tugbank persistence`

**References:** [P08] modes, Spec (#modes-policies), State Zone Mapping (#state-zone-mapping), [L02]

**Artifacts:**
- `data-keyboard-access` on the root; tugbank default `dev.tugtool.app`/`keyboardAccess`; read-on-boot; store + `useSyncExternalStore`.

**Tasks:**
- [ ] Add read/write to `settings-api.ts` (PUT `/api/defaults/dev.tugtool.app/keyboardAccess`).
- [ ] Apply `data-keyboard-access` before first visible paint (like theme), default `standard`.
- [ ] Provide a store/hook so the FocusManager walk reads the current mode.

**Tests:**
- [ ] Unit: mode reducer/store defaults to `standard`; toggling updates the attr.

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean; toggling the default flips `data-keyboard-access` in the running app.

#### Step 3: Tab pipeline — `focus-next` / `focus-previous` + editor precedence {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `focus(tab): intercept Tab/Shift-Tab as focus-next/previous chain actions`

**References:** [P04] Tab actions, [Q02] editor handshake, Risk R02, (#affected-inventory)

**Artifacts:**
- `FOCUS_NEXT`/`FOCUS_PREVIOUS` actions; new pipeline stage; Tab/Shift-Tab in `keybinding-map.ts`; editor Tab-consume precedence; reconcile `⇧⇥`.

**Tasks:**
- [ ] Add actions to `action-vocabulary.ts`; bindings to `keybinding-map.ts`.
- [ ] Pipeline stage dispatches focus-next/previous; FocusManager advances key view honoring mode + policy ([P02]/[P08]).
- [ ] Resolve [Q02]: editor consumes Tab when completion/typeahead open; replace the `Prec.highest` Tab ownership in `tug-text-editor/completion-extension.ts` accordingly.
- [ ] Reconcile dev-card `⇧⇥ cycle-permission-mode` into the precedence model.

**Tests:**
- [ ] `focus-walk.test.ts`: next/previous honor group order, skip policy, mode default.
- [ ] app-test: Tab visits app-authored order; Tab in editor with open completion accepts the completion (does not move focus).

**Checkpoint:**
- [ ] `just app-test` focus-walk scenario `VERDICT: PASS`; completion accept still works.

#### Step 4: Floating-surface focus traps (CFRunLoop modes) {#step-4}

**Depends on:** #step-3

**Commit:** `focus(trap): push/pop focus modes for menus, popovers, sheets, alerts, completion`

**References:** [P03] CFRunLoop traps, (#cfrunloop-model), Risk R01

**Artifacts:**
- `pushFocusMode`/`popFocusMode` wired into floating-surface open/close; Tab cycles within; key-view restore on dismiss.

**Tasks:**
- [ ] Push a trapped mode on open (menu, completion, popover, sheet, alert); pop on close; restore prior key view.
- [ ] Tab/Shift-Tab wrap within the active mode.

**Tests:**
- [ ] app-test: open a menu, Tab past the last item → wraps to first; Escape/dismiss → key view restored to opener.

**Checkpoint:**
- [ ] `just app-test` trap scenario `VERDICT: PASS`.

#### Step 5: Dynamic context-scoped keybinding registry {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `focus(keys): dynamic context-scoped keybinding registry (useKeybindings)`

**References:** [P11] dynamic keybindings, Spec (#keybinding-registry), (#cfrunloop-model)

**Artifacts:**
- `use-keybindings.tsx`; a dynamic keybinding registry on the manager keyed by scope id and focus mode; Stage 1 resolves in-context bindings before the static `KEYBINDINGS` fallback.

**Tasks:**
- [ ] Add the keybinding registry (`register` / `unregister` / `resolve` / `active`) keyed by responder scope id and focus mode.
- [ ] `useKeybindings([...])` registering via `useLayoutEffect` ([L03]); entries cite `TUG_ACTIONS.*` constants (never raw strings, per action-naming.md); cleanup unregisters. Tolerant pattern (no-op outside a provider, stable identity, like `useOptionalResponder` — [L26]).
- [ ] Stage 1 resolution: match dynamic bindings along the key-view→root walk (innermost-first), then fall back to `matchKeybinding` on the static map; honor `preventDefaultOnMatch`.
- [ ] Mode-local bindings register into the active focus mode and deactivate on pop ([P03]).
- [ ] Dev-mode warn on a duplicate chord at the same scope.

**Tests:**
- [ ] `focus-walk.test.ts` (or sibling): precedence — innermost-in-context beats ancestor beats global; an out-of-context binding does not match.
- [ ] app-test: a component-registered shortcut fires only while that component is in context and is gone after unmount; a static global shortcut still fires.

**Checkpoint:**
- [ ] `just app-test` keybinding scenario `VERDICT: PASS`; `bunx tsc --noEmit` clean.

---

#### Step 6: Focus-ring primitive + two-tier indication; delete per-component rings {#step-6}

**Depends on:** #step-1

**Commit:** `focus(ring): single --tugx-focus-ring primitive + two-tier key-view marker`

**References:** [P05] focus ring, [Q01] tier-1 weight, (#affected-inventory)

**Artifacts:**
- `--tugx-focus-ring` tokens in both themes; Tier-1 `[data-key-view]` 1px hairline; Tier-2 `:focus-visible` blue ring; deletion of all per-component ring rules.

**Tasks:**
- [ ] Author `--tugx-focus-ring-{color,width,offset}` (color = action/blue) in `brio.css` + `harmony.css`.
- [ ] Add the shared mechanism (single selector/attribute) and Tier-1 hairline on `[data-key-view]`.
- [ ] Delete per-component ring rules (indigo `accentCool`, `link`-colored dialog/inline-dialog rings, cue accent, etc.).
- [ ] Resolve [Q01] by eye against both themes; lock the token.

**Tests:**
- [ ] app-test: after a click the key view shows the hairline (Tier 1); after Tab it shows the blue ring (Tier 2).

**Checkpoint:**
- [ ] `bun run audit:tokens pairings` passes; no per-component `outline:`/`focus-ring` rule remains (grep).

#### Step 7: Recolor UI-selection → accent/orange {#step-7}

**Depends on:** #step-6

**Commit:** `theme(selection): accent (orange) becomes the color of UI selection`

**References:** [P06] color contract, [P12] semantic keys, [L12], [L20], (#affected-inventory)

**Artifacts:**
- UI-selection surfaces (`selected`, `highlighted`) re-pointed to accent; an accent selection token for menus/lists. **Text/character selection (`selection … plain`) stays blue.** Shared `control-filled-action` keeps blue for CTA/activation; the menu *selection* use moves to the accent token.

**Tasks:**
- [ ] Re-point `selected`/`highlighted` selection surfaces to accent in both themes; roll to list-row, menu, editor-context-menu, list-view (option/radio already accent).
- [ ] Leave `surface-selection-primary-normal-plain-*` (text/character selection: code-view, markdown-view, text-editor, `::highlight(card-selection)`) at its current blue ([L12]).
- [ ] Where `control-filled-action` is shared (CTA fill + menu transient), move the menu *selection* usage to the accent selection token and keep CTA/activation blue ([P12]).

**Tests:**
- [ ] app-test: a selected list row resolves the accent token; an editor text selection stays blue.

**Checkpoint:**
- [ ] `bun run audit:tokens pairings` clean; selected rows orange, text selection blue in the running app.

#### Step 8: Confine blue to the keyboard-active axis {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `theme(focus): blue = keyboard-active (focus ring + default-action), not selection`

**References:** [P06] color contract, [P12] semantic keys, [P05] focus ring

**Artifacts:**
- Blue removed from *selection* usages (now orange); blue retained for the focus ring and the default-action (CTA) affordance.

**Tasks:**
- [ ] Sweep for blue-as-*selection* remnants; ensure blue surfaces are only the focus ring and the `filled-action` CTA/default-action.
- [ ] Verify a selected-and-focused row reads orange fill + blue ring; a default CTA button stays blue.

**Tests:**
- [ ] app-test: selected+focused row carries both tokens distinguishably; the CTA button remains blue.

**Checkpoint:**
- [ ] `bun run audit:tokens pairings` clean; visual check both themes.

> **Steps 9–22 — Radix taming, one primitive per step.** Each disables the
> primitive's borrowed Radix focus management and drives focus from the engine, behind
> its own commit and app-test checkpoint so a regression is isolated to one primitive.
> Risk-ordered: simple controls first, roving composites next, non-modal traps, then
> modal surfaces. Common references for all: [P01] FocusManager, Risk R01,
> (#affected-inventory). `internal/tug-label` (Radix Label — `htmlFor` association only,
> no focus management) carries no taming work and is covered by the ARIA step ([#step-25]).

#### Step 9: Tame internal/tug-button (base control focus) {#step-9}

**Depends on:** #step-3

**Commit:** `focus(radix): internal/tug-button — engine-driven focus, Slot preserved`

**References:** [P01] FocusManager, [P10] refuse split, Risk R01, (#affected-inventory)

**Artifacts:**
- The base button (underlying push/popup/icon buttons) registers as a focusable and maps its `data-tug-focus` bundle to explicit no-steal-on-click + focus policy; Radix `Slot` (`asChild`) pass-through retained.

**Tasks:**
- [ ] Register the base button as a focusable; split `data-tug-focus` into no-steal-on-click + explicit policy ([P10]).
- [ ] Confirm `asChild`/Slot composition and disabled handling unaffected.

**Tests:**
- [ ] app-test: a button click does not move the key view; the button is reachable per its policy; the ring shows on keyboard focus.

**Checkpoint:**
- [ ] `just app-test` button scenario `VERDICT: PASS`; `bunx tsc --noEmit` clean.

---

#### Step 10: Tame TugCheckbox {#step-10}

**Depends on:** #step-3, #step-9

**Commit:** `focus(radix): TugCheckbox — engine focus + ring, Space local`

**References:** [P01] FocusManager, [P05] focus ring, Risk R01, (#affected-inventory)

**Artifacts:**
- Radix checkbox focus deferred to the engine; Space toggles locally; Radix toggle semantics intact.

**Tasks:**
- [ ] Register focusable; key view + ring from the engine; keep Radix checked/indeterminate semantics.

**Tests:**
- [ ] app-test: Tab reaches it; Space toggles; ring shows on keyboard focus only.

**Checkpoint:**
- [ ] `just app-test` checkbox scenario `VERDICT: PASS`.

---

#### Step 11: Tame TugSwitch {#step-11}

**Depends on:** #step-3, #step-9

**Commit:** `focus(radix): TugSwitch — engine focus + ring`

**References:** [P01] FocusManager, [P05] focus ring, Risk R01, (#affected-inventory)

**Artifacts:**
- Radix switch focus deferred to the engine; Space/Enter toggle local.

**Tasks:**
- [ ] Register focusable; engine ring/key view; keep Radix toggle semantics.

**Tests:**
- [ ] app-test: Tab reaches it; Space toggles; ring on keyboard focus.

**Checkpoint:**
- [ ] `just app-test` switch scenario `VERDICT: PASS`.

---

#### Step 12: Tame TugSlider {#step-12}

**Depends on:** #step-3, #step-9

**Commit:** `focus(radix): TugSlider — engine focus; arrow-step local, drag continuous`

**References:** [P01] FocusManager, [P05] focus ring, Risk R01, (#affected-inventory)

**Artifacts:**
- Radix slider focus deferred to engine; arrow-key steps stay discrete, pointer drag stays continuous (the existing phase contract is unchanged).

**Tasks:**
- [ ] Register the thumb as a single focusable; arrows step locally; engine owns ring/key view.

**Tests:**
- [ ] app-test: Tab reaches the thumb; arrows step; ring on keyboard focus; drag unaffected.

**Checkpoint:**
- [ ] `just app-test` slider scenario `VERDICT: PASS`.

---

#### Step 13: Tame TugTabBar (roving) {#step-13}

**Depends on:** #step-3

**Commit:** `focus(radix): TugTabBar — single focus stop, arrows local`

**References:** [P01] FocusManager, [P02] authored order, Risk R01, (#affected-inventory)

**Artifacts:**
- The custom `tabIndex` roving becomes a single focus stop in the walk; arrows move within; the engine owns Tab between stops.

**Tasks:**
- [ ] Register the tab bar as one focusable; keep component-local arrow roving; remove reliance on native inter-control Tab.

**Tests:**
- [ ] app-test: Tab enters/exits the bar as one stop; arrows move between tabs; ring on keyboard focus.

**Checkpoint:**
- [ ] `just app-test` tab-bar scenario `VERDICT: PASS`.

---

#### Step 14: Tame TugRadioGroup (roving) {#step-14}

**Depends on:** #step-3

**Commit:** `focus(radix): TugRadioGroup — disable Radix roving, arrows local`

**References:** [P01] FocusManager, [P02] authored order, Risk R01, (#affected-inventory)

**Artifacts:**
- Radix's built-in roving replaced by the manual `tabIndex` roving pattern already used in `tug-option-group.tsx` (Radix exposes no public knob to disable roving); the group is a single focus stop; Radix value/state semantics retained.

**Tasks:**
- [ ] Replace the Radix roving layer with manual roving (option-group pattern); the group registers as one focusable; arrows select-and-move locally; keep Radix value semantics.

**Tests:**
- [ ] app-test: Tab treats the group as one stop; arrows move/select; ring on keyboard focus.

**Checkpoint:**
- [ ] `just app-test` radio-group scenario `VERDICT: PASS`.

---

#### Step 15: Tame TugAccordion (roving) {#step-15}

**Depends on:** #step-3

**Commit:** `focus(radix): TugAccordion — disable Radix roving, header focus local`

**References:** [P01] FocusManager, [P02] authored order, Risk R01, (#affected-inventory)

**Artifacts:**
- Radix accordion's built-in roving replaced by manual roving (option-group pattern; no public knob to disable Radix roving); headers reachable via the walk; arrows move between headers locally; expand/collapse semantics retained.

**Tasks:**
- [ ] Replace the Radix roving layer with manual roving; register accordion headers per the authored order; arrows local; keep expand/collapse semantics.

**Tests:**
- [ ] app-test: headers reachable; arrows move; expand/collapse via Space/Enter; ring on keyboard focus.

**Checkpoint:**
- [ ] `just app-test` accordion scenario `VERDICT: PASS`.

---

#### Step 16: Tame TugTooltip {#step-16}

**Depends on:** #step-3

**Commit:** `focus(radix): TugTooltip — focus-trigger only, no focus capture`

**References:** [P01] FocusManager, Risk R01, (#affected-inventory)

**Artifacts:**
- Tooltip opens on trigger focus/hover without capturing the key view; no FocusScope to remove (radix-tooltip), just confirm it never steals focus.

**Tasks:**
- [ ] Confirm the tooltip never moves the key view; the trigger keeps its ring/key view from the engine.

**Tests:**
- [ ] app-test: focusing a tooltip trigger shows the tooltip and the trigger's ring; key view stays on the trigger.

**Checkpoint:**
- [ ] `just app-test` tooltip scenario `VERDICT: PASS`.

---

#### Step 17: Tame TugPopover (FocusScope → engine trap) {#step-17}

**Depends on:** #step-3, #step-4

**Commit:** `focus(radix): TugPopover — replace FocusScope with engine focus mode`

**References:** [P01] FocusManager, [P03] traps, Risk R01, (#affected-inventory, #cfrunloop-model)

**Artifacts:**
- Radix `FocusScope` (`onOpenAutoFocus`/`onCloseAutoFocus`) replaced by a pushed focus mode; Tab traps within; key view restored on close.

**Tasks:**
- [ ] Push a focus mode on open, pop on close; engine sets initial focus and restores the opener's key view.

**Tests:**
- [ ] app-test: Tab cycles within the open popover; dismiss restores the opener's key view.

**Checkpoint:**
- [ ] `just app-test` popover scenario `VERDICT: PASS`.

---

#### Step 18: Tame TugContextMenu {#step-18}

**Depends on:** #step-3, #step-4

**Commit:** `focus(radix): TugContextMenu — engine focus mode + chain Escape`

**References:** [P01] FocusManager, [P03] traps, Risk R01, (#affected-inventory, #cfrunloop-model)

**Artifacts:**
- Radix `FocusScope` replaced by a pushed focus mode; Escape close via the chain; key view restored on close.

**Tasks:**
- [ ] Push/pop the focus mode; arrows move items locally; Escape dismisses via the chain; restore key view.

**Tests:**
- [ ] app-test: Tab/arrows stay within the menu; Escape closes; key view restored.

**Checkpoint:**
- [ ] `just app-test` context-menu scenario `VERDICT: PASS`.

---

#### Step 19: Tame internal/tug-popup-menu {#step-19}

**Depends on:** #step-3, #step-4

**Commit:** `focus(radix): internal/tug-popup-menu — engine focus mode for the shared menu surface`

**References:** [P01] FocusManager, [P03] traps, Risk R01, (#affected-inventory, #cfrunloop-model)

**Artifacts:**
- The shared dropdown surface (used by the popup button and friends): Radix `FocusScope` replaced by a pushed focus mode; restore on close.

**Tasks:**
- [ ] Push/pop the focus mode; arrows local; Escape via chain; restore key view to the trigger.

**Tests:**
- [ ] app-test: open via a popup button → Tab/arrows trapped; dismiss restores the trigger's key view.

**Checkpoint:**
- [ ] `just app-test` popup-menu scenario `VERDICT: PASS`.

---

#### Step 20: Tame TugSheet (modal trap + restore) {#step-20}

**Depends on:** #step-3, #step-4

**Commit:** `focus(radix): TugSheet — engine modal focus mode + restore`

**References:** [P01] FocusManager, [P03] traps, Risk R01, (#affected-inventory, #cfrunloop-model)

**Artifacts:**
- Radix `react-focus-scope` (`onOpenAutoFocus`) replaced by an engine modal focus mode; initial focus and restore owned by the engine; pane-modal scoping preserved.

**Tasks:**
- [ ] Push a modal focus mode on open; engine sets initial focus; pop and restore on close.

**Tests:**
- [ ] app-test: Tab traps within the sheet; close restores the prior key view; peer panes unaffected.

**Checkpoint:**
- [ ] `just app-test` sheet scenario `VERDICT: PASS`.

---

#### Step 21: Tame TugAlert (modal dialog) {#step-21}

**Depends on:** #step-3, #step-4

**Commit:** `focus(radix): TugAlert — engine modal focus mode`

**References:** [P01] FocusManager, [P03] traps, Risk R01, (#affected-inventory, #cfrunloop-model)

**Artifacts:**
- Radix `alert-dialog` FocusScope replaced by an engine modal focus mode; default-action wiring deferred to [#step-23].

**Tasks:**
- [ ] Push/pop a modal focus mode; engine initial focus + restore; keep alert semantics.

**Tests:**
- [ ] app-test: Tab traps within the alert; close restores the prior key view.

**Checkpoint:**
- [ ] `just app-test` alert scenario `VERDICT: PASS`.

---

#### Step 22: Radix-taming integration checkpoint {#step-22}

**Depends on:** #step-9, #step-10, #step-11, #step-12, #step-13, #step-14, #step-15, #step-16, #step-17, #step-18, #step-19, #step-20, #step-21

**Commit:** `N/A (verification only)`

**References:** [P01] FocusManager, [P03] traps, Risk R01, (#affected-inventory)

**Tasks:**
- [ ] Verify every tamed primitive runs under the engine (no Radix `RovingFocus`/`FocusScope`/guards still driving focus).
- [ ] Re-evaluate `internal/safari-focus-shift.ts`; delete if the engine made it obsolete, or document why it remains.
- [ ] Confirm `internal/tug-label` and `tug-pane-banner` carry no orphaned focus behavior (deferred to [#step-24]/[#step-25]).

**Tests:**
- [ ] Full `just app-test` primitive suite green across all tamed components.

**Checkpoint:**
- [ ] `just app-test` Radix-taming suite `VERDICT: PASS`; `bunx tsc --noEmit` clean; no Radix focus regressions.

---

#### Step 23: Semantic commit keys + scope default/cancel actions {#step-23}

**Depends on:** #step-3, #step-4

**Commit:** `focus(keys): semantic commit keys (Return/Escape/⌘.) → scope default/cancel actions`

**References:** [P12] semantic keys, [P07] default-action (superseded), [P03] traps, [Q02] text-context precedence, (#affected-inventory, #cfrunloop-model)

**Artifacts:**
- `DEFAULT_ACTION` + `CANCEL_ACTION` actions; each focus mode / pane declares `defaultAction` + `cancelAction`; a pipeline stage routes Return → default and Escape/⌘. → cancel against the active mode (text-context precedence first); deletion of `pushDefaultButton`/`popDefaultButton`/`peekDefaultButton*` and the `defaultButton` prop.

**Tasks:**
- [ ] Add `DEFAULT_ACTION` / `CANCEL_ACTION`; modes (`TugSheet`, `TugAlert`, `TugConfirmPopover`) and non-modal panes declare default/cancel on their scope.
- [ ] Route Return → default-action and Escape/⌘. → cancel-action against the active focus mode; non-modal resolves via the chain walk from the first responder's pane ([P12], resolves F4).
- [ ] Text-context precedence: editors keep Return (newline/submit) and Escape (dismiss completion) when the key view owns them; otherwise the key falls through to the scope action ([Q02] pattern).
- [ ] Fold the existing Escape/⌘. → `CANCEL_DIALOG` bindings into `cancel-action`; keep the CTA button's blue `control-…-filled-action` as its default-action affordance ([P12]).
- [ ] Delete the default-button stack API + `defaultButton` prop; update `tug-text-editor`/`keymap.ts` submit-Enter defer and `gallery-default-button.tsx`, `dev-question-dialog.tsx`.

**Tests:**
- [ ] app-test: arrow-navigate a list in a sheet, press Return → the sheet's default action fires (focus need not move to OK); Escape/⌘. cancels; cross-pane Return does not fire another pane's default.
- [ ] app-test: Return in a focused text editor still submits/newlines per its config (precedence holds).

**Checkpoint:**
- [ ] grep for `pushDefaultButton|peekDefaultButton|defaultButton` returns nothing; `just app-test` commit-keys scenario `VERDICT: PASS`.

#### Step 24: First-responder + `refuse` audit & reclassification {#step-24}

**Depends on:** #step-1, #step-3

**Commit:** `focus(audit): reclassify first-responder & split data-tug-focus refuse`

**References:** [P10] refuse split, [P01] FocusManager, (#three-axes)

**Artifacts:**
- Every `useResponder`/`makeFirstResponder`/`focusResponder`/`data-tug-focus="refuse"` site reclassified against the three axes; `refuse` split into no-steal-on-click vs focus `skip`.

**Tasks:**
- [ ] Enumerate the 28 `data-tug-focus` sites; assign each (a) chain no-steal-on-click and (b) focus policy independently.
- [ ] Audit `makeFirstResponder`/`focusResponder` calls; confirm none substitute for the engine's key-view promotion.

**Tests:**
- [ ] app-test: a no-steal-on-click control that is also Tab-skipped is reachable by pointer, absent from standard Tab order.

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean; `just app-test` audit scenario `VERDICT: PASS`.

#### Step 25: Accessibility-mode ARIA pass + dual mode toggle {#step-25}

**Depends on:** #step-2, #step-3, #step-24

**Commit:** `a11y(mode): interactive ARIA pass + in-app setting & Swift menu toggle`

**References:** [P08] modes, [P09] interactive-only, [Q03] signal source (deferred), (#modes-policies)

**Artifacts:**
- ARIA roles/states on interactive affordances; `accessibility` mode ignores `skip`; in-app setting UI + Swift host menu item (additive); reserved host→web channel name (unused).

**Tasks:**
- [ ] Assert interactive ARIA roles/states across the affordances enumerated in [#step-24] (AT-ready foundation).
- [ ] In `accessibility` mode, include `skip` focusables in the walk.
- [ ] Add the in-app settings toggle (use existing Tug components) and a Swift menu item wired to the `keyboardAccess` default.

**Tests:**
- [ ] app-test: a `skip` control is unreachable by Tab in `standard`, reachable in `accessibility`.

**Checkpoint:**
- [ ] `just app-test` mode scenario `VERDICT: PASS`; toggle works from both surfaces.

#### Step 26: Integration Checkpoint {#step-26}

**Depends on:** #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-22, #step-23, #step-24, #step-25

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), all [P01]–[P11]

**Tasks:**
- [ ] Verify Tab order, traps, two-tier ring, selection vs focus colors, default-action, and both modes work together.

**Tests:**
- [ ] Full `just app-test` focus suite green; `bun run audit:tokens pairings` clean; `bunx tsc --noEmit` + `bun test` green.

**Checkpoint:**
- [ ] All success criteria in [#success-criteria] satisfied.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** An app-owned focus engine with an always-visible key view, app-authored two-mode Tab navigation with CFRunLoop-style floating-surface traps, a dynamic context-scoped keybinding registry, a single crisp focus-ring primitive, the accent=selection / action=focus color contract, a retired default-button stack, and an audited first-responder/refuse model — Radix tamed, accessibility mode in-app and AT-ready.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every criterion in [#success-criteria] verified.
- [ ] No per-component focus-ring rule, no default-button stack API, no blue-as-selection token remains (grep).
- [ ] A context-scoped keybinding activates only in context and detaches on unmount; in-context overrides global; static globals still fire (app-test).
- [ ] Return/Escape/⌘. resolve to the active scope's default/cancel action independent of the key view, with editor precedence intact (app-test).
- [ ] Blue = keyboard-active only (focus ring + CTA default-action); UI selection orange; text selection unchanged-blue (audit + app-test).
- [ ] `bunx tsc --noEmit`, `bun test`, `bun run audit:tokens pairings`, and the `just app-test` focus suite are all green.
- [ ] `tuglaws/focus-engine.md` written; `responder-chain.md` / `token-naming.md` updated.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] OS/VoiceOver accessibility-tree integration and auto-engage of `accessibility` mode from a host signal ([Q03]).
- [ ] Keyboard-navigation of non-interactive content (reading cursor) — out of scope per [P09].
- [ ] Per-theme Tier-1 marker tuning if [Q01]'s single token proves insufficient.

| Checkpoint | Verification |
|------------|--------------|
| Tab order is app-authored | app-test asserts visit order independent of DOM order |
| Key view always visible | app-test asserts `data-key-view` + hairline after click and Tab |
| Traps work | app-test wrap + restore on a floating surface |
| Selection ≠ focus | app-test selected+focused row carries accent fill + blue ring |
| Default-button retired | grep clean; Enter still confirms the active dialog |
| Two modes | app-test `skip` reachability differs by `data-keyboard-access` |

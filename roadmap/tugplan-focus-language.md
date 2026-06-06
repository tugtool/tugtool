## Focus-Language Modernization — Roll Out the New Keyboard-Focus Visual Language {#focus-language}

**Purpose:** Replace the engine's single orange focus ring with the settled focus-visual language — a **ring + faint behind-tint** on the focused component, the component's **native fill** for committed selection, all driven by **one role axis that defaults to `action`** — across the entire component library and every app-wide focusable. This is a re-skin over the focus engine, not a change to it.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-06 |

- **Predecessor:** `roadmap/tugplan-keyboard-model.md` — built the focus engine and the behavior model; its `#focus-language-modernization` section is closed out as **spike complete**, and its `#flm-verdict` records the settled model this plan rolls out. This plan owns the *visual language*; that plan owned the *behavior*.
- **Spike canvas:** `tugdeck/src/components/tugways/cards/gallery-focus-language.{tsx,css}` — the settled reference, judged by eye in both themes. The `--fl-*` variables there are the prototype of this plan's real tokens.
- **Surface:** tugdeck / tugways (TypeScript/React + theme CSS); no Rust/Swift.
- **Build/test:** `bunx tsc --noEmit` (warnings are errors); `bun test` (pure logic); `just app-test <file>` for behavior regression (greppable `VERDICT: PASS|FAIL`); by-eye gallery review per theme/mode for appearance.

---

### Phase Overview {#phase-overview}

#### Context {#context}

The focus engine projects four stable DOM attributes today — `[data-key-view-kbd]` (the keyboard-focused component), `[data-key-cursor]` (the roving cursor item inside a deferred group), `[data-key-within]` (the immediate container of the key view), and `data-selected` (committed selection). A single global rule in `styles/focus-ring.css` paints **one orange `outline`** on `[data-key-view-kbd]`, a quiet within-mark, and a neutral cursor tint. That orange ring is the whole focus language, and it is weak: it reads as one undifferentiated treatment, it never expresses a control's role, and it doesn't carry selection.

The keyboard-model spike (now closed out) settled a richer language on the gallery canvas: the focused component wears a **ring plus a faint behind-tint**; committed selection is the component's **native fill** (radio dot / segmented pill / option fill / list-row fill); and ring + fill + tint all read **one role variable that defaults to `action`** and is overridden per role. Because every state is already a projected DOM attribute, rolling this out is CSS + tokens + a handful of resting-style tweaks — **the engine, the scopes, and the behavior app-tests do not move.**

#### Strategy {#strategy}

- **Tokens first, then re-point the global rule.** Land the real token surface ([P05]) and re-point the existing `[data-key-view-kbd]` rule to it in one foundational step, so the *entire app* shifts to the new ring coherently before any per-component work — no mixed orange/new state.
- **Re-skin over stable attributes ([P04]).** Touch only CSS/tokens and a few resting-style renders. Never change the engine, the scope stack, or what attributes are projected. Behavior app-tests stay green as the proof that nothing behavioral moved.
- **One role axis, default action ([P03]).** Model every focusable as carrying a role that defaults to `action`; ring/fill/tint resolve from it. Most components need *zero* prop changes — only their focus CSS changes — because they ride the default.
- **Component-by-component, grouped by archetype.** Walk the matrix in archetype clusters (buttons → item-groups → live/continuous → rows → leaf controls → surfaces → links/app-wide), each a commit, each gallery-verified in both themes.
- **Lift the bespoke dialog CSS into first-class component CSS.** The fill-promotion proven in `dev-permission-dialog.css`/`dev-question-dialog.css` becomes a TugPushButton keyboard-promoted state; the dialogs then consume it instead of carrying their own copy.
- **Appearance is judged by eye, behavior by app-test.** Pixels are not app-tested ([#test-non-goals]); the gallery (and the spike card) is the review surface, per theme and per keyboard-vs-mouse.
- **Close with governance.** Author the `tuglaws/` focus-language doc and the governing decision that supersedes the keyboard-model plan's [P03], so the language is documented law, not folklore.

#### Success Criteria (Measurable) {#success-criteria}

- Every component in the keyboard-model [Keyboard Behavior Matrix](tugplan-keyboard-model.md#keyboard-matrix) shows the new focus signature — ring + faint behind-tint on focus, native fill on selection — verified by eye in **both** brio and harmony. (gallery review checklist per component)
- The orange `--tugx-focus-ring-color` axis is gone from the focus path; the ring color resolves from the role axis defaulting to `action`. (grep: no `--tugx-focus-ring-color` consumers in component/chrome focus CSS; the spike-card legend may retain an explicit orange swatch for contrast)
- Role-bearing controls (button, checkbox, switch, radio, choice, option) ring + fill + tint in their role color; role-less controls render `action`. (gallery danger/accent cells per component)
- `TugInput` invalid state focuses in the danger role; `TugTabBar` commits on act. (gallery + live build)
- All existing `just app-test` keyboard scenarios still `VERDICT: PASS` (behavior unchanged); `bunx tsc --noEmit` clean; `bun test` green. (CI commands)
- A `tuglaws/focus-language.md` exists describing the language, and the governing decision supersedes keyboard-model [P03]. (file present; cross-links resolve)

#### Scope {#scope}

1. The token foundation: real focus-language tokens (ring / behind-tint / selection-fill resolved from a role axis) authored in `styles/focus-ring.css` + `styles/themes/brio.css` + `styles/themes/harmony.css`, re-pointing the global `[data-key-view-kbd]` rule ([#step-1]).
2. TugPushButton keyboard-promoted state; unify the inline dialogs onto it ([#step-2]).
2.5. Keyboard-focus-cycling mode (Opt-Tab) for text-first cards — a per-card cycle focus-scope toggled by a trigger, with the dev card as first consumer; the surface that exercises the whole focus language end-to-end ([#step-cycle]).
3. Item-groups: TugRadioGroup, TugChoiceGroup, TugOptionGroup ([#step-3]).
4. Live / continuous: TugSlider, TugTabBar (→ commit-on-act) ([#step-4]).
5. Descendable rows: TugListView/TugListRow, TugAccordion ([#step-5]).
6. Leaf controls: TugCheckbox, TugSwitch, TugInput (validation→role), TugTextarea, TugValueInput ([#step-6]).
7. Surfaces / boxes: TugPopover, TugSheet, TugAlert, the inline-dialog shell **and its option rows**, plus a menus audit (TugContextMenu, internal/tug-popup-menu) ([#step-7]).
8. Links + the app-wide long tail the global rule touches: TugLink, title bars, toolbars, prompt entry, dev panel ([#step-8]).
9. Governance: `tuglaws/focus-language.md`, the governing decision superseding [P03], and the Keyboard Behavior Matrix visual-column annotation ([#step-9]).
10. Integration checkpoint + decide the spike card's fate ([#step-10]).

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Any change to the focus engine** — the registry, Tab walk, scope stack, keybinding registry, key-view/cursor/within projection, and ring-modality stay byte-for-byte. This plan reads the attributes they already set.
- Re-litigating the *behavior* model (focus/move/act over scopes) — owned and done by the keyboard-model plan.
- The accessibility-mode ARIA pass + standard/accessibility dual-mode toggle (a keyboard-model follow-on); this plan must not *break* it, but a dedicated high-contrast focus variant is deferred ([Q03]).
- New component-level user-facing `role` props where none exist — the role axis defaults to `action` and components opt into richer roles over time ([P03]); only `TugInput`'s existing `validation` is mapped this phase ([P07]).
- The deferred `refuse`/first-responder audit (keyboard-model `#step-15`).
- **Z1 transcript cycling / message selection** — the first cut of the cycling mode ([P10]) circulates the chrome zones (Z2 / Z4 / Z5) only; tabbing into the transcript to scroll or select messages is deferred (possibly indefinitely).

#### Dependencies / Prerequisites {#dependencies}

- The four projected focus attributes (`[data-key-view-kbd]`, `[data-key-cursor]`, `[data-key-within]`, `data-selected`) — all live, from the keyboard-model plan.
- `styles/focus-ring.css` (the global focus rule + `--tugx-focus-*` token surface) and the theme token system (`--tug7-*`, `--tug-color()` PostCSS expansion, `styles/themes/{brio,harmony}.css`).
- The spike canvas `gallery-focus-language.{tsx,css}` as the visual reference, and the keyboard-model `#flm-verdict` as the settled model.
- The bespoke prototypes in `dev-permission-dialog.css` / `dev-question-dialog.css` (the fill-promotion to lift) and `internal/tug-button.css` (the role-style classes).

#### Constraints {#constraints}

- **tuglaws hold** — esp. [L06] appearance is CSS/DOM attributes, never React state; [L17] one-hop token aliasing (`--tugx-*` → `--tug7-*`); [L24] state-zone discipline. Cross-check and name laws in each tugways step's commit body.
- Theme token files (`brio.css`, `harmony.css`) are **hand-authored** — edit directly; there is no generation script.
- **Warnings are errors** (`bunx tsc --noEmit`). No fake-DOM/RTL or mock-store tests. Behavior via `just app-test`; appearance by eye.
- **Pixel appearance is not app-testable** — do not add pixel-snapshot tests; the gallery is the review surface ([#test-non-goals]).
- No plan-step numbers in code/comments/commits — describe the behavior.
- HMR is always running for tugdeck; never run manual frontend builds.

#### Assumptions {#assumptions}

- The role color a control rings/fills/tints with maps to the existing `--tug7-...-filled-{role}-rest` token family (action/danger/accent/agent/data/option), exactly as the spike used them; `action` is the neutral default.
- A faint behind-tint can be layered over a component's own background without a new DOM node — via an `outline`/`box-shadow`/gradient-overlay technique as the spike proved ([P01], [Q02]).
- Most components need no prop change to adopt the role axis (they ride `action`); the focus CSS change is the bulk of each step.
- The inline dialogs' current focus behavior is final (keyboard-model `#step-14` done); this plan only refactors their *styling* onto the shared button state.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Cite plan-local decisions `[P01]`–`[P0n]` (use `P`, never `D`), open questions `[Q01]`, specs `S01`, risks `R01`, and step anchors `#step-n`. Global laws/decisions are `[Lnn]`/`[Dnn]` (referenced, not owned here). Never cite line numbers — add an anchor.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Real token shape for the role-resolved focus axis (OPEN → resolve in #step-1) {#q01-token-shape}

**Question:** How are the spike's `--fl-role` / `--fl-sel` / `--fl-focus-bg` expressed as real tokens? A single set of `--tugx-focus-*` variables that components set per role, vs. component-tier aliases per role, vs. a small resolver that maps a `data-role` to the `--tug7-...-filled-{role}-*` family.

**Why it matters:** It sets the authoring ergonomics for every component step and whether theme files grow a new token block.

**Options:** (a) `--tugx-focus-ring` / `--tugx-focus-fill` / `--tugx-focus-tint` set from `[data-fl-role]`-style rules in `focus-ring.css` (mirrors the spike's structure 1:1); (b) per-component `--tugx-<component>-focus-*` aliases ([L17]); (c) a hybrid — shared `--tugx-focus-*` defaults + per-component overrides only where the native fill differs.

**Plan to resolve:** Spike (a) against two real components in [#step-1]; it is the closest lift of the proven card. **Lean:** (a) + (c) — shared defaults, component overrides for native fills. **Resolution:** OPEN.

#### [Q02] Behind-tint layering over component backgrounds (OPEN → resolve in #step-1) {#q02-tint-layer}

**Question:** How to paint the faint behind-tint without a new DOM node when the component already has a background (segmented track, sheet surface, list panel)?

**Why it matters:** Naively setting `background` clobbers the component's own surface; the spike used a `linear-gradient` overlay for the box and a plain background for trackless groups.

**Plan to resolve:** Settle one technique (gradient-overlay vs. `box-shadow` inset vs. a `::before`) in [#step-1] and reuse it everywhere. **Lean:** gradient-overlay over the existing background (the spike's box approach), since it composes with any surface. **Resolution:** OPEN.

#### [Q03] High-contrast / accessibility-mode focus variant (DEFERRED) {#q03-a11y-variant}

**Question:** Does the new language need a distinct high-contrast treatment under accessibility mode?

**Why it matters:** Double-borders are colourblind-robust, but a single faint tint + thin ring may be too subtle at high-contrast settings.

**Resolution:** DEFERRED to the keyboard-model a11y follow-on (`#roadmap`). This plan must not regress accessibility mode; a dedicated variant is out of scope. **Framing from [P13]:** the *navigation* half of an a11y keyboard mode is "always-on cycling" = making a toggleable context **persistent** (drop the toggle, push at mount), assessed at [#step-cycle-vet]; this question is now specifically about the *visual* high-contrast treatment, which remains deferred.

#### [Q04] Fate of the spike card (OPEN → decide in #step-10) {#q04-spike-card}

**Question:** Keep `gallery-focus-language.{tsx,css}` as a living reference, fold its cases into the per-component gallery cards, or delete it?

**Why it matters:** It is a throwaway by design, but it is also the single screen that shows the whole language at once.

**Plan to resolve:** Decide at [#step-10] once the rollout is real. **Lean:** keep it (retitle "Focus language reference") but stop it from drifting by having it consume the real tokens, not its private `--fl-*`. **Resolution:** OPEN.

#### [Q05] The cycle trigger chord (OPEN → resolve in #step-cycle-trigger-spike) {#q05-cycle-trigger}

**Question:** Which chord toggles the keyboard-focus-cycling mode ([P09])? The mnemonic candidate is **Opt-Tab** (⌥⇥ — "Tab, but navigation"), but macOS full-keyboard-access / WebKit may intercept Tab-family chords before they reach the WebView — the same reason ⇧⇥ is eaten and `at0088` dispatches its chord synthetically.

**Why it matters:** If the chord never reaches the document keybinding stage, the mode is unreachable; the trigger must be confirmed *before* the mechanism is wired to it.

**Options:** (a) **Opt-Tab** (⌥⇥) — most mnemonic; (b) a **non-Tab chord** if Opt-Tab is eaten (⌃Tab is OS-reserved; candidates: a function chord, ⌥Esc, or a card-scoped leader); (c) a two-key leader.

**Plan to resolve:** Spike in [#step-cycle-trigger-spike] — a temporary capture-phase probe / app-test that posts the chord and asserts the document listener receives it; take the first reliable option. **Lean:** Opt-Tab if it lands, else the simplest non-conflicting chord. **Resolution:** DECIDED — **Opt-Tab (⌥⇥)**. Confirmed by `at0138`: a native ⌥⇥ reaches the document keydown listeners (it is *not* eaten by macOS full-keyboard-access the way plain Tab / ⇧⇥ are) and matches the `CYCLE_FOCUS_MODE` binding (`preventDefaultOnMatch` fires). The engine side is clear too — the focus-walk stage bails on any modifier (`responder-chain-provider.tsx`), so ⌥⇥ is never consumed as a reverse-tab. No fallback chord needed.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| App-wide re-skin regresses a shipped surface's focus affordance | high | med | Re-point the global rule first ([#step-1]) so everything stays coherent; per-surface steps; live-build pass | A surface loses/garbles its focus ring |
| Behind-tint clobbers a component background | med | med | One settled layering technique ([Q02]); per-component eye check both themes | Tint hides content or wrong surface |
| Silent visual regressions (pixels not app-tested) | med | med | By-eye gallery review per theme/mode is a required checkpoint; behavior app-tests guard that attributes/behavior didn't move | Reviewer can't tell focus from rest |
| Role-axis adoption balloons into prop churn | med | low | Default `action` means no prop changes for most; only focus CSS moves ([P03]) | A step needs new props on many components |
| Theme contrast: filled role on light vs dark flips text legibility | med | med | Keep the spike's retuned intensities; verify white-on-fill in both themes per step | Text unreadable on a filled selection |
| Cycle trigger chord eaten by OS/WebKit | high | med | Spike the chord first ([#step-cycle-trigger-spike]); fall back to a non-Tab chord ([Q05]) | A posted chord never reaches the document listener |
| Cycling mode regresses the editor's typing / Tab semantics | high | low | Mode is opt-in + trapped; behavior app-tests for enter/cycle/act/exit AND editor-Tab-still-completes | Tab in the editor stops doing completion |

**Risk R01: Mixed-language window during rollout** {#r01-mixed-window}

- **Risk:** Between [#step-1] and the last component step, migrated and un-migrated focusables could show two different focus looks.
- **Mitigation:** [#step-1] re-points the *global* `[data-key-view-kbd]` rule to the new ring axis, so every un-migrated focusable already rings in the new language; per-component steps then add the behind-tint + native-fill refinements. There is never an orange-vs-new split — only "ring only" vs "ring + refinements".
- **Residual risk:** Un-migrated groups show the component ring rather than the cursor-item ring until their step lands; acceptable and self-evidently in-progress.

**Risk R02: The cycle trigger is unreachable** {#r02-trigger-eaten}

- **Risk:** macOS / WebKit may intercept Opt-Tab (a Tab-family chord) before it reaches the WebView, exactly as it eats ⇧⇥ — leaving the cycling mode with no way in.
- **Mitigation:** confirm reachability in [#step-cycle-trigger-spike] *before* building the mechanism; [Q05] carries a non-Tab fallback chord.
- **Residual risk:** the fallback chord is less mnemonic than Opt-Tab.

---

### Design Decisions {#design-decisions}

#### [P01] The focus signature: ring + faint behind-tint on the focused component; native fill for selection (DECIDED; GOVERNING; supersedes keyboard-model [P03]) {#p01-signature}

**Decision:** Keyboard focus is shown by a **ring** on the focused element plus a **faint behind-tint** on its component; committed selection is the component's **native fill** (radio dot / segmented pill / option fill / list-row fill / checkbox-switch fill). These are three orthogonal marks — ring = "the keyboard is here", tint = "this component is focused", fill = "this is selected".

**Rationale:**
- Proven by eye on the spike canvas across the full archetype taxonomy in both themes.
- Selection-as-native-fill preserves decades-old per-component conventions; the keyboard layer sits on top rather than replacing them.
- Supersedes keyboard-model [P03] ("ring on the component, *never* on a sub-item; cursor = hover token"): the spike showed the cursor must be able to ride **on top of** a selection fill (multi-select), which a ring does and a tint can't — so for item-groups the ring moves to the cursor item (see [P02]).

**Implications:** `styles/focus-ring.css` and per-component CSS react to the existing attributes; the orange `--tugx-focus-ring-color` axis is retired from the focus path; the keyboard-model matrix's visual column is rewritten ([#step-9]).

#### [P02] Leaf rings the whole component; item-group tints the group and rings the cursor item (DECIDED) {#p02-leaf-vs-group}

**Decision:** For a **leaf** focusable (button, input, toggle, slider) the component *is* the focusable, so the ring wraps the whole component and the behind-tint sits behind it. For an **item-group** (radio/choice/option/list/accordion/Q&A) the behind-tint sits on the **group** and the ring sits on the **cursor item** — so the cursor stays visible even atop a selected item's fill.

**Rationale:** Resolves the multi-select crux (a tint vanishes under a fill; an outline ring does not) with no added checkmark, while keeping a single signature.

**Mechanism — the inversion, and how CSS tells a leaf from a group.** Today the global focus rule maps `[data-key-view-kbd]` → an outline **ring** and `[data-key-cursor]` → a background **tint**. This model **inverts that for groups**: a group key-view becomes a behind-**tint** and the cursor item becomes a **ring**. The engine does **not** project a container-kind attribute (verified: `use-focusable` sets only `data-tug-focusable` / `data-tug-focus-key`; the `container: "item"` kind never reaches the DOM), and this plan **adds none** ([P04]). So differentiation is **pure CSS, per component**:

- the global rule keeps `[data-key-view-kbd]` → ring — correct for a **leaf** control;
- `[data-key-cursor]` is changed **globally** to an outline **ring** (role-resolved) — correct for every cursor item;
- each **group** component, in its own step, **overrides the global ring on its `[data-key-view-kbd]` root to `outline: none` + the behind-tint**, keyed on its own `data-slot` / `role` (e.g. `[data-slot="tug-radio-group"]`, `role="radiogroup"`).

No engine touch; stays in the appearance zone ([L06]).

**Implications:** the leaf-vs-group split is owned by each group's CSS overriding the global ring; [#step-1] globalizes only the ring recolor + the cursor→ring flip; the behind-tint is applied **per archetype** (steps 2–8), never globally. Until a group's step lands it shows the leaf ring on its container — a benign in-progress state (Risk R01).

#### [P03] One role axis, default `action`; no role-less branch (DECIDED) {#p03-role-axis}

**Decision:** The ring color, the selection fill, and the behind-tint all resolve from a **single role variable that defaults to `action`** (the neutral interactive blue) and is overridden per role. Every focusable is modeled as carrying a role; "role-less" controls simply ride the `action` default. Buttons additionally **promote to their filled role style** on focus (the [#step-2] keyboard-promoted state).

**Rationale:** Collapses the two-case (role vs role-less) handling into one path; makes a danger input / accent toggle / danger option expressible for free; matches the spike's final unification.

**Implications:** No `var(--role, fallback)` branching; components set the role variable only when non-default. `TugInput.validation` maps onto it ([P07]); `TugTabBar` keeps `action`.

#### [P04] Re-skin over stable engine attributes — no engine change (DECIDED) {#p04-reskin}

**Decision:** This plan changes only CSS, tokens, and a few resting-style renders. It does not modify the focus engine, the scope stack, the projection of `[data-key-view-kbd]`/`[data-key-cursor]`/`[data-key-within]`/`data-selected`, or any behavior.

**Rationale:** The de-risker — behavior app-tests (which assert attributes/behavior, not pixels) stay green and prove nothing behavioral moved; the work is contained to the appearance zone ([L06]).

**Implications:** Every step's checkpoint includes the relevant behavior app-tests still `VERDICT: PASS` plus `tsc` clean; appearance is the by-eye add-on. The leaf-vs-group differentiation ([P02]) is handled by per-component CSS overrides, **not** a new engine-projected attribute, to keep this decision intact. (Deliberate behavior exceptions, each carried with its own app-tests: [P08] TugTabBar commit-on-act, and [P09] the keyboard-focus-cycling mode — a new, opt-in mode that gives the focus language its home on text-first cards, built on the engine's existing focus-mode stack rather than a new projection.)

#### [P05] Token architecture — promote the spike's `--fl-*` knobs to real tokens (DECIDED; shape in [Q01]) {#p05-tokens}

**Decision:** Author a real focus-language token surface (ring / behind-tint / selection-fill, resolved from the role axis) in `styles/focus-ring.css` + the theme files, replacing the spike's private `--fl-*`. Component CSS consumes these tokens, not bespoke per-component colors.

**Rationale:** Single source of truth, theme-aware, tunable in one place (as the spike demonstrated); avoids the bespoke-per-component drift the dialogs currently have.

**Implications:** [#step-1] lands the tokens; later steps consume them; the spike card is repointed at them ([Q04]).

#### [P06] Buttons keep fill-promotion, unified into a TugPushButton keyboard-promoted state (DECIDED) {#p06-button-promote} 

**Decision:** A focused button promotes to its filled role style + role ring (demoting siblings to outlined), lifted from the bespoke dialog CSS into `internal/tug-button.css` reacting to the engine attributes. The inline Permission/Question dialogs consume this state instead of carrying their own copy.

**Rationale:** Buttons have no separate selection, so fill-as-focus is unambiguous and is the treatment already shipped + loved in the dialogs; centralizing removes duplication.

**Implications:** `dev-permission-dialog.css` / `dev-question-dialog.css` shrink to dialog-layout only; the promotion is a first-class button capability.

#### [P07] TugInput validation maps onto the role axis (DECIDED) {#p07-input-validation}

**Decision:** `TugInput`'s existing `validation` axis (`default`/`invalid`/`valid`/`warning`) maps onto the role axis: invalid→danger, valid→success, warning→caution, default→action. The focus ring/border take the resolved role color; no parallel "role" prop is added.

**Rationale:** One semantic-color axis, not two; an invalid field focusing red is the natural, expected behavior.

**Implications:** Input focus CSS resolves the role from the validation class; covered in [#step-6].

#### [P08] TugTabBar commits on act (DECIDED) {#p08-tabbar-commit}

**Decision:** `TugTabBar` moves from live-commit (selection follows the cursor on every move) to **commit-on-act**, matching TugChoiceGroup, so the cursor and selection are separable like every other item-group.

**Rationale:** Removes the one live-commit special case; lets the tab bar use the identical item-group focus signature (behind-tint + cursor ring + native pill fill).

**Implications:** A small behavior change (not pure appearance) — its step carries an app-test for arrow-moves-without-committing + act-commits, and updates the keyboard-model matrix row.

#### [P09] Keyboard-focus-cycling mode for text-first cards (DECIDED; behavior addition) {#p09-cycle-mode}

**Decision:** Text-first cards — whose resting key view is a text editor that owns Tab — gain a **keyboard-focus-cycling mode**: a per-card, **trapped** engine focus-scope, toggled by a dedicated trigger ([Q05]), within which Tab circulates the card's chrome zones (the [D97] `Z`-areas) while the editor's typing semantics are suspended. The resting state after connection is **typing** (caret in editor); the trigger flips to **cycling**. The mechanism is **general** (any text-first card opts in); the **dev card is the first consumer**.

**Rationale:**
- The editor needs Tab (completion / indent, `at0104`) and the chrome needs Tab (reach the `Z`-zones) — irreconcilable on one Tab. A *mode* resolves it (the modal-editor move).
- Cycling is the surface that finally exercises the whole focus language on a real card — one Tab tour shows every archetype — so it is feature and end-to-end vetting surface at once.
- The deferred a11y mode ([Q03]) likely falls out for free ("always-on cycling" = the cycle scope is the base mode).

**Implications:** A scoped **behavior** addition — the [P04] carve-out — built on the engine's existing focus-mode stack (`pushFocusMode` / `popFocusMode` / `focusFirstInMode`), adding **no** new engine projection. Carried with its own app-tests. A reusable hook + dev-card wiring; the *visuals* come from [#step-1]–[#step-8]. See [#cycle-model].

#### [P10] Cycle topology — zones are the focus-language item-groups (DECIDED) {#p10-cycle-topology}

**Decision:** In cycling mode, **Tab moves between zones; arrows rove within a zone.** A multi-control *semantic group* is an **item-group** (behind-tint on the zone, ring on the cursor item, per [P02]); a single control or a cluster of independent controls contributes **leaf** stops (whole ring). The cycle is **trapped** (wraps within the card), Shift+Tab reverses. The **Z1 transcript is excluded** from the first cut.

**Order + seed — REVISED 2026-06-06 (supersedes the original "seed at Z5 submit / wrap top→bottom"):** the cycle reads the card **bottom toolbar left→right, then up, then into the editor**, and **seeds at the route (the first stop)**:

> **route (Z4A) → Mode → Model → Effort (Z4B) → submit (Z5) → Z2 status row → prompt-entry editor → wrap.**

The **editor is the last stop** (a text stop, per [P11]): landing rings the **still-blurred** input area with a focus-ring-colored border, and **Return resumes typing** (exits cycling). The **Z2 status row is one item-group stop** (Tab to it, ←/→ rove STATE/TIME/TOKENS/CONTEXT/TASKS — they are a coherent spatial row of popover triggers; the roved cell takes the default **blue** ring, no role). The **Z4B chips stay independent leaf stops** (Mode/Model/Effort). A **disabled** stop (the empty submit; the Z4B chips on the Shell route) is dropped from the walk by the engine's interactivity filter (`FocusManager.isRecordInteractive`), so the seed lands on the next live stop (route stays first).

**Why the seed moved off submit:** with the editor now in the cycle and the full toolbar+Z2 walked, a spatial left→right→up→editor reading is more legible than "nearest-actionable-first"; the route is the natural entry. (This reverses the earlier interim "submit first" — see [P12], also revised.)

**Refinement (impl):** "multi-control zone = item-group" applies only to a **semantic group** (Z4A route = Code/Shell; the Z2 row = the telemetry cells). A cluster of **independent** controls (Z4B = Mode / Model / Effort) is **not** one item-group — each is its own leaf Tab stop. Arrow-within is for true groups.

**Rationale:** Zone-granular cycling keeps the Tab count low and maps the card's zones onto the focus-language's leaf/group archetypes — cycling *is* the language's showcase. Seeding at the route + reading left→right→up→editor gives a predictable spatial tour that ends on the text surface the user most often wants back.

**Implications:** Each consumer registers its zones as cycle stops (`focusGroup` into the card's cycle scope); the existing item-group focus CSS ([#step-3], [#step-5]) renders the within-zone roving for free.

#### [P11] Mode keys — Return is text-entry-only; Space acts; trigger exits (DECIDED) {#p11-cycle-keys}

**Decision:** While cycling: the **trigger toggles the mode off** anywhere (restoring the caret to the editor); **Return is reserved for text-entry contexts only** — landing the cycle ring on the prompt-entry (or any text-input) zone and pressing Return **drops into the field** (resume typing — which also exits cycling), where the route's own Return semantics apply (Prompt: Shift+Return submits; Shell: Return submits), and on a **non-text** control Return is inert; **Space acts** on the focused control (the engine act tier). Dedicated chords stay live throughout (routes ⇧⌘C / ⇧⌘S, permission ⇧⌘P, and the per-zone Z2 chords Cmd-1…N). **Escape is deliberately NOT bound** to exit cycling in the first cut — the trigger already toggles off, and Escape is kept free for future per-stop / cancel-ladder semantics; revisit only if exiting via Escape proves a real need.

**Rationale:** "Return = enter / commit text" is the one universal expectation; reserving it to text contexts keeps "land in prompt-entry + Return → typing" coherent and removes the ambiguous Return-activates-button-vs-submit case. Space-acts matches the existing act tier. The chords are the fast path; cycling is the discoverable / accessible path; they coexist.

**Implications:** The cycle scope's key handling routes Return only to text-input stops, dispatches act on Space, and pops on the trigger (and on Return dropping into a text stop). The Z2 cells gain Cmd-1…N popup-toggle chords ([#step-cycle-keys]).

**Brought forward (2026-06-06):** the **editor-as-text-stop** half — the prompt-entry editor is the cycle's last stop, lands the ring on the still-blurred input, and **Return resumes typing (exits cycling)** — lands with the dev-card cycle redesign ([#step-cycle-devcard], [P10] revised order), not deferred to [#step-cycle-keys]. The remaining [P11] mode-key semantics (Space-acts on non-text stops, the inert-Return rule on buttons, Cmd-1…N Z2 chords) stay in [#step-cycle-keys].

#### [P12] Per-state default focus + per-control roles for the dev card (DECIDED) {#p12-devcard-focus}

**Decision:** The dev card declares its default (resting) key view **per state** — **Picker → the Open (submit) button; Connected → the editor** — and focus **migrates deliberately on state transition** (spawn picker→connected seeds the editor; end connected→picker seeds Open), never landing wherever React happens to mount. Per-control roles: **submit = action** (danger while stopping), **route choice = action**, **permission chip = agent**.

**Rationale:** Matches the single-text-entry rule (the editor is the connected card's persistent destination) and the commit-home convention (Open is the picker's primary action). The roles make the cycle tour role-resolved per [P03].

**Cycling suppresses the standing fill; fill follows focus; restore on exit.** Outside cycling, the submit button is `filled` as its standing identity (the ring's home base) — unchanged; we do **not** touch the submit button. *During* cycling, `filled` means a different thing — the keyboard-focus convention (filled = "the keyboard is here") — so the submit's standing fill is **suppressed** so the fill follows the cursor (exactly one filled+ringed stop at a time), and **restored on exit**. The two meanings never co-occur, and the seed lands the fill on the commit-home on entry, so nothing flickers. Mechanism (pure CSS, [L06] — **no change to the submit button's component or props, no React-state emphasis swap**): a rule keyed on the card's `[data-cycling="true"]` signal (rendered from `useCycleMode`'s engine-derived `cycling`) relaxes the standing fill on cycle-stop buttons to outlined while cycling; the existing promotion rules (`[data-key-view-kbd]` / `[data-key-cursor]`) fill the focused one; on exit `data-cycling` drops and the submit reverts to its identity fill. This refines the keyboard-model "primary keeps its fill, ring moves" reading for the cycling context — in cycling, **filled === focused, everywhere**.

**Implications:** A per-state default-focus declaration on the card's seed path + the transition migration; the roles feed the focus-language visuals; the `[data-cycling]` fill-suppression rule lands with the dev-card wiring ([#step-cycle-devcard]). The `gallery-cycle-demo` already models the target (all stops outlined → fill follows focus); the suppression matters only where a cycle stop is `filled` at rest (the dev-card submit).

**REVISED 2026-06-06 — cycle seed + cycling visuals:**
- **Resting default focus is unchanged** (Picker → Open; Connected → editor). What changed is the **cycle seed**: ⌥⇥ now seeds the **route**, not the submit ([P10] revised). "Resting default" (where focus rests outside cycling) and "cycle seed" (the first stop ⌥⇥ lands on) are distinct — the resting default stays the editor; the cycle seed is the route.
- **Blur the input, drop the section ring.** While cycling, the editor stands down via the existing **`deactivated` read-only path** (`deactivated = inlineDialogPending || cycling`) — that *is* the mode indicator. The engine's **`data-key-within`** container mark (the faint outline on the focused stop's container — the toolbar / prompt-entry section) is **suppressed during cycling**: only the focused-stop ring + the input blur read the mode. (User: "don't draw an outer ring around the Z4/Z5 section.")
- **Editor-stop ring:** when the cycle lands on the editor (last stop), the still-blurred input area shows a **focus-ring-colored border** (the focused-stop ring for a text stop); Return resumes typing ([P11]).
- **Fill-suppression still holds:** the submit is `filled` at rest and suppressed-to-outlined during cycling so the fill follows the focused stop — unchanged by the seed move (it keys on `[data-cycling]`, not on being the seed).

#### [P13] Every focus context is persistent-cycling or toggleable-cycling (DECIDED) {#p13-context-cycling-type}

**Decision:** Every focus context — pane / card / sheet / alert / dialog — relates to keyboard-focus-cycling (the trapped Tab-walk over its controls) in exactly one of two ways, and the context **knows which**:

- **Persistent cycling** — the trapped walk **is** the context's base mode. It is pushed when the context opens and never turned off; there is no editor monopolizing Tab, so Tab circulating the controls is simply how the context works. Examples: `PermissionDialog`, `QuestionDialog`, the Model / permission / effort sheets — any surface with **no Tab-owning text surface**.
- **Toggleable cycling** — the context's base mode is **text-first**: a Tab-owning editor rests with the keyboard, and cycling is a mode **pushed on the trigger (⌥⇥)** and **popped back to the editor caret**. Example: the connected dev card.

**The discriminator is a single question: does the context contain a Tab-owning surface?** A *Tab-owning surface* is a **multi-line editor** (the CodeMirror prompt / code editor) where Tab means indent / completion. A **single-line** text input (a path field, a search box, a rename field) does **not** own Tab — Tab should leave it — so its presence does **not** make a context toggleable. No Tab-owner → **persistent**; a Tab-owner → **toggleable** (the editor is the resting home, cycling is the escape hatch).

**The type is a property of (context × state), not of a component — it can flip as the UI evolves.** The dev card is **persistent in its Picker state** (no editor — the picker is a form whose only text field is single-line) and **toggleable in its Connected state** (the prompt editor owns Tab). The type changes at the Picker→Connected transition; a context must re-derive its type as its state changes, and seed/expose the trigger accordingly. (This is the concretized form of "track these states as the UI and user interaction evolve.")

**Rationale:** This is a *classification over a mechanism we already have*, not a new mechanism. Persistent cycling is exactly `useFocusTrap` (push a `{ trapped: true }` mode at open, pop on unmount, no toggle); toggleable cycling is exactly `useCycleMode` (push on ⌥⇥, capture+restore the editor key view, expose a toggle) — `useCycleMode` is `useFocusTrap` + a toggle + key-view capture/restore. Naming the two as one axis (a) gives a decision rule for every new context instead of ad-hoc per-surface keyboard wiring, (b) lets the two hooks converge (toggleable builds on persistent), and (c) **dissolves the deferred a11y question [Q03]**: "always-on cycling" for accessibility is just *making a toggleable context persistent* — drop the toggle, push at mount — same mechanism, no separate feature.

**Implications:**
- Each context **declares or derives** its cycling type (from the discriminator), and the type is **reactive to the context's state** where the state changes the composition (dev card). Persistent contexts push their trapped mode at open (`useFocusTrap`) and never expose ⌥⇥; toggleable contexts rest on the editor and expose ⌥⇥ (`useCycleMode`).
- **The session picker is *persistent*, not toggleable** ([#step-picker-keys]): its only text input is the single-line path field, which does not own Tab. (Reclassifies the earlier tentative read.)
- **Convergence (not required now, enabled):** refactor `useCycleMode` to build on `useFocusTrap` so both express the one mechanism; the a11y mode ([Q03], assessed at [#step-cycle-vet]) becomes "persistent variant of an otherwise-toggleable context."
- **Governance:** this axis is enshrined in the focus-language tuglaws doc ([#step-9]) alongside the leaf/group/cycle model; until then this decision is the reference.
- Keep it **lightweight** — a naming + decision rule + hook convergence, **not** a new "focus-context manager." The engine's focus-mode stack already is the manager; this decision only says how each context should use it.

---

### Deep Dives {#deep-dives}

#### Keyboard-focus-cycling model {#cycle-model}

A text-first card has one irreducible conflict: the **editor wants Tab** (completion / indent, `at0104`) and the **chrome wants Tab** (reach the [D97] `Z`-zones). One Tab can't mean both. The resolution is a **mode** ([P09]):

- **Typing** (resting, after connection): caret in the editor; Tab = completion. The chrome is reachable only by dedicated chords (routes ⇧⌘C / ⇧⌘S, permission ⇧⌘P, Z2 Cmd-1…N).
- **Cycling** (trigger-toggled): the editor's typing is suspended; **Tab circulates the zones, arrows rove within a zone.**

**Mapping to engine primitives (no new projection — the [P09] carve-out reuses the existing stack):**

- the trigger **pushes a trapped per-card focus mode** (`pushFocusMode`) and **seeds the key view at the commit-home** (`focusFirstInMode` → Z5 submit);
- Tab walks the mode's focusables (the registered `Z`-zones); each zone is a **leaf** (Z5) or an **item-group** (Z2 / Z4) — so the focus-language's [P02] leaf-vs-group visuals render the tour for free;
- the trigger (or Return dropping into a text stop) **pops the mode** (`popFocusMode`), restoring the editor caret (the captured prior key view). Escape is deferred ([P11]).

**Cycle order ([P10]):** seed Z5; forward Tab wraps to the top and reads top→bottom (Z2 → Z4 → Z5 → wrap), Shift+Tab reverses; trapped within the card; Z1 transcript excluded (first cut).

**Why this is the focus language's home:** one Tab tour of the dev card exercises every archetype in the matrix — leaf ring on submit; group tint + cursor ring on the status bar and route; role colors (submit = action / danger, permission = agent). Cycling is simultaneously the feature and the end-to-end vetting surface.

**a11y ([Q03]):** "always-on cycling" is just "the cycle scope is the base mode" — design the mechanism so the toggle can be removed without restructuring, so the a11y mode falls out. Assessed at [#step-cycle-vet].

---

### Specification {#specification}

#### The focus-language contract {#language-contract}

For any focusable, given the engine attributes:

- `[data-key-view-kbd]` on a **leaf** → ring (role color) + faint behind-tint (role color) on the component.
- `[data-key-view-kbd]` on an **item-group container** → faint behind-tint (role color) on the container.
- `[data-key-cursor]` on an **item** → ring (role color) on the item, offset so it survives atop a fill.
- `data-selected` (or the component's native checked/active state) → the component's **native fill** in the role color.
- `[data-key-within]` on a container → the quiet "contains active" mark (unchanged in meaning; restyled to the new tint family).
- Role resolves from the role axis, default `action` ([P03]); buttons additionally promote to filled ([P06]).

#### Token surface (target) {#token-surface}

Replaces the orange axis. Exact names settle in [Q01]; shape:

- `--tugx-focus-ring` (role-resolved ring color; default `action`), `--tugx-focus-ring-width/offset/radius` (geometry, kept).
- `--tugx-focus-tint` (role-resolved faint behind-tint).
- `--tugx-focus-fill` (role-resolved native-selection fill) + `--tugx-focus-fill-on` (light glyph/text on fill).
- `--tugx-key-within-*` (restyled to the tint family).
- Role override rules mapping a role to the `--tug7-...-filled-{role}-*` family.

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| focus ring / behind-tint (focused component) | appearance | CSS keyed on `[data-key-view-kbd]` reading the role token | [L06] |
| cursor ring (current item) | appearance | CSS keyed on `[data-key-cursor]` reading the role token | [L06] |
| `data-key-within` mark | appearance | CSS keyed on `[data-key-within]` (engine-projected) | [L06] |
| committed selection fill | appearance (from committed data) | `data-selected` / native checked-active state → CSS | [L06] |
| role (per component) | config | prop / validation class → role token; default `action` | [L06], [L24] |
| (engine: key view, cursor, scope stack) | structure | **unchanged** — FocusManager owns it | [L22] |
| cycling-mode active (per card, [P09]) | structure | engine focus-mode push/pop (`pushFocusMode` / `popFocusMode`); no React state | [L22], [L06] |
| cycle stop registration (the Z-zones, [P10]) | structure | `focusGroup` into the card's cycle scope; one leaf/item-group per zone | [L22], [L03] |

No new store-backed state; no `useState` for appearance ([L06]).

---

### Compatibility / Migration / Rollout {#rollout}

- **Migration shape:** [#step-1] re-points the global `[data-key-view-kbd]` rule, shifting the whole app at once (R01 mitigation); per-component steps then layer the behind-tint + native-fill + cursor-ring refinements. No flag/gate — it is a visual replacement, reversible by git.
- **Who is impacted:** every keyboard-focusable surface app-wide. Mouse interaction is unchanged (focus marks show on keyboard focus only, per the engine's `-kbd` attribute).
- **Rollback:** per-step git revert; the engine is untouched so reverts are pure CSS.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tuglaws/focus-language.md` | The documented focus-language law + governing decision ([#step-9]) |
| `use-cycle-mode.ts` (or similar; name settled in impl) | The reusable keyboard-focus-cycling hook a text-first card opts into — push/seed/pop a trapped cycle scope ([#step-cycle-mechanism]) |

#### Files to modify {#files-modified}

| File | Change |
|------|--------|
| `styles/focus-ring.css` | Re-point the global rule; define the role-resolved focus token surface ([#step-1]) |
| `styles/themes/brio.css`, `styles/themes/harmony.css` | Focus token values per theme; keep the spike's retuned filled intensities ([#step-1]) |
| `internal/tug-button.css` | Keyboard-promoted (filled-role) state ([#step-2]) |
| `tug-radio-group.css`, `tug-choice-group.css`, `tug-option-group.css` | Group tint + cursor ring + native fill, role-aware ([#step-3]) |
| `tug-slider.css`, `tug-tab-bar.css` | Slider ring/thumb; tab bar commit-on-act + segmented treatment ([#step-4]) |
| `tug-list-view.css`, `tug-list-row.css` (+ accordion) | Row cursor ring + native fill + within mark ([#step-5]) |
| `tug-checkbox.css`, `tug-switch.css`, `tug-input.css`, `tug-textarea.css`, `tug-value-input.css` | Whole-component ring + tint + native fill; input validation→role ([#step-6]) |
| `tug-popover/sheet/alert` + inline-dialog shell CSS | Box ring + within ([#step-7]) |
| `tug-link.css` + app-chrome focus CSS | Link + app-wide focusables ([#step-8]) |
| `dev-permission-dialog.css`, `dev-question-dialog.css` | Shrink to layout; consume the shared button state ([#step-2]) |
| `keybinding-map.ts` + `action-vocabulary.ts` | The cycle-toggle trigger chord + action ([#step-cycle-trigger-spike], [#step-cycle-keys]) |
| `cards/dev-card.tsx`, `tug-prompt-entry.tsx` | Register the dev-card Z-zones as cycle stops; per-state default focus + transition migration; Z2 Cmd-1…N chords ([#step-cycle-devcard], [#step-cycle-keys]) |
| `tugplan-keyboard-model.md` (matrix) | Visual-column annotation ([#step-9]) |
| `gallery-focus-language.{tsx,css}` | Repoint at real tokens / decide fate ([#step-10]) |

---

### Documentation Plan {#documentation-plan}

- [ ] Author `tuglaws/focus-language.md` (the language + the governing decision) ([#step-9]).
- [ ] Annotate the keyboard-model [Keyboard Behavior Matrix](tugplan-keyboard-model.md#keyboard-matrix) visual column to the new signature ([#step-9]).
- [ ] No one-off `docs/*.md` — laws live in `tuglaws/`.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When |
|----------|---------|------|
| **Behavior regression** (`just app-test`) | Prove nothing behavioral moved — the existing keyboard scenarios still pass | Every step ([P04]) |
| **Pure logic** (`bun:test`) | Only if a role→token resolver has branching worth unit-testing | [#step-1] if applicable |
| **By-eye gallery review** | The appearance proof — focus signature per component, both themes, keyboard vs mouse | Every component step |
| **Live-build pass** | Surfaces/app-chrome focus that the gallery can't host | [#step-7], [#step-8] |

#### What stays out of tests {#test-non-goals}

- **No pixel-snapshot / fake-DOM render tests** — appearance is reviewed by eye in the gallery; the project bans fake-DOM/RTL and pixel assertions. A focus *color* is not a unit test.
- **No mock-store tests.** The engine is untouched; there is nothing new to assert at the store layer.

---

### Execution Steps {#execution-steps}

> Each step commits on completion after its checkpoint passes. Behavior app-tests + `tsc` are the hard gates; the by-eye gallery check (both themes) is the appearance gate.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Token foundation + re-point the global focus rule | done | 950337d5 (+ ring-scope fix d1dbaf12) |
| #step-gallery | Gallery rename + enrichment policy (ring-scope bug fixed) | done | d1dbaf12 + rename |
| #step-2 | TugPushButton keyboard-promoted state; unify inline dialogs | done | (dash focus-button) |
| #step-cycle | Step 2.5 — Keyboard-focus-cycling mode (umbrella) | pending | — |
| #step-cycle-trigger-spike | Step 2.5.1 — Trigger spike: confirm the chord reaches the webview | done | 62228934 |
| #step-cycle-mechanism | Step 2.5.2 — Cycle-mode scope primitive (push/seed/pop) | done | (main) |
| #step-cycle-devcard | Step 2.5.3 — Dev card joins the cycle; per-state default focus | redesigned ([P10]r): route-seed + blur + no outer ring committed `6a27148f`; editor text-stop done (uncommitted); Z2 status-row stop pending | — |
| #step-cycle-keys | Step 2.5.4 — Mode keys + Z2 dedicated chords | pending | — |
| #step-cycle-vet | Step 2.5.5 — Integration checkpoint + a11y assessment | pending | — |
| #step-picker-keys | Step 2.6 — Session-picker keyboard navigation (persistent cycling, [P13]) | to design + implement | — |
| #step-3 | Item-groups — radio / choice / option | pending | — |
| #step-4 | Live / continuous — slider; tab bar (→ commit-on-act) | pending | — |
| #step-5 | Descendable rows — list view / row, accordion | pending | — |
| #step-6 | Leaf controls — checkbox, switch, input (validation→role), textarea, value-input | pending | — |
| #step-7 | Surfaces / boxes — popover, sheet, alert, inline dialogs (+ option rows), menus audit | pending | — |
| #step-8 | Links + app-wide focusables (title bars, toolbars, prompt, dev panel) | pending | — |
| #step-9 | Governance — tuglaws/focus-language.md + matrix rewrite + governing decision | pending | — |
| #step-10 | Integration checkpoint + spike-card fate | pending | — |

#### Step 1: Token foundation + re-point the global focus rule {#step-1}

**Commit:** `focus(lang): role-resolved focus tokens; re-point the global ring`

**References:** [P01], [P02], [P03], [P04], [P05], [Q01], [Q02], Risk R01, (#token-surface, #language-contract, #p02-leaf-vs-group)

**Artifacts:** new focus token surface in `styles/focus-ring.css` + `brio.css`/`harmony.css`; the global `[data-key-view-kbd]` / `[data-key-cursor]` / `[data-key-within]` rules re-pointed.

**Tasks:**
- Define the role-resolved focus tokens ([P05]); resolve [Q01]'s token shape against two real components and [Q02]'s tint-layering technique; keep the spike's retuned filled-accent/danger intensities.
- Re-point the global `[data-key-view-kbd]` rule from the orange axis to the role-axis **ring** (default `action`) — this is the **leaf** treatment; groups override it in their own steps ([P02]).
- **Flip the global `[data-key-cursor]` rule from a background tint to an outline ring** (role-resolved) — the item cursor for every group ([P02]).
- Restyle the `[data-key-within]` mark into the new tint family.
- **Do NOT globalize the behind-tint** — leaf / group / chrome differ, so it is applied per archetype in steps 2–8 ([P02], Risk R01).
- Keep `--tugx-focus-ring-width/offset/radius`; retire `--tugx-focus-ring-color` from the component/chrome focus path (the spike-card legend may keep an explicit orange swatch for contrast — out of the focus path, settled at [#step-10]).

**Tests:**
- Behavior: full `just app-test` keyboard sweep still `VERDICT: PASS` (nothing behavioral moved).
- By-eye: a **leaf** focusable rings in the new default-action language; a **cursor item** in a group now shows a ring (not the old tint); groups still ring their container until [#step-3]+ land (expected, Risk R01); both themes; orange gone from the focus path.

**Checkpoint:** `bunx tsc --noEmit` clean; app-test sweep green; gallery shows the new default ring + cursor ring in brio + harmony.

> **Step 1 follow-up — the ring-scope bug (fixed `d1dbaf12`).** Step 1 originally
> declared the role-axis aliases (`--tugx-focus-ring` / `-tint` / `-fill`) on
> `:root`, but the `--tug7-*` theme tokens are scoped to **`body`**. A
> `var(--tug7-*)` evaluated at `:root` (the `<html>` element, above the theme
> scope) resolves to the *guaranteed-invalid value*, which inherits down and
> collapses every `outline: … var(--tugx-focus-ring)` to `none` — so **the focus
> ring was invisible app-wide** (the "Tabbing does nothing" / "I can't see the
> changes" report). Fix: the three role-axis aliases moved to `body` (geometry
> literals stay on `:root`). Also repointed `tug-slider.css`'s whole-component
> ring from the retired `--tugx-focus-ring-color` to `--tugx-focus-ring` (orphaned
> by Step 1), and updated `at0115` to assert the ring on the slider root (the
> component rings; the thumb stays the key-view target). The whole focus suite was
> red before this fix (Step 1's "green sweep" claim was wrong); 10/10 focus
> app-tests green after. Upholds [L06], [L17] (one-hop alias, now in the right
> scope).

#### Step (gallery): Gallery rename + enrichment policy {#step-gallery}

**Commit:** `focus(gallery): rename Focus Walk → Focus Language; enrichment is per-component`

**References:** [P01], [P02], [P03], [P04], (#success-criteria, #test-categories)

**Depends on:** #step-1

**STATUS — done.** This step was originally scoped as "make the gallery keyboard-drivable
by building a shared trapped `<FocusLanguageSection>`." **That premise was wrong, and the
trap helper was both unnecessary and harmful** — see below. It collapses to a rename + a
policy note; the real fix was the Step 1 ring-scope bug above.

**Why the original premise was wrong.** The diagnosis "regular gallery cards aren't
keyboard-focus surfaces, so Tab does nothing" was a *symptom of the invisible-ring bug*,
not a missing focus scope. Driving the engine directly proved it: the existing `Focus Walk`
sections register their component into the base focus mode via `focusGroup`/`focusOrder`,
and the **base mode already drives the Tab-walk** — click into a card (or its pane title
bar) → Tab → the key view walks into the component and rings. This is exactly what the
existing focus app-tests (`at0118`, `at0119`, `at0125`, `at0112`, …) exercise, and they
pass. Once the ring actually paints (Step 1 fix), the gallery is a perfectly good
keyboard-focus vetting surface as-is.

**Why a trapped `<FocusLanguageSection>` is rejected.** A per-card trap active on mount
would have **broken two passing app-tests**: every mounted card (including hidden
background tab-cards) would push a trapped focus mode, breaking `at0125`'s
background-tab isolation; and seeding `focusFirstInMode` on mount would light the ring at
rest, breaking `at0118`'s "no ring at rest" assertion. The engine already isolates hidden
cards and lands one Tab on the active card's first focusable — no trap needed. **Do not
add one.**

**Done (on `main`, earlier):**
- ✅ Deleted the unintelligible demo cards `gallery-focus-states` + `gallery-focus-nested`, their `gallery-focus.css`, their registrations, and the `at0123`/`at0124` app-tests.
- ✅ De-spiked `gallery-focus-language` into a permanent **"Focus Language"** card — the static OVERVIEW of the whole language (a `--fl-*` mockup; repoint at the real tokens in [#step-10]).

**Done (this step):**
- ✅ **Ring-scope bug fixed** (`d1dbaf12`) — the real cause of the gallery looking broken (see the Step 1 follow-up box above).
- ✅ **Renamed** every card's `Focus Walk` → `Focus Language` (label text + comments + aria-labels) across `gallery-choice-group / -radio-group / -option-group / -checkbox / -switch / -slider / -accordion / -chain-actions`. **Testids kept** (`*-focus-title`, `focus-walk-*`) — they back `at0112/at0118/at0125`; renaming them would break those tests.

**Enrichment policy (folded into the component steps, not a separate step).** The gallery is
the **example + vetting surface for the focus language**, not just look-and-feel. As each
component step ([#step-2]–[#step-8]) lands, it **enriches that component's Focus Language
section** into a real vetting surface:
- show the component's **role variants** (action default + danger/accent/… where the
  component supports roles) so the role-resolved ring/fill/tint are visible side by side;
- where it makes sense, include **multiple components in the section so Tab moves between
  them** (proving the ring travels and the within-mark reads);
- exercise the **complete progression** — rest → keyboard focus (ring + behind-tint) →
  cursor (group → ring on the cursor item) → committed selection (native fill).
No shared trap helper; the base mode drives it. Components without a Focus Language section
yet get one added as their step lands.

**Tests:**
- Behavior: `tsc` clean; the focus app-test sweep green (`at0104/0106/0109/0112/0113/0114/0115/0118/0119/0125` — 10/10 after the ring-scope fix). No banned tests — pixels are by-eye.
- By-eye: open a component card, click in, **Tab** — the real component rings/cursors/selects per the model, both themes.

**Checkpoint:** `bunx tsc --noEmit` clean; focus app-test sweep green; ring visible in brio + harmony; the rename landed with testids preserved; the two demo cards are gone and the **Focus Language** reference card is permanent. **No `<FocusLanguageSection>` helper exists (by design).**

#### Step 2: TugPushButton keyboard-promoted state; unify inline dialogs {#step-2}

**Depends on:** #step-1

**Commit:** `focus(button): first-class keyboard-promoted state; dialogs consume it`

**References:** [P06], [P03], [P01], (#p06-button-promote)

**Artifacts:** keyboard-promoted rules in `internal/tug-button.css`; `dev-permission-dialog.css`/`dev-question-dialog.css` reduced to layout.

**Tasks:**
- Lift the bespoke fill-promotion (focused → filled role + role ring; siblings demoted) into `internal/tug-button.css`, reacting to the engine attributes and the role axis.
- Repoint the inline dialogs onto it; delete their duplicated promotion CSS.

**Tests:**
- Behavior: the inline-dialog keyboard scenarios still `VERDICT: PASS`.
- By-eye: focused Allow/Deny/Save/Delete promote correctly per role, both themes; dialogs match the gallery.

**Checkpoint:** `tsc` clean; dialog app-tests green; dialogs visually unchanged or better.

#### Step 2.5: Keyboard-focus-cycling mode for text-first cards (umbrella) {#step-cycle}

**Depends on:** #step-1, #step-2

**Commit:** `N/A (umbrella — the substeps carry the commits)`

**References:** [P09], [P10], [P11], [P12], [Q05], Risk R02, (#cycle-model, #language-contract)

Umbrella for the cycling-mode feature ([P09]) — the one deliberate **behavior** addition in this plan (the [P04] carve-out). Substeps [#step-cycle-trigger-spike] → [#step-cycle-vet] build the general mechanism (a reusable hook over the engine's focus-mode stack) and wire the dev card as the first consumer. This is what gives the focus language its home on text-first cards: one Tab tour exercises every archetype. Design write-up in the deep dive ([#cycle-model]); the *visuals* it displays come from [#step-1]–[#step-8].

#### Step 2.5.1: Trigger spike — confirm the chord reaches the webview {#step-cycle-trigger-spike}

**STATUS — done.** Opt-Tab (⌥⇥) confirmed reachable + matched ([Q05] DECIDED); the action + binding are wired; `at0138` guards it. The mechanism (the handler) lands in [#step-cycle-mechanism].

**Depends on:** #step-1

**Commit:** `focus(cycle): cycle-toggle trigger chord + action`

**References:** [Q05], [P09], Risk R02, (#cycle-model)

**Artifacts:** `CYCLE_FOCUS_MODE` action in `action-vocabulary.ts`; the ⌥⇥ trigger chord in `keybinding-map.ts`; `at0138-cycle-trigger-chord.test.ts`; [Q05] resolved in this plan.

**Tasks:**
- [x] Spike the candidate chord (Opt-Tab, ⌥⇥) reachability: an app-test that posts a native ⌥⇥ and asserts the document keybinding stage receives + matches it. → **reaches + matches** (not eaten by macOS, unlike ⇧⇥).
- [x] If eaten, take the first reliable non-Tab fallback; record the choice + rationale in [Q05]. → **not eaten; Opt-Tab kept** ([Q05] DECIDED).
- [x] Wire the chosen chord to the `CYCLE_FOCUS_MODE` action (handler deferred to the mechanism step). Also fixed the stale `⇧⇥` comment on `CYCLE_PERMISSION_MODE` (now ⇧⌘P) while in `action-vocabulary.ts`.

**Tests:**
- [x] Behavior: `at0138` posts a native ⌥⇥ and asserts it reaches the document (not OS-eaten) AND `defaultPrevented === true` (the binding matched). `VERDICT: PASS`.

**Checkpoint:**
- [x] `bunx tsc --noEmit` clean.
- [x] the chord is confirmed reachable (`at0138` green).
- [x] [Q05] resolved (Opt-Tab chosen + recorded).

#### Step 2.5.2: Cycle-mode scope primitive (push/seed/pop) {#step-cycle-mechanism}

**STATUS — done.** `useCycleMode` built (general, engine-derived `cycling`, no new projection); proven on a permanent `gallery-cycle-demo` card; `at0139` guards push/seed/wrap/restore. The real consumer (dev card) is [#step-cycle-devcard].

**Depends on:** #step-cycle-trigger-spike

**Commit:** `focus(cycle): per-card cycle focus-scope primitive`

**References:** [P09], [P10], [P11], (#cycle-model, #state-zone-mapping)

**Artifacts:** `use-cycle-mode.tsx` (the hook); `cards/gallery-cycle-demo.tsx` + its registration (the showcase / test surface); `at0139-cycle-mode-scope.test.ts`.

**Tasks:**
- [x] Implement the cycle scope: the toggle pushes a **trapped** per-card focus mode, seeds the key view at the commit-home (the lowest-`focusOrder` stop, via `focusFirstInMode`), and pops on toggle — restoring the captured prior key view (the resting key view / editor caret) ([P10]). `cycling` is **engine-derived** (`useSyncExternalStore` on `currentFocusMode() === scopeId`, [L02]), not a parallel React boolean. `exit` is exposed for [#step-cycle-keys] (the Return-into-text exit).
- [x] Keep it **general**: the hook owns only push/seed/pop + the `CycleScope` wrapper; the consumer supplies the stops (via `focusGroup` inside `CycleScope`) and orders the commit-home first. No dev-card specifics.
- [x] No new engine projection — reuse the focus-mode stack (`pushFocusMode` / `popFocusMode` / `focusFirstInMode` / `focusKeyView`) — the [P04] carve-out via [P09].

**Tests:**
- [x] Behavior: `at0139` — ⌥⇥ seeds the commit-home; Tab wraps home → A → B → home (trapped; the resting control never takes the key view); ⌥⇥ restores the resting key view. `VERDICT: PASS`.

**Checkpoint:**
- [x] `bunx tsc --noEmit` clean.
- [x] the primitive pushes/seeds/pops a trapped cycle scope (`at0139` green).
- [x] no existing app-test regresses (the hook + demo card are additive; the keybinding/focus-walk are untouched).

#### Step 2.5.3: Dev card joins the cycle; per-state default focus {#step-cycle-devcard}

**STATUS — Slices 1 + 2 done (uncommitted on `main`); Slice 3 optional/deferred. RESUME NOTES.**

*Slice 1 — DONE (uncommitted).* The dev card cycles end-to-end: `useCycleMode({ enabled: !sessionErrored })` in `DevCardBody`; `CYCLE_FOCUS_MODE → cycle.toggle()` on the card-content responder; `data-cycling` on the `dev-card` root; the prompt entry wrapped in `cycle.CycleScope`; the **Z5 submit authored as the commit-home** via new neutral `submitFocusGroup`/`submitFocusOrder` props on `TugPromptEntry` (group `dev-prompt-cycle`, order 0); **Connected → editor on exit** via a layout effect on the engine-derived `cycling` snapshot (the editor is a responder, not a key-view, so the card owns the restore — `pushFocusMode`'s `restoreKeyView` is null); the **fill-suppression CSS** (`[data-cycling="true"] .tug-prompt-entry-submit-button.tug-button-filled-{action,danger}:not([data-key-view-kbd]):not([data-key-cursor])` → outlined tokens) in `tug-prompt-entry.css`.

*Slice 2 — DONE (uncommitted).* Z4A route as the second cycle stop: new neutral `routeFocusGroup`/`routeFocusOrder` props on `TugPromptEntry` → the route `TugChoiceGroup` (group `dev-prompt-cycle`, order 1). The route is an **item-group** — one Tab stop, arrows within — and its **root** carries `data-key-view-kbd` when it holds the cycle key view (the arrow cursor `data-key-cursor` rides a child), so the cycle tours submit(0) → route(1) → wrap. **Picker → Open** default focus via a **smart latch** in `DevProjectPickerForm` (user-chosen): on mount/settle, focus Open when it is enabled (a valid path seeded) else the path field; a user edit (`onChange`) claims the field so the latch never yanks focus mid-typing; `autoFocus` removed from `TugFileChooser`, `openButtonRef` added to the Open button. Verified: `bunx tsc --noEmit` clean; **at0140** (submit seed → Tab tour submit→route→wrap → exit restores editor) green; regressions green — at0138/at0139 (cycle primitive), at0088/at0092/at0093/at0099/at0102 (dev/picker incl. default-button pane scope), at0051/at0080/at0081 (dev focus), at0085/at0118 (route/choice-group), at0103/at0104 (submit/tab completion), at0020/at0024/at0025/at0100/at0105/at0106 (roundtrip/sheet/permission-keys). NB: **at0038** (deactivation inactive-paint) fails its two *dev* cases on `getActiveCardId()==="B"` — **pre-existing**, reproduced on a clean baseline build with these changes stashed; unrelated to focus language.

*Post-review fixes (uncommitted).* (1) **Disabled controls are no longer Tab targets** — `FocusManager.walkOrder` now skips a focusable whose element is `:disabled` / `[aria-disabled="true"]` / computed `pointer-events: none` (new `isRecordInteractive`, reading the DOM at walk time like `isRecordRendered`). So the submit drops out of the cycle while the editor is empty (its empty-input gate) and the seed lands on the route instead — **no React state**, the empty-ness stays DOM/appearance state and the structure consumer (the walk) observes it directly ([L06]/[L22]/[L24]; L02 forbids mirroring editor empty-ness into `useState`). at0140 extended to assert empty→submit-skipped and typed→submit-seeded. (2) **Choice-group double-ring** (selected-value ring + cycle group/cursor ring) is a Step 3 cleanup — note added to [#step-3].

*Slice 3 — Z4B chips DONE (uncommitted); Z2 status row still deferred.* The interactive Z4B chips — **Mode** (`PermissionModeChip`), **Model** (`ModelChip`), **Effort** (`EffortChip`) — now take `focusGroup`/`focusOrder` props and join the cycle as **leaf stops** at orders 2 / 3 / 4. Tour: submit(0, seed) → route(1) → Mode(2) → Model(3) → Effort(4) → wrap. They are independent controls, so each is its **own leaf Tab stop** (NOT a single arrow-within item-group — a [P10] refinement: "multi-control zone = item-group" applies to a *semantic* group like the route choice; a cluster of independent controls is a run of leaf stops). On the Shell route the chips are `disabled` and the engine's interactivity filter drops them from the walk for free. The chips are `tinted agent`, so the role-ring axis in `internal/tug-button.css` was extended to cover `tinted` (was filled/outlined only) — a focused chip now rings in its agent role colour. at0140 tours all five stops. **Still deferred:** Z2 status-bar cells (STATE/TIME/TOKENS/TASKS/CONTEXT) as an item-group stop — render `cycle.CycleScope` again around the Z2 row (same mode id), orders renumber so Z2 reads top-of-tour. The non-interactive Z4B badges (CLAUDE CODE / PROJECT / SESSION) are display-only and intentionally not stops.

*Where we are.* Working **on `main`** (the user commits; I edit + run checkpoints). Done + committed: 2.5.1 trigger chord `62228934`; 2.5.2 mechanism `fad9abc6`; refinements `8d382f2b`. The at0088 fix is `6e2c8a83`; the Step 2.5 authoring is `73b4784c`. Slice 1 above is **uncommitted**.

*Build / test (CRITICAL — from the repo root, one invocation):* `export TUG_FORCE_BUNDLE_ID=dev.tugtool.app.apptest && just build-app && just app-test <files>`. Without the env var the app-test fails the macOS AX preflight (the grant lives on `dev.tugtool.app.apptest`). `bunx tsc --noEmit` from `tugdeck/`. tsc + app-tests are the gates; appearance is by-eye in both themes. Next AT number: **at0140** (the `app-test-inventory.md` is stale at AT0083 — number by filename; do **not** add a lone inventory entry).

*The proven mechanism (reuse it).* `useCycleMode({ enabled })` in `tugdeck/src/components/tugways/use-cycle-mode.tsx` → `{ cycling, toggle, exit, CycleScope, scopeId }`. The trigger is **⌥⇥** = `TUG_ACTIONS.CYCLE_FOCUS_MODE` (in `action-vocabulary.ts`), bound in `keybinding-map.ts` (`{ key: "Tab", alt: true, scope: "key-card", preventDefaultOnMatch: true }`). **Reference wiring** (copy this shape from `cards/gallery-cycle-demo.tsx`): a `card-content` `useResponder` maps `CYCLE_FOCUS_MODE → toggle`; the card root carries `data-cycling={cycling ? "true" : "false"}`; `CycleScope` wraps the cycle-able zones; each cycle stop is a `focusGroup` focusable with the **commit-home at `focusOrder` 0** (what `focusFirstInMode` seeds); `focusNext` wraps top→bottom, Shift+Tab reverses ([P10]).

*Dev-card integration map (the real consumer).*
- **Card-content responder already exists** in `cards/dev-card.tsx` (`useResponder({ id: \`${cardId}-card-content\`, kind: "card-content", actions: {...} })`, the block that holds `FOCUS_PROMPT` / `CYCLE_PERMISSION_MODE` / `RUN_SLASH_COMMAND`). **Add `[TUG_ACTIONS.CYCLE_FOCUS_MODE]: () => cycle.toggle()` there.** Call `useCycleMode({ enabled: <connected> })` in the dev card (enabled only in the **Connected** state, never the Picker).
- **`CycleScope` + `data-cycling`**: wrap the dev card's content root (it must cover BOTH the transcript pane (Z2) and the prompt pane (Z4/Z5)) and put `data-cycling` on it.
- **Z5 submit + Z4A route live in the SHARED `tug-prompt-entry.tsx`** — the toolbar `<div className="tug-prompt-entry-toolbar" data-tug-focus="refuse">` holds `<TugChoiceGroup … aria-label="Route">` (Z4A, **no `focusGroup` today → not registered**) and `<TugPushButton className="tug-prompt-entry-submit-button" action={SUBMIT} emphasis="filled" role={submitView.danger ? "danger" : "action"}>` (Z5). `data-tug-focus="refuse"` is no-steal-on-click only — it does NOT block `focusGroup` registration. **`TugPushButton`/`TugChoiceGroup` register only when given a `focusGroup`** (both gate on `focusGroup !== undefined`).
- **Z4B permission chip** = `cards/permission-mode-chip.tsx` (`TugPushButton` `emphasis="tinted" role="agent"`). **Z2 status bar** = the `Z2` telemetry status row (cells STATE/TIME/TOKENS/TASKS/CONTEXT) in the transcript pane.

*THE key open design question to resolve first (decide in impl):* how do the **shared** prompt-entry's route + submit join the cycle **without coupling the shared component to the cycle concept or polluting the base mode**? Lean: `tug-prompt-entry` accepts **optional `cycleFocusGroup` + order props** (passed only by the dev card); the dev card **wraps the prompt entry (and status row) in `CycleScope`** so those controls register into the **cycle scope** (modes=[scopeId]) via `FocusModeContext`, NOT the base mode — so they are inert during typing and walked only while cycling. Verify whether `tug-prompt-entry` is dev-card-only vs shared (grep its importers) before choosing unconditional vs prop-gated registration. The editor itself is a **responder** (caret), not a `focusGroup` focusable — it is NOT a cycle stop in this step (editor-as-text-stop is the 2.5.4 concern).

*Per-state default focus ([P12]).* **Connected → editor** is already the seed (`tug-prompt-entry` `paintMirrorAsActive`). **Picker → Open**: `DevProjectPicker` currently `autoFocus`es the `TugFileChooser` (Project path) — move the default focus to the **Open** `TugPushButton` (the picker footer `<TugPushButton emphasis="filled" role="action" onClick={submit}>Open</TugPushButton>`). Transition migration: spawn (picker→connected) seeds the editor; end (connected→picker) seeds Open — wire deliberately, don't rely on mount order.

*Fill-suppression CSS ([P12]).* While `[data-cycling="true"]`, relax the submit's standing `filled-action` to outlined so the promoted fill follows focus; the existing `[data-key-view-kbd]`/`[data-key-cursor]` promotion (Step 2, in `internal/tug-button.css`) re-fills the focused stop; on exit `data-cycling` drops → submit reverts. Pure CSS keyed on the card's `data-cycling` ancestor; **no change to the submit button's component/props** (user-confirmed). Roles: submit=action/danger (already), route=action, chip=agent (already).

*Scope advice (big step — land in coherent commits).* Slice 1: mode plumbing on the dev card (`useCycleMode` + `CYCLE_FOCUS_MODE` handler + `data-cycling` + `CycleScope`) + **Z5 submit as the commit-home stop** + Connected→editor restore + the fill-suppression CSS → a real dev-card cycle end-to-end (at0140). Slice 2: Z4A route as the next stop + Picker→Open default + transition migration. Slice 3 (optional / may defer): Z2 status bar as an item-group stop + Z4B chip. Mark each in the ledger.

*Tests.* at0140: Connected dev card (`bindDevSession` like at0088) → ⌥⇥ → cycle on, key view on the submit (Z5) → Tab → route (when added) → ⌥⇥ → off, caret back in editor. Plus the Picker→Open default. By-eye: fill follows focus (suppressed submit), both themes.

**Depends on:** #step-cycle-mechanism

**Commit:** `focus(cycle): dev-card zones + per-state default focus`

**References:** [P10], [P12], [P09], (#cycle-model)

**Artifacts:** dev-card / prompt-entry registration of the Z-zones (Z2 status group, Z4A route, Z4B indicators incl. the permission chip, Z5 submit) as cycle stops; the per-state default-focus declaration + transition migration.

**Tasks:**
- Register the chrome zones as cycle stops — each a leaf or item-group per [P10] (Tab between zones, arrow within); seed at Z5; forward Tab wraps top→bottom, Shift+Tab reverses ([P10]). *(Done: Z5 submit = commit-home (0), Z4A route item-group (1), Z4B Mode/Model/Effort leaf stops (2/3/4) — submit → route → chips → wrap. Deferred: Z2 status cells.)*
- [x] Declare per-state default focus ([P12]): Picker → Open, Connected → editor; migrate focus deliberately on spawn / end transitions. *(Connected → editor via the cycle-exit layout effect; Picker → Open via the smart latch — focus Open when settled enabled, else the field, never interrupting typing.)*
- [x] Apply per-control roles ([P12]): submit = action (danger while stopping), route = action, permission chip = agent. *(submit = action/danger (unchanged), route = action, the Z4B chips = agent; the role-ring axis now covers `tinted` so a focused chip rings agent.)*
- [x] Add the `[data-cycling]` fill-suppression rule ([P12]): while cycling, the submit's standing `filled` is relaxed to outlined so the fill follows focus (one filled+ringed stop at a time); on exit it reverts to its identity fill. Pure CSS on the card's `data-cycling` signal — no change to the submit button's component / props.
- [x] Z1 transcript excluded ([P10]).

**Tests:**
- Behavior: app-tests — Picker seeds Open; Connected seeds the editor; spawn / end migrates focus; the cycle tours Z5 → (top→bottom) → Z5 and wraps.
- By-eye: the cycle tour shows the focus language (ring / tint / role) across zones, both themes.

**Checkpoint:** `bunx tsc --noEmit` clean; default-focus + cycle app-tests green; by-eye tour clean in brio + harmony.

#### Step 2.5.4: Mode keys + Z2 dedicated chords {#step-cycle-keys}

**Depends on:** #step-cycle-devcard

**Commit:** `focus(cycle): mode keys + Z2 popup chords`

**References:** [P11], [P12], (#cycle-model)

**Artifacts:** the cycle scope's key handling (Return text-entry-only; Space acts; trigger exit); Cmd-1…N popup-toggle chords for the Z2 status-bar cells. A text-input cycle stop in `gallery-cycle-demo` to exercise the Return-into-text exit.

**Tasks:**
- Wire the exit + Return / Space semantics ([P11]): trigger toggles off anywhere; Return drops into a text-input stop (resume typing — also exits cycling) and is inert on non-text controls; Space acts on the focused control. Escape is deferred ([P11]).
- Add a text-input cycle stop to `gallery-cycle-demo` (a `focusGroup` stop wrapping a caret surface) so the Return-into-text exit is exercisable.
- Add Cmd-1…N chords toggling each Z2 cell's popup; confirm they coexist with the existing routes (⇧⌘C / ⇧⌘S) and permission (⇧⌘P) chords.

**Tests:**
- Behavior: app-tests — Return on a text stop drops into typing (no submit) and exits cycling; Space acts on a non-text control; the trigger restores the caret; Cmd-N toggles the Nth Z2 popup.

**Checkpoint:** `bunx tsc --noEmit` clean; mode-key + chord app-tests green.

#### Step 2.5.5: Integration checkpoint + a11y assessment {#step-cycle-vet}

**Depends on:** #step-cycle-trigger-spike, #step-cycle-mechanism, #step-cycle-devcard, #step-cycle-keys

**Commit:** `N/A (verification only)`

**References:** [P09], [P10], [P11], [P12], [P13], [Q03], (#success-criteria, #cycle-model)

**Tasks:**
- End-to-end pass: enter (trigger) → cycle (Tab / arrow) → act (Space / dedicated chord) → exit (Return-into-text / trigger), in both card states, both themes.
- Assess the [P13] a11y corollary: "always-on cycling" = making a toggleable context **persistent** (drop the toggle, push at mount — the [P13] persistent type), which resolves the deferred [Q03]. Record the finding for the a11y follow-on.

**Tests:**
- Behavior: full `just app-test` keyboard sweep green (incl. the new cycle tests); the editor's Tab still completes (no regression — Risk R02 row).
- By-eye: the cycle tour reads as the focus-language showcase on the dev card.

**Checkpoint:** all cycle gates green; the a11y assessment is recorded.

#### Step 2.6: Session-picker keyboard navigation (persistent cycling) {#step-picker-keys}

**STATUS — to design + implement (new, surfaced 2026-06-06).** The connected card cycles (Step 2.5); the **picker** (`DevProjectPicker` / `DevProjectPickerForm`, the "Choose Session" sheet) has **no keyboard navigation** — ⌥⇥ correctly does nothing there, and that stays true. Per [P13] the picker is a **persistent-cycling** context: its only text input is the **single-line** path field, which does not own Tab, so there is no Tab-owner to suspend — the trapped Tab-walk **is** the picker's base mode (always on, no toggle). It is *not* a toggleable cycle like the connected card. The walk is missing today and must be designed + built.

**Depends on:** #step-3 (the recents / sessions lists are the item-group archetype; reuse that focus CSS rather than re-inventing it).

**Commit:** `focus(picker): persistent keyboard navigation for the session picker`

**References:** [P02], [P12], [P13], (#cycle-model — for the per-state contrast: Picker = persistent cycling, Connected = toggleable cycling)

**Design (to settle in a devise/vet pass before building):**
- **Mechanism ([P13] persistent):** the picker pushes a trapped focus mode at open via **`useFocusTrap`** (the persistent-cycling primitive — the same `pushFocusMode({ trapped: true })` the cycle uses, minus the toggle and the editor key-view restore). Its controls register into that mode as cycle stops; there is no ⌥⇥ toggle and no base/editor to return to.
- **Tab order:** Project-path field → Recent Project Paths list → Sessions list → trash-all → Cancel → Open. Each list is one Tab stop with **arrow-roving within** (the [P02]/[#step-3] item-group model — these are `TugListView`s, the list archetype). The single-line path field is an ordinary stop (Tab leaves it; it does not consume Tab).
- **Default focus / seed:** Picker → **Open** when a valid path is seeded (the smart latch already added in [#step-cycle-devcard]); else the path field. Return on Open submits ([P12]).
- **Within-list keys:** ↑/↓ rove; Return opens the roved session (or commits the roved recent into the path field); the per-row trash affordance reachable (Delete key? or a roved trash button) — **open question**.
- **Escape:** Cancel (the sheet's cancel ladder) — confirm against the inline-dialog Escape model.
- **Focus-trap modality:** the picker is pane-modal, so the persistent trap should wrap Tab inside it — reuse the sheet focus-trap machinery (at0106), which is the same `useFocusTrap` mechanism.

**Tasks:** (to expand after the design pass)
- Push the picker's persistent trapped mode at open (`useFocusTrap`); register its controls (path field, the two lists, the action buttons) as stops in that mode so Tab walks them and arrows rove the lists.
- Wire Return/Escape per the design; reach the trash affordances by keyboard.
- App-test: Tab order + arrow-rove + Return-opens-session + Escape-cancels, both themes.

**Checkpoint:** `tsc` clean; picker keyboard app-test green; full keyboard reachability of the picker by-eye.

#### Step 3: Item-groups — radio / choice / option {#step-3}

**Depends on:** #step-1

**Commit:** `focus(groups): behind-tint + cursor ring + native fill, role-aware`

**References:** [P01], [P02], [P03], (#language-contract)

**Artifacts:** `tug-radio-group.css`, `tug-choice-group.css`, `tug-option-group.css`.

**Tasks:**
- Project the behind-tint from `[data-key-view-kbd]` on the group; the ring from `[data-key-cursor]` on the item (offset to survive atop a fill); native fill from the checked/active state (dot / pill / fill) in the role color.
- Remove the old orange-cursor/selection CSS these files carry today.
- **Resolve the double-ring observed on the dev card's route group in cycling** ([#step-cycle-devcard] by-eye): today the selected segment carries its own ring AND, when the group is a cycle stop, the group root carries `[data-key-view-kbd]` + the seeded `[data-key-cursor]` promotes the segment — two rings stacked. The [P02] model is the fix: behind-tint on the group, a single ring on the cursor item only. Verify in the dev card's cycle tour, both themes.

**Tests:**
- Behavior: each group's existing app-tests + `at0030` component-state-preservation green.
- By-eye: exclusive (radio dot / choice pill) and multi (option) per the gallery, incl. danger/accent, both themes.

**Checkpoint:** `tsc` clean; group app-tests green; gallery parity.

#### Step 4: Live / continuous — slider; tab bar (commit-on-act) {#step-4}

**Depends on:** #step-1

**Commit:** `focus(live): slider ring/thumb; tab bar commit-on-act`

**References:** [P01], [P02], [P08], (#p08-tabbar-commit)

**Artifacts:** `tug-slider.css`, `tug-tab-bar.css`, and the TabBar commit-timing change.

**Tasks:**
- Slider: whole-component ring + behind-tint; fill the thumb on focus (role color).
- Tab bar: switch to commit-on-act ([P08]); apply the item-group signature (group tint + cursor ring + native pill fill); update the keyboard-model matrix row note.

**Tests:**
- Behavior: slider app-tests green; **new** app-test — tab bar arrow moves the cursor without committing, act commits.
- By-eye: both, both themes.

**Checkpoint:** `tsc` clean; app-tests (incl. the new tab-bar one) green; gallery parity.

#### Step 5: Descendable rows — list view / row, accordion {#step-5}

**Depends on:** #step-1

**Commit:** `focus(rows): list/accordion behind-tint + cursor ring + native fill`

**References:** [P01], [P02], [P03], (#language-contract)

**Artifacts:** `tug-list-view.css`, `tug-list-row.css`, accordion CSS.

**Tasks:**
- Row cursor ring + native row fill (role color) + the `[data-key-within]` mark on descend; behind-tint on the list/accordion container.
- Replace the current orange row-cursor/selection CSS.

**Tests:**
- Behavior: list-view + accordion app-tests (incl. dev-card picker / transcript regressions) green.
- By-eye: cursor-on-selected-row legibility, descend within-mark, both themes.

**Checkpoint:** `tsc` clean; app-tests green; gallery parity.

#### Step 6: Leaf controls — checkbox, switch, input, textarea, value-input {#step-6}

**Depends on:** #step-1

**Commit:** `focus(leaf): whole-component ring + tint + native fill; input validation→role`

**References:** [P01], [P02], [P03], [P07], (#p07-input-validation)

**Artifacts:** `tug-checkbox.css`, `tug-switch.css`, `tug-input.css`, `tug-textarea.css`, `tug-value-input.css`.

**Tasks:**
- Toggle/switch: whole-component ring (glyph + label) + behind-tint; native blue "on" fill, role-aware.
- Input/textarea/value-input: whole-component ring + behind-tint; map `validation` onto the role axis ([P07]) so invalid focuses danger.

**Tests:**
- Behavior: input/toggle app-tests green.
- By-eye: ring wraps glyph+label; invalid input focuses red; both themes.

**Checkpoint:** `tsc` clean; app-tests green; gallery parity.

#### Step 7: Surfaces / boxes — popover, sheet, alert, inline dialogs, menus {#step-7}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `focus(surfaces): box ring + within; dialog option-rows; menus audit`

**References:** [P01], [P02], [P04], (#language-contract)

**Artifacts:** popover/sheet/alert + inline-dialog shell focus CSS; the inline-dialog **option rows**; a menus audit note.

**Tasks:**
- Box-scope ring (box-shadow hugging the radius, no reflow) + the quiet within variant; behind-tint where the surface allows ([Q02]).
- **Inline-dialog option rows** (the scope/question choices — item-group *items* inside the modal, distinct from the Deny/Allow/Next buttons handled in [#step-2]): give them the item-group treatment from [#step-3] (cursor ring + native fill, role-resolved), replacing the bespoke `[data-key-cursor]` border-recolor in `dev-permission-dialog.css` / `dev-question-dialog.css`.
- **Menus audit (`TugContextMenu`, `internal/tug-popup-menu`):** confirm they are Radix-highlighted and do **not** carry the engine `[data-key-cursor]` attribute, so the global cursor→ring flip ([#step-1]) does not reach them — record this as no-change, or add a scoped override only if the audit finds otherwise.

**Tests:**
- Behavior: surface + dialog + menu app-tests green (Escape/trap/restore unchanged — engine untouched).
- Live-build pass: open each surface and both menus; confirm the box focus + dialog option-row cursor read in both themes; menu highlight unchanged.

**Checkpoint:** `tsc` clean; surface/dialog/menu app-tests green; live-build confirmation; menus audit recorded.

#### Step 8: Links + app-wide focusables {#step-8}

**Depends on:** #step-1

**Commit:** `focus(app): links + title bars / toolbars / prompt / dev panel`

**References:** [P01], [P03], (#r01-mixed-window)

**Artifacts:** `tug-link.css` + app-chrome focus CSS (the long tail the global rule touches).

**Tasks:**
- TugLink: inline ring + behind-tint (underline kept for hover).
- Audit the app-wide focusables the global `[data-key-view-kbd]` rule already paints (title bars, toolbars, prompt entry, dev panel); confirm each reads correctly under the new tokens; add per-surface overrides only where the default ring is wrong.

**Tests:**
- Behavior: existing chrome app-tests green.
- Live-build pass: Tab through the app shell; every stop rings coherently, both themes.

**Checkpoint:** `tsc` clean; app-tests green; live shell Tab-through clean.

#### Step 9: Governance — tuglaws doc + matrix rewrite + governing decision {#step-9}

**Depends on:** #step-3, #step-4, #step-5, #step-6, #step-7, #step-8

**Commit:** `focus(law): focus-language doc + matrix visual column`

**References:** [P01], [P02], [P03], (#language-contract, #token-surface)

**Artifacts:** `tuglaws/focus-language.md`; updated keyboard-model matrix; a governing decision entry.

**Tasks:**
- Author `tuglaws/focus-language.md`: the contract ([#language-contract]), the token surface ([#token-surface]), the role axis, and how a new component declares its focus visuals.
- Rewrite the keyboard-model [Keyboard Behavior Matrix](tugplan-keyboard-model.md#keyboard-matrix) visual column to the new signature; record the governing decision superseding [P03] (promote to `tuglaws/design-decisions.md` if the user wants it global).

**Tests:** n/a (docs) — cross-links resolve; matrix matches shipped behavior.

**Checkpoint:** doc present and accurate; matrix consistent with the implemented components.

#### Step 10: Integration checkpoint + spike-card fate {#step-10}

**Depends on:** #step-2, #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)` (plus a small commit if the spike card is repointed/removed)

**References:** [P01], [Q04], (#success-criteria, #exit-criteria)

**Tasks:**
- Composed-surface pass: a sheet containing a list, a form, and an editor — confirm one coherent focus language across nesting, both themes, keyboard vs mouse.
- Decide [Q04]: repoint `gallery-focus-language` at the real tokens and retitle "Focus language reference", or delete it.

**Tests:**
- Behavior: full `just app-test` sweep green; `bun test` green; `bunx tsc --noEmit` clean.
- By-eye: the [#success-criteria] checklist passes per component, both themes.

**Checkpoint:** all gates green; [#exit-criteria] satisfied; spike-card decision recorded.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The whole app speaks one keyboard-focus visual language — ring + faint behind-tint on the focused component, native fill for selection, all role-resolved (default `action`) — documented in `tuglaws/focus-language.md`, with the focus engine and all behavior unchanged.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every matrix component shows the new focus signature in both themes (gallery checklist).
- [ ] The orange focus axis is retired from the focus path (grep clean).
- [ ] Role-bearing controls ring/fill/tint per role; role-less ride `action` (gallery danger/accent cells).
- [ ] `TugInput` invalid focuses danger; `TugTabBar` commits on act (gallery + live).
- [ ] All `just app-test` keyboard scenarios `VERDICT: PASS`; `bun test` green; `bunx tsc --noEmit` clean.
- [ ] `tuglaws/focus-language.md` exists; the governing decision supersedes keyboard-model [P03]; the matrix visual column is rewritten.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] High-contrast / accessibility-mode focus variant ([Q03]) — with the keyboard-model a11y pass.
- [ ] Broaden component-level `role` props beyond `TugInput`'s validation as real semantic needs arise.
- [ ] The deferred keyboard-model `refuse`/first-responder audit (its `#step-15`).
- [ ] Escape-to-exit cycling mode ([P11]) — deliberately left out of the first cut; add if the trigger / Return-into-text exits prove insufficient.

| Checkpoint | Verification |
|------------|--------------|
| Token foundation | `tsc` clean; app-test sweep green; new ring in both themes |
| Per-component parity | gallery review per archetype, both themes |
| App-wide coherence | live shell Tab-through; composed-surface pass |
| Governance | `tuglaws/focus-language.md` present; matrix consistent |

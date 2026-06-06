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

**Resolution:** DEFERRED to the keyboard-model a11y follow-on (`#roadmap`). This plan must not regress accessibility mode; a dedicated variant is out of scope.

#### [Q04] Fate of the spike card (OPEN → decide in #step-10) {#q04-spike-card}

**Question:** Keep `gallery-focus-language.{tsx,css}` as a living reference, fold its cases into the per-component gallery cards, or delete it?

**Why it matters:** It is a throwaway by design, but it is also the single screen that shows the whole language at once.

**Plan to resolve:** Decide at [#step-10] once the rollout is real. **Lean:** keep it (retitle "Focus language reference") but stop it from drifting by having it consume the real tokens, not its private `--fl-*`. **Resolution:** OPEN.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| App-wide re-skin regresses a shipped surface's focus affordance | high | med | Re-point the global rule first ([#step-1]) so everything stays coherent; per-surface steps; live-build pass | A surface loses/garbles its focus ring |
| Behind-tint clobbers a component background | med | med | One settled layering technique ([Q02]); per-component eye check both themes | Tint hides content or wrong surface |
| Silent visual regressions (pixels not app-tested) | med | med | By-eye gallery review per theme/mode is a required checkpoint; behavior app-tests guard that attributes/behavior didn't move | Reviewer can't tell focus from rest |
| Role-axis adoption balloons into prop churn | med | low | Default `action` means no prop changes for most; only focus CSS moves ([P03]) | A step needs new props on many components |
| Theme contrast: filled role on light vs dark flips text legibility | med | med | Keep the spike's retuned intensities; verify white-on-fill in both themes per step | Text unreadable on a filled selection |

**Risk R01: Mixed-language window during rollout** {#r01-mixed-window}

- **Risk:** Between [#step-1] and the last component step, migrated and un-migrated focusables could show two different focus looks.
- **Mitigation:** [#step-1] re-points the *global* `[data-key-view-kbd]` rule to the new ring axis, so every un-migrated focusable already rings in the new language; per-component steps then add the behind-tint + native-fill refinements. There is never an orange-vs-new split — only "ring only" vs "ring + refinements".
- **Residual risk:** Un-migrated groups show the component ring rather than the cursor-item ring until their step lands; acceptable and self-evidently in-progress.

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

**Implications:** Every step's checkpoint includes the relevant behavior app-tests still `VERDICT: PASS` plus `tsc` clean; appearance is the by-eye add-on. The leaf-vs-group differentiation ([P02]) is handled by per-component CSS overrides, **not** a new engine-projected attribute, to keep this decision intact. (The one deliberate exception across the plan is [P08] TugTabBar commit-on-act — a scoped behavior change, carried with its own app-test.)

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
| #step-2 | TugPushButton keyboard-promoted state; unify inline dialogs | pending | — |
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

#### Step 3: Item-groups — radio / choice / option {#step-3}

**Depends on:** #step-1

**Commit:** `focus(groups): behind-tint + cursor ring + native fill, role-aware`

**References:** [P01], [P02], [P03], (#language-contract)

**Artifacts:** `tug-radio-group.css`, `tug-choice-group.css`, `tug-option-group.css`.

**Tasks:**
- Project the behind-tint from `[data-key-view-kbd]` on the group; the ring from `[data-key-cursor]` on the item (offset to survive atop a fill); native fill from the checked/active state (dot / pill / fill) in the role color.
- Remove the old orange-cursor/selection CSS these files carry today.

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

| Checkpoint | Verification |
|------------|--------------|
| Token foundation | `tsc` clean; app-test sweep green; new ring in both themes |
| Per-component parity | gallery review per archetype, both themes |
| App-wide coherence | live shell Tab-through; composed-surface pass |
| Governance | `tuglaws/focus-language.md` present; matrix consistent |

## Dash UI: identity grammar, badge elision, Lens sub-rows {#dash-ui}

**Purpose:** Make a dash-bound session legible everywhere a session shows its identity — the masthead, the Lens, the session atom — through one shared grammar instead of per-surface badges, and fix the badge-elision bug that made the current chip clip both ends of the dash name.

This plan implements the decisions recorded in [roadmap/dash-ui-report.md](dash-ui-report.md): the `TugBadge` elision fix, a session-keyed `dashForSession` lookup, a dash run in the session identity grammar (glyph+name on the line tier, glyph-only on the atom), Lens dash sub-rows under bound sessions, and the Dashes section dieting down to a roster.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugdash/dash-ui |
| Last updated | 2026-08-15 |

---

### Review Record {#review-record}

**Round 1 — 2026-08-15, fable.** Reviewed `plan:d05679fe8253f805`. Lint: 0 errors, 1 warning (this section resolves it).
Oriented on: the whole document — first pass, same turn as authorship, against the real code (`tug-badge.tsx`/`.css`, `tug-session-identity.tsx`/`.css`, `session-masthead.tsx`, `cards-data-source.ts`, `cards-section.tsx`, `cards-session-cell.tsx`, `dashes-section.tsx`, `changeset-all-store.ts`, `changeset-types.ts`, at0406).
Applied: test-plan sanity — Step 1's elision pin was hedged ("or defer"); rewritten as a falsifiable at0406 extension using a dash name longer than the chip's 12ch cap, with the both-ends-clip failure mode asserted directly, after checking that the shipped fixture's name (`at0406-chip`) never exercises elision. Sequencing — `dashRun={false}` in `cards-session-cell.tsx` moved from Step 3 to Step 4 so a Lens session row is never dash-blind between the two steps landing. Test-plan concreteness — the atom-glyph pin's three candidate homes replaced with one: a new `at04xx` with named `@covers`. Tuglaws cross-check: [L02] every new read (`useDashForSession`, the `changesets` input) enters through `useSyncExternalStore`-backed hooks; [L06] the review tint and badge elision are CSS on attributes; [L11]/[L30] sub-row activation reuses the `focus-session-card` dispatch; [L19] the sub-row composes `TugListRow` under the existing `TugListView`; the State Zone Mapping covers each. Verified the id spaces line up (`bound_sessions` and `identity.id` are both tug session ids) and that `visibleOrder()`/reorder are untouched by non-pane rows.
Deferred: nothing — no open questions were raised or carried.

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dash infrastructure (binding, lifecycle, plan adoption, join mode) landed across four phases, but the UI that shows a dash grew up as per-surface improvisations. The masthead renders a `TugBadge` chip in the title line's trailing slot (`session-masthead.tsx`, `slots=` prop) that clips the dash name off *both ends* with no ellipsis — the CSS at `session-masthead.css` (`.session-masthead-dash-chip`) asks for `text-overflow: ellipsis`, but `TugBadge`'s root is `display: inline-flex; justify-content: center` (`tug-badge.css`), and `text-overflow` is inert on a flex container: the text lives in an anonymous flex item, the ellipsis never paints, and centering clips symmetrically. The Lens has a standalone **Dashes** section (`lens/sections/dashes-section.tsx`) disconnected from the sessions working the dashes. Session atoms (`tug-session-identity.tsx` chip tier) and the Gazette's citations show nothing dash-related at all.

Two stores answer "what dash is this?" today and neither serves the surfaces that need it: `cardSessionBindingStore.getBinding(cardId)?.dash` is **card-keyed** (the masthead's read), and `ChangesetAllStore`'s dash entries carry `bound_sessions` **per dash** (the Lens section's read). No **session-keyed** lookup exists — which is exactly what an atom, a Gazette ref, or a Lens sub-row holds: a session id and no card.

#### Strategy {#strategy}

- Fix elision inside `TugBadge` itself so no call site can reproduce the both-ends clip — every badge in the app benefits.
- Build the one session-keyed read (`dashForSession`) as a pure projection over the `ChangesetAllStore` snapshot — derived on every read, no second store, no new feed (the [D138] discipline).
- Fold the dash into the identity grammar: `TugSessionIdentity` grows a third run — glyph+name on the line tier, glyph-only marker on the chip tier — and the masthead's trailing badge is deleted. Every line-tier surface (masthead, Lens rows, picker) inherits the run by construction.
- Nest a dash sub-row under its bound session's row in the Lens Cards section, as a new row kind in the existing flat projection (`buildCardsRows`).
- Keep the Dashes section as the account-global roster, dieted: its per-session jump chips are redundant once the sub-rows exist.
- Sequence so each step is independently shippable and testable: badge fix → selector → grammar → sub-rows → diet → integration.

#### Success Criteria (Measurable) {#success-criteria}

- A `TugBadge` narrower than its text paints a trailing ellipsis, never a both-ends clip (app-test asserts `scrollWidth > clientWidth` implies visible ellipsis via `text-overflow` on the measured text span; pinned in the rewritten at0406).
- Binding a dash via the real CLI (`tugutil dash bind`) makes the masthead title line show ` ⎇ <dash-name>` with no card reload and no masthead height change; unbinding removes it (at0406 rewritten to pin the run instead of the chip).
- A session atom for a dash-bound session shows the `⎇` glyph; the same atom for an unbound session does not (app-test).
- The Lens Cards section shows one indented `git-branch` sub-row under each session row whose session is in a dash's `bound_sessions`, carrying name, stage, `step i/N`, and the review mark (pure test on `buildCardsRows` + app-test).
- The Lens Dashes section renders no per-session jump chips; its rows, ordering, and collapsed summary are otherwise unchanged (updated `dashes-section.test.ts` + at0407).
- `bunx tsc --noEmit`, `bunx vite build`, and the derived app-test selection (`just app-test-changed`) are green.

#### Scope {#scope}

1. `TugBadge` single-line text elision (component + CSS).
2. `dashForSession` session-keyed projection over the changeset aggregate.
3. The dash run in `TugSessionIdentity` (both tiers), the review tint on it, the tooltip line, and deletion of the masthead badge.
4. `dash-subrow` row kind in the Lens Cards projection and its cell renderer.
5. Dashes-section diet: remove jump chips.
6. Test updates: at0406 rewrite, at0407 update, `cards-data-source.test.ts` and `dashes-section.test.ts` extensions, new pure tests for the index.

#### Non-goals (Explicitly out of scope) {#non-goals}

- The Z4A Join route / join-mode composer polish (its own later pass, per the report).
- Entry-point discoverability for dash workflows (deferred by agreement).
- Section-row activation opening the Changes shade at the dash entry (named follow-on).
- The divergence chip on the Changes card's dash entry (named follow-on from the plan-adoption phase).
- Any change to `sessionCitation` — the flat citation string stays dash-free ([P03]).
- Server/tugcast changes — everything here reads facts the `CHANGESET_ALL` feed already carries.

#### Dependencies / Prerequisites {#dependencies}

- The dash changeset entry already carries `bound_sessions`, `stage`, `step_current`/`step_total`, and `review` (`tugdeck/src/lib/changeset-types.ts`, `DashChangesetEntry`) — shipped in the dash-integration phases.
- App-test dash fixtures exist: `tests/app-test/dash-fixture.ts` (`createDash`, `recordStampedPlan`, `makePlanStale`, `releaseDash`).

#### Constraints {#constraints}

- Tuglaws for all tugdeck work; the laws each change touches are named in the commit body ([L02], [L03], [L06], [L13], [L19]).
- No `localStorage`; no new persisted state is introduced by this plan.
- Warnings are errors (`bunx tsc --noEmit` clean; `-D warnings` for any Rust, though no Rust moves here).
- App-tests run via `just` recipes only, never piped; selection via `just app-test-changed`.
- The debug app loads the prod rollup bundle — `bunx vite build` before declaring tugdeck work done.

#### Assumptions {#assumptions}

- A session is bound to at most one dash at a time (the card binding holds a single `dash`); if a malformed snapshot ever lists one session under two dashes, first-in-project-order wins deterministically ([P02]).
- The `CHANGESET_ALL` feed updates `bound_sessions` on bind/unbind with no reload (at0406 and at0407 already rely on this).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

None. The design forks (parked-dash disposition, run loudness per tier, section retention) were settled in the discussion recorded in [roadmap/dash-ui-report.md](dash-ui-report.md) and appear below as decisions.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Flex-elision regressions in existing badges | med | low | wrapper span only in single-line layout; gallery + existing app-tests | any badge visually truncating where it previously fit |
| Identity surfaces re-rendering on every changeset beat | low | low | per-snapshot memoized index; hook returns stable fact | typing-lag telemetry regression |
| Sub-rows disturbing Lens reorder | med | low | sub-rows are not pane rows; `visibleOrder()` derives from pane rows only | reorder drag aborting silently |

**Risk R01: Badge wrapper changes existing badge layouts** {#r01-badge-wrapper}

- **Risk:** Wrapping single-line badge content in a text span could alter baseline or gap behavior at the ~dozens of existing `TugBadge` call sites.
- **Mitigation:** The wrapper is a plain inline flex item with `min-width: 0` — it only constrains when a mount site constrains the badge, which today produces the clip bug; unconstrained badges keep their shrink-to-fit width. Verify in the gallery cards (`gallery-*`) and let `just app-test-changed` sweep the affected suites.
- **Residual risk:** A call site that relied on the both-ends-clip appearance (none known) would change appearance.

**Risk R02: Changeset-driven wakes on identity surfaces** {#r02-changeset-wakes}

- **Risk:** `TugSessionIdentity` mounting a `useDashForSession` subscription puts every atom and title on the changeset aggregate's beat.
- **Mitigation:** The index is built once per snapshot (memoized on snapshot identity) and the hook's selector returns the per-session fact, which is reference-stable for unchanged sessions; `useSyncExternalStore` then skips re-render when the selected value is unchanged. The aggregate itself moves on changeset edits, not per-keystroke.
- **Residual risk:** A deck with hundreds of visible atoms re-runs the cheap map lookup per atom on each aggregate beat.

**Risk R03: Sub-row ids colliding or breaking list identity** {#r03-subrow-ids}

- **Risk:** A dash bound to two sessions renders two sub-rows; a dash owner key alone would collide as a list id.
- **Mitigation:** Sub-row list id is `dash:<ownerId>:<paneId>` ([P04]) — unique per mount by construction.
- **Residual risk:** None identified.

---

### Design Decisions {#design-decisions}

#### [P01] Badge elision is fixed inside TugBadge, not at call sites (DECIDED) {#p01-badge-elision}

**Decision:** `TugBadge`'s single-line layout wraps its non-icon children in an inner `.tug-badge-text` span carrying `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; the two-line layout's existing `.tug-badge-label` / `.tug-badge-content` spans gain `min-width: 0` and the same overflow treatment on their text.

**Rationale:**
- `text-overflow` on a flex container is inert — the text is an anonymous flex item and never elides; `justify-content: center` then clips both ends (the at0406 screenshot bug). This is the standing inline-flex-cannot-elide trap; the fix belongs where the flex container is.
- Fixing the component means no future call site can reproduce the bug; fixing the masthead's mount would fix one of many.

**Implications:**
- `.session-masthead-dash-chip`'s own ellipsis rules become redundant (and the chip itself is deleted in [P03] anyway).
- Unconstrained badges are unaffected: `min-width: 0` only matters when an ancestor constrains the badge's width.

#### [P02] dashForSession is a pure projection over the changeset snapshot (DECIDED) {#p02-dash-for-session}

**Decision:** A new `tugdeck/src/lib/dash-session-index.ts` exports `buildDashSessionIndex(snapshot): ReadonlyMap<string, DashSessionFact>` (pure), `dashSessionIndex(snapshot)` (the same, memoized on snapshot identity), and `useDashForSession(sessionId): DashSessionFact | null` (subscribed via `useChangesetAll`). `DashSessionFact` is `{ ownerId, name, stage, review, projectDir }` projected from `DashChangesetEntry` (`owner_id`, `display_name`, `stage ?? null`, `review ?? null`, plus the owning project's dir).

**Rationale:**
- Follows [D138]: anything derivable from an existing aggregate is derived on every read — no second store, no feed, no lifecycle.
- One selector means bind/unbind repaints every surface at once, the same liveness custom names already have.

**Implications:**
- Iteration order over `snapshot.projects` makes first-wins deterministic if a session ever appears under two dashes.
- The memo is a module-level `WeakMap<WorkspacesChangesetSnapshot, ReadonlyMap<…>>` — snapshot identity is the cache key, so a new snapshot rebuilds once and every reader shares it.

#### [P03] The dash joins the identity grammar as a third run; the citation string stays dash-free (DECIDED) {#p03-dash-run}

**Decision:** `TugSessionIdentity` reads `useDashForSession(identity.id)` and renders a dash marker after the title runs: on the **line tier**, a lucide `GitBranch` glyph at text size plus the dash name, in the callsign's muted register, inside the title's elision box; on the **chip tier** (the atom), the glyph alone, with "on dash <name>" added to the hover tooltip. `sessionCitation` and `sessionIdentityLine` are untouched. The masthead's `TugBadge` chip, its CSS block, and the masthead's `dashName` / `dashOwnerId` / `useDashReviewState` reads are deleted; the review tint moves onto the run (a `data-review` attribute on the marker; caution tone for `stale`, dashed/dotted treatment for `never-reviewed`; CSS only, [L06]).

**Rationale:**
- A dash is the same *kind* of fact as the project — where the session is working — so it belongs in the title grammar, not in a slot fighting pane chrome for space.
- The binding is temporary; the citation is the durable flat-text form that outlives it in pastes and commits. A citation carrying a dash would rot.
- The line tier is composed by `SessionIdentityRow`, so the masthead, the Lens Cards session rows, and the session picker inherit the run with zero per-surface work.

**Implications:**
- Elision priority on the line tier: the name survives; the dash run elides before the callsign does (the run takes `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` + a `max-inline-size` cap in ch units; the callsign keeps `flex: none` in title contexts). Exact cap tuned in the gallery.
- at0406 is rewritten around the run (see #step-3); its no-reflow and no-collision pins carry over.
- The marker mounts as a leaf subscription in `TugSessionIdentity` — the same pattern as `SessionPrivacyMarker`.

#### [P04] Lens dash sub-rows are a new row kind in the existing Cards projection (DECIDED) {#p04-lens-subrow}

**Decision:** `CardsRow` gains a `{ type: "dash-subrow" }` variant emitted by `buildCardsRows` immediately after any `pane` row whose `identity.tugSessionId` resolves through the dash index; `LensCardsInputs` gains `readonly changesets: WorkspacesChangesetSnapshot | null`, included in `setInputsWithoutNotify`'s equality check; the row's list id is `dash:<ownerId>:<paneId>`; its `kindOfRow` key is `"dash-subrow"`, registered in `CARDS_CELL_RENDERERS`. The cell renders indented under the session row: `GitBranch` glyph, dash name, stage word, `step i/N` when both halves are present, and the review mark. Activation and select front the session's card (the same `focus-session-card` dispatch as the row above it). Sub-rows are not drag handles and never appear in `visibleOrder()`.

**Rationale:**
- The Cards section's row model is already a flat typed list dispatched by kind through `TugListView` — a new kind is the native extension point, not a parallel structure.
- The sub-row states a fact *about the session above it*; a dash bound to two sessions truthfully appears under each.

**Implications:**
- `cards-section.tsx` reads `useChangesetAll()` and threads the snapshot into the inputs — one more `useSyncExternalStore` read on a surface that already has five ([L02]).
- The sub-row suppresses nothing: when the group is collapsed or the pane row is filtered out, the sub-row goes with it (it is only emitted after a surviving pane row).
- Filtering: the sub-row's dash name joins its session row's match fields, so a dash name query finds the session working it.

#### [P05] Lens Cards session rows suppress the title's dash run (DECIDED) {#p05-suppress-run-in-lens}

**Decision:** `TugSessionIdentity` gains a `dashRun` prop (default `true`), threaded through `SessionIdentityRow`; `cards-session-cell.tsx` passes `dashRun={false}`.

**Rationale:**
- With [P04], the Lens session row would show ` ⎇ <dash>` in its title and a richer dash sub-row directly beneath it — the same fact twice within 20px. The sub-row wins: it carries stage, steps, and review, which the run does not.
- The suppression is one prop; if iteration decides the run should show everywhere, the default already says so.

**Implications:**
- The masthead and the session picker keep the run (they have no sub-row).

#### [P06] The Dashes section stays as the roster and sheds its jump chips (DECIDED) {#p06-section-diet}

**Decision:** `dashes-section.tsx` keeps its registration, ordering ([P02] of the dash-integration phase — `compareDashRows`), collapsed summary, phase dot / parked mark, name, stage, steps, review mark, and project label. `DashSessionJump` and the `lens-dashes-jumps` trailing block are deleted. Row activation still fronts the first bound session's card (unchanged).

**Rationale:**
- Settled in discussion: parked dashes must stay findable in the Lens, so the section survives as the account-global roster; a worked dash appearing both here and as a sub-row is two contexts answering two questions.
- The jump chips duplicated what the sub-row now does better — the sub-row *is* at the session.

**Implications:**
- `dashes-section.test.ts` drops its jump-chip assertions; at0407 drops its jump-chip pins.
- Opening the Changes shade at the dash entry from a section row is a follow-on, not this plan.

---

### Deep Dives (Optional) {#deep-dives}

#### Where each surface gets its dash fact today vs. after {#fact-sources}

| Surface | Today | After |
| --- | --- | --- |
| Masthead | `cardSessionBindingStore.getBinding(cardId)?.dash` + `useDashReviewState` | the identity's own `useDashForSession(identity.id)` — masthead-specific reads deleted |
| Lens Cards rows | nothing | sub-row from `inputs.changesets` via the index; title run suppressed ([P05]) |
| Lens Dashes section | `useChangesetAll()` per-dash entries | unchanged |
| Session atoms / Gazette citations | nothing | glyph marker from `useDashForSession(identity.id)` |

The card-keyed binding read stays authoritative where a *card* is the subject (the dash lane's verbs, join mode); this plan only changes *identity display* surfaces, which are session-subject.

#### The elision mechanics on the title line {#elision-mechanics}

`tug-session-identity.css` title contexts today: the name span has `min-width: 0; overflow: hidden; text-overflow: ellipsis` and a `max-width` interplay; the callsign is `flex: none` (it survives). The dash run slots in as a third sibling with `flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-inline-size: <cap>ch`. Because the run has both a shrink basis and a cap, a squeeze takes the dash name down to its ellipsis before the flex algorithm starts starving the name span, giving the stated priority: name survives, dash elides first, callsign never. The chip tier renders no name run at all (glyph only), so the atom's existing inversion (user's words survive, callsign elides) is untouched.

---

### Specification {#specification}

**Spec S01: DashSessionFact** {#s01-dash-session-fact}

```ts
/** What one session's dash binding looks like to an identity surface. */
export interface DashSessionFact {
  /** The dash's owner key — unique per incarnation of a reused name. */
  readonly ownerId: string;
  /** The dash's display name. */
  readonly name: string;
  /** Derived lifecycle stage, or null from a sender that sends none. */
  readonly stage: string | null;
  /** `reviewed` | `stale` | `never-reviewed`, or null when unknown / no plan. */
  readonly review: string | null;
  /** The owning project's directory (`project.project_dir` from the snapshot). */
  readonly projectDir: string;
}
```

Built by walking `snapshot.projects`, then each project's `changesets` filtered to `kind === "dash"`, then each entry's `bound_sessions ?? []`; the map is keyed by session id; an already-present key is skipped (first wins).

**Spec S02: the dash-subrow row shape** {#s02-dash-subrow-shape}

```ts
| {
    readonly type: "dash-subrow";
    readonly group: LensCardsGroup;          // the session row's group
    readonly paneId: string;                 // the session row's pane
    readonly cardId: string;                 // the session row's card, for activation
    readonly dash: DashSessionFact;          // identity + tint
    readonly steps: string | null;           // "step i/N" preformatted, or null
  }
```

`steps` is formatted at projection time from `step_current` / `step_total` exactly as the Dashes section does (both halves present or null) — the sub-row and the section cannot drift because both format from the same entry fields. `idOfRow` returns `dash:<ownerId>:<paneId>`; `kindOfRow` returns `"dash-subrow"`.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| session→dash index | derived external state | pure projection over `useChangesetAll` snapshot, memoized per snapshot; `useSyncExternalStore` underneath | [L02] |
| dash run / marker visibility | structure (mount/unmount on fact presence) | React render from the subscribed fact | [L02] |
| review tint on the run | appearance | `data-review` attribute + CSS | [L06] |
| badge text elision | appearance | CSS on the new `.tug-badge-text` span | [L06] |
| Lens sub-rows | derived external state | `changesets` input into `buildCardsRows` recompute | [L02] |
| sub-row activation | command | `focus-session-card` dispatch | [L11] |
| list composition | — | `TugListView` cell renderer, no hand-rolled focus | [L19] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/dash-session-index.ts` | `DashSessionFact`, `buildDashSessionIndex`, `dashSessionIndex`, `useDashForSession` |
| `tugdeck/src/lib/__tests__/dash-session-index.test.ts` | pure tests for the projection |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `.tug-badge-text` | CSS class + span | `tug-badge.tsx` / `tug-badge.css` | [P01]; single-line face text wrapper |
| `DashSessionFact` | interface | `lib/dash-session-index.ts` | Spec S01 |
| `buildDashSessionIndex` | fn | `lib/dash-session-index.ts` | pure; exported for tests |
| `dashSessionIndex` | fn | `lib/dash-session-index.ts` | WeakMap-memoized per snapshot |
| `useDashForSession` | hook | `lib/dash-session-index.ts` | subscribed read |
| `SessionDashMarker` (or inline run) | component | `tug-session-identity.tsx` | [P03]; both tiers; leaf like `SessionPrivacyMarker` |
| `dashRun` | prop | `tug-session-identity.tsx`, `session-identity-row.tsx` | [P05]; default `true` |
| `.tug-session-identity-dash` | CSS | `tug-session-identity.css` | run + marker + `[data-review]` tints |
| masthead dash chip | **delete** | `session-masthead.tsx`, `session-masthead.css` | the `slots=` badge, `.session-masthead-dash-chip` rules, `dashName`/`dashOwnerId`/`useDashReviewState` reads |
| `CardsRow` `"dash-subrow"` variant | type | `lens/sections/cards-data-source.ts` | Spec S02 |
| `LensCardsInputs.changesets` | field | `lens/sections/cards-data-source.ts` | + equality in `setInputsWithoutNotify` |
| `DashSubrowCell` | renderer | `lens/sections/cards-section.tsx` (or a small sibling file) | registered as `"dash-subrow"` |
| `DashSessionJump`, `.lens-dashes-jumps` | **delete** | `lens/sections/dashes-section.tsx` / `.css` | [P06] |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (bun:test, pure)** | projection logic: the index, `buildCardsRows` emission, formatting | Steps 2, 4, 5 |
| **App-test (real app)** | what only the real render can show: elision pixels, run appearance on bind, sub-row presence, no-reflow | Steps 1, 3, 4, 5 |

#### What stays out of tests {#test-non-goals}

- No fake-DOM / RTL render tests and no mock-store assertion tests — banned shapes (dash-work-doctrine). Everything DOM-shaped goes through `just app-test`.
- The WeakMap memo's cache behavior — an implementation detail; the observable contract (same snapshot → same map identity) is one assertion, not a suite.
- The exact `ch` cap on the dash run — tuned visually in the gallery; a pixel pin would be brittle across font changes.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | TugBadge learns to elide | done | `85ed6dd09` |
| #step-2 | The session-keyed dash index | done | `2a640526d` |
| #step-3 | The dash run in the identity grammar | done | `4253a837c` |
| #step-4 | Lens dash sub-rows | done | `a903b6ad8` |
| #step-5 | The Dashes section diet | done | `eb2d075f6` |
| #step-6 | Integration checkpoint | done | `1dcd0d93e` |

#### Step 1: TugBadge learns to elide {#step-1}

**Commit:** `tugways(tug-badge): elide single-line badge text with an ellipsis instead of clipping both ends`

**References:** [P01] Badge elision inside TugBadge, Risk R01, (#context, #elision-mechanics)

**Artifacts:**
- `.tug-badge-text` wrapper span in `tug-badge.tsx`'s single-line `buildFace`; `min-width: 0` + overflow/ellipsis rules in `tug-badge.css` for it and for the two-line `.tug-badge-label` / `.tug-badge-content` text.

**Tasks:**
- [ ] In `buildFace` (single-line branch), wrap `faceContent` in `<span className="tug-badge-text">`; leave the icon a sibling.
- [ ] Add the CSS: `.tug-badge-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`; give the two-line layout's label/content spans `min-width: 0` and the same overflow treatment.
- [ ] Sweep the gallery badge surfaces (`gallery-*` cards) visually via the running debug instance for unchanged rest appearance.

**Tests:**
- [ ] Extend at0406 (pre-rewrite, still pinning the chip): bind a dash whose name exceeds the chip's `max-inline-size: 12ch` cap (the fixture's current `at0406-chip` is under it, so the shipped test never exercises elision) and assert the chip elides with a trailing ellipsis — `.tug-badge-text` has `scrollWidth > clientWidth`, computed `text-overflow` is `ellipsis`, and the rendered text's leading characters are the dash name's leading characters (a both-ends clip fails this last check). The Step-3 rewrite retires this pin into the run's.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 2: The session-keyed dash index {#step-2}

**Commit:** `tugdeck(dash-session-index): one session-keyed read for "what dash is this session on"`

**References:** [P02] dashForSession projection, Spec S01, Risk R02, (#fact-sources)

**Artifacts:**
- `tugdeck/src/lib/dash-session-index.ts`, `tugdeck/src/lib/__tests__/dash-session-index.test.ts`.

**Tasks:**
- [ ] Implement `DashSessionFact`, `buildDashSessionIndex`, `dashSessionIndex` (WeakMap memo keyed on snapshot identity), `useDashForSession` (via `useChangesetAll`, selecting from the memoized map).
- [ ] Project `stage ?? null` and `review ?? null`; take `projectDir` from the owning project record.

**Tests:**
- [ ] Empty snapshot → empty map; a dash with two `bound_sessions` → both keys map to the same fact object.
- [ ] A session listed under two dashes → first-in-project-order wins.
- [ ] `dashSessionIndex(snapshot) === dashSessionIndex(snapshot)` (same identity), and a new snapshot yields a new map.
- [ ] Entries with `bound_sessions` absent contribute nothing.

**Checkpoint:**
- [ ] `cd tugdeck && bun test dash-session-index`
- [ ] `cd tugdeck && bunx tsc --noEmit`

---

#### Step 3: The dash run in the identity grammar {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `tugways(session-identity): the dash rides the title as a third run; the masthead badge is deleted`

**References:** [P03] dash run, [P05] dashRun prop, Spec S01, Risk R02, (#elision-mechanics, #fact-sources)

**Artifacts:**
- The run/marker in `tug-session-identity.tsx` + `.css`; the `dashRun` prop threaded through `session-identity-row.tsx`; masthead deletions in `session-masthead.tsx` + `.css`; `cards-session-cell.tsx` passing `dashRun={false}`; at0406 rewritten (rename to `at0406-masthead-dash-run.test.ts`).

**Tasks:**
- [ ] In `TugSessionIdentity`, read `useDashForSession(identity.id)` (skip when `missing` — an unresolvable citation has no live binding to show). Line tier renders the glyph+name run after the callsign run; chip tier renders the glyph-only marker beside the privacy marker; both wear `data-review` when `dashReviewPaints` says so, tinted by CSS.
- [ ] Add "on dash <name>" to `identityTooltip`'s content when the fact is present (the tooltip is built in the same component and can take the fact as an argument).
- [ ] Elision CSS per (#elision-mechanics): run shrinks and ellipsizes before the name; callsign untouched.
- [ ] Thread `dashRun` (default `true`) through `SessionIdentityRow` to `TugSessionIdentity`. Do **not** pass `false` from `cards-session-cell.tsx` in this step — the suppression lands in #step-4 together with the sub-row that replaces it, so a Lens session row is never dash-blind in between.
- [ ] Delete from the masthead: the `slots=` badge block, the `dashName` / `dashOwnerId` `useSyncExternalStore` reads, the `useDashReviewState` call, the `dashReviewPaints`/`dashReviewTooltip` imports, and the `.session-masthead-dash-chip` CSS rules.
- [ ] Rewrite at0406 around the run: bind via real CLI → run appears with the dash name, no masthead height change, no collision with pane controls; `makePlanStale` → the run's `data-review` tint appears; unbind → run gone. Update its `@covers` lines (`tug-session-identity.tsx` joins them).

**Tests:**
- [ ] at0406 rewrite as above.
- [ ] A new app-test at the next free `at04xx` slot (`@covers tugdeck/src/components/tugways/tug-session-identity.tsx`, `tugdeck/src/lib/dash-session-index.ts`): a session atom in a real surface shows the `⎇` glyph while its session is dash-bound and loses it on unbind, and `Copy as Citation` writes the same string bound or unbound.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 4: Lens dash sub-rows {#step-4}

**Depends on:** #step-2

**Commit:** `tugdeck(lens): a dash nests as an indented sub-row under the session working it`

**References:** [P04] sub-row row kind, [P05] dashRun suppression, Spec S02, Risk R03, (#fact-sources)

**Artifacts:**
- The `"dash-subrow"` variant + emission in `cards-data-source.ts`; `changesets` input; `DashSubrowCell` renderer + CSS; `cards-section.tsx` wiring; extended `cards-data-source.test.ts`; a new app-test.

**Tasks:**
- [ ] Add the variant (Spec S02) to `CardsRow`, `kindOfRow`, `idOfRow`; emit after each surviving `pane` row whose `identity.tugSessionId` hits `dashSessionIndex(inputs.changesets)`; format `steps` at projection time.
- [ ] Add `changesets` to `LensCardsInputs` and to `setInputsWithoutNotify`'s equality chain; `cards-section.tsx` reads `useChangesetAll()` and threads the snapshot.
- [ ] Add the dash name to the session pane row's match fields so filtering by dash name keeps the session (and its sub-row) visible.
- [ ] `DashSubrowCell`: indented `TugListRow` (flush/compact like the section rows), `GitBranch` glyph leading, name + stage + steps + review mark; select/activate dispatch `focus-session-card` with the row's `cardId`; no drag handle, no `data-lens-row-id`.
- [ ] Pass `dashRun={false}` from `cards-session-cell.tsx` ([P05]) — the sub-row now carries the fact the run would duplicate.
- [ ] Confirm `visibleOrder()` and reorder are untouched (they walk `type === "pane"` only).

**Tests:**
- [ ] `cards-data-source.test.ts`: a bound session pane row is followed by its sub-row; an unbound one is not; two panes bound to one dash yield two sub-rows with distinct ids; collapsed group emits neither; filter by dash name keeps the pair; `changesets: null` emits no sub-rows.
- [ ] New app-test (with `@covers` for `cards-data-source.ts` + `cards-section.tsx`): real `dash bind` → sub-row appears under the session row in the Lens with the `git-branch` glyph; unbind → gone.

**Checkpoint:**
- [ ] `cd tugdeck && bun test cards-data-source && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 5: The Dashes section diet {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(lens): the Dashes section slims to a roster — jump chips retired by the sub-rows`

**References:** [P06] section diet, (#fact-sources)

**Artifacts:**
- `dashes-section.tsx` / `.css` with `DashSessionJump` and the trailing jumps block removed; updated `dashes-section.test.ts`; updated at0407.

**Tasks:**
- [ ] Delete `DashSessionJump`, the `trailing=` jumps block, and the `lens-dashes-jump*` CSS; keep dot/parked, name, stage, steps, review, project label, ordering, collapsed summary, and row activation (front the first bound session's card).
- [ ] Update `dashes-section.test.ts` and at0407 to drop jump-chip assertions and pin the surviving shape.

**Tests:**
- [ ] `dashes-section.test.ts` green with no jump-chip references.
- [ ] at0407 green pinning the dieted row.

**Checkpoint:**
- [ ] `cd tugdeck && bun test dashes-section && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 6: Integration checkpoint {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [P01]–[P06], (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Walk the whole loop against the debug instance: bind a dash from the Session card's shell route → masthead run, atom glyph, Lens sub-row, and roster row all present; stale the plan → tints appear in run and sub-row; unbind → all four revert; the Dashes section still lists a parked dash nothing is bound to.

**Tests:**
- [ ] The full derived selection: `just app-test-changed` over the phase's cumulative diff.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test-changed`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A dash-bound session is legible at every identity register — masthead title run, atom glyph, Lens sub-row — from one session-keyed read, with the badge-clip bug dead and the Dashes section serving as the account-global roster.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] No `TugBadge` anywhere clips text off both ends; a constrained badge shows a trailing ellipsis (at0406 pin).
- [ ] The masthead's dash chip is gone; the title carries the ` ⎇ <dash>` run with the review tint (at0406 rewrite green).
- [ ] Atoms mark dash-bound sessions with the glyph; citations are byte-identical to before (atom app-test green).
- [ ] The Lens shows the sub-row under bound sessions and the dieted roster section, both live on bind/unbind (Step 4/5 tests green).
- [ ] `bun test`, `bunx tsc --noEmit`, `bunx vite build`, and `just app-test-changed` all green.

**Acceptance tests:**
- [ ] at0406 (rewritten), at0407 (updated), the new Lens sub-row app-test, and the atom-glyph pin.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Section-row activation opening the Changes shade at the dash entry.
- [ ] The divergence chip on the Changes card's dash entry (base plan dirt at a glance).
- [ ] The Z4A Join route / join-mode composer polish pass.
- [ ] Entry-point discoverability for starting dashes from the surfaces that show them.

| Checkpoint | Verification |
|------------|--------------|
| Types + bundle | `cd tugdeck && bunx tsc --noEmit && bunx vite build` |
| Pure logic | `cd tugdeck && bun test` |
| Real app | `just app-test-changed` |

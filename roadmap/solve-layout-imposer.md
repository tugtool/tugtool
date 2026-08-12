<!-- devise-skeleton v4 -->

## Solve Layout Imposition — the deterministic per-rail allocator {#solve-layout-imposer}

**Purpose:** Replace the space allocator's graded licence and shared-rail-width rule with a deterministic, closed-form, per-rail solver built on lexicographic invariants (floors → no-overlap → greed-ordered fill toward preferences → ceilings), give the Gazette a typographically derived width (56–64ch at a bumped font size), and pin the whole solution space with an exhaustively generated golden table.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | implemented (awaiting user vetting on the debug build) |
| Target branch | main |
| Last updated | 2026-08-12 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The layout imposer has two layers. Layer A — placement — is already solved: a slot is an anchor at a fixed travel fraction of the band, emitted as CSS `calc()`, and nothing in this plan touches it. Layer B — the space allocator (`allocateSidebarWidths` in `tugdeck/src/lib/layout-imposer.ts`) — has a closed-form least-squares core (`solveSidebarWidths`) wrapped in a heuristic acceptance policy: a three-grade licence judged against a 2px `seamPicture` tolerance, a soft floor at 20% under the chosen width (`LENS_FLEX_SHRINK_FRACTION`), an "improvement, not perfection" fallback judged against the standing widths, and an all-or-nothing `null` meaning "leave every rail where it is". On top of that, every standing rail is forced to one shared width — a rule that makes a wide Gazette drag the Lens wide, or get refused because the shared answer fails the picture test.

The immediate pressure is the Gazette (`roadmap/gazette-plan.md`): its posts are prose, its current 12px body type is too small, and its rail is too narrow for the legibility and interactivity the feature wants. The Gazette should be the *greediest* of the sidebars — the one fed first and drained last — with a width derived from typography (64ch measure by default, fungible down to 56ch) rather than a hand-tuned pixel count. The session discussion that produced this plan concluded that the set of possible layouts, given (canvas width, imposition kind, occupied slots and their widths, rail occupancy, rail policies), is small enough to *solve* rather than guess: for any fixed discrete configuration, the correct rail widths are a piecewise-linear function of canvas width with a handful of computable breakpoints. No search, no measurement, no grading.

#### Strategy {#strategy}

- Keep the closed-form geometry (`solveSidebarWidths` — the least-squares band fit) exactly as it is; it is the part of the current allocator that is already right.
- Replace the acceptance policy with a **lexicographic water-fill**: floors are inviolable, the tiling target (no-overlap / gap-rhythm) outranks preferences, preferences fill in greed order, ceilings cap everything. The solver becomes a total function — it always answers when a rail stands.
- Delete the shared-width rule: each rail gets its own answer, folded from its members. Stacking semantics (wider preference wins) are preserved unchanged.
- Register greed as data: a `greedRank` on the card registration, Gazette 1 (greediest) < Lens 2 < Jots 3, folded to a rail by taking its greediest member.
- Derive the Gazette's floor and preference from its type: bump the body font, then floor = 56ch + measured chrome, preferred = 64ch + measured chrome, with an app-test that measures the real rendered face and pins the derivation against drift.
- Pin the whole solution space: an exhaustive enumeration test asserting the invariants across every configuration axis, plus a regenerable golden table checked into the repo as the drift net.
- Land in compile-clean steps: registry data first (inert), then the solver + plumbing, then the Gazette typography, then the regression nets.

#### Success Criteria (Measurable) {#success-criteria}

- `allocateSidebarWidths` returns a non-null answer for every input with ≥1 standing rail and finite numbers (verified by the enumeration sweep in Step 5).
- Two rails with different policies can stand at different widths (unit test + at0303).
- With Gazette (rank 1) on one side and Lens (rank 2) on the other, shrinking the canvas drains the Lens to its floor before the Gazette gives a pixel under its preference, and growing the canvas feeds the Gazette to its ceiling first (unit test + golden table rows).
- The Gazette's registered `min.width` and `preferred.width` equal `round(56 × ch) + chrome` and `round(64 × ch) + chrome` for the real rendered body face, within ±4px (app-test measure pin in at0365).
- `LENS_FLEX_SHRINK_FRACTION`, `ALLOCATOR_RESIDUAL_TOLERANCE_PX`, the graded licence, and `RailPolicy.currentWidth` no longer exist in `layout-imposer.ts` (grep is the verification).
- Every invariant in List L02 holds over the full enumeration of List L01 (`bun test` on the solutions test).
- `cd tugdeck && bunx tsc --noEmit && bunx vite build` clean; selected app-tests green.

#### Scope {#scope}

1. `tugdeck/src/lib/layout-imposer.ts` — the allocator rewrite (types, solver, deleted constants).
2. `tugdeck/src/card-registry.ts` — `greedRank` registration field and accessor.
3. `tugdeck/src/deck-manager.ts` — rail folding and plumbing for per-rail answers and ranks.
4. `tugdeck/src/components/gazette/` — font bump, 64ch reading measure, derived width constants.
5. Regression nets: rewritten unit tests, new solutions enumeration + golden table, updated at0303, extended at0365.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Layer A (placement): `resolvePlacement`, `travelFraction`, `imposeRect`, `imposeStyle`, `resolveSpan` are untouched.
- The vertical split-rail math (`railSeamFractions` / `railSharesFromFractions`) and `imposeSidebarStyle` are untouched.
- **The moments are unchanged** ([P08]): the allocator still runs only on a Layouts click, `assignCardToSlot`, and a settled canvas resize. This plan changes *what the answer is*, never *when it is asked for*.
- Per-card ceilings: the ceiling stays the single shared `maxRailWidth` = `CONTENT_WIDTH_SLIM_PX` (675). See [Q03].
- Content card widths, the width presets (675/800/1230), and the preset appliers are untouched.
- The Lens's `lensStore.widthPx` plumbing and `sidebarWidthStore` are untouched — preference sourcing stays exactly as it is.
- Gazette-internal presentation work beyond the font bump and reading measure (post layout, interactivity — that is the *next* phase the session discussion deferred).

#### Dependencies / Prerequisites {#dependencies}

- The layouts-rework sidebar taxonomy and the current allocator are landed (they are — this plan edits them in place).
- The Gazette card and at0365 exist (they do).

#### Constraints {#constraints}

- Rust-side untouched; this is a pure tugdeck phase. Frontend verification is `bunx tsc --noEmit` + `bunx vite build` (the debug app loads the prod rollup bundle, so a vite build is mandatory before declaring done).
- bun, never npm. App-tests only via `just` recipes, selective (`just app-test-changed` / named files), never a sweep, output never piped.
- Tuglaws apply: [L02] external state via `useSyncExternalStore` only, [L06] appearance via CSS/DOM. This plan adds **no new runtime state** (see #state-zone-mapping).
- No `localStorage`; durable widths already live on tugbank via `sidebarWidthStore` — unchanged.
- Warnings are errors across the repo.

#### Assumptions {#assumptions}

- `document.fonts` + canvas measurement (`tugdeck/src/lib/font-metrics.ts`) is reliable in the app-test environment — it is already used by atom chips (pinned by at0205).
- Spacing tokens are theme-invariant: `--tug-space-md: 8px`, `--tug-space-sm: 6px` in every `tugdeck/styles/themes/*.css`.
- IBM Plex Sans (`--tug-font-family-sans`) is the Gazette body face on every platform the app ships on, so one authored ch constant is valid everywhere the pin runs.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` headings, `[P##]` plan-local decisions, `[Q##]` open questions, `Spec S##`, `Table T##`, `List L##`, `Risk R##` labels, and `**Depends on:**` lines citing `#step-N` anchors. Global design decisions are cited as `[D##]`/`[L##]` against `tuglaws/design-decisions.md` and `tuglaws/tuglaws.md`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Exact bumped font sizes (DECIDED) {#q01-font-sizes}

**Question:** "A couple points larger" — what exactly do body and meta become?

**Why it matters:** The ch derivation bakes the body size into the registered widths.

**Resolution:** DECIDED (see [P05]): body 12px → 14px, meta 10px → 11px, empty-state 12px → 14px. Both are named `/* TUNE HERE */` constants in `gazette-card.css`; retuning later is a one-line CSS change plus re-running the derivation (Step 4's pin test fails loudly if the constants and the CSS drift apart, which is the point).

#### [Q02] What does the solver answer when no chain stands? (DECIDED) {#q02-no-chain-answer}

**Question:** With zero or one occupied slot there is no seam and `solveSidebarWidths` has nothing to fit. Today the allocator returns `null` (leave rails standing). Keep that, or answer anyway?

**Why it matters:** "Total function" was the promise; a `null` that means "shrug" is the ambiguity this plan exists to delete.

**Resolution:** DECIDED (see [P06]): the solver answers `clamp(preferred, floor, ceiling)` per rail. This is safe because preference is sourced from the durable stores (`lensStore.widthPx` / `sidebarWidthStore`), which the user's own drag writes — so "snap to preference" is always "snap to the width the user last chose", never a regression of it. `null` survives with exactly two honest meanings: no rail stands, or an input is non-finite.

#### [Q03] Per-card rail ceilings (DEFERRED) {#q03-per-card-ceilings}

**Question:** Should each sidebar card carry its own max width the way it now carries its own floor?

**Why it matters:** Only if some future rail card wants to grow past slim (675) or be capped under it.

**Resolution:** DEFERRED — no current card wants it, and `CardSizePolicy.max` already exists as the natural home if one ever does. The shared `maxRailWidth` ceiling stays. Revisit when a card asks.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Rails move more often than the graded licence allowed | med | med | Moments unchanged; 1px deadband in `_commitImposition`; FLIP settle already animates moves (at0294) | Visible churn on ordinary resizes |
| Font-metric variance breaks the ch pin | low | low | Pin measures the *real rendered face* in-test with ±4px tolerance | at0365 flake on the measure test |
| Golden table brittleness | med | med | Regeneration is one env var; the invariant sweep (not the golden) is the primary net | Golden churn on unrelated commits |
| Preference ratchet returns | high | low | Preference still read only from durable stores; `currentWidth` deleted from `RailPolicy` so the solver *cannot* see its own past answers | Any future edit re-adding live width to the input |

**Risk R01: Retune churn under the total-function solver** {#r01-retune-churn}

- **Risk:** The graded licence refused many moves ("improvement, not perfection"); the new solver always answers, so settled resizes may re-tune rails that previously held still.
- **Mitigation:** The answer is a pure function of (canvas, chain, policies) — repeated retunes at the same inputs are idempotent, so there is no oscillation, only honest tracking of the window; the `≥1px` write threshold in `_commitImposition` and `retuneSidebarAllocation` already suppresses no-op commits.
- **Residual risk:** A user who hand-drags a rail then resizes the window will see the rail re-solve around their dragged width (their drag *is* the preference, so the re-solve anchors on it — this is the designed behavior, not a bug, but it is a behavior change from "rails mostly hold still").

**Risk R02: at0303 rewrite loses a guarded invariant** {#r02-at0303-invariants}

- **Risk:** at0303's six invariants include behaviors this plan deletes (two rails → one width) next to behaviors it must preserve (preference untouched across close/reopen, retune moments); a careless rewrite could drop the preserved ones.
- **Mitigation:** Step 6 enumerates the invariant disposition explicitly (Table T02) — each old invariant is either kept, rewritten, or deleted with the deleting decision cited.
- **Residual risk:** None beyond ordinary test-authoring error.

---

### Design Decisions {#design-decisions}

#### [P01] Lexicographic invariants replace the graded licence (DECIDED) {#p01-lexicographic-invariants}

**Decision:** The allocator's policy is a strict priority order — (1) every rail ≥ its floor; (2) the chain tiles (seams on the gap, no overlap) whenever the canvas permits it with rails inside their bounds; (3) remaining width fills rails toward their preferences in greed order; (4) no rail exceeds the ceiling — solved in closed form, judged by nothing.

**Rationale:**
- The graded licence existed because the objective was never stated as invariants; every grade is a proxy question ("does the picture look better?") that the priority order answers directly.
- All acceptance machinery — `ALLOCATOR_RESIDUAL_TOLERANCE_PX`, `LENS_FLEX_SHRINK_FRACTION` (the soft floor), the standing-picture comparison, `seamPicture`-as-judge — becomes deletable.
- For any fixed discrete configuration the answer is piecewise-linear in canvas width with computable breakpoints, which is what makes the golden table possible (Spec S01).

**Implications:**
- The solver is a **total function**: non-null whenever ≥1 rail stands and inputs are finite ([P06]).
- `seamPicture` survives only as a test-side measurement helper (exported for tests), never as an input to the decision.
- The soft floor is gone: a rail's shrink range is `[minWidth, preferredWidth]`, period. The hard floor is the only floor.

#### [P02] Per-rail answers; the shared-width rule is deleted (DECIDED) {#p02-per-rail-answers}

**Decision:** Each standing rail gets its own solved width. The rule that every rail stands at one shared number (`total / sides.length`, the "sidebars are a uniform class" doctrine in `allocateSidebarWidths`) is deleted.

**Rationale:**
- The rule is why a wide Gazette drags the Lens wide or gets refused; per-card policies are meaningless if the answer is forced uniform across sides.
- Within a side nothing changes: same-side cards share one rail and one width by geometry (one `--tug-sidebar-width-{side}` property per side; `deck-canvas.tsx` already publishes per-side values, so the CSS layer needs zero changes).

**Implications:**
- `RailWidths` (`{left?, right?}`) already carries per-side numbers — the type is unchanged; only the constraint that the two values match is removed.
- `_commitImposition` already writes widths per side from the `RailWidths` record — it needs no change for asymmetry.
- The unit-test block "every standing rail takes one shared width" is rewritten to assert the greed ordering instead (Step 3).

#### [P03] Greed is a registered rank: Gazette 1 < Lens 2 < Jots 3 (DECIDED) {#p03-greed-rank}

**Decision:** `CardRegistration` gains an optional `greedRank?: number` — lower is greedier: fed first in surplus, drained last in deficit. Gazette registers 1, Lens 2, Jots 3; unregistered cards default to `DEFAULT_GREED_RANK = 9`. A rail's rank folds to the **minimum** (greediest member) of its members.

**Rationale:**
- The Gazette is a prose reading surface — the sidebar with the most to lose from narrowness; the Lens is lists; Jots is incipits. The order is a product decision from this plan's originating session.
- Registry-driven, never a `componentId` string comparison in the solver — the solver takes ranks as numbers in its input and knows nothing about cards.
- Min-fold composes with [P04]: a rail carrying the Gazette is greedy wherever the Gazette stands.

**Implications:**
- `RailPolicy` gains `greedRank: number`; `_sidebarRails` folds it with `Math.min`.
- Ties (two rails at equal rank) split evenly — deterministic and order-independent (Spec S01 step 4).

#### [P04] Stacking folds are preserved: wider preference wins (DECIDED) {#p04-stacking-fold}

**Decision:** Same-side cards fold exactly as today — rail preferred = max of member preferences, rail floor = max of member floors — plus the new rank fold (min). No change to `_sidebarRails`'s existing max-folds.

**Rationale:**
- "When sidebars are stacked, the one with the wider preference wins" is already what the max-fold does; this decision pins it as intended behavior rather than incidental.
- Max-fold on floors composes with the Gazette's derived floor: a rail carrying Gazette + Jots takes the Gazette's 56ch floor, so the greedy reader is never crowded by a modest stackmate.

**Implications:**
- The fold rules get their own unit assertions in Step 3 so they can never regress silently.

#### [P05] The Gazette's widths are derived from its type: 56ch floor, 64ch preference, at the bumped size (DECIDED) {#p05-gazette-ch-derivation}

**Decision:** Bump the Gazette body to 14px (meta 11px, empty-state 14px), then compute `MIN_GAZETTE_WIDTH_PX = round(56 × GAZETTE_BODY_CH_PX) + GAZETTE_ROW_CHROME_PX` and `DEFAULT_GAZETTE_WIDTH_PX = round(64 × GAZETTE_BODY_CH_PX) + GAZETTE_ROW_CHROME_PX` in `gazette-card-registration.tsx`, where `GAZETTE_BODY_CH_PX` is the measured advance of "0" in the real rendered body face at 14px and `GAZETTE_ROW_CHROME_PX` is the measured pane-edge-to-body-column chrome (both sides). Both measured constants are authored numbers pinned by an app-test that re-measures the real render ([P07] explains why authored-and-pinned rather than measured-at-runtime).

**Rationale:**
- "64ch by default, fungible down to 56ch" maps exactly onto the two policy inputs the solver reads — the typography *defines* the policy; no new mechanism.
- A future font-size or chrome tune fails the pin test instead of leaving a stale width constant behind.
- The body column also takes `max-inline-size: 64ch` in CSS, so a user-widened rail (up to the 675 ceiling) keeps a comfortable measure instead of stretching lines.

**Implications:**
- The known chrome components are documented in Spec S03; the authored constant is set from a real measurement during Step 4 and pinned thereafter.
- Expected magnitudes (sanity, not spec): 1ch of IBM Plex Sans at 14px ≈ 8px, so preferred ≈ ~555–575px and min ≈ ~490–505px — comfortably under the 675 ceiling.
- **The new preference reaches only users who never sized the Gazette.** `_sidebarPreferredWidth` reads `sidebarWidthStore.widthFor("gazette")` first and falls back to the registered `preferred.width`; a user with a stored 480 keeps 480 as their preference, which Spec S01 step 2 then clamps up to the new floor (~496) — not to the 560 the measure buys. That is correct ([L23]: their drag is their choice, and the stored value is never overwritten), but it means **a tester with a stored width will see the feature "not work"** until that tugbank key (`dev.tugtool.gazette` / `widthPx`) is cleared. Say this in the Step 4 commit message, and clear the key before judging the result by eye.

#### [P06] The solver is total; `null` means only "no rail" or "bad number" (DECIDED) {#p06-total-function}

**Decision:** `allocateSidebarWidths` returns a `RailWidths` answer whenever ≥1 rail stands and all inputs are finite. With no chain (fewer than two occupied slots) each rail answers `clamp(preferred, floor, ceiling)`. `RailPolicy.currentWidth` is deleted — the solver never sees the standing widths.

**Rationale:**
- The all-or-nothing `null` ("leave rails standing") existed to serve the improvement-not-perfection grade; with the grade gone it has no question to answer.
- Deleting `currentWidth` makes the no-ratchet property structural: the solver *cannot* read its own past answers back, rather than being documented not to.
- Resolves [Q02]; preference safety argued there.

**Implications:**
- `retuneSidebarAllocation` and `_commitImposition` keep their `≥1px` change checks — "answer equals standing" is detected by the caller, not encoded as `null`.
- The chain guards in `chainOf` relax: a chain of 0 or 1 is no longer a `null` case for the *allocator* (it is still one for `solveSidebarWidths`, which genuinely has no seam to fit).

#### [P07] Measured constants are authored and pinned, never computed at boot (DECIDED) {#p07-authored-pinned}

**Decision:** `GAZETTE_BODY_CH_PX` and `GAZETTE_ROW_CHROME_PX` are authored numeric constants in the registration module, verified by an app-test that measures the real render — not measured at registration time.

**Rationale:**
- Registration runs at boot, before layout has requested the face — `document.fonts.ready` resolves on an empty queue then, and a canvas measure would report the fallback's metrics with complete confidence (the exact trap `tugdeck/src/lib/font-metrics.ts`'s module doc documents).
- Deterministic registration keeps the solver's inputs stable from the first frame; an async width upgrade arriving mid-session would be a re-tune trigger this plan has no license to add ([P08]).
- The pin test closes the drift loop: the authored number is checked against the truth on every selected run.

**Implications:**
- Step 4 includes a one-time measurement procedure (in-test `note()` output) to set the authored values honestly.

#### [P08] The moments are unchanged (DECIDED) {#p08-moments-unchanged}

**Decision:** The allocator still runs exactly at the three moments documented on `retuneSidebarAllocation` in `deck-manager.ts` — a Layouts-section click, `assignCardToSlot`, a settled canvas resize — and nowhere else.

**Rationale:**
- "A rail's width belongs to the user, spent only when the user asked the deck to arrange itself" is doctrine this plan has no quarrel with; the rework is about what the answer is, not when it is computed.

**Implications:**
- No changes to `deck-canvas.tsx`'s settled-resize observer or `RESIZE_RETUNE_QUIET_MS`.

#### [P09] The regression net is an invariant sweep plus a regenerable golden table (DECIDED) {#p09-golden-table}

**Decision:** A new unit test enumerates the configuration space (List L01), asserts the invariants (List L02) on every point, and additionally compares a representative slice against a checked-in golden JSON (`tugdeck/src/lib/__tests__/golden/imposer-solutions.json`), regenerated by running the same test with `IMPOSER_GOLDEN_UPDATE=1`.

**Rationale:**
- The invariant sweep is the strong net (it checks *properties*, so it survives intentional retunes); the golden is the drift net (it catches *any* behavioral change, intended or not, and makes it reviewable as a diff).
- The solver is pure arithmetic — tens of thousands of calls run in well under a second in bun.

**Implications:**
- Golden regeneration is a deliberate act that shows up in review as a JSON diff; the regeneration command is documented in the test header.

---

### Deep Dives {#deep-dives}

#### The current allocator, and exactly what is deleted {#current-allocator-inventory}

All in `tugdeck/src/lib/layout-imposer.ts` unless noted. **Kept:** `solveSidebarWidths` (the closed-form least-squares band fit — unchanged), `chainOf` (fold duplicates to widest, sort by slot; its `< 2` bail moves from the allocator's concern to `solveSidebarWidths`'s per [P06]), `resolveSpan` (the gap-count authority), `RailWidths`, `railSidesOf`/`railsOf`, `RESIZE_RETUNE_QUIET_MS`, `AllocatorInput.maxRailWidth` and the caller's `CONTENT_WIDTH_SLIM_PX` ceiling. **Rewritten:** `allocateSidebarWidths` (becomes Spec S01), `RailPolicy` (gains `greedRank`, loses `currentWidth` and the soft-floor semantics on `preferredWidth`), its doc comment (the "graded licence" essay is replaced by the invariant order). **Deleted:** `LENS_FLEX_SHRINK_FRACTION`, `ALLOCATOR_RESIDUAL_TOLERANCE_PX`, the three grades, the standing-picture comparison, the one-shared-width distribution. **Demoted:** `seamPicture` — exported as a test-measurement helper (it measures via `imposeRect`'s real clamped rule, which is exactly what the tiling invariant should be checked against), no longer consulted by the solver.

In `tugdeck/src/deck-manager.ts`: `_sidebarRails` keeps its max-folds and adds the min-fold for `greedRank` (resolved per member via the new registry accessor); `_sidebarPreferredWidth` is unchanged (durable stores remain the only preference source); `_allocatedRailWidths` and `_commitImposition` are unchanged in shape (both already speak per-side `RailWidths`); `retuneSidebarAllocation` is unchanged.

#### Why the answer is piecewise-linear, and what the breakpoints are {#piecewise-linear}

**The separation property — distribution is free.** `resolveSpan` insets the canvas by `railWidth + gap` per occupied side, so `band = canvasWidth − Σ rails − (R + 2)·gap`. The band — and therefore every seam in the chain — depends only on the rails' **total**, never on how that total is split between left and right. Distribution shifts `span.x` and nothing else. This is the keystone of the whole decomposition: **the total determines tiling; greed determines only which rail is wide.** Invariant 4 in List L02 is therefore true by construction rather than merely checked, and greed order can never trade away picture quality.

For a fixed discrete configuration (kind, occupied slots and widths, rail policies), the least-squares band `B*` is a constant offset from nothing — the fit depends only on the chain — so the rails' solved total `T* = canvasWidth − (R + 2)·gap − B*` is **linear in canvas width with slope 1**. The water-fill (Spec S01) maps that scalar through a monotone piecewise-linear distribution whose breakpoints are exactly the canvas widths where `T*` crosses: `Σ floors`, each partial-fill boundary in drain order (`Σ preferred −` each rail's give, taken in reverse-greed order), `Σ preferred`, each partial-fill boundary in fill order, and `Σ ceilings`. The golden table samples each breakpoint ±1px plus a coarse sweep, which is what makes "exhaustive" honest rather than aspirational.

#### Worked example {#worked-example}

Three-up, slots 0 and 2 occupied by two comfy (800px) cards; Gazette alone on the right (floor ≈ 496, preferred ≈ 560, rank 1 — illustrative ch-derived values); Lens alone on the left (floor 320, preferred 420, rank 2); gap 5, ceiling 675. `R = 2`. The chain's fit is exact with band `B* = 1605` (two 800s and one 5px seam), so `solveSidebarWidths` returns `T* = canvas − 5·(2 + 2) − 1605 = canvas − 1625`. That return value **is** the target before clamping — Spec S01 step 3's warning in one line. `Σ floor = 816`, `Σ pref = 980`, `Σ ceil = 1350`.

- Canvas 2605: `T* = 980` = `Σ pref` exactly — Gazette 560, Lens 420, every seam on the gap.
- Canvas 2505: `T* = 880`, deficit 100. Lens (less greedy) drains first: Lens 320 (floor, gave 100), Gazette holds 560.
- Canvas 2430: `T* = 805`, which is below `Σ floor = 816`, so `target` clamps **up** to 816 before any rail is touched. Deficit against `Σ pref` is then 164: Lens drains first to its floor (420 → 320, gives 100), Gazette gives the remaining 64 (560 → 496, exactly its floor). Both rails stand on their floors, and the 11px the clamp refused to give is carried by the chain — the band comes out 1594 against the 1605 that would tile, so the single interior seam goes from +5 to **−6, a 6px overlap**. This is the overflow regime, reported honestly rather than repaired.
- Canvas 2805: `T* = 1180`, surplus 200. Gazette (greedier) fills first: Gazette 675 (ceiling, took 115), Lens takes the remaining 85: Lens 505. Note both rails end **above** their preferences — surplus is capped by `target` and `ceil`, never by preference (Spec S01 step 4).
- One-up with a single occupied slot ([Q02]): `solveSidebarWidths` returns `null`, target = `Σ pref` — Gazette 560, Lens 420, the card centers in what remains.

---

### Specification {#specification}

**Spec S01: The per-rail solver** {#s01-solver}

Signature: `allocateSidebarWidths(input: AllocatorInput): RailWidths | null` — name, module, and caller unchanged.

**`R ≤ 2` always.** `railSidesOf` returns at most `left` and `right`, so the "greed order" is a sort of at most two elements and the tie case is exactly "two rails at equal rank". Nothing below needs to scale past that.

1. **Guards.** No standing rail → `null`. Any non-finite `canvasWidth`, occupied entry, or rail policy number — **including `greedRank`**, which is sorted on and would make the order nondeterministic if it were `NaN` — or a non-positive `maxRailWidth` → `null`. These are the only `null`s ([P06]). `chainOf` already validates `preferredWidth`/`minWidth` finiteness per rail; extend that check to `greedRank` rather than adding a second validation site.
2. **Per-rail bounds.** For each standing rail `i`: `floor_i = minWidth`, `ceil_i = max(round(maxRailWidth), floor_i)` (a floor above the ceiling wins, exactly as the current Grade-1 comment argues — a rail that cannot paint under its floor beats a policy about maximum width), `pref_i = clamp(round(preferredWidth), floor_i, ceil_i)`.
3. **Target total.** `solveSidebarWidths(input)` **already returns the rails' total** — read its final line: it computes the band `B*` internally and returns `canvasWidth − gap·(railCount + 2) − B*`. Do **not** subtract the band again; the target is that return value verbatim. Call it `T*`. When `solveSidebarWidths` returns `null` — no seam (fewer than two occupied slots), no rail, or a degenerate fit (`Σa² ≤ 0`) — the target is `Σ pref_i` ([Q02]). Then clamp: `target = clamp(T*, Σ floor_i, Σ ceil_i)`. `chainOf` semantics are unchanged (fold duplicate slots to widest, sort by slot).
4. **Greed-ordered water-fill.** Start every rail at `pref_i`.
   - `Σ pref = target`: done.
   - **Deficit** (`Σ pref > target`): visit rails in *reverse* greed order (largest `greedRank` first — least greedy drains first); shrink each toward `floor_i` until the total meets the target. The greediest rail gives width only after every other rail stands at its floor.
   - **Surplus** (`Σ pref < target`): visit rails in greed order (smallest `greedRank` first); grow each toward `ceil_i` until the total meets the target. The greediest rail reaches its ceiling before any less greedy rail grows a pixel past its preference. **Preference is not a cap in surplus** — growth is bounded by the clamped `target` (itself the least-squares optimum) and then by `ceil_i`. Growing past preference happens only when the geometry actually wants the width, which is what the old Grade 1 already did; the old preference cap lived only in the deleted Grade 3.
   - **Ties:** rails at equal rank split their tier's delta evenly, then any remainder a bounded member could not absorb is redistributed to the members still short of their bound (a one-pass mini water-fill within the tier — with `R ≤ 2` this is at most one redistribution). Deterministic and independent of input order.
5. **Rounding.** Round each width to an integer; the ≤R px rounding residual is absorbed by the band's travel (never redistributed — a pixel of seam slack is invisible; a redistribution loop is complexity with no picture to buy).

Properties (these are List L02's invariants, stated once): total on the guarded domain; every width in `[floor_i, ceil_i]`; monotone non-decreasing in canvas width per rail; greed-sound (a less greedy rail above its preference implies every greedier rail at its ceiling; a greedier rail below its preference implies every less greedy rail at its floor); exact tiling whenever `T* ∈ [Σ floor, Σ ceil]` and the chain is tileable; pure and deterministic.

**Spec S02: Type changes** {#s02-types}

```ts
// layout-imposer.ts
export interface RailPolicy {
  preferredWidth: number;  // the user's durable choice (or the registered preferred)
  minWidth: number;        // the hard floor — the only floor
  greedRank: number;       // lower = greedier: fed first, drained last
}
// AllocatorInput: unchanged shape (canvasWidth, kind, occupied, rails, maxRailWidth)
// RailWidths: unchanged ({ left?: number; right?: number }) — values may now differ

// card-registry.ts
export const DEFAULT_GREED_RANK = 9;
export interface CardRegistration { /* … */ greedRank?: number; }
export function getGreedRank(componentId: string): number;  // registration's rank ?? DEFAULT_GREED_RANK
```

`_sidebarRails` fold (deck-manager.ts): preferred = `Math.max`, min = `Math.max` (both unchanged), greedRank = `Math.min` over members via `getGreedRank(componentId)`; the `currentWidth` fold line is deleted.

**Table T01: Registered greed ranks** {#t01-greed-ranks}

| Card | `greedRank` | Registration file |
|------|-------------|-------------------|
| Gazette | 1 | `tugdeck/src/components/gazette/gazette-card-registration.tsx` |
| Lens | 2 | `tugdeck/src/components/lens/lens-register-card.tsx` |
| Jots | 3 | `tugdeck/src/components/jots/jots-card-registration.tsx` |
| (any other) | 9 (`DEFAULT_GREED_RANK`) | — |

**Spec S03: Gazette typography and the width derivation** {#s03-gazette-derivation}

CSS (`tugdeck/src/components/gazette/gazette-card.css`): `.gazette-post-body` `font-size: 12px → 14px` and gains `max-inline-size: 64ch`; `.gazette-post-meta` `10px → 11px` (its `line-height: 16px` and the glyph gutter's `block-size: 16px` stay — 11px fits the band); `.gazette-empty` `12px → 14px`. Mark the body size with the existing `/* TUNE HERE */` convention.

Registration (`gazette-card-registration.tsx`):

```ts
export const GAZETTE_BODY_FONT_PX = 14;        // must equal .gazette-post-body font-size — pinned by test
export const GAZETTE_BODY_CH_PX = /* measured */;   // advance of "0", IBM Plex Sans @ 14px (≈ 8)
export const GAZETTE_MIN_MEASURE_CH = 56;
export const GAZETTE_MEASURE_CH = 64;
export const GAZETTE_ROW_CHROME_PX = /* measured */; // pane edge → body column, both sides summed
export const MIN_GAZETTE_WIDTH_PX =
  Math.round(GAZETTE_MIN_MEASURE_CH * GAZETTE_BODY_CH_PX) + GAZETTE_ROW_CHROME_PX;
export const DEFAULT_GAZETTE_WIDTH_PX =
  Math.round(GAZETTE_MEASURE_CH * GAZETTE_BODY_CH_PX) + GAZETTE_ROW_CHROME_PX;
```

Known chrome components (documented beside the constant; the authored value is the *measured* total, these are its anatomy): `.gazette-transcript` inline padding 2 × `--tug-space-md` (8px) = 16, glyph gutter `--tugx-gazette-gutter-inline-size` = 18, post grid gap `--tug-space-sm` = 6, plus whatever pane/CardHost chrome stands between the pane's `size.width` and the transcript's content box (borders, host padding — measured, not guessed; macOS overlay scrollbars contribute 0).

The pin (extends `tests/app-test/at0365-gazette-card.test.ts`): open the Gazette; `whenFaceLoaded` + `textMeasurer` (from `tugdeck/src/lib/font-metrics.ts`) against a real `.gazette-post-body` element; assert computed `font-size` = `GAZETTE_BODY_FONT_PX`; assert measured `"0"` advance = `GAZETTE_BODY_CH_PX` ± 0.25; measure chrome = pane width − body content-box width and assert = `GAZETTE_ROW_CHROME_PX` ± 2; assert the two registered widths equal the formula ± 4. `note()` every measured number so a failing run hands the correct constants to whoever retunes.

**List L01: Enumeration axes for the solutions test** {#l01-enumeration-axes}

- Kinds: all six (`one-up` … `six-up`).
- Occupancy: every non-empty subset of the kind's slots (≤ 63 per kind), each at uniform slim/comfy/wide, plus one mixed pattern (alternating slim/wide) per subset size.
- Rail configurations: right-only, left-only, both-sides; policies drawn from a fixture set: Gazette-alone (derived floor/preferred, rank 1), Lens-alone (320/420, rank 2), Jots-alone (320/420, rank 3), Gazette+Jots stacked (max-fold check), Gazette-right + Lens-left, Jots-left + Gazette-right, equal-rank pair (tie split), plus a dragged-preference variant (preferred 600).
- Canvas: every breakpoint of the configuration (#piecewise-linear) ± 1px, plus a sweep from 700 to 3800 in steps of 100.

**List L02: Invariants asserted on every enumerated point** {#l02-invariants}

1. Non-null whenever a rail stands (totality, [P06]).
2. `floor_i ≤ width_i ≤ ceil_i` for every rail.
3. Greed soundness, both directions (Spec S01 properties).
4. Tiling: when `T* ∈ [Σ floor, Σ ceil]` and the chain admits an exact fit, `seamPicture` at the answer reports `worstError ≤ 2 + R` (rounding allowance) and `worstOverlap` ≤ the same.
5. Canvas monotonicity: for fixed config, each rail's width is non-decreasing in canvas width.
6. Stacking fold: a stacked rail's answer never falls below any member's floor.
7. Tie fairness: equal-rank rails with equal bounds receive equal widths.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| `greedRank` | none — static registration data, not state | `registerCard` field + accessor | [D04] |
| Solved rail widths | structure (already exists) | deck store `pane.size.width` via `_commitImposition`, read through `useSyncExternalStore` | [L02] |
| Gazette type sizes / 64ch measure | appearance | CSS only (`gazette-card.css`) | [L06] |
| Derived width constants | none — module constants, pinned by test | authored + app-test pin | [P07] |

No new runtime state of any kind is introduced.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/__tests__/layout-imposer-solutions.test.ts` | Enumeration sweep + golden comparison ([P09]) |
| `tugdeck/src/lib/__tests__/golden/imposer-solutions.json` | The checked-in golden table |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `greedRank` | field | `card-registry.ts` `CardRegistration` | optional; lower = greedier |
| `DEFAULT_GREED_RANK` | const (9) | `card-registry.ts` | |
| `getGreedRank` | fn | `card-registry.ts` | `registration?.greedRank ?? DEFAULT_GREED_RANK` |
| `RailPolicy` | interface | `lib/layout-imposer.ts` | + `greedRank`; − `currentWidth`; floor semantics per Spec S02 |
| `allocateSidebarWidths` | fn (rewrite) | `lib/layout-imposer.ts` | Spec S01 |
| `seamPicture` | fn (visibility) | `lib/layout-imposer.ts` | becomes exported, test-only consumer |
| `LENS_FLEX_SHRINK_FRACTION` | **delete** | `lib/layout-imposer.ts` | |
| `ALLOCATOR_RESIDUAL_TOLERANCE_PX` | **delete** | `lib/layout-imposer.ts` | |
| `_sidebarRails` | method (edit) | `deck-manager.ts` | + min-fold of ranks; − currentWidth fold |
| `GAZETTE_BODY_FONT_PX`, `GAZETTE_BODY_CH_PX`, `GAZETTE_MIN_MEASURE_CH`, `GAZETTE_MEASURE_CH`, `GAZETTE_ROW_CHROME_PX` | consts | `components/gazette/gazette-card-registration.tsx` | Spec S03 |
| `MIN_GAZETTE_WIDTH_PX`, `DEFAULT_GAZETTE_WIDTH_PX` | consts (now derived) | same | formula, not literals |

---

### Documentation Plan {#documentation-plan}

- [ ] Rewrite `allocateSidebarWidths`'s doc comment: the invariant order replaces the graded-licence essay; the per-rail rule replaces the "uniform class" doctrine; note the totality contract and the two remaining `null` meanings.
- [ ] Update `_sidebarRails` / `_sidebarPreferredWidth` / `retuneSidebarAllocation` doc comments where they describe deleted behavior (soft floor, standing-picture judging, shared width).
- [ ] Candidate global design-decision entry (the per-rail lexicographic allocator and the greed order) for `tuglaws/design-decisions.md` — drafted as a follow-on for the user to land; plans do not edit tuglaws unilaterally.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** (bun) | Solver arithmetic, folds, regimes, edge guards | Steps 2–3, rewritten `layout-imposer.test.ts` blocks |
| **Golden / Contract** | The full solution space as a reviewable artifact | Step 5, `layout-imposer-solutions.test.ts` |
| **App-test** | The real deck: commit paths, moments, measured typography | Steps 4 and 6 (at0365, at0303) |

#### What stays out of tests {#test-non-goals}

- jsdom/mock render tests — banned; the imposer's unit surface is pure arithmetic and needs no DOM, and everything DOM-real is covered by app-tests on the actual app.
- FLIP animation timing — at0294 owns settle behavior and is unchanged by this plan (rails moving is already an animated path).
- Cross-platform font metrics beyond the shipped face — the pin measures the face the app actually renders; hypothetical fallback stacks are not worth the brittleness.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Run app-tests bare via `just` — never piped.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Greed ranks in the registry | done | `a0b73d4ed` |
| #step-2 | The per-rail solver + unit-suite rewrite | done | `03d4193be` |
| #step-3 | Deck-manager greed fold | done | `dce8073b2` |
| #step-4 | Gazette typography and derived widths | done | `13f5f92ea` |
| #step-5 | The solutions sweep and golden table | done | `47df4681d` |
| #step-6 | at0303 rewrite | done | `f188b6d0a` |
| #step-7 | Integration checkpoint | done | `0d5a5e3f8` |

#### Step 1: Greed ranks in the registry {#step-1}

**Commit:** `tugdeck(card-registry): register sidebar greed ranks (Gazette 1, Lens 2, Jots 3)`

**References:** [P03] Greed rank, Table T01, Spec S02, (#symbols)

**Artifacts:**
- `greedRank?` on `CardRegistration`, `DEFAULT_GREED_RANK`, `getGreedRank()` in `tugdeck/src/card-registry.ts`.
- Ranks registered per Table T01 in the three registration files.

**Tasks:**
- [ ] Add the field, constant, and accessor with doc comments stating the semantics (lower = greedier: fed first in surplus, drained last in deficit; consumed by the space allocator via `deck-manager.ts`).
- [ ] Register 1/2/3 on Gazette/Lens/Jots. This step is inert — nothing reads the ranks yet — so it lands compile-clean without touching the solver.

**Tests:**
- [ ] Unit: `getGreedRank` returns the registered rank, and `DEFAULT_GREED_RANK` for an unregistered id (add to the existing registry coverage in `tugdeck/src/lib/__tests__/` or beside the registry's current tests if a file exists; otherwise a small block in `layout-imposer.test.ts`'s neighbor is fine — keep it a pure-registry test).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 2: The per-rail solver and the unit-suite rewrite {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(imposer): replace graded licence and shared width with lexicographic per-rail solver`

**References:** [P01] Lexicographic invariants, [P02] Per-rail answers, [P06] Total function, Spec S01, Spec S02, (#current-allocator-inventory, #piecewise-linear, #worked-example)

**Artifacts:**
- Rewritten `allocateSidebarWidths` and `RailPolicy` in `tugdeck/src/lib/layout-imposer.ts`; deleted `LENS_FLEX_SHRINK_FRACTION` and `ALLOCATOR_RESIDUAL_TOLERANCE_PX`; `seamPicture` exported.
- `tugdeck/src/lib/__tests__/layout-imposer.test.ts`: the `"the space allocator"` block rewritten to Spec S01's regimes; the `"every standing rail takes one shared width"` block replaced by a greed-ordering block.

**Tasks:**
- [ ] Implement Spec S01 exactly: guards (including `greedRank` finiteness), per-rail bounds, target total — **`solveSidebarWidths` returns the rails' total already; do not subtract the band again** — `Σ pref` target when it returns `null`, then reverse-greed drain / greed fill, tie split with remainder redistribution, rounding.
- [ ] Update `RailPolicy` per Spec S02; delete the two constants and every grade; rewrite the function's doc comment per #documentation-plan.
- [ ] Make `deck-manager.ts`'s `RailPolicy` construction match the new shape (pass `greedRank: getGreedRank(componentId)`, drop `currentWidth`). The *fold* work and doc updates land in #step-3; this step does the field swap so the build is green.
- [ ] Rewrite the allocator unit blocks in the same commit — the solver and the suite that proves it land together, so this step has a real green boundary: exact tiling; deficit drains reverse-greed (Lens to floor before Gazette gives); surplus fills greed-first (Gazette to ceiling, and **past preference** — the deleted Grade-3 cap must not reappear); per-rail asymmetric answers; floor-beats-ceiling; no-chain → clamped preferences ([Q02]); tie split with remainder; guards return `null` only for no-rail/non-finite.
- [ ] Port the #worked-example numbers as one named test — including the canvas-2430 overflow case (both rails on floors, seam at −6) — so the plan and the suite share an oracle.

**Tests:**
- [ ] The rewritten allocator suite above.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/__tests__/layout-imposer.test.ts`
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`

---

#### Step 3: Deck-manager greed fold {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(imposer): greed-fold sidebar rails in deck-manager`

**References:** [P03] Greed rank, [P04] Stacking fold, [P08] Moments unchanged, Spec S02, Table T01, (#state-zone-mapping)

**Artifacts:**
- `_sidebarRails` min-folds `greedRank`; doc comments updated across `deck-manager.ts` per #documentation-plan.

**Tasks:**
- [ ] Fold ranks (`Math.min`) in `_sidebarRails` via `getGreedRank(componentId)`; delete the `currentWidth` fold; update the method's doc comment (the max-fold preferred/floor language stays — [P04]).
- [ ] Update `_sidebarPreferredWidth` and `retuneSidebarAllocation` doc comments where they describe deleted behavior (soft floor, standing-picture judging, one shared width). `retuneSidebarAllocation`'s "THE MOMENTS" paragraph stays verbatim — [P08].

**Tests:**
- [ ] Unit: the stacking folds, asserted against `allocateSidebarWidths` with rail policies built the way `_sidebarRails` builds them — wider preference wins, tightest (largest) floor binds, greediest (minimum) rank wins.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src && bunx tsc --noEmit && bunx vite build`

---

#### Step 4: Gazette typography and derived widths {#step-4}

**Depends on:** #step-1

**Commit:** `tugdeck(gazette): bump type to 14px and derive rail widths from the 56–64ch measure`

**References:** [P05] ch derivation, [P07] Authored and pinned, [Q01] Font sizes, Spec S03, (#state-zone-mapping)

**Artifacts:**
- `gazette-card.css`: body 14px + `max-inline-size: 64ch`, meta 11px, empty 14px.
- `gazette-card-registration.tsx`: the Spec S03 constants; `MIN_GAZETTE_WIDTH_PX` / `DEFAULT_GAZETTE_WIDTH_PX` become derived.
- at0365 gains the measure-pin test.

**Tasks:**
- [ ] CSS changes per Spec S03.
- [ ] Write the pin test first with placeholder constants and `note()` output; run it once to *obtain* the honest measured values (`GAZETTE_BODY_CH_PX`, `GAZETTE_ROW_CHROME_PX`); author them into the registration; re-run green ([P07]'s one-time measurement procedure).
- [ ] Document the chrome anatomy beside `GAZETTE_ROW_CHROME_PX` per Spec S03.

**Tests:**
- [ ] The at0365 measure-pin test (font-size, ch advance, chrome, derived-width formula — tolerances per Spec S03).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test at0365-gazette-card.test.ts`

---

#### Step 5: The solutions sweep and golden table {#step-5}

**Depends on:** #step-2, #step-4

**Commit:** `tugdeck(imposer): exhaustive solution sweep + golden table as the regression net`

**References:** [P09] Golden table, List L01, List L02, Spec S01, (#piecewise-linear)

**Artifacts:**
- `tugdeck/src/lib/__tests__/layout-imposer-solutions.test.ts` and `…/golden/imposer-solutions.json`.

**Tasks:**
- [ ] Implement the enumeration per List L01 with a per-configuration breakpoint computer (#piecewise-linear); assert every List L02 invariant at every point (use the exported `seamPicture` for invariant 4).
- [ ] Golden slice: a deterministic representative subset (~200 rows: every rail-config fixture × every kind at one occupancy each × breakpoint canvases), serialized as sorted JSON; compare against the checked-in file; regenerate via `IMPOSER_GOLDEN_UPDATE=1 bun test …` (documented in the test header). Fixture widths use the *landed* Gazette constants from #step-4, imported — never re-hardcoded.

**Tests:**
- [ ] The sweep and golden comparison are the tests.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/__tests__/layout-imposer-solutions.test.ts`
- [ ] `cd tugdeck && bunx tsc --noEmit`

---

#### Step 6: at0303 rewrite {#step-6}

**Depends on:** #step-3

**Commit:** `tests(at0303): per-rail greedy allocator invariants`

**References:** [P02] Per-rail answers, [P03] Greed rank, [P08] Moments unchanged, Risk R02, Table T02 below, (#success-criteria)

**Table T02: at0303 invariant disposition** {#t02-at0303-disposition}

| Old invariant | Disposition |
|---|---|
| Engagement + FLIP settle | keep |
| Preference untouched across close/reopen | keep — the no-ratchet property, now structural ([P06]) |
| Untileable give-back capped at chosen width | **replace** — the chosen-width cap was Grade 3's rule and is deleted with it. Deficit clamps at floors; surplus is capped by the clamped target and then `ceil_i`, **not** by preference ([P01], Spec S01 step 4). Assert the new rule explicitly so the old one cannot creep back. |
| Re-assert re-tunes / assignCardToSlot re-tunes | keep ([P08]) |
| Two rails → one width | **replace** with: two rails answer per-rail; greed order observable (Gazette holds while Lens drains) |

**THE HARNESS CANNOT RESIZE THE WINDOW.** at0303's own header says so ("The harness cannot resize the app's window, so this gesture is what covers that entry end to end"), and the existing test is built around that fact: it computes fixture card widths at runtime from the *measured* canvas and uses the re-assert gesture as the retune trigger. Do not write a step that resizes the canvas — it cannot be done.

The substitution is exact, not a compromise. `T*` is `canvasWidth − gap·(R+2) − B*`, and `B*` is a function of the chain's card widths, so **moving a fixture card's width moves the target exactly as moving the canvas would**. To place the deck on either side of a breakpoint, seed card widths rather than window sizes, then re-assert the layout ([P08]'s moment) to make the solver run.

**Tasks:**
- [ ] Rewrite `tests/app-test/at0303-imposer-space-allocator.test.ts` per Table T02, driving the real app: open Gazette right + Lens left, seed both preferences through tugbank (as the current test seeds `PREFERRED`), compute fixture card widths from the measured canvas so `T*` lands first in the surplus regime and then in the deficit regime, re-assert the layout at each, and assert on real pane widths that (a) the two rails answer with *different* widths and (b) the Lens drains to its floor while the Gazette holds its preference.
- [ ] Keep invariant 2 (preference untouched across close/reopen) reading through the production path exactly as it does today — it is the no-ratchet guard and [P06] only strengthens it.
- [ ] Verify `@covers` still resolves (`just app-test-covers-check`).

**Tests:**
- [ ] at0303 itself.

**Checkpoint:**
- [ ] `just app-test at0303-imposer-space-allocator.test.ts`

---

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Grep-verify the deletions: `grep -rn "LENS_FLEX_SHRINK_FRACTION\|ALLOCATOR_RESIDUAL_TOLERANCE_PX\|currentWidth" tugdeck/src/lib/layout-imposer.ts tugdeck/src/deck-manager.ts` returns nothing.
- [ ] Full frontend verification and the derived app-test selection.

**Tests:**
- [ ] Aggregate: unit suites + selected app-tests together.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test-changed`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A deterministic, total, per-rail space allocator with registered greed order and typographically derived Gazette widths, pinned by an exhaustive generated solution table.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [x] Every #success-criteria item verified by its named mechanism.
- [x] Step Status Ledger fully `done` with commit hashes recorded.
- [ ] On a live deck: Gazette right + Lens left, window narrowed — the Lens visibly drains to its floor while the Gazette holds its 64ch measure. *(The user's vetting pass on the debug build. Clear the `dev.tugtool.gazette` / `widthPx` tugbank key first — see [P05]: a stored width is still the user's preference and the new measure only reaches a Gazette nobody has sized.)*

**Landed values.** The measure came out at `GAZETTE_BODY_CH_PX = 8.4` and `GAZETTE_ROW_CHROME_PX = 42`, so the Gazette's preferred width is **580** and its floor **512** — both matching the in-app measurement exactly (at0365). The plan's illustrative 560/496 were estimates; the sweep, the golden table, and at0303 all read the landed constants rather than re-hardcoding them.

**Acceptance tests:**
- [ ] `cd tugdeck && bun test src` (allocator suite + solutions sweep + golden)
- [ ] `just app-test at0303-imposer-space-allocator.test.ts at0365-gazette-card.test.ts`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Gazette internal presentation redesign (the "*many* improvements" phase this plan clears space for).
- [ ] Global design-decision entry for the allocator doctrine in `tuglaws/design-decisions.md` (user lands tuglaws edits).
- [ ] Per-card rail ceilings if a card ever asks ([Q03]).

| Checkpoint | Verification |
|------------|--------------|
| Solver totality + invariants | `layout-imposer-solutions.test.ts` sweep |
| Behavior drift | golden JSON diff in review |
| Typography ↔ width coherence | at0365 measure pin |
| Real-deck greed order | at0303 |

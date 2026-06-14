<!-- plan authored against devise-skeleton v4 -->

## Dev-Transcript Rendering & Scroll Redux {#transcript-redux}

**Purpose:** Make the dev-card transcript render every message accurately at its real height (no holes, no estimate-driven scrollbar), give the user full control over scrolling, and save/restore scroll position pixel-perfectly across Developer ▸ Reload and HMR — fast, for any real transcript size.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (via `tugutil dash`) |
| Last updated | 2026-06-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dev-card transcript has accumulated three tangled defects that resisted piecemeal fixing. Repeated symptom-chasing failed because rendering, scroll control, and restore were changed together; a prior windowing→inline effort was reverted wholesale and `main` was reset to the clean baseline `97bf26ce`. This plan starts fresh against that baseline with a strict separation of concerns and a discipline of vetting each concern on the **real app** before moving to the next.

The three observed defects map to one root cause and two consequences:

1. **Rendering (root cause).** Every transcript row is wrapped in `TieredCell` (`transcript-tier.tsx`): a row renders a *cheap* muted-text preview at a reserved (estimate-like) height until a shared `IntersectionObserver` (`useInRichWindow`, `RICH_WINDOW_MARGIN = 1500px`) upgrades it to *rich*. A row that has never been rich sits at its cheap height. This single mechanism produces **both** the empty "holes" the user sees when scrolling (cheap previews of tool/complex cells) **and** the scrollbar that changes height as you scroll (the total height is `Σ(cheap) + Σ(rich)` and shifts every time a cell first goes rich). The user's requirement #5 forbids exactly this.

2. **Scroll control.** `card-host.tsx` installs a `MutationObserver`-driven region-scroll re-apply loop, designed for *virtualized* scrollers whose `scrollHeight` grows after mount as estimated heights refine. It re-applies the saved `scrollTop` on every cardRoot mutation until the live `scrollTop` lands within `REGION_SCROLL_TOLERANCE_PX = 8` of the saved value. For a transcript saved while following the bottom, this never settles — re-engaging SmartScroll follow-bottom (`source: "scroll-to-bottom"`) and slamming the user down whenever they try to scroll up.

3. **Reload/restore.** Because heights are estimate-driven, the saved pixel position can't be honored on the first commit, which is why the retry loop exists at all. Removing estimates removes the reason for the loop.

The insight that unblocks all five requirements: **render every cell at its true height — no cheap tier, no estimates.** Then the scrollbar is the real cumulative height (never shifts), there are no cheap placeholders (no holes), and pixel-perfect restore becomes a one-shot assignment instead of a fighting loop.

#### Strategy {#strategy}

- **Separate the three concerns and do them in order, vetting each on the real app before the next.** Rendering first (A), then scroll control + restore (B), then reload/HMR perf + reveal UX (C). Last time conflation caused ghost-chasing.
- **Retire `TieredCell`; render all cells rich at real heights.** The transcript already mounts `inline` (all rows, no windowing), so this is a wrapper removal, not a new architecture.
- **Never use estimates.** No cheap reserved heights, no estimated offsets for the dev transcript. The scrollbar is always the true sum of measured heights. (See [[feedback_no_height_estimates]].)
- **Measure on the user's real sessions, never assert.** Prove load time on the biggest real session before declaring requirement #1 met. Only if a genuinely huge transcript is too slow do we escalate to *measure-every-row-once → cache real heights → window on real numbers* — a follow-on, not this phase.
- **Let the all-rich pass adjudicate the reducer question empirically.** If holes/missing messages survive all-rich rendering, investigate the reducer `${msgId}:${blockIndex}` keying; if they vanish, the reducer is exonerated and we don't touch it.
- **Make user scroll always win.** Redesign restore as one-shot and make follow-bottom re-engage only on genuine user intent — never as a side effect of a restore or a mutation.
- **Observe the real app, don't theorize.** Instrument with `tugDevLogStore.debug(...)` on the live debug instance and read persisted card state via the `tugbank` CLI. (See [[feedback_never_fake]].)

#### Success Criteria (Measurable) {#success-criteria}

- **[req #5] No holes:** scrolling through the full transcript of real session `49fc50a1` (and the largest available real session) shows fully-rendered content for every row — no empty/muted-preview frames — verified visually on the live debug instance. (#rendering-all-rich)
- **[req #5] Stable scrollbar:** the scroll thumb's size and position do not change while scrolling a settled (fully-replayed) transcript. Verified visually and by logging `scrollHeight` on scroll — it is constant once replay completes. (#rendering-all-rich)
- **[req #1] Load performance:** the largest real session loads in a time we measure and the user accepts; recorded in the plan. No regression vs. the inline-no-hold baseline (~2.2s on the biggest real session). (#perf-measurement)
- **[req #2] Full scroll control:** after scrolling up, the user stays where they scrolled — no slam to bottom from a mutation or a restore. Verified on the live debug instance and via `followdbg` logs showing no spurious `scroll-to-bottom`/`idle-reengage` engages. (#scroll-control-model)
- **[req #4] Pixel-perfect restore:** scroll to a marked row, trigger Developer ▸ Reload, and land at the same `scrollTop` (within ≤2px) on the same row. Verified via dev-panel logging of saved vs. restored `scrollTop`. (#pixel-perfect-restore)
- **[req #3] Reload/HMR perf:** Developer ▸ Reload completes in a measured, acceptable time; HMR repaints without reloading transcript data. Verified by timing logs and the HMR-vs-Reload invariant. (#reload-hmr-perf)

#### Scope {#scope}

1. Retire `TieredCell` and render every dev-transcript cell rich at its real height (no cheap tier, no estimates).
2. Remove the now-dead cheap-preview plumbing for the dev transcript (`previewForRow`, `previewTextForMessages` usage, `transcript-tier.*`) where no longer referenced.
3. Empirically confirm whether residual holes/missing messages exist; if so, fix the reducer-level cause.
4. Redesign scroll-restore so user scroll always wins: one-shot region-scroll restore for the transcript, correct follow-bottom/atBottom semantics.
5. Achieve pixel-perfect save/restore across Developer ▸ Reload and HMR on real heights.
6. Measure and tune Developer ▸ Reload and HMR performance; preserve the HMR-never-reloads-data invariant.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Re-introducing windowing/virtualization for the dev transcript. (Only if real-session measurement proves all-rich too slow — then it's a follow-on, on real measured heights, never estimates.)
- Changing the windowing path used by other `TugListView` consumers (e.g. the gallery list).
- Reworking the streaming/live-turn rendering path beyond what removing `forceRich` requires.
- Any change to tugbank's persistence model or the card-state wire format beyond what the restore semantics require.

#### Dependencies / Prerequisites {#dependencies}

- Clean baseline: `main` at `97bf26ce`.
- A live debug instance via `just app-debug` for real-app vetting; `just logs-debug`, `just stop-debug`, `just launch-debug`.
- The `tugbank` CLI for reading persisted card state: `tugbank --instance <id> --json read <domain> <key>` (domain `dev.tugtool.deck.cardstate`, key = card UUID).
- Real session JSONLs for measurement (e.g. `49fc50a1`, plus the largest available). (See [[feedback_real_content_fixtures]].)

#### Constraints {#constraints}

- **Warnings are errors** (`-D warnings`); zero new lint/type findings, fix pre-existing ones in touched files. (See [[feedback_fix_preexisting]].)
- **No estimates anywhere** in the dev-transcript render or scrollbar math.
- **No fake/mock paths** to test or measure — drive the real product path. (See [[feedback_never_fake]], [[feedback_test_reality]].)
- **Tests:** real-app behavior via `just app-test <file>` only (never a hand-rolled `TUGAPP_*` pipeline); pure-logic via `bun:test`. No fake-DOM/RTL, no mock-store assertion tests. App-tests use a fast fixture + short timeouts and exit promptly. (See [[feedback_just_app_test]], [[feedback_no_happy_dom_tests]], [[feedback_apptest_background]].)
- **HMR is always running** for tugdeck; never hand-build the frontend. (See [[feedback_hmr]].)
- **Tuglaws** apply: cross-check `tuglaws/tuglaws.md`, `pane-model.md`, `component-authoring.md` before tugdeck/chrome edits and name the laws touched in each dash commit. (See [[feedback_tuglaws_cross_check]].)
- Work on a `tugutil dash` worktree; never commit to `main` (only the user joins).

#### Assumptions {#assumptions}

- Real transcripts are ~250 rows; the markdown-reconcile fix (`80c246c6`, in baseline) already removed the old all-rich blow-up, so all-rich is expected to be affordable — to be confirmed by measurement, not assumed.
- Removing `TieredCell` eliminates the holes and the scrollbar shift together (single mechanism). The reducer keying is a *secondary* hypothesis to be tested only if defects survive.
- With real heights, a transcript's `scrollHeight` is correct on the first commit after replay completes, so restore needs no growth-chasing retry loop for this region.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit and kebab-case; steps cite plan-local decisions `[P01]`… and anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Do holes/missing messages survive all-rich rendering? {#q01-residual-holes}

**Question:** After retiring `TieredCell` and rendering every cell rich, do any holes or misrendered/missing messages remain?

**Why it matters:** If yes, the cause is below the list view (most likely the reducer's per-turn `${msgId}:${blockIndex}` keying when one assistant message is split across two JSONL entries — thinking-only then text — each restarting `block_index` at 0). If no, the reducer is exonerated and must not be touched.

**Options (if known):**
- All defects vanish → reducer untouched (close as DECIDED, exonerated).
- Some defects remain → fix reducer keying to disambiguate split-entry blocks.

**Plan to resolve:** Spike empirically in #step-2 on the real app against `49fc50a1` and the largest real session, reading the reducer output for the suspect messages.

**Resolution:** OPEN — resolved by #step-2's real-app check; #step-3 is conditional on the outcome.

#### [Q02] Is all-rich fast enough on the largest real session? {#q02-allrich-perf}

**Question:** Does rendering every cell rich load within an acceptable time on the largest real transcript?

**Why it matters:** Requirement #1 ("any size"). If all-rich is too slow on a genuinely huge transcript, we need measure-once-cache-window on real heights — a follow-on.

**Plan to resolve:** Measure in #step-5 on real sessions; record numbers in this plan.

**Resolution:** OPEN — resolved by #step-5 measurement. Escalation to windowing-on-real-heights is a follow-on (#roadmap), not this phase.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| All-rich too slow on huge transcript | high | low | Measure on real sessions; escalate to measure-once-cache-window on real heights | Measured load exceeds user-accepted budget |
| Holes survive all-rich (reducer cause) | med | med | Conditional reducer fix (#step-3), gated on #step-2 | Defects visible after #step-1 |
| Removing the retry loop breaks restore for *other* region scrollers | high | med | Scope the change to the transcript region only; leave the generic markdown-view path intact | Any non-transcript region scroll regresses |
| Streaming/live-turn row tears down without `forceRich` | med | low | Preserve always-rich for the in-flight row by construction (all rows rich) | Live turn flickers or loses a pending dialog |

**Risk R01: Scoping the region-scroll restore change** {#r01-region-scope}

- **Risk:** The CardHost MutationObserver retry serves *all* `data-tug-scroll-key` regions (notably virtualized `tug-markdown-view`), not just the transcript.
- **Mitigation:** Distinguish the transcript region (real heights → one-shot restore) from genuinely virtualized regions (keep growth-chasing). Do not delete the loop wholesale; branch on region capability.
- **Residual risk:** A future region that claims real heights but lies would mis-restore; documented as a region contract.

---

### Design Decisions {#design-decisions}

#### [P01] Render every dev-transcript cell rich at its real height (DECIDED) {#p01-all-rich}

**Decision:** Retire `TieredCell` for the dev transcript. Each row renders its full (rich) cell directly; there is no cheap tier and no reserved/estimated height.

**Rationale:**
- The cheap/rich tiering is the single mechanism behind both the holes and the estimate-driven scrollbar shift (#context).
- The transcript already mounts `inline` (all rows), so the rich subtrees are the only honest thing to mount.
- Estimates are banned ([[feedback_no_height_estimates]]); a real-height-only list satisfies requirements #4 and #5 by construction.

**Implications:**
- The scrollbar height equals `Σ(measured heights)` and is stable once replay completes.
- `previewForRow` / `previewTextForMessages` / `transcript-tier.*` become dead for the transcript and are removed where unreferenced.
- `forceRich` is moot (all rows rich); the in-flight streaming row stays rich automatically.

#### [P02] No estimates and no windowing for the dev transcript (DECIDED) {#p02-no-estimates}

**Decision:** The dev transcript renders all cells inline at measured heights with no `estimatedHeightForKind`, no spacers, no `computeWindow`. Windowing remains available to other `TugListView` consumers.

**Rationale:**
- Real transcripts are bounded (~250 rows) and the markdown-reconcile fix removed the old blow-up.
- Estimate-free is the only way to guarantee a non-shifting scrollbar and pixel-perfect restore.

**Implications:**
- The dev transcript's `scrollHeight` is correct on the first commit after replay — enabling one-shot restore.
- A future huge-transcript escalation must measure real heights once and window on those, never on estimates (#roadmap).

#### [P03] One-shot, real-height region-scroll restore for the transcript (DECIDED) {#p03-one-shot-restore}

**Decision:** For the transcript region, restore saved `scrollTop` once after replay/paint settles, then stop. Do not run the growth-chasing MutationObserver re-apply loop for this region.

**Rationale:**
- The retry loop exists only because virtualized scrollers grow `scrollHeight` after mount as estimates refine. With real heights there is nothing to chase.
- The never-settling loop is the slam mechanism for an atBottom-saved transcript (#context).

**Implications:**
- The CardHost restore path must branch: real-height regions get one-shot restore; genuinely virtualized regions keep growth-chasing (R01).
- Restore disengages follow-bottom and suppresses idle-reengage for that programmatic write (existing SmartScroll affordances).

#### [P04] User scroll always wins; follow-bottom re-engages only on genuine user intent (DECIDED) {#p04-user-wins}

**Decision:** Follow-bottom is engaged only by user gestures (scroll-to-bottom, End/Cmd-Down) or by a save that recorded `atBottom`. A restore, a mutation, or a programmatic write never re-engages follow-bottom against the user.

**Rationale:**
- Requirement #2. The observed `disengage{wheel-up} → ENGAGE{scroll-to-bottom}` loop violated this.

**Implications:**
- `atBottom` in the saved meta means "the user was following the bottom; resume following," not "slam `scrollTop` to a stale pixel."
- `_setFollowingBottom` stays the single chokepoint; restore paths route through the existing `restore-target`/suppression affordances and never synthesize `scroll-to-bottom`.

#### [P05] Reducer keying is touched only if defects survive all-rich (DECIDED) {#p05-reducer-conditional}

**Decision:** Do not modify the reducer unless #step-2 confirms holes/missing messages persist after all-rich rendering.

**Rationale:**
- Avoid changing correctness-critical replay code on a hypothesis. The all-rich pass is the cheapest disambiguator.

**Implications:**
- #step-3 is conditional and may close as "exonerated, no change."

---

### Specification {#specification}

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Rich-vs-cheap tier (REMOVED) | — | deleted; all rows render rich | [L06] |
| Measured cell heights | structure/local-data | `ResizeObserver` → `HeightIndex`/DOM measurement; never React state | [L22], [L06] |
| Scroll thumb geometry | appearance | true `scrollHeight` from measured layout; CSS/DOM, no estimate math | [L06] |
| Follow-bottom intent | appearance | DOM attribute (`data-visible`) via `onFollowBottomChange`; never React state | [L06] |
| Region scroll restore (transcript) | local-data (DOM authority) | one-shot `scrollTop` write gated on paint settle; `tug-region-scroll-set` event to disengage follow-bottom | [L22], [L23] |
| Saved card state (scrollTop, anchor, atBottom) | external/persistent | tugbank via `/api/defaults`; enters React only via `useSyncExternalStore` if observed | [L02] |
| Stable cell wrapper identity | structure | same wrapper element across re-renders so observers/restore stay attached | [L26] |

(Confirm exact law numbers against `tuglaws/tuglaws.md` at implement time and name them in each dash commit.)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Real-app** (`just app-test`) | Reload/restore, scroll control, no-slam, pixel-perfect landing | Steps that change scroll/restore behavior |
| **Pure-logic** (`bun:test`) | Reducer keying for split-entry blocks (data-in/data-out) | Only if #step-3 fires |
| **Manual real-app vetting** | Holes, scrollbar stability, load feel — observed on the live debug instance | Every rendering/scroll step |

#### What stays out of tests {#test-non-goals}

- **Fake-DOM/RTL render tests** — banned; happy-dom is deleted. Express rendering correctness as real-app vetting or pure data tests. ([[feedback_no_happy_dom_tests]])
- **Mock-store assertion tests** — banned. ([[feedback_no_mock_store_tests]])
- **Gallery/fixture scroll scenarios** — do not test invented scenarios; drive the real session resume + reload path only. ([[feedback_never_fake]])

---

### Execution Steps {#execution-steps}

> Work happens on a `tugutil dash` worktree (absolute paths into the worktree). Commit each step via `tugutil dash commit`. Vet rendering on the real app before touching scroll. The user joins to `main`.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Retire TieredCell — render all transcript cells rich | pending | — |
| #step-2 | Vet rendering on the real app; adjudicate residual defects | pending | — |
| #step-3 | (Conditional) Fix reducer split-entry block keying | pending | — |
| #step-4 | One-shot real-height region-scroll restore; user scroll wins | pending | — |
| #step-5 | Pixel-perfect restore + load measurement on real sessions | pending | — |
| #step-6 | Reload/HMR perf + reveal UX; HMR-never-reloads invariant | pending | — |
| #step-7 | Integration checkpoint — all five requirements on real sessions | pending | — |

---

#### Step 1: Retire TieredCell — render all transcript cells rich {#step-1}

**Commit:** `Render dev-transcript cells at real height; drop tiering`

**References:** [P01] All-rich render, [P02] No estimates, (#context, #rendering-all-rich), Risk R01

**Artifacts:**
- `dev-card-transcript.tsx`: cell renderers (user/assistant/ghost) render their rich cell directly, not wrapped in `TieredCell`.
- Removed dead cheap-preview plumbing where unreferenced: `previewForRow`, `previewTextForMessages` import/usage, and `transcript-tier.tsx` / `transcript-tier.css` if no other consumer remains.

**Tasks:**
- [ ] In `dev-card-transcript.tsx`, replace each `<TieredCell …>{() => <Cell/>}</TieredCell>` with the rich `<Cell/>` directly; remove `forceRich` derivation.
- [ ] Grep for other consumers of `TieredCell`, `previewTextForMessages`, `previewForRow`; delete the dev-transcript-only ones and remove `transcript-tier.*` only if fully unreferenced.
- [ ] Keep the `inline` prop on `TugListView`; confirm no `estimatedHeightForKind` is supplied for this list.
- [ ] Cross-check tuglaws (L06/L22/L26) and name them in the commit body.

**Tests:**
- [ ] `bunx tsc --noEmit` clean; zero new warnings.

**Checkpoint:**
- [ ] Typecheck clean.
- [ ] HMR repaints the transcript with rich rows; no `TieredCell`/cheap markup in the DOM (`data-tier` attribute gone).

---

#### Step 2: Vet rendering on the real app; adjudicate residual defects {#step-2}

**Depends on:** #step-1

**Commit:** `N/A (verification only)`

**References:** [P01] All-rich render, [Q01] Residual holes, [P05] Reducer conditional, (#rendering-all-rich, #q01-residual-holes)

**Tasks:**
- [ ] `just app-debug`; load real session `49fc50a1` and the largest available real session on the live debug instance.
- [ ] Scroll the full transcript: confirm **no holes** (every row fully rendered) and the **scrollbar does not change height/position** once replay completes. Log `scrollHeight` on scroll via `tugDevLogStore.debug(...)` and confirm it is constant.
- [ ] Resolve [Q01]: if any holes/missing/misrendered messages remain, capture the offending `msg_id`/`block_index` from the reducer output and proceed to #step-3; if none, mark [Q01] DECIDED (reducer exonerated) and skip #step-3.

**Tests:**
- [ ] Manual real-app vetting (the only honest test for "no holes"/"stable scrollbar").

**Checkpoint:**
- [ ] User confirms no holes and a stable scrollbar on both sessions, **or** a concrete reducer defect is captured for #step-3.

---

#### Step 3: (Conditional) Fix reducer split-entry block keying {#step-3}

**Depends on:** #step-2

**Commit:** `Disambiguate split-entry blocks in transcript reducer`

**References:** [P05] Reducer conditional, [Q01] Residual holes, (#open-questions)

> Execute only if #step-2 confirmed residual defects. Otherwise close as "exonerated — no change" in the ledger.

**Artifacts:**
- `lib/code-session-store/reducer.ts`: keying that disambiguates a `block_index` restart when one assistant message spans two JSONL entries (thinking-only then text).

**Tasks:**
- [ ] Reproduce the captured defect from real JSONL; identify where two blocks collide on `${msgId}:${blockIndex}` within a turn's scratch entry.
- [ ] Adjust the key (e.g. incorporate entry/sequence) so split-entry blocks never collide; preserve dedupe semantics for `turn_complete` and live/replay parity.
- [ ] Cross-check correctness against existing reducer behavior; fix any pre-existing issue in touched code.

**Tests:**
- [ ] `bun:test` pure-logic test feeding the real split-entry event sequence and asserting both blocks survive distinctly (no fake-DOM, no mock store).

**Checkpoint:**
- [ ] The previously-missing message renders; full real-app re-vet from #step-2 passes.

---

#### Step 4: One-shot real-height region-scroll restore; user scroll wins {#step-4}

**Depends on:** #step-2

**Commit:** `One-shot transcript scroll restore; stop slam-to-bottom`

**References:** [P03] One-shot restore, [P04] User scroll wins, Risk R01, (#scroll-control-model, #r01-region-scope)

**Artifacts:**
- `card-host.tsx`: transcript region restored one-shot (gated on replay/paint settle), not via the never-settling MutationObserver loop; genuinely virtualized regions keep the existing growth-chasing path (R01).
- `smart-scroll.ts` / `dev-card-transcript.tsx`: restore disengages follow-bottom and suppresses idle-reengage for the programmatic write; follow-bottom re-engages only on user intent or an `atBottom`-flagged save.

**Tasks:**
- [ ] Branch the CardHost restore so the transcript region (real heights) restores once and stops; do not delete the loop used by virtualized regions.
- [ ] Ensure the programmatic restore routes through `tug-region-scroll-set` (disengage follow-bottom) and sets the idle-reengage suppression, so no `idle-reengage`/`scroll-to-bottom` engage follows.
- [ ] Verify `atBottom` semantics: a transcript saved while following bottom resumes following; a transcript saved scrolled-up restores to the saved pixel and stays.
- [ ] Cross-check tuglaws (L02/L22/L23) and name them in the commit body.

**Tests:**
- [ ] `just app-test` real-app test: scroll up on a resumed real session, mutate/settle, assert `scrollTop` stays put (no slam); assert `followdbg` shows no spurious engage. Fast fixture, short timeouts, prompt exit.

**Checkpoint:**
- [ ] On the live debug instance, scrolling up holds; `followdbg` logs show `disengage{wheel-up}` with no follow-on `ENGAGE{scroll-to-bottom}`.

---

#### Step 5: Pixel-perfect restore + load measurement on real sessions {#step-5}

**Depends on:** #step-4

**Commit:** `Pixel-perfect transcript restore across reload`

**References:** [P03] One-shot restore, [Q02] All-rich perf, (#pixel-perfect-restore, #perf-measurement, #q02-allrich-perf)

**Artifacts:**
- Verified save/restore on real heights; recorded load measurements in this plan's [Q02] resolution.

**Tasks:**
- [ ] On the live debug instance, scroll to a marked row, note saved `scrollTop` (read tugbank: `tugbank --instance <id> --json read dev.tugtool.deck.cardstate <cardId>`), trigger Developer ▸ Reload, and confirm the restored `scrollTop` matches within ≤2px on the same row. Log saved vs. restored via `tugDevLogStore.debug(...)`.
- [ ] Measure load time of the largest real session (replay-to-interactive) and record it; resolve [Q02]. Confirm no regression vs. the ~2.2s inline-no-hold baseline.

**Tests:**
- [ ] `just app-test` real-app reload test: resume → scroll to anchor → reload → assert landed `scrollTop` within tolerance. Fast fixture, short timeouts.

**Checkpoint:**
- [ ] Pixel-perfect landing confirmed; load numbers recorded and accepted ([Q02] resolved).

---

#### Step 6: Reload/HMR perf + reveal UX; HMR-never-reloads invariant {#step-6}

**Depends on:** #step-5

**Commit:** `Tune reload reveal; keep HMR from reloading transcript`

**References:** [P02] No estimates, (#reload-hmr-perf), [[project_hmr_vs_reload]]

**Artifacts:**
- Reveal/paint gate for Developer ▸ Reload tuned for all-rich; HMR confirmed to never reload transcript data.

**Tasks:**
- [ ] Time Developer ▸ Reload on real sessions; tune the paint/reveal gate (`data-replaying`/DevReplayProgress) so reveal is single and fast with all-rich, no accumulation FOUC.
- [ ] Confirm the HMR-vs-Reload invariant: HMR repaints without re-resuming from JSONL; Developer ▸ Reload is the only true hard refresh. Verify via dev-panel logs that an HMR save does not re-run replay.

**Tests:**
- [ ] `just app-test` (or live-instance dev-panel observation) confirming HMR does not trigger a transcript data reload.

**Checkpoint:**
- [ ] Reload completes in a measured, accepted time; HMR repaints without reloading data.

---

#### Step 7: Integration checkpoint — all five requirements on real sessions {#step-7}

**Depends on:** #step-1, #step-2, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), [P01]–[P05]

**Tasks:**
- [ ] On the live debug instance with real session `49fc50a1` and the largest real session, verify all five requirements together: load perf (#1), full scroll control / no slam (#2), reload+HMR perf (#3), pixel-perfect restore (#4), accurate rendering — no holes / no estimate-driven scrollbar / no missing messages (#5).

**Tests:**
- [ ] Aggregate real-app pass: the `just app-test` reload/scroll tests green; manual vetting of holes + scrollbar stability confirmed by the user.

**Checkpoint:**
- [ ] User signs off that all five requirements hold on real sessions. Then (and only then) `tugutil dash join`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A dev-card transcript that renders every message accurately at real height, gives the user uninterrupted scroll control, and restores scroll position pixel-perfectly across Developer ▸ Reload and HMR — measured fast on the user's real sessions.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] No holes and a stable scrollbar on real sessions (req #5). (#rendering-all-rich)
- [ ] User scroll always wins; no slam-to-bottom (req #2). (#scroll-control-model)
- [ ] Pixel-perfect restore across Developer ▸ Reload (req #4). (#pixel-perfect-restore)
- [ ] Load + reload times measured and accepted (req #1, #3). (#perf-measurement, #reload-hmr-perf)
- [ ] No estimates anywhere in the dev-transcript render/scroll path (req #5).

**Acceptance tests:**
- [ ] `just app-test` reload + scroll-control tests green (fast, prompt exit).
- [ ] User-confirmed manual vet of holes + scrollbar stability on real sessions.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] If [Q02] measurement shows all-rich too slow on a genuinely huge transcript: measure-every-row-once → cache real heights → window on real numbers (never estimates).

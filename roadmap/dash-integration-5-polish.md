## Polish and doctrine — the dash lane's last mile {#polish-and-doctrine}

**Purpose:** Close the dash integration program: make a project with several dashes navigable (a picker, a real ordering), give the shade's dash lane the two binding gestures it still lacks (adopt, leave), surface whether a dash's plan is still reviewed, write the lifecycle down in `tuglaws/dash-lifecycle.md`, and delete the one-release skill aliases. Implements [phase 5](dash-integration-plan.md#phase-5) of the dash integration program.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Target branch | main (runs as the `polish-lane` dash) |
| Program plan | [dash-integration-plan.md](dash-integration-plan.md#phase-5) |
| Last updated | 2026-08-14 |

---

### Review Record {#review-record}

<!-- Appended by /tugplug:plan-review; the stamp is written by `tugutil plan stamp`. -->

**Round 1 — 2026-08-14, opus.** Reviewed `plan:1b1e870a4639969e`. Lint: 0 errors, 0 warnings.
Oriented on: the whole document — a first pass, devised and reviewed in one turn on Opus per the `plan-devise` fork.
Applied: **technical choices** — the mark's masthead mechanism was wrong. The plan had `session-masthead.tsx` reading the bound dash out of "the card's changeset snapshot", but `SessionMastheadProps` is `{ sessionId, cardId?, accessoryHost? }` and the masthead is handed no `ChangesRouteController`; it already reads the *account-global* aggregate for exactly this shape of fact (`useSessionBranch` from `changeset-all-store.ts`). Rewritten as a sibling hook `useDashReviewState` beside `branchForProject`/`useSessionBranch`, with the symbol inventory and State Zone Mapping corrected to match, so the plan no longer implies a prop-threading change the masthead's design forbids.
**Holes** — added [#edges](#edges), covering the five cases an implementer hits and would otherwise re-derive: two cards on one dash is legal and must not be guarded against; a picker dismissed mid-bind is harmless because the ack is the mover; a released dash vanishing mid-gesture exposes `bind_dash`'s minting for one recompose (pre-existing, scoped out); the mark reads `stale` during a review's own edit-then-stamp window, correctly; and a manually-removed worktree degrades to no field.
**Test-plan sanity** — Step 5 proposed asserting "a `bind_dash` for a released dash leaves the chip unchanged, which only passes if the ack is the mover". That test cannot exist: a released dash has no row to click, and `bind_dash` mints so it cannot be refused. Replaced with the complement-rule assertion (fronted offers Leave and no Adopt, and vice versa), and the ack-is-the-mover discipline moved into `#test-non-goals` as an explicitly untested invariant rather than a fake proof.
**Cold reader** — Step 2's fixture would have failed on first run: `dash step start --plan` is the only writer of `branch.tugdash/<name>.tugplan` and refuses unless the document parses *and* carries a `#step-1` ledger row, and it mutates the ledger before the stamp. Both facts, and the reason the mutation does not invalidate the stamp, are now in the step. Step 1's golden-fixture task was conditional ("if either carries a dash entry"); both goldens do carry one and neither records a `plan_path`, so the correct expectation is that they do **not** move — stated, with the instruction to fix the emission rather than the fixture if they do.
**Falsifiability** — two checkpoints could not fail. `grep -c "two-beat" …` reports a count, not a verdict; replaced with `! grep -q` on the exact stale clause. Step 7's stub grep used `\b`, which matches `tugplug:dash` inside `tugplug:dash-audit` and would report every surviving skill as a leftover; replaced with `([^a-z-]|$)` and verified against the current tree.
**Sequencing** — Steps 3 and 5 gained `**Depends on:** #step-2` with HTML comments naming these as *file-contention* dependencies, not logical ones. Neither needs the review field; both rewrite files Step 2 rewrites. An unexplained dependency reads as a hidden coupling.
Deferred: nothing new. [Q01] (how long a dash has been parked) was raised and left deferred with its rationale and resolution path — it needs a wire field no surface has yet earned.

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 1 through 4 built the dash lane end to end: a dash has an identity (`tugdash/<name>#<tugid>`), a derived stage, a session binding, a maintained join draft, a lane in the Changes shade, a row in the Lens, a chip in the masthead, and — with phase 4 — a landing surface with `/join`, a preview, a gate, a receipt, and a release affordance behind a discard preflight.

What is left is the part that only shows up once somebody actually lives in the lane, plus the doctrine that has been accumulating in plan documents instead of in `tuglaws/`. Five specific gaps, each small, none of which the earlier phases could honestly have closed:

1. **A project with six dashes is unnavigable.** Bare `/dash` (the handler at `tugdeck/src/components/tugways/cards/session-card.tsx`, the `dash:` entry of the local slash-verb table) opens the Changes shade and stops. That was the right answer for one dash; with several it shows them all and offers no way to pick one. Binding still means typing the name exactly. And the Lens **Dashes** section has no ordering at all — `dashRowsFromSnapshot` in `tugdeck/src/components/lens/sections/dashes-section.tsx` emits rows in project-enumeration order then snapshot order, so the dash somebody is working sorts below one created a week ago and forgotten.

2. **Only one binding gesture exists, and it is typed.** `bind_dash` and `unbind_dash` are both live CONTROL verbs on the server (`tugcast/src/feeds/agent_supervisor.rs`, dispatched in `handle_control`), and the deck already handles both acks — `action-dispatch.ts` registers `bind_dash_ok` and `unbind_dash_ok`, which move `cardSessionBindingStore`. But the deck **never sends `unbind_dash` from anywhere**, and it only sends `bind_dash` from the typed `/dash <name>` verb. The shade's dash lane, which is the room where a dash's facts already live, offers neither.

3. **Nothing says whether a dash's plan is still reviewed.** Phase 2.1 built the whole apparatus — `tugutil_core::plan::review_state` returns `reviewed` / `stale` / `never-reviewed` by comparing the newest Review Record round's `plan:<hash>` stamp against the document's live content stamp, and `tugutil plan status` reports it. Phase 3.1 put `plan_path` on the dash changeset entry. `dash-implement` gates on it at setup. But no *surface* reads it, so the only way to learn that your plan drifted past its review is to run a CLI verb.

4. **The lifecycle is written down only in plans.** The state model (derive vs declare), the binding concept, and the landing doctrine live scattered across `roadmap/dash-integration-*.md`, which are implementation records, not law. `tuglaws/INDEX.md` has a "Working on a dash" section holding exactly one file (`dash-work-doctrine.md`, which is about how an *agent* behaves on a worktree, not about what a dash *is*). And `tuglaws/tracking-changes.md` still describes `/commit` as a two-beat gesture ("no ready draft → open the shade and generate; ready draft → land it; … `now` collapses the beats") — that has been false since commit mode shipped; `/commit` now enters a mode via `commitModeController.enter()` and `now` means nothing.

5. **Eight redirect stubs are still in the roster.** `tugplug/skills/` holds `audit`, `dash`, `dash-run`, `devise`, `implement`, `join`, `review-plan`, and `vet` — each a `disable-model-invocation` skill that prints a replacement chip and stops. They were introduced for one release so old transcripts' chips stayed clickable. That release has turned over.

#### Strategy {#strategy}

- **Server computes, surfaces render.** Review state is derived exactly once, in `dash_entries` in `tugcast/src/feeds/changeset.rs`, and rides the dash changeset entry as one wire field. Three surfaces then read one value. Nothing in the deck parses a plan.
- **Ordering is a projection, not a store.** The Lens section's ordering is a pure sort inside `dashRowsFromSnapshot` over the snapshot it already reads. No new state, no persistence, nothing to invalidate.
- **The picker is a sheet, not transcript ink.** Picking which dash to work on is a UI-concept act, exactly like the bind it performs — silent, no turn, no transcript row. It goes on the card's existing sheet host, which is where every other picker in the session card already goes.
- **The two binding gestures go where the facts are.** Adopt and Leave land on the Changes shade's dash-lane rows and nowhere else. The Lens Dashes section stays the read-only account-global glance its own docblock says it is.
- **Doctrine is a subtraction, not an addition.** `tuglaws/dash-lifecycle.md` collects what is already true and scattered; it invents nothing. The one new global decision, [D138], is its compressed entry.
- **The deletions are last and separate.** Removing the stubs touches no code path, so it commits on its own and cannot be entangled with a behavior change.

#### Success Criteria (Measurable) {#success-criteria}

- A dash whose plan's newest stamped review round no longer matches the document's content stamp shows a stale mark in the Lens Dashes row, in the Changes shade's dash row, and on the masthead dash chip — verified by an app-test that creates a real dash, writes a real plan, stamps it with `tugutil plan stamp`, appends a line to the plan, and asserts the mark appears where it did not before.
- With three dashes in a project, bare `/dash` opens a sheet listing all three, arrow keys move the selection, and Return binds the card to the highlighted one — verified by an app-test asserting the binding store's dash name changed to the row that was highlighted.
- With exactly one dash, bare `/dash` binds it and opens no sheet — verified in the same app-test.
- The Lens Dashes section orders worked dashes above parked ones and, within each group, `landing` above `built` above `working` above `created` — verified by a bun table test over `dashRowsFromSnapshot` and an app-test asserting DOM row order.
- Clicking Adopt on a non-fronted dash row rebinds this card to it (the masthead chip changes); clicking Leave on the fronted row clears the binding (the chip disappears) — verified by an app-test driving real clicks.
- `tuglaws/dash-lifecycle.md` exists, is registered in `tuglaws/INDEX.md`, and `tuglaws/tracking-changes.md` no longer describes `/commit` as two-beat — verified by grep in the step checkpoint.
- `tugplug/skills/` contains no directory named `audit`, `dash`, `dash-run`, `devise`, `implement`, `join`, `review-plan`, or `vet`, and no file in the repo outside `roadmap/` references `/tugplug:` + any of those names — verified by grep.

#### Scope {#scope}

1. A `review` field on the dash changeset entry, computed server-side from the dash's recorded `plan_path`.
2. The stale-review mark in three surfaces: the Lens Dashes row, the Changes shade dash row, the masthead dash chip.
3. A total ordering for the Lens Dashes section.
4. A `/dash` picker sheet for a project with more than one dash.
5. Adopt and Leave affordances on the Changes shade's dash-lane rows.
6. `tuglaws/dash-lifecycle.md`, its INDEX registration, global decision [D138], and the `tracking-changes.md` correction.
7. Deletion of the eight redirect-stub skills and the doc/manifest references to them.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Release.** The Release affordance and its discard preflight ship in [phase 4](dash-integration-4-join.md#step-10). This phase adds no second release path and no release verb.
- **Creating a dash from the picker.** `/dash <name>` already creates-if-needed and leaves a shell receipt saying what was made ([P05] of phase 2's plan). The picker never runs a git mutation.
- **Gating anything on review state.** The mark is advisory ([P07]). `dash-implement` already refuses to walk a stale plan at setup; a second gate at landing would block work the user can see is fine.
- **Dropping the draft ledger's legacy owner key.** `tugutil draft`'s `legacy_id` / `legacy_owner_id` fallback (`tugutil/src/draft.rs`, `tugcast/src/server.rs`, `tugcast/src/feeds/changeset.rs`) stays ([P06]).
- **A cross-project picker.** The `/dash` picker lists this card's project's dashes. The account-global list is the Lens's job and stays there.
- **Any new chord.** Nothing here earns one; ⌃⌘J is Jots.

#### Dependencies / Prerequisites {#dependencies}

- **Phase 4 (join mode) must be landed first.** [#step-5](#step-5) adds affordances to `session-changes-dash-lane.tsx` rows that phase 4 restructures (its step 6 adds `SessionChangesDashLanding` and a landing face to the same row; its step 10 adds Release to the same affordance cluster). Building phase 5's row affordances on the pre-phase-4 row shape would be rewritten immediately.
- Phase 2.1 (shipped, `eb5953baa` + fixups): `tugutil_core::plan` with `parse`, `review_state`, `content_stamp`, `ReviewState`.
- Phase 3.1 (shipped, `1eba4c683`): `plan_path` on `DashDetail` and on the dash changeset entry; `tugutil plan status` / `stamp`.
- `tugcast` already depends on `tugutil-core` (see `tugrust/crates/tugcast/Cargo.toml`) — [#step-1](#step-1) needs no new dependency edge.

#### Constraints {#constraints}

- **Warnings are errors.** `tugrust/.cargo/config.toml` sets `-D warnings`; a build with any warning fails.
- Every tugdeck change must pass `bunx tsc --noEmit` and `bunx vite build` — the debug app loads the rollup bundle, so a change that only survives HMR is not done.
- App-tests are selective. `just app-test-changed` derives the run from `@covers` back-references and refuses past a 20-file budget; when it refuses, name the files. Never `just app-test-all`.
- Any new `*.test.ts` under `tests/app-test/` must carry `@covers` lines that resolve, or `just app-test-covers-check` fails.
- The Lens Dashes section's data pass must not read per-card session phase — phase lives on `codeSessionStore` snapshots that move on every transcript event, and the section deliberately mounts that subscription at the leaf (`DashPhaseDot`). [#step-3](#step-3)'s ordering must stay inside the snapshot projection for the same reason.

#### Assumptions {#assumptions}

- A plan document is small (tens of kilobytes) and `plan::parse` is a single-pass markdown scan, so reading and parsing one plan per dash inside the changeset feed's existing blocking hop is negligible next to the git subprocesses `dash_detail_entries_in` already runs for each dash ([P04]).
- Most projects hold a handful of dashes, not hundreds — the picker is a flat list with no search field, and the Lens ordering is an ordinary comparator sort.
- The Session card's `/` completion popup is built from the `session_capabilities` command catalog, so deleting a skill directory removes it from the popup with no deck change ([#step-7](#step-7)).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Should a parked dash's row say how long it has been parked? (DEFERRED) {#q01-parked-age}

**Question:** The Lens row and the shade row both render the parked mark as a binary — either a live session is working this dash or none is. Neither says *when* it was last worked. A dash parked for an hour and one parked for three weeks read identically, and only the second one is a candidate for release.

**Why it matters:** It changes what the feed carries. "Last worked" is not derivable from anything currently on the wire: `bound_sessions` is a live-sessions-only query, so an unbound dash carries no timestamp at all. Answering it means either surfacing the newest dash-log line's timestamp (`append_dash_log` writes them; nothing reads them back as a time) or the branch tip's committer date. Both are new fields on `DashDetail` and on the changeset entry.

**Options (if known):**
- Newest dash-log entry's timestamp — the truest "last activity", since it counts `mark` and `step` declarations, not just commits.
- Branch tip committer date — free from git, but a dash worked all day without a commit reads as stale.
- Nothing — parked is parked.

**Plan to resolve:** Revisit once the lane has been lived in with more than a handful of dashes at once, which is the only condition under which the distinction pays for a new wire field. If it earns its way in, the dash-log timestamp is the candidate to spike first, since it is the one that matches what "worked" means everywhere else in this program.

**Resolution:** DEFERRED — not required for phase close. Nothing in this phase forecloses it: adding a field to `DashChangesetEntry` is additive and skip-if-none, exactly as `plan_path` and `review` are.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Reading a plan per dash per recompose slows the changeset feed | low | low | The read happens inside the existing `spawn_blocking` hop, alongside git subprocesses that already dominate; an unreadable or unparseable plan degrades to no field, never to an error | A changeset recompose measurably regresses on a repo with many dashes |
| Phase 5's row affordances conflict with phase 4's row rewrite | med | med | Phase 5 is sequenced strictly after phase 4 (#dependencies); [#step-5](#step-5) extends the affordance cluster phase 4 establishes rather than introducing a second one | Phase 4 lands with a materially different row shape than its step 6 describes |
| Deleting a stub breaks a clickable chip in an old transcript | low | high | Accepted deliberately — the chip becomes an unknown command, which the card already handles with a "no such command" alert rather than a burned turn | A user reports losing something they still reach for |
| The picker's binding races a mid-turn rebind | low | low | `bind_dash` is a CONTROL verb with no turn semantics, and the binding store moves only on the `bind_dash_ok` broadcast, so a refusal leaves the card bound to what it was | — |

**Risk R01: The stale mark misreads a plan the dash does not actually drive** {#r01-wrong-plan}

- **Risk:** `plan_path` is recorded on the dash's branch config by `dash step start --plan`, and it is never cleared. A dash that finished its plan, then carried on with unrelated `dash-on` rounds, still points at that plan — and if somebody edits the plan afterwards, the dash grows a stale mark for work it is no longer doing.
- **Mitigation:**
  - The mark is advisory and carries a tooltip naming the plan path ([P03]), so the reading is always "this plan, which this dash recorded" rather than an unattributed alarm.
  - The mark is *absent*, not benign-looking, when there is no `plan_path` — a plan-less dash never grows one.
- **Residual risk:** A long-lived dash that outgrew its plan reads as stale forever. Clearing `plan_path` would need a verb (`dash step` is the only writer today) and no gesture asks for one yet; the honest answer is that such a dash *is* pointing at a stale plan, which is true even if it no longer cares.

**Risk R02: `unbind_dash` leaves the server's ledger and the card disagreeing** {#r02-unbind-ledger}

- **Risk:** Leave sends `unbind_dash { tug_session_id }` and waits for `unbind_dash_ok` to clear `cardSessionBindingStore`. If the broadcast is lost, the card keeps showing a dash chip for a binding the ledger no longer holds, and the shade's lane keeps fronting that dash.
- **Mitigation:**
  - The deck already treats the ack as the only mover for the bind direction (`action-dispatch.ts`'s `bind_dash_ok` / `unbind_dash_ok` handlers, and the `dash-bind-error-store` for refusals) — Leave inherits that discipline rather than optimistically clearing.
  - The next changeset recompose re-emits `bound_sessions` from the ledger, so the Lens row self-corrects even if the card's chip does not.
- **Residual risk:** A dropped ack leaves one card's chip wrong until it rebinds or reloads. That is the pre-existing property of every binding gesture in the lane, not something this step introduces.

---

### Design Decisions {#design-decisions}

#### [P01] The `/dash` picker is a pane-modal sheet, never transcript ink (DECIDED) {#p01-picker-sheet}

**Decision:** Bare `/dash` in a project with more than one dash opens a sheet on the session card's existing sheet host (`cardPickerSheet`, the `useTugSheet()` instance the card already holds and renders), listing the project's dashes; Return or click binds the highlighted one and closes. With exactly one dash it binds that dash directly and opens nothing. With none it keeps today's caution ("No dashes in this project — /dash \<name\> starts one"). The shade no longer opens as the bare-`/dash` response.

**Rationale:**
- Picking a dash is a UI-concept act with no turn and no durable consequence, exactly like the `bind_dash` it performs. Transcript ink is for things that happened to the *work*; a pick is not one of them. A `TugInlineDialog` mounted in transcript flow — the other candidate — would put a disposable choice permanently in the record.
- The sheet host is where every other picker in the session card already lives (the card picker, the compaction progress sheet, the slash-command notice alert, and a dozen more `showSheet` call sites), so this needs no new surface, no new dismissal semantics, and no new focus scope.
- One dash is not a choice. Opening a sheet to confirm the only option is ceremony, and the existing verb already has the "act, don't ask" shape for the named case.

**Implications:**
- The sheet's `content` renders a `TugListView` over a data source built from the project's dash entries, composing `TugListRow` per [L19]; the list owns arrow navigation and `commitOnEnter`, so no key handling is written by hand.
- The picker never mutates git and never touches `shellSessionStore` — see [#non-goals](#non-goals).
- Bare `/dash` no longer calls `shadeViewController.show("changes")`. The shade remains reachable by every other route it already has.

#### [P02] The Lens Dashes section is totally ordered: worked first, then by stage, then by name (DECIDED) {#p02-lens-ordering}

**Decision:** `dashRowsFromSnapshot` sorts its flattened rows by a three-key comparator: (1) not-parked before parked; (2) descending stage rank, `landing` > `draft-ready` > `audited` > `built` > `implementing` > `working` > `created`, with an absent or unrecognized stage sorting last; (3) `display_name` ascending as the tiebreak. Project grouping is dropped as an ordering key — the project label already rides each row when more than one project has dashes.

**Rationale:**
- The section's own job, per its docblock, is to answer *whether anyone is on it*. An ordering that ignores that answer contradicts the section's premise; sorting worked dashes first makes the first screenful the useful one.
- Stage rank is nearest-to-done first, because the actionable dash is the one about to land, not the one just created. `landing` sorts top because it means an interrupted teardown — the one state that actively needs a person.
- Name is the tiebreak rather than snapshot order because snapshot order is git-enumeration order, which is stable but arbitrary, and an arbitrary stable order still reshuffles when a branch is created or deleted.
- The sort is a pure function of the snapshot, so it stays inside the projection and adds no state, no store, and nothing to invalidate ([L02] is untouched).

**Implications:**
- The stage-rank table is exported so its test can be a table test rather than a DOM assertion.
- Rows keyed on `ownerId` already, so reordering does not disturb `TugListView` identity.

#### [P03] Review state is computed on the server and rides the changeset entry (DECIDED) {#p03-review-on-the-wire}

**Decision:** `dash_entries` in `tugcast/src/feeds/changeset.rs` resolves each dash's plan (repo root / `worktree_rel` / `plan_path`), reads it, parses it with `tugutil_core::plan::parse`, and emits `review: Some("reviewed" | "stale" | "never-reviewed")` on the dash changeset entry. A dash with no `plan_path`, an unreadable file, or a document that does not parse as a plan emits no field at all. The deck never reads a plan.

**Rationale:**
- The value already has exactly one definition — `tugutil_core::plan::review_state` — and `tugcast` already depends on that crate. Computing it anywhere else would be a second implementation of a hash comparison, which is the class of duplication that drifts silently.
- The deck has no filesystem access and no markdown plan parser, and giving it either to paint a badge would be a large amount of new surface for a cosmetic mark.
- Three surfaces need the same answer. One field on the entry they all already read is the whole delivery.
- **Absence is the honest reading for every failure.** A plan that cannot be read has not been shown to be stale; emitting `never-reviewed` for an I/O error would put a scolding mark on a dash whose plan is merely on a branch that is not checked out.

**Implications:**
- `ChangesetEntry::Dash` grows `review: Option<String>` with `skip_serializing_if = "Option::is_none"`, matching how `plan_path` and `step_current` already ride.
- `DashChangesetEntry` in `tugdeck/src/lib/changeset-types.ts` grows `review?: string`, and the changeset golden fixtures (`tugdeck/src/__tests__/fixtures/changeset-snapshot.golden.json`, `workspaces-changeset-snapshot.golden.json`) are regenerated if they carry a dash entry.
- The read is unconditional per recompose with no memoization — see [P04].

#### [P04] The plan read is unconditional; no mtime cache (DECIDED) {#p04-no-cache}

**Decision:** The review-state read happens on every changeset recompose, with no caching layer keyed on path, mtime, or size.

**Rationale:**
- `dash_entries` already calls `tugdash_core::dash_detail_entries_in`, which runs several `git` subprocesses *per dash* (branch config reads, a rev-list for rounds, a status for worktree dirt, a log for round subjects). A process spawn costs more than reading and parsing a 50 KB markdown file, so a cache would be optimizing the cheap half.
- A cache is a correctness surface: keyed on mtime it misses same-second edits, keyed on content it has already done the read. Neither is worth carrying for a badge.

**Implications:**
- If a repo with many dashes ever measurably regresses, the fix is to cache `dash_detail_entries_in`'s whole result, not the plan read — this decision names the right target for that future work rather than pre-solving it in the wrong place.

#### [P05] Adopt and Leave live on the shade's dash rows; the Lens stays read-only (DECIDED) {#p05-affordance-home}

**Decision:** A non-fronted dash row in the Changes shade's dash lane gains an **Adopt** affordance that sends `bind_dash`; the fronted row (this card's own dash) gains a **Leave** affordance that sends `unbind_dash`. The Lens Dashes section gains no verbs and keeps its jump-to-card chip as its only gesture.

**Rationale:**
- The shade is already the room where a dash's facts live — base, rounds, dirt, round subjects, join draft, and (after phase 4) the landing outcome. The act of taking a dash on belongs beside the facts you would take it on for.
- The Lens is account-global and its rows deliberately span projects; a bind is per-card and per-project, so a bind gesture there would need to answer "bound to which card?" — a question the Lens has no answer to and the shade answers by construction (it is *this card's* shade).
- The Lens section's docblock states it is read-only on purpose. Keeping it so means one fewer surface to keep honest as the lane's verbs grow.
- Adopt on a non-fronted row and Leave on the fronted one are complements, so the two never appear on the same row and the cluster stays one affordance wide.

**Implications:**
- `SessionChangesDashLaneProps` grows `onAdopt(entry)` and `onLeave(entry)` callbacks; the lane stays a presentational component taking data as props, and `session-changes-view.tsx` wires the senders.
- The card is the only thing that knows its `tugSessionId` and `projectDir`, so the senders are built there (or in the view from `cardSessionBindingStore`), not in the lane.
- Adopt on a row whose dash this card is *already* bound to never renders — that row is the fronted one by definition.
- Phase 4's rule that "non-fronted dash rows stay read-only" is about *landing* — a gesture that lands work from a card that never touched it. Adopting is the opposite act (it is how a card comes to touch it), so it does not violate that rule.

#### [P06] The skill stubs go; the draft ledger's legacy owner key stays (DECIDED) {#p06-what-compat-goes}

**Decision:** Delete the eight redirect-stub skill directories — `audit`, `dash`, `dash-run`, `devise`, `implement`, `join`, `review-plan`, `vet` — and every doc/manifest reference to them. Keep `tugutil draft`'s legacy owner-key fallback in full: `Owner::legacy_id`, `dash_owner`'s bare-`tugdash/<name>` sibling, the `legacy_owner_id` field on the draft-set request, `tugcast/src/server.rs`'s read-through-and-supersede, and `legacy_owner_key` in `tugdash-core::ops` with its use in `feeds/changeset.rs` and `feeds/agent_supervisor.rs`.

**Rationale:**
- The two compat surfaces have different clocks. A stub skill is compat for **text in a transcript**: it expires the moment nobody clicks an old chip, and its failure mode is a "no such command" alert. The legacy owner key is compat for **rows on disk** in a SQLite ledger, which can be arbitrarily old and whose failure mode is a draft that silently cannot be found.
- The legacy key costs nothing to keep: it is a read-side fallback that *supersedes* — the first resolution through the legacy key rewrites the row under the current key, so the population it serves shrinks to zero on its own. Deleting it would strand exactly the rows it has not reached yet.
- Eight stubs is a roster three-quarters composed of redirects, which makes the real roster hard to read — the cost of keeping them is paid on every listing.

**Implications:**
- `tugplug/.claude-plugin/plugin.json`'s `description` and `keywords` name `devise`, `review-plan`, `implement`, and `dash`; they are rewritten to the shipped names.
- `tugplug/CLAUDE.md`'s stub paragraph is deleted, not amended.
- Nothing in `tugdeck/`, `tugrust/`, or `tugapp/` references a stub by name (verified by grep across the repo; the only hits outside `tugplug/skills/` and `roadmap/` are in the plugin manifest), so no code change is entangled with this deletion.

#### [P07] The stale-review mark is advisory and gates nothing (DECIDED) {#p07-advisory-only}

**Decision:** The mark paints in three surfaces with a tooltip naming the plan and its state, and blocks no gesture. Join mode's gate readout does not mention it; the Join affordance's enablement does not consider it.

**Rationale:**
- The gate that matters already exists and is earlier: `dash-implement` reads `tugutil plan status` at setup and raises a dialog before walking a plan whose review is `stale` or `never-reviewed`. That is the moment where acting on an unreviewed design is expensive.
- By landing time the work is written, built, and vetted by a human. Blocking a landing on a document's hash would refuse work the user is looking at, on the strength of a mark about a *plan*.
- An advisory mark that is never a blocker can be read at a glance and ignored; a mark that is sometimes a blocker has to be reasoned about every time.

**Implications:**
- No change to phase 4's `JoinBlocker` set, its wire spec, or its gate.
- The mark's whole contract is: paint, and say what it means on hover.

#### [P08] `tuglaws/dash-lifecycle.md` is the one home for the dash model; [D138] is its compressed entry (DECIDED) {#p08-doctrine-home}

**Decision:** Write `tuglaws/dash-lifecycle.md` covering the state model (the seven derived/declared stages and `derive_stage`'s precedence), the identity model (owner key, creation id, legacy key), the binding concept (what a bind is, that it is per-card and live-sessions-only, that it is a UI concept git cannot see), the derive-vs-declare rule, and the landing doctrine (two-beat: beat 1 shows exactly what beat 2 will do; skills draft, humans land). Register it in `tuglaws/INDEX.md` under the existing "Working on a dash" section beside `dash-work-doctrine.md`. Add one new global decision, **[D138]**, stating the derive-vs-declare rule compactly and pointing at the new file. Correct `tuglaws/tracking-changes.md`'s stale two-beat `/commit` sentence.

**Rationale:**
- The distinction between the two dash docs is real and worth keeping: `dash-work-doctrine.md` is about **how an agent behaves** on a worktree (working root, verification bar, banned test shapes); `dash-lifecycle.md` is about **what a dash is** and what its states mean. Merging them would give one file two audiences.
- `design-decisions.md` entries are single dense paragraphs; the lifecycle needs tables and a state list, so the file is the home and [D138] is the index into it — the same relationship `tracking-changes.md` has with [D112] and [D113].
- The `/commit` sentence is not merely out of date, it describes a gesture that no longer exists (`now` was a real keyword and is now inert), which is the kind of doc error that costs somebody an afternoon.

**Implications:**
- [D138] is the next free number: `design-decisions.md`'s highest existing entry is **D137**.
- The new file is doctrine only — it introduces no rule that the code does not already follow, so nothing in this step can fail a test.

---

### Deep Dives {#deep-dives}

#### How review state is resolved, exactly {#review-resolution}

The pieces already exist and only need joining. In `tugrust/crates/tugcast/src/feeds/changeset.rs`, `dash_entries(repo_root, ledger)` runs `tugdash_core::dash_detail_entries_in(&root)` inside a single `tokio::task::spawn_blocking` hop and maps each `DashDetail` into a `ChangesetEntry::Dash`. The detail already carries `plan_path: Option<String>` (recorded on the dash's branch config by `dash step start --plan`, read back by `tugdash_core::ops::dash_plan_path`) and `worktree_rel`.

The absolute plan path is `repo_root.join(worktree_rel).join(plan_path)` — the same composition `changeset-types.ts` documents on the `plan_path` field ("Absolute path is `projectDir` / `worktree` / `plan_path`"). It is the **worktree** copy deliberately: that is the document a dash run edits and whose ledger the step verbs rewrite, so it is the one whose review state describes the work in flight.

From there:

```rust
fn dash_review_state(repo_root: &Path, worktree_rel: &str, plan_path: &str) -> Option<String> {
    let abs = repo_root.join(worktree_rel).join(plan_path);
    let source = std::fs::read_to_string(&abs).ok()?;
    let doc = tugutil_core::plan::parse(&source).ok()?;
    Some(tugutil_core::plan::review_state(&doc, &source).as_str().to_string())
}
```

Every failure is `None`, per [P03]. `ReviewState::as_str` already returns the exact wire spellings `plan status` reports (`"reviewed"`, `"stale"`, `"never-reviewed"`), so there is no second vocabulary to keep in sync.

The call must happen **inside** the `spawn_blocking` closure — it is synchronous file I/O, and hoisting it out would put a blocking read on the async runtime. The cleanest shape is to compute it in the same closure that produces the details, returning `(DashDetail, Option<String>)` pairs.

#### What the mark looks like in each of the three surfaces {#mark-surfaces}

All three read the same field and paint per [L06] — a data attribute plus CSS, never React state for appearance.

| Surface | File | Where it goes | Shape |
|---|---|---|---|
| Lens Dashes row | `tugdeck/src/components/lens/sections/dashes-section.tsx` | A new fact in the `lens-dashes-facts` span, after `lens-dashes-stage` | A small glyph wrapped in `TugTooltip`, `data-slot="lens-dashes-review"`, `data-review="stale"` |
| Changes shade dash row | `tugdeck/src/components/tugways/cards/session-changes/session-changes-dash-lane.tsx` | A new fact in the `session-changes-dash-facts` span, after the stage fact, behind the same `·` separator convention | Same glyph + tooltip, `data-slot="session-changes-dash-review"` |
| Masthead dash chip | `tugdeck/src/components/tugways/session-masthead.tsx` | The existing `session-masthead-dash-chip` `TugBadge` gains a `data-review` attribute; CSS paints the mark | Attribute only — no new element inside the chip, which is one line tall |

Only `stale` and `never-reviewed` paint. `reviewed` and absent paint nothing, because a mark that is always present is not a mark. The two painting states are visually distinct (per the tooltip text at minimum), because "this was reviewed and has moved since" and "nothing ever reviewed this" call for different responses.

**The masthead reads the account-global aggregate, not a card controller.** `SessionMastheadProps` is `{ sessionId, cardId?, accessoryHost? }` — it is handed no `ChangesRouteController` and must not grow one for a badge. The precedent it should follow is already in the same file: it reads the branch with `useSessionBranch(projectDir)` from `@/lib/changeset-all-store`, which is exactly this shape — a per-card fact derived from the account-global snapshot via `useSyncExternalStore` ([L02]).

So the mechanism is a sibling hook in `tugdeck/src/lib/changeset-all-store.ts`, written beside `branchForProject` / `useSessionBranch` and memoized the same way:

```ts
export function dashReviewForProject(
  data: WorkspacesChangesetSnapshot,
  projectDir: string | null,
  dashOwnerId: string | null,
): string | null
export function useDashReviewState(
  projectDir: string | null,
  dashOwnerId: string | null,
): string | null
```

It finds the project by `project_dir`, then the dash entry by **`owner_id === dashOwnerId`** — never by name. A stale binding to a dead incarnation of a reused name must not paint the wrong dash's mark; this is the same rule `orderDashLane` in the shade lane already states for choosing the fronted row. The masthead already holds `projectDir` (it computes it for `useSessionBranch`) and gets the owner key from `cardSessionBindingStore.getBinding(cardId)?.dash?.id`.

#### The picker's shape {#picker-shape}

The handler lives in `session-card.tsx`'s local slash-verb table, in the `name.length === 0` branch of the existing `dash:` entry. The branch becomes:

- `snap.dashes.length === 0` → today's caution, unchanged.
- `snap.dashes.length === 1` → send `bind_dash` for that one dash. No sheet.
- otherwise → `void cardPickerSheet.showSheet({ title: "Work on a dash", icon: "GitBranch", iconRole: "agent", content: (close) => <DashPickerSheet … /> })`.

`DashPickerSheet` is a new component beside the other card sheets. It composes `TugListView` with a flat immutable data source over the project's dash entries (the same `DashRowsDataSource` pattern the Lens section uses — a class with `numberOfItems` / `idForIndex` / `kindForIndex` / a no-op `subscribe` / `getVersion` returning the array), one `TugListRow` per dash showing name · stage · rounds · dirty, with `commitOnEnter="act"` and a delegate whose `onActivate(index)` sends the bind and calls `close()`.

The card's own dash (matched by owner key against `cardSessionBindingStore.getBinding(cardId)?.dash?.id`) renders with a "current" mark and is the initially-selected row. Seed it with `TugListView`'s `initialSelectedIndex` prop — the surface-supplied active row, which the list prefers over its own selection when placing the cursor — so Return with no arrow presses is a no-op rebind rather than a surprise. Do not mirror the selection into React state; the list owns it ([L19]).

The uncomposed guard (`!snap.composed`) must come **before** the branch on `snap.dashes.length`, not after: before the first aggregate emit the list is empty for reasons that have nothing to do with the project, and showing "no dashes in this project" then is a lie. The existing handler already has this guard but places it after the bare-form branch, which is correct today only because the bare form's response (open the shade) is harmless when the snapshot is empty. Moving it up is part of this step.

#### Adopt and Leave: the wire, exactly {#adopt-leave-wire}

Both are CONTROL frames on the existing connection, sent with `getConnection()?.sendControlFrame(...)`, and neither produces transcript ink.

**Adopt** — the same frame the typed `/dash <name>` verb already sends:

```
bind_dash { tug_session_id, project_dir, dash: <display_name> }
```

Parsed by `parse_bind_dash_payload` in `tugcast/src/feeds/agent_supervisor.rs`. Note the payload names the dash by its **short name**, not its owner key — that is the existing verb's contract and Adopt inherits it. The bind **mints**: naming a dash that does not exist succeeds anyway. That is not reachable here (the name comes from a row in the snapshot), but it is why the frame must never be built from user text on this path.

**Leave**:

```
unbind_dash { tug_session_id }
```

Parsed by `parse_tug_session_id_payload` — the session id is the whole payload, because a session has at most one dash binding. Nothing else is needed and nothing else is read.

Both acks are already registered in `tugdeck/src/action-dispatch.ts` (`bind_dash_ok`, `unbind_dash_ok`) and both already move `cardSessionBindingStore`. **Neither affordance may optimistically move the store** — the broadcast is the mover, per the comment already in `action-dispatch.ts` ("the chip and the lane both wait for `bind_dash_ok` — so a refusal has …"). This is what makes a refused bind leave the card correctly bound to what it was.

#### What happens on the edges {#edges}

The happy paths above are short; these are the cases an implementer will hit and should not have to re-derive.

**Two cards on one dash is legal, not a race.** `bound_sessions` is a *list*, and the Lens row already renders one jump chip per bound session. Adopting a dash another card holds is a supported state, not a conflict — do **not** add a guard, a confirm, or a steal. The only thing a bind displaces is *this* card's previous binding, because a session has at most one dash (which is why `unbind_dash`'s payload is the session id and nothing else).

**A picker dismissed mid-bind is harmless.** `close()` runs immediately after `onPick` sends the frame; the `bind_dash_ok` broadcast then lands on a card with no sheet and moves the binding store anyway, because the store's mover is the ack and never the sheet. The sheet's promise carries no result and nothing awaits the bind's outcome — a refusal surfaces through `dash-bind-error-store`, which is card-scoped and outlives the sheet.

**A released dash disappears mid-gesture.** Release (phase 4's step 10) tears down branch and worktree; the entry vanishes on the next aggregate recompose and the row unmounts. A click already in flight against that row sends `bind_dash` for a name that no longer exists — and `bind_dash` **mints**, so it succeeds and leaves the card wearing a chip for a dash with no branch. This is pre-existing (`/dash <name>` has always had it, which is why the typed verb matches against the snapshot first) and is not this phase's to fix; the exposure here is one recompose wide.

**The mark and the mid-review plan.** `plan-review` edits the plan and stamps it *last*, so a recompose landing between the edit and the stamp reads `stale` for a plan that is being reviewed right now. That is correct — it *is* stale at that instant — and it self-corrects on the next recompose after the stamp. No debounce, no suppression: a mark that lied about the intervening moment would be worse than one that flickers.

**A plan on a branch that is not checked out.** `plan_path` is worktree-relative and the worktree is the dash's own, so the file is on disk whenever the dash is active. A dash whose worktree was removed out from under it (a manual `git worktree remove`) reads as `None` per [P03] rather than as an error — which is the same degradation `dash_detail_entries_in` already applies to every other fact about such a dash.

#### What `tuglaws/dash-lifecycle.md` has to say {#lifecycle-contents}

The material is all established; the file's job is to hold it in one place. The outline:

- **What a dash is.** A git branch (`tugdash/<name>`) plus a worktree plus branch config (`branch.tugdash/<name>.{tugbase,description,tugid,tugplan}`) plus a dash-log. Every fact about a dash is one of those four; there is no dash database.
- **Identity.** The owner key is `tugdash/<name>#<tugid>` (`tugdash_core::ops::dash_owner_key`), opaque, never displayed, never a git ref. It is what makes two incarnations of a reused name distinct. A dash created before ids existed keys under the bare branch ref, which is the legacy key `legacy_owner_key` strips to, and which `tugutil draft` still reads through and supersedes ([P06]).
- **The stages, and derive vs declare.** Seven values from `derive_stage(rounds, worktree_dirty, has_draft, landing, declared)` with precedence `landing > declared > draft-ready > working > created`. `landing` is derived from the presence of a join journal; `implementing` / `built` / `audited` are *declared* by `dash step` and `dash mark`, because git cannot see them. The rule: **anything git can see is derived on every read and never stored; anything it cannot is declared once, in the dash-log, by a verb.** A stage is never written to a config key.
- **Binding.** A bind mates a live session to a dash. It is a UI concept — git has no idea — stored in the per-instance `sessions.db` and read back live-sessions-only, which is exactly why a dash whose cards have all closed reads as *parked*. Parked is not a stage; it is the absence of workers. A bind is per-card, minting, and never a landing authority.
- **Landing.** Two beats, and beat 1 shows exactly what beat 2 will do. Preview is `git merge-tree --write-tree` in memory and touches nothing. Skills draft, humans land: `/commit` (main lane) and `/join <name>` (dash lane) are the user's gestures, and a skill's part ends at `tugutil draft set`.
- **Cross-references** to `dash-work-doctrine.md` (agent behavior), `tracking-changes.md` (the capture/commit layer beneath), [D112]/[D113]/[D116], and the new [D138].

---

### Specification {#specification}

**Spec S01: `review` on the dash changeset entry** {#s01-review-field}

Emitted by `dash_entries` in `tugcast/src/feeds/changeset.rs`; consumed by the Lens section, the shade lane, and the masthead.

| Field | Type | Presence | Meaning |
|---|---|---|---|
| `review` | `string` | omitted when absent (`skip_serializing_if = "Option::is_none"`) | One of `"reviewed"`, `"stale"`, `"never-reviewed"` — `tugutil_core::plan::ReviewState::as_str` verbatim |

Omitted when: the dash records no `plan_path`; the file cannot be read; the document does not parse as a plan. Consumers treat omission as "nothing to say" and paint nothing.

**Spec S02: the Lens Dashes ordering comparator** {#s02-lens-order}

Applied to the flattened row list inside `dashRowsFromSnapshot`, after projection and before return.

1. `parked` ascending — `false` (worked) before `true`.
2. Stage rank descending, per **Table T01**.
3. `name` ascending, `localeCompare`.

**Table T01: stage rank** {#t01-stage-rank}

| Stage | Rank |
|---|---|
| `landing` | 6 |
| `draft-ready` | 5 |
| `audited` | 4 |
| `built` | 3 |
| `implementing` | 2 |
| `working` | 1 |
| `created` | 0 |
| absent / unrecognized | −1 |

An unrecognized stage sorts last rather than throwing: an older or newer sender must never be able to break the section's render.

**Spec S03: `DashPickerSheet`'s contract** {#s03-picker-contract}

| Input | Type | Notes |
|---|---|---|
| `dashes` | `readonly DashChangesetEntry[]` | This project's dash entries, in the snapshot's order — the picker does **not** apply [P02]'s ordering, which is the Lens's presentation choice |
| `boundDashId` | `string \| null` | Owner key of this card's current dash; marks and seeds the selection |
| `onPick` | `(entry) => void` | Sends `bind_dash`; the sheet calls `close()` immediately after |

The sheet resolves with no result value; the bind's outcome arrives through `bind_dash_ok` / the bind-error store, not through the sheet's promise.

#### State Zone Mapping {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| `review` on the dash entry | local-data | Server-computed, arrives on the changeset snapshot; the Lens reads it via `useChangesetAll`, the shade via its `ChangesRouteController` snapshot, the masthead via the new `useDashReviewState` — all three `useSyncExternalStore` reads of an existing store, no new store | [L02] |
| The stale mark's paint | appearance | `data-review` attribute + CSS in the three surfaces' stylesheets; no React state | [L06] |
| Lens row order | local-data (derived) | Pure sort inside `dashRowsFromSnapshot`, memoized by `useMemo` on the snapshot | [L02], [L22] |
| Picker sheet open/closed | structure | `useTugSheet`'s imperative `showSheet` promise on the card's existing host; nothing persisted | — |
| Picker's highlighted row | local-data | `TugListView`'s own selection; the consumer never mirrors it into React state | [L19] |
| Card's dash binding after Adopt / Leave | local-data | `cardSessionBindingStore`, moved **only** by the `bind_dash_ok` / `unbind_dash_ok` broadcasts | [L02], [L28] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/cards/dash-picker-sheet.tsx` | The `/dash` picker's sheet content ([P01], Spec S03) |
| `tugdeck/src/components/tugways/cards/dash-picker-sheet.css` | Its row styling |
| `tuglaws/dash-lifecycle.md` | The dash state / identity / binding / landing doctrine ([P08]) |
| `tests/app-test/at0416-dash-picker.test.ts` | The picker's app-test |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `dash_review_state` | fn | `tugrust/crates/tugcast/src/feeds/changeset.rs` | Reads + parses the dash's plan; every failure is `None` ([P03]) |
| `ChangesetEntry::Dash { review }` | enum variant field | `tugrust/crates/tugcast/src/feeds/changeset.rs` | `Option<String>`, skip-if-none (Spec S01) |
| `DashChangesetEntry.review` | interface field | `tugdeck/src/lib/changeset-types.ts` | `review?: string` |
| `DASH_STAGE_RANK` | const | `tugdeck/src/components/lens/sections/dashes-section.tsx` | Exported for its table test (Table T01) |
| `compareDashRows` | fn | `tugdeck/src/components/lens/sections/dashes-section.tsx` | Exported comparator (Spec S02) |
| `DashRow.review` | interface field | `tugdeck/src/components/lens/sections/dashes-section.tsx` | Carried through the projection |
| `DashPickerSheet` | component | `tugdeck/src/components/tugways/cards/dash-picker-sheet.tsx` | Spec S03 |
| `dashReviewForProject` / `useDashReviewState` | fn / hook | `tugdeck/src/lib/changeset-all-store.ts` | Beside `branchForProject` / `useSessionBranch`, same shape ([#mark-surfaces](#mark-surfaces)) |
| `SessionChangesDashLaneProps.onAdopt` / `.onLeave` | props | `.../session-changes/session-changes-dash-lane.tsx` | [P05] |
| `SessionMastheadProps` review input | prop / store read | `tugdeck/src/components/tugways/session-masthead.tsx` | Bound dash's review state, matched by owner key ([#mark-surfaces](#mark-surfaces)) |

#### Files deleted {#deleted-files}

| Path | Reason |
|------|--------|
| `tugplug/skills/audit/` | Redirect stub → `dash-audit` ([P06]) |
| `tugplug/skills/dash/` | Redirect stub → `dash-on` |
| `tugplug/skills/dash-run/` | Redirect stub → `dash-on` |
| `tugplug/skills/devise/` | Redirect stub → `plan-devise` |
| `tugplug/skills/implement/` | Redirect stub → `dash-implement` |
| `tugplug/skills/join/` | Redirect stub → `dash-join` |
| `tugplug/skills/review-plan/` | Redirect stub → `plan-review` |
| `tugplug/skills/vet/` | Retired → `plan-review` |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/dash-lifecycle.md` — new ([P08], [#lifecycle-contents](#lifecycle-contents))
- [ ] `tuglaws/INDEX.md` — register it under "Working on a dash"
- [ ] `tuglaws/design-decisions.md` — add [D138]
- [ ] `tuglaws/tracking-changes.md` — correct the two-beat `/commit` sentence
- [ ] `tugplug/CLAUDE.md` — delete the stub paragraph
- [ ] `tugplug/.claude-plugin/plugin.json` — `description` and `keywords` name only shipped skills

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Rust unit** | `dash_review_state` over real files in a `TempDir` — a stamped plan, an edited-after-stamp plan, an unstamped plan, a missing file, a non-plan file | Step 1 |
| **bun table** | `compareDashRows` / `DASH_STAGE_RANK` over constructed row arrays | Step 3 |
| **app-test** | Real dashes via `tests/app-test/dash-fixture.ts`, real plans on disk, real clicks | Steps 2, 4, 5 |
| **grep checkpoint** | The deletions and the doc corrections are absence claims; grep is the falsifier | Steps 6, 7 |

#### What stays out of tests {#test-non-goals}

- **The mark's exact glyph or color** — appearance is CSS per [L06]; the tests assert the `data-review` attribute, which is the contract.
- **The sheet's animation** — motion is `TugAnimator`'s and background app-test windows run no rAF; a gesture's outcome is never hung off its animation.
- **A jsdom render of the picker** — banned shape. The picker is proved by an app-test driving the real list with real keys, and its ordering logic is not in the picker at all.
- **`tugutil_core::plan::review_state` itself** — already covered by phase 2.1's tests; step 1 tests the *joining*, not the primitive.
- **That the bind/unbind acks, rather than the handlers, move the binding store** — stated plainly because it is a real discipline with no honest test behind it. `bind_dash` **mints**, so a bind sent from a snapshot row cannot be refused, and there is no cheap way to drive a connection-down state from an app-test. An optimistic write would therefore pass every assertion in [#step-5](#step-5). The discipline is held by [P05]'s implication, the comment already in `action-dispatch.ts`, and code review — not by a test, and this plan does not pretend otherwise.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Review state on the dash changeset entry | pending | — |
| #step-2 | The stale-review mark in three surfaces | pending | — |
| #step-3 | The Lens Dashes ordering | pending | — |
| #step-4 | The `/dash` picker sheet | pending | — |
| #step-5 | Adopt and Leave in the dash lane | pending | — |
| #step-6 | The lifecycle doctrine | pending | — |
| #step-7 | Delete the one-release stubs | pending | — |
| #step-8 | Integration checkpoint | pending | — |

#### Step 1: Review state on the dash changeset entry {#step-1}

**Commit:** `tugdash(polish-lane): the dash changeset entry carries its plan's review state`

**References:** [P03] review on the wire, [P04] no cache, Spec S01, (#review-resolution)

**Artifacts:**
- `dash_review_state` in `tugrust/crates/tugcast/src/feeds/changeset.rs`
- `review` on `ChangesetEntry::Dash` and on `DashChangesetEntry`

**Tasks:**
- [ ] Add `review: Option<String>` to the `ChangesetEntry::Dash` variant with `#[serde(skip_serializing_if = "Option::is_none")]`, placed beside `plan_path` so the two related fields read together.
- [ ] Write `dash_review_state(repo_root, worktree_rel, plan_path) -> Option<String>` per [#review-resolution](#review-resolution). Every failure path returns `None` — no logging louder than `tracing::debug!`, because an unreadable plan is a normal state, not an incident.
- [ ] Call it **inside** `dash_entries`' existing `spawn_blocking` closure, alongside `dash_detail_entries_in`. Returning `(DashDetail, Option<String>)` pairs from the closure is the shape that keeps all blocking work in one hop; do not add a second `spawn_blocking`.
- [ ] Add `review?: string` to `DashChangesetEntry` in `tugdeck/src/lib/changeset-types.ts`, documented as one of the three `plan status` spellings and as omitted-when-nothing-to-say.
- [ ] **Both golden fixtures carry exactly one dash entry** — `tugdeck/src/__tests__/fixtures/changeset-snapshot.golden.json` and `workspaces-changeset-snapshot.golden.json`. Neither dash records a `plan_path`, so under Spec S01 both should serialize with `review` **absent** and the goldens should not move at all. If either does move, that is the signal that the skip-if-none is wrong — fix the emission, not the fixture.

**Tests:**
- [ ] Rust, in `changeset.rs`'s test module, against a `TempDir` holding real files: `dash_review_state_reads_reviewed_for_a_stamped_plan` — write a plan with a Review Record round, stamp it via `tugutil_core::plan::set_review_stamp`, assert `Some("reviewed")`.
- [ ] Rust: `dash_review_state_reads_stale_after_the_document_moves` — append a line after stamping, assert `Some("stale")`.
- [ ] Rust: `dash_review_state_reads_never_reviewed_without_a_stamp`.
- [ ] Rust: `dash_review_state_is_absent_for_a_missing_file` and `…_for_a_document_that_is_not_a_plan` — both `None`.

**Checkpoint:**
- [ ] `cd tugrust && cargo build`
- [ ] `cd tugrust && cargo nextest run -p tugcast`
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit`

---

#### Step 2: The stale-review mark in three surfaces {#step-2}

**Depends on:** #step-1

**Commit:** `tugdash(polish-lane): a dash whose plan drifted past its review says so`

**References:** [P03] review on the wire, [P07] advisory only, Spec S01, Risk R01, (#mark-surfaces)

**Artifacts:**
- The mark in `dashes-section.tsx`, `session-changes-dash-lane.tsx`, `session-masthead.tsx`, and their stylesheets
- `at0407-lens-dashes-section.test.ts` and `at0406-masthead-dash-chip.test.ts` extended

**Tasks:**
- [ ] Carry `review` through `DashRow` in `dashes-section.tsx`'s `rowFromEntry`, and render the mark as a new fact in the `lens-dashes-facts` span with `data-slot="lens-dashes-review"` and `data-review={...}`. Wrap it in `TugTooltip`; the tooltip names the state in plain words and does **not** name a path (the Lens row is one line and spans projects, so a path there is noise).
- [ ] Render the same mark in `session-changes-dash-lane.tsx`'s facts span, behind the existing `·` separator convention, `data-slot="session-changes-dash-review"`. Here the tooltip **does** name the plan path — the shade is this project's room and the path is the actionable half (Risk R01).
- [ ] Add `dashReviewForProject` + `useDashReviewState` to `tugdeck/src/lib/changeset-all-store.ts`, written beside `branchForProject` / `useSessionBranch` and memoized to the string the same way ([#mark-surfaces](#mark-surfaces)). Match the dash on `owner_id`, **never** on name.
- [ ] In `session-masthead.tsx`, call it with the `projectDir` the file already computes for `useSessionBranch` and the owner key from `cardSessionBindingStore.getBinding(cardId)?.dash?.id`, and put the result on the existing `session-masthead-dash-chip` badge as `data-review`. Paint via CSS; add no element inside the chip. Do **not** thread a `ChangesRouteController` into `SessionMastheadProps` — the masthead is pane-supplied chrome and its props are `{ sessionId, cardId?, accessoryHost? }` on purpose.
- [ ] Only `stale` and `never-reviewed` paint. Give them visibly different tooltip text; if they share a glyph, they must not share a tone.
- [ ] Add the CSS in each surface's own stylesheet, with knob defaults expressed as `var(--x, default)` at the point of use rather than declared on the component's element.

**Tests:**
- [ ] app-test, extending `at0407-lens-dashes-section.test.ts`: create a real dash with `dash-fixture.ts`, write a plan into its worktree, record it with `tugutil dash step <name> start 1 --plan <rel>`, stamp it with `tugutil plan stamp`, and assert `[data-slot="lens-dashes-review"]` is **absent**. Then append a line to the plan, wait for the next recompose, and assert it is present with `data-review="stale"`. Release the dash in `afterAll`.
- [ ] **The fixture plan must be a real plan, not a stub** — `dash step start` (`step_in` in `tugdash-core/src/ops.rs`) is the only writer of `branch.tugdash/<name>.tugplan`, and it refuses unless the document parses *and* carries a Step Status Ledger row whose anchor is `#step-1`. Give the fixture a minimal but genuine plan: the required sections, one `#### Step 1: … {#step-1}` with its `**Commit:**` / `**References:**` / Tasks / Tests / Checkpoint fields, a matching ledger row, and a Review Record round for `plan stamp` to write into. Two consequences to bake into the fixture, both non-obvious: `dash step start` **mutates the plan** (it flips the ledger row to `in progress`), so it must run *before* the stamp; and ledger status cells are outside the hashed content, so that mutation does not itself make the plan stale — which is precisely why the test's "not stale yet" assertion is meaningful.
- [ ] app-test, extending `at0406-masthead-dash-chip.test.ts`: bind the card to that dash and assert the chip's `data-review` follows the same transition.
- [ ] Add the new `@covers` lines (`tugdeck/src/lib/changeset-types.ts`, `tugdeck/src/lib/changeset-all-store.ts`, `tugdeck/src/components/tugways/session-masthead.tsx`) to both files' docblocks.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit && bunx vite build`
- [ ] `just build-app`
- [ ] `just app-test at0407-lens-dashes-section.test.ts at0406-masthead-dash-chip.test.ts`
- [ ] `just app-test-covers-check`

---

#### Step 3: The Lens Dashes ordering {#step-3}

**Depends on:** #step-2

<!-- A file-contention dependency, not a logical one: this step and #step-2 both
     rewrite `dashRowsFromSnapshot` and `DashRow` in `dashes-section.tsx`, and
     #step-2 falsifies the docblock sentence this step rewrites. Nothing in the
     ordering needs the review field. -->

**Commit:** `tugdash(polish-lane): the Lens orders dashes by who is on them and how far along`

**References:** [P02] Lens ordering, Spec S02, Table T01

**Artifacts:**
- `DASH_STAGE_RANK` and `compareDashRows` in `dashes-section.tsx`
- `dashes-section.test.ts` extended

**Tasks:**
- [ ] Add `DASH_STAGE_RANK` as an exported `Record<string, number>` per Table T01, and `compareDashRows(a, b)` implementing Spec S02's three keys. An absent or unrecognized stage ranks −1 — never throw, never `undefined` into a subtraction.
- [ ] Apply the sort at the end of `dashRowsFromSnapshot`, on a copy (`[...rows].sort(...)`); the projection's input is the snapshot and must not be mutated.
- [ ] Leave the project-label logic alone — it is a disambiguation rule about *rendering*, not an ordering key, and dropping project grouping from the order does not change when the label appears.
- [ ] Update the section's docblock: it currently states rows come in "project-enumeration order then entry order", which this step falsifies.

**Tests:**
- [ ] bun, in `tugdeck/src/components/lens/sections/__tests__/dashes-section.test.ts`: a table test over `compareDashRows` covering worked-before-parked (dominant over stage — a parked `landing` sorts below a worked `created`), stage rank within a group, the name tiebreak, and an unrecognized stage sorting last.
- [ ] bun: `dashRowsFromSnapshot` over a two-project snapshot asserts the returned order and that the project label still appears on every row.
- [ ] app-test, extending `at0407-lens-dashes-section.test.ts`: with two real dashes at different stages, assert the DOM order of `[data-slot="lens-dashes-row"]` by their `data-dash` attributes.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test at0407-lens-dashes-section.test.ts`

---

#### Step 4: The `/dash` picker sheet {#step-4}

**Commit:** `tugdash(polish-lane): bare /dash picks a dash instead of showing the room`

**References:** [P01] picker sheet, Spec S03, (#picker-shape)

**Artifacts:**
- `dash-picker-sheet.tsx` / `.css`
- The rewritten bare-form branch of `session-card.tsx`'s `dash:` verb
- `at0416-dash-picker.test.ts`

**Tasks:**
- [ ] Write `DashPickerSheet` per Spec S03 and [#picker-shape](#picker-shape). Compose `TugListView` + `TugListRow` ([L19]); hand-rolling list focus is a law violation and `TugListView` already owns arrow motion and `commitOnEnter`.
- [ ] The card's own dash is marked and is the seeded selection. Match on owner key against `cardSessionBindingStore.getBinding(cardId)?.dash?.id`.
- [ ] Rewrite the bare-form branch of the `dash:` verb: move the `!snap.composed` guard **above** the branch (see [#picker-shape](#picker-shape) for why), then zero → caution, one → bind directly, many → `showSheet`.
- [ ] Bare `/dash` no longer calls `shadeViewController.show("changes")`. Delete that call and the `[Q02]` comment above it that justified it — the question it deferred is now answered.
- [ ] Update the `dash:` handler's comment block: it documents "discovery lands where this card's own dash facts live", which this step replaces.

**Tests:**
- [ ] app-test `at0416-dash-picker.test.ts`, `@covers` `session-card.tsx`, `dash-picker-sheet.tsx`, `card-session-binding-store.ts`: create three real dashes with `dash-fixture.ts`; type `/dash` and submit; assert the sheet is up and lists three rows; press Down twice and Return; assert the masthead dash chip now reads the third dash's name (the binding moved through the real `bind_dash` → `bind_dash_ok` round trip, not an optimistic write). Release all three in `afterAll`.
- [ ] Same file: with two of the three released, bare `/dash` binds the survivor and no sheet appears.
- [ ] Same file: escape dismisses the sheet with the binding unchanged.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit && bunx vite build`
- [ ] `just build-app`
- [ ] `just app-test at0416-dash-picker.test.ts at0408-dash-gesture.test.ts`
- [ ] `just app-test-covers-check`

---

#### Step 5: Adopt and Leave in the dash lane {#step-5}

**Depends on:** #step-2

<!-- Also a file-contention dependency: #step-2 adds the review fact to the same
     `session-changes-dash-lane.tsx` row this step gives affordances to. Adopt
     and Leave need nothing from the review field. -->

**Commit:** `tugdash(polish-lane): adopt and leave a dash from the Changes shade`

**References:** [P05] affordance home, Risk R02, (#adopt-leave-wire)

**Artifacts:**
- `onAdopt` / `onLeave` on `SessionChangesDashLaneProps` and their affordances
- The senders in `session-changes-view.tsx`
- `at0405-changes-dash-lane.test.ts` extended

**Tasks:**
- [ ] Add `onAdopt(entry)` and `onLeave(entry)` to `SessionChangesDashLaneProps`. The lane stays presentational — it takes data and callbacks and sends nothing itself.
- [ ] Render **Adopt** on non-fronted rows and **Leave** on the fronted row, in the row's trailing affordance cluster beside the pop-out and fold cue. Compose `TugPushButton` at the cluster's existing size; do not introduce a second control vocabulary in the same row.
- [ ] Wire both in `session-changes-view.tsx` from `cardSessionBindingStore`'s binding, sending the frames in [#adopt-leave-wire](#adopt-leave-wire) via `getConnection()?.sendControlFrame`.
- [ ] **Neither handler touches `cardSessionBindingStore`.** The `bind_dash_ok` / `unbind_dash_ok` broadcasts are the only movers (Risk R02) — this is what makes a refused bind leave the card correctly bound to what it was.
- [ ] Gate both on the same predicate phase 4's Join affordance uses, disabled with a reason rather than silently bouncing. A bind is cheap, but a binding change mid-landing would move the shade's fronting out from under an open join.
- [ ] Update the lane's docblock: it states the lane is "read-only by design in this era", which phase 4 already dented and this step finishes.

**Tests:**
- [ ] app-test, extending `at0405-changes-dash-lane.test.ts`: with two real dashes and the card bound to the first, click Adopt on the second's row and assert the masthead chip changes to the second's name **and** that the second row is now the fronted one; then click Leave on that row and assert the chip disappears and no row is fronted.
- [ ] Same file: assert the fronted row offers Leave and no Adopt, and a non-fronted row offers Adopt and no Leave — the complement rule, which a refactor could silently break into two buttons on one row.
- [ ] bun: none. The row's Adopt/Leave choice is a one-line function of `fronted`; a test for it would assert a ternary.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit && bunx vite build`
- [ ] `just build-app`
- [ ] `just app-test at0405-changes-dash-lane.test.ts at0406-masthead-dash-chip.test.ts`

---

#### Step 6: The lifecycle doctrine {#step-6}

**Commit:** `tugdash(polish-lane): the dash lifecycle becomes doctrine`

**References:** [P08] doctrine home, (#lifecycle-contents)

**Artifacts:**
- `tuglaws/dash-lifecycle.md`
- `tuglaws/INDEX.md`, `tuglaws/design-decisions.md`, `tuglaws/tracking-changes.md`

**Tasks:**
- [ ] Write `tuglaws/dash-lifecycle.md` to the outline in [#lifecycle-contents](#lifecycle-contents). Ground every claim in a symbol a reader can find — `derive_stage`, `dash_owner_key`, `legacy_owner_key`, `bound_sessions_for` — rather than restating behavior in prose alone.
- [ ] Do **not** hard-wrap the prose.
- [ ] Register it in `tuglaws/INDEX.md` under the existing "Working on a dash" heading, beside `dash-work-doctrine.md`, with a one-line description that draws the distinction between the two (what a dash *is* vs how an agent *behaves* on one).
- [ ] Add **[D138]** to `tuglaws/design-decisions.md` in the file's established `**D138.** **<bold claim>.** <dense paragraph>` form. The claim: *anything git can see is derived on every read and never stored; anything it cannot is declared once, in the dash-log, by a verb* — with the stage precedence and the pointer to the new file. D137 is the current highest number; take the next.
- [ ] Correct `tuglaws/tracking-changes.md`'s workflow-layer paragraph: `/commit` is a **mode**, not a two-beat gesture. It enters via `commitModeController.enter()` (⌃⌘C, `/commit`, or Session ▸ Commit…), turns the prompt entry into the message editor over the changes sheet, and `now` no longer means anything. `/join <name>`'s description in the same sentence is also pre-phase-4 and should describe join mode.
- [ ] Add the cross-references both ways: `dash-work-doctrine.md` gains a line pointing at the lifecycle doc for what the stages mean.

**Tests:**
- [ ] None — this step ships no code. Its falsifiers are the greps in its checkpoint.

**Checkpoint:**
- [ ] `test -f tuglaws/dash-lifecycle.md`
- [ ] `grep -q "dash-lifecycle.md" tuglaws/INDEX.md`
- [ ] `grep -q "^\*\*D138\." tuglaws/design-decisions.md`
- [ ] `! grep -q "two-beat: no ready draft" tuglaws/tracking-changes.md` — the exact stale clause, which currently reads ``/commit` (two-beat: no ready draft → open the shade and generate; …)`
- [ ] `grep -rn "dash-lifecycle" tuglaws/ tugplug/` shows the cross-references resolve

---

#### Step 7: Delete the one-release stubs {#step-7}

**Commit:** `tugplug(polish-lane): retire the one-release skill aliases`

**References:** [P06] what compat goes, (#deleted-files)

**Artifacts:**
- Eight deleted skill directories
- `tugplug/CLAUDE.md`, `tugplug/.claude-plugin/plugin.json`

**Tasks:**
- [ ] `git rm -r` the eight directories in [#deleted-files](#deleted-files).
- [ ] Delete the stub paragraph in `tugplug/CLAUDE.md` (the one naming the seven old names plus `vet` as one-release redirect stubs). Delete it; do not amend it to say they are gone.
- [ ] Rewrite `tugplug/.claude-plugin/plugin.json`'s `description` and `keywords`, which currently name `devise`, `review-plan`, `implement`, and `dash`, to the shipped roster (`plan-devise`, `plan-review`, `dash-implement`, `dash-on`, `dash-join`, `dash-audit`, `draft`, `history`).
- [ ] Verify nothing outside `roadmap/` references a deleted name — the grep in the checkpoint is the falsifier, and `roadmap/` is exempt because those documents are historical records of the phases that created the stubs.
- [ ] Do **not** touch `tugutil/src/draft.rs`, `tugcast/src/server.rs`, `tugdash-core/src/ops.rs`'s `legacy_owner_key`, or any of their tests ([P06]).

**Tests:**
- [ ] None — a deletion's test is its grep.

**Checkpoint:**
- [ ] `ls tugplug/skills/` lists exactly `dash-audit`, `dash-implement`, `dash-join`, `dash-on`, `draft`, `history`, `plan-devise`, `plan-review`
- [ ] `grep -rnE "tugplug:(audit|dash|dash-run|devise|implement|join|review-plan|vet)([^a-z-]|$)" --include='*.md' --include='*.ts' --include='*.tsx' --include='*.rs' --include='*.json' . | grep -v '^./roadmap/'` returns nothing. The trailing `([^a-z-]|$)` is load-bearing: a plain `\b` would match `tugplug:dash` inside `tugplug:dash-audit` and report every surviving skill as a leftover stub. Verified against the current tree — it reports only `roadmap/` hits, which are excluded because those documents are the historical record of the phases that created the stubs.
- [ ] `cd tugrust && cargo nextest run -p tugutil -p tugcast` (proves the ledger compat is untouched)
- [ ] `just hooks-test`

---

#### Step 8: Integration checkpoint {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [P01] picker sheet, [P02] Lens ordering, [P03] review on the wire, [P05] affordance home, [P06] what compat goes, [P08] doctrine home, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Walk the phase's exit criteria against a running debug instance with three real dashes at different stages, one of them driving a plan that has been edited past its stamp.
- [ ] Confirm the mark, the ordering, the picker, and Adopt/Leave all read correctly in one session — the four are independent in the code and have not been seen together until now.
- [ ] Confirm the `/` completion popup no longer offers the eight deleted names (it is built from the `session_capabilities` catalog, so this is the proof that the deletion reached the running app rather than only the repo).
- [ ] Write the dash's join draft with `tugutil draft set --owner dash:polish-lane`.

**Tests:**
- [ ] `just app-test at0405-changes-dash-lane.test.ts at0406-masthead-dash-chip.test.ts at0407-lens-dashes-section.test.ts at0408-dash-gesture.test.ts at0416-dash-picker.test.ts`

**Checkpoint:**
- [ ] `cd tugrust && cargo build && cargo nextest run`
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit && bunx vite build`
- [ ] `just build-app && just app-test-covers-check`
- [ ] `just app-test-changed` (or, if it refuses on budget, the named set above plus whatever else it printed)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A dash lane that is navigable with several dashes in flight, tells you when a dash's plan has drifted past its review, lets a card take a dash on or put it down without typing, and whose model is written down in `tuglaws/` instead of in plan documents — with the one-release aliases gone.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] A dash whose plan moved after its stamp shows a stale mark in the Lens row, the shade row, and the masthead chip; a dash with no plan shows none (verification: `at0407` + `at0406`)
- [ ] The Lens Dashes section orders worked-before-parked, then by stage, then by name (verification: bun table test + `at0407` DOM order)
- [ ] Bare `/dash` opens a picker with several dashes, binds directly with one, and cautions with none (verification: `at0416`)
- [ ] Adopt on a non-fronted row and Leave on the fronted row move the card's binding through the real broadcasts (verification: `at0405`)
- [ ] `tuglaws/dash-lifecycle.md` exists, is indexed, [D138] is written, and `tracking-changes.md`'s `/commit` description matches commit mode (verification: step 6 checkpoint greps)
- [ ] `tugplug/skills/` holds eight real skills and no stubs; no non-roadmap file names a deleted skill (verification: step 7 checkpoint greps)
- [ ] `tugutil draft`'s legacy owner-key fallback is untouched and its tests pass (verification: `cargo nextest run -p tugutil -p tugcast`)

**Acceptance tests:**
- [ ] `at0416-dash-picker.test.ts` (new)
- [ ] `at0405`, `at0406`, `at0407` (extended)
- [ ] Rust: the five `dash_review_state_*` cases in `tugcast/src/feeds/changeset.rs`
- [ ] bun: the `compareDashRows` table test

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [Q01] — how long a dash has been parked, if the lane ever holds enough dashes for the distinction to pay for a wire field
- [ ] Clearing a dash's recorded `plan_path` when it outgrows its plan (Risk R01's residual)
- [ ] Dropping the draft ledger's legacy owner key, once the population it serves is provably empty ([P06])

| Checkpoint | Verification |
|------------|--------------|
| Review state on the wire | `cargo nextest run -p tugcast`; the five `dash_review_state_*` cases |
| The mark in three surfaces | `just app-test at0407-lens-dashes-section.test.ts at0406-masthead-dash-chip.test.ts` |
| Lens ordering | `cd tugdeck && bun test`; `just app-test at0407-lens-dashes-section.test.ts` |
| The picker | `just app-test at0416-dash-picker.test.ts` |
| Adopt / Leave | `just app-test at0405-changes-dash-lane.test.ts` |
| Doctrine | step 6's greps |
| Stubs gone, ledger compat kept | step 7's greps + `cargo nextest run -p tugutil -p tugcast` |

# Joining a dash: what the first real landing showed

The dash-UI work landed on `main` as `5964a0a19` — by CLI, from the terminal, with the conflict resolved by hand. The Changes shade was open the whole time, was invoked deliberately, and did not respond. This is the post-mortem, written while it is fresh.

## What actually happened

The dash was built over six steps and arrived at the shade in the state the shade is for: six rounds, a written join draft, a clean build. Then:

1. `main` had moved. `3de067513 tugways(file-tip)` rewrote `identityTooltip` onto the shared `entity-tips` skeleton and deleted the local `.tug-session-identity-tip*` rules; the dash had added a live dash row to the same function. One file, twelve lines, both sides.
2. The shade said `conflicted` and named the file. Correct, and where its help ended.
3. Every control in the lane was a dead click. `Resolve`, `Join`, `Adopt` — no response, no explanation. `Release` was the only one not tried, and only because it does the opposite of what was wanted.
4. The landing happened in the terminal: `git merge main`, a hand resolution, `tugutil dash join`.

## The reproduction, and what it overturned (2026-08-15)

`tests/app-test/at0425-dash-conflicted-landing.test.ts` now reconstructs the incident's exact state for real: an unbound card, a join aimed by name, a preview that comes back `conflicted` over a genuine delete/modify conflict (the fixture rewinds the dash branch to the base tip's parent and deletes a file the tip modified — no commit on the base, no dirt in the developer's checkout). It settled three things:

- **The "impossible state" section this brief used to carry was a misreading.** The lane fronts by `frontedDashId ?? boundDashId`, and join mode's active target supplies `frontedDashId` (`session-card.tsx`, `dashId: joinSnapshot.active ? …`). `/dash-join <name>` deliberately fronts a dash the card never adopted, and that row correctly offers **Adopt** — fronting is about what is being landed, the binding about what the card works. ADOPT under "This card's dash" is the designed rendering of what happened, not a corruption.
- **The lane's wiring works end to end in a clean instance.** Join refuses on the conflicted outcome and carries its reason ("Resolve the conflicts first"); Resolve's click registers instantly (the offer face leaves on the store's synchronous flip) and the ladder round-trips to a terminal frame in seconds; Adopt sends a real `bind_dash` and flips to Leave on the `bind_dash_ok` that comes back. The incident's dead clicks do not reproduce structurally. What remains for the incident itself is environmental to that release instance — plus the presentation failures below, which make a correctly-refusing lane indistinguishable from a dead one.
- **The first explanation (`turnInProgress`) stays recorded as wrong.** The agent's turn had ended before the hand-off, so `canInterrupt` was false and that gate was open. A plausible mechanism found by reading is not a diagnosis — and neither was the fronting "contradiction" that replaced it.

## The ladder's false resolution — the worst finding, proven live

Driving the reproduction exposed a correctness bug that outranks everything else in this brief. `rerere_rung` (`tugrust/crates/tugdash-core/src/resolve.rs`) merges the branch in a scratch worktree and then harvests **any conflicted path whose working-tree file is non-empty and marker-free** as "resolved by rerere". A delete/modify conflict is marker-free by construction — git leaves the modify side's content in the tree — so the rung claims the path with the **base side's content** even though rerere did nothing. Binary conflicts should false-positive the same way. The per-file walk downstream has the correct guard ("non-content conflicts short-circuit to unresolved"), but rung 2 runs first and steals those paths.

Consequence, demonstrated on a probe dash: the "resolution" kept the base's file, the candidate equaled the base tree, and `dash join --resolve` **landed an empty squash** — the dash's entire change silently discarded under a green verdict (`ebee1d49f`, since removed). On the UI path the same false positive flips the outcome to `clean` and arms Join. Combined with the incident's other rerere lesson — the cache replayed a *wrong* recorded resolution during the hand merge — the rule is: **no rerere product may land without being shown.**

### Why the existing test does not catch it

`resolve.rs`'s inline test module already carries `delete_modify_short_circuits_to_unresolved`, and it passes. It passes because its `init()` helper builds a fresh temp repo with **rerere off and no `rr-cache`**, and `rerere_rung` early-returns on `!has_rr_cache(repo)` before it can steal the path — so the delete/modify falls through to the per-file walk and short-circuits correctly, exactly as the test asserts.

The bug is therefore invisible to the whole suite and appears only in a repo that has a populated `rr-cache`. This one does (`rerere.enabled=true`, many entries under `.git/rr-cache`), which is why it surfaced against real work and not in CI.

### The fix, in two halves

**Half one — stop fabricating.** The predicate the rung is missing already exists: `RawStages::load()` returns `None` for exactly the non-content conflicts (a missing ours-or-theirs stage ⇒ delete/modify, differing modes ⇒ mode conflict, a NUL byte ⇒ binary). `rerere_rung` iterates `stages.keys()` and never consults the value; it should iterate the pairs and skip any path whose `RawStages` is non-content, so those reach the per-file short-circuit that already handles them. Gating inside the rung is better than gating at the call site: it keeps the rung's returned map meaning "rerere really resolved this", which is what the `ResolvedBy::Rerere` label claims downstream. Worth considering as a belt-and-braces second signal: `git rerere remaining` names the paths rerere did *not* resolve, which is a direct answer rather than the current inference from "the file has no conflict markers".

**Half two — show the product.** Even a correct rerere resolution is a *replayed* one, and the incident's hand merge proved a cached resolution can be stale and wrong. Any path resolved by rung 2 has to be visible — and reviewable — before it lands. The `resolved` array already carries `resolved_by` per file and the landing face already renders it; what is missing is that a rerere-resolved candidate arms **Join** identically to a clean preview, with no diff of what was replayed.

**The regression test.** Same shape as `delete_modify_short_circuits_to_unresolved`, but seed an `rr-cache` first (any recorded resolution is enough — `has_rr_cache` only checks the directory is non-empty) so rung 2 actually runs. Assert `unresolved == ["f.txt"]`, `resolved.is_empty()`, and `candidate_commit.is_none()`. Today that test fails with the file reported `resolved_by: "rerere"` and a candidate equal to the base tree.

**⚠️ Never probe this with `tugutil dash join <name> --resolve`.** That verb does not stop at the candidate — it lands. That is how the empty `ebee1d49f` reached `main` while this was being diagnosed. `--preview` is the safe CLI probe (it touches nothing and is what at0425 drives); everything else belongs in the Rust tests above, which build their own scratch repos in tempdirs.

### The loose end this leaves in at0425

`tests/app-test/at0425-dash-conflicted-landing.test.ts` currently accepts **any** terminal face — `resolved`, `partial`, or `error` — and records which one it got as a `note()`, because today the false positive makes a delete/modify report `resolved`. Once the fix lands, that assertion tightens to `partial` naming the conflicting file; the test carries a comment saying so at the assertion.

## Two defects the landing did establish

Both are read off the landed commit, not inferred:

- **The subject line is doubled** — `tugdash(dash-ui): tugdash(dash-ui): identity carries the dash run…`. The join prefixes `tugdash(<name>): ` onto the draft unconditionally, including when the draft already opens with a conventional subject.
- **The draft that landed was not the draft that was written.** `tugutil draft set --owner dash:dash-ui` wrote one message; the commit carries a different, auto-generated summary — accurate, but including a bullet nobody wrote. Something regenerated the maintained draft between the write and the join. If the draft is the thing a landing commits, a scribe silently replacing it is the more serious of the two.

## One hazard the resolution exposed

`git rerere` auto-staged a cached resolution for the conflicted file, silently, and it was wrong: it kept one side wholesale and discarded the other. Left alone it would have landed a tooltip styled by CSS that no longer exists — green build, green tests, broken hover. The dash-work doctrine has the resolve ladder running `rerere`; any surface that offers `Resolve` has to say **that a cached resolution was used** and show what it produced, or it will land silent breakage on exactly the conflicts that recur.

## What the dash-UI work did and did not do for this

Honestly: **almost nothing for joining.** It improved where a dash is *legible* — the masthead title run, the atom glyph, the Lens sub-row, the roster. The join surface is the Changes shade, which that work did not touch. Two indirect benefits only: the `TugBadge` elision fix applies to the lane's own dash-name badge, and the Lens sub-row makes the dash easier to *find* before you fail to act on it.

That is the chicken-and-egg named at the time, and it is worth stating plainly: legibility work does not move a landing that has no working controls.

## Where to take this

1. ~~Reproduce the dead lane~~ **Done — at0425.** The wiring is sound; the causes worth fixing are the ladder's false resolution and the presentation failures below.
2. **Fix `rerere_rung`'s marker-free harvest** so non-content conflicts reach the per-file short-circuit, and surface every rerere-resolved file for review before anything lands.
3. **Then decide what a turn should legitimately block.** The blanket `turnInProgress` gate on every control — `Join`, `Resolve`, `Release`, `Adopt`/`Leave` — was not what broke this run, but it is still wrong on its own terms: a landing mutates the base while an agent may be mid-edit, so some gate is right, but `Resolve` touches only the dash and blocking it locks the one escape hatch a conflicted dash has.
4. **A refused control must state its reason without a hover.** Each button carries its reason as a native `title`, and `.tug-button:disabled` sets `pointer-events: none` — an element with no pointer events never hovers, so that reason can never render. This is dead code wherever it appears, independent of what caused this incident.
5. **Make disabled look disabled.** `--tugx-control-disabled-opacity` is `0.65` in the dark themes, `0.7` in the light. A filled action button at that strength reads as live, and when a whole cluster is disabled at once there is no full-strength control adjacent to calibrate against.
6. **Give a conflict somewhere to go.** The shade named the file and stopped. The diagnosis that made the hand resolution possible — *which commit on the base touched this file, and when* — was `git log --name-only` archaeology the UI had every fact needed to do.
7. **Fix the two message defects** — the doubled subject prefix, and whatever rewrote the draft.

## Starting again from cold

Everything named above, by path:

| What | Where |
|---|---|
| The lane, `orderDashLane`, `DashRow`, the "This card's dash" label | `tugdeck/src/components/tugways/cards/session-changes/session-changes-dash-lane.tsx` |
| The `Resolve` / `Join` / `Release` face | `.../session-changes/session-changes-dash-landing.tsx` |
| `boundDashId`, `turnInProgress`, `laneBinding`, the adopt/leave frames | `.../session-changes/session-changes-view.tsx` |
| `evaluateJoinLandGate`, `joinDisabledReason` | `tugdeck/src/lib/join-mode-controller.ts` |
| `.tug-button:disabled` (`pointer-events: none`, the opacity) | `tugdeck/src/components/tugways/internal/tug-button.css` |
| `--tugx-control-disabled-opacity` | `tugdeck/styles/themes/*.css` |
| The dash entry's shape (`bound_sessions`, `stage`, `review`) | `tugdeck/src/lib/changeset-types.ts` |
| App-tests over this lane | `tests/app-test/at0405-changes-dash-lane.test.ts`, `at0417-join-mode.test.ts`, `at0418-join-outcomes.test.ts`, `at0425-dash-conflicted-landing.test.ts` |
| Dash fixtures for tests (`createDash`, `releaseDash`, `commitRound`) | `tests/app-test/dash-fixture.ts` |
| **The resolution ladder** — `resolve_conflicts`, `rerere_rung`, `RawStages::load`, `has_rr_cache`, and the inline `mod tests` | `tugrust/crates/tugdash-core/src/resolve.rs` |
| `integrate_message` (the unconditional `tugdash(<name>): ` prefix), `join_in` | `tugrust/crates/tugdash-core/src/ops.rs` |
| The server's resolve handler (`do_changeset_join_resolve`) and the control dispatch | `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` |
| The AI rung's scribe seam and the progress deltas | `tugrust/crates/tugcast/src/feeds/join_resolve.rs` |
| The client's resolve overlay store (`ResolveState`, the delta/ok/err frames) | `tugdeck/src/lib/changeset-join-store.ts` |

State of the world at the last update (2026-08-15): `main` is at `0181e5e0d`. The `dash-ui` dash is joined and torn down; no debug instances are running. Uncommitted and belonging to this line of work: this brief (modified) and `tests/app-test/at0425-dash-conflicted-landing.test.ts` (new, untracked, passing in ~10s via `just app-test tests/app-test/at0425-dash-conflicted-landing.test.ts`). The empty probe commit `ebee1d49f` described above was reset off `main` and is gone.

Next piece of work, already scoped: **the `rerere_rung` fix**, per "The fix, in two halves" above.

## Open questions

- Is the composer's join route (`/join <name>`) reachable in the state the shade was in? It shares `evaluateJoinLandGate`, but the fronting inconsistency above is the lane's, and whether the composer route sees the same broken state is unknown. Neither route was tried before falling back to the CLI.
- Should a landing be reachable at all from a session mid-turn, or should the shade offer to queue it for the turn's end?

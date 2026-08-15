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

**Half one — stop fabricating. Done.** The predicate the rung was missing already existed: `RawStages::load()` returns `None` for exactly the non-content conflicts (a missing ours-or-theirs stage ⇒ delete/modify, differing modes ⇒ mode conflict, a NUL byte ⇒ binary). `rerere_rung` iterated `stages.keys()` and never consulted the value; it now iterates the pairs and skips any path whose `RawStages` is non-content, so those reach the per-file short-circuit that already handled them. Gating inside the rung rather than at the call site keeps the rung's returned map meaning "rerere really resolved this", which is what the `ResolvedBy::Rerere` label claims downstream. It also now consults `git rerere remaining` in the scratch worktree and skips anything rerere itself still lists — a direct answer alongside the inference from "the file has no conflict markers". An unreadable answer restricts nothing, so the cross-check can only tighten the harvest, never widen it.

**Half two — show the product. Done.** Even a correct rerere resolution is a *replayed* one, and the incident's hand merge proved a cached resolution can be stale and wrong. What shipped generalises that past rerere, because the argument does: every rung above the replay probe decides a file by machine, and rung 4 and rung 5 are outright guesses. So the gate is *any candidate built out of per-file resolutions*.

- **The server sends what it decided.** `FileResolution` carries `diff` — the unified diff from the base head to the candidate for that path alone, capped at 400 lines. It is read off the built candidate rather than the blobs, so an add, a delete and a mode change all arrive in the form git already renders. A partial outcome has no candidate and therefore no diffs: there is nothing to review when nothing can land.
- **The review is a state of the resolve round, not of a component.** `ResolveState.reviewed` lives in `changeset-join-store` keyed by dash, because both landing routes have to honour it — the lane's Join button and the composer's `/join <name>`. A review held in the landing face would gate one and not the other. Every fresh ladder run resets it; a new resolution is a new decision.
- **The gate is the shared one.** `evaluateJoinLandGate` grew a required `unreviewedResolution` input and an `unreviewed` reason, placed immediately after `outcome` — the same question one level finer: not *is* there something to land, but *has anyone looked at what the machine decided to land*. Making the field required rather than optional is what proved every call site had been updated; the compiler found all three.
- **The face shows the diffs and asks for a beat.** The resolved face renders the resolutions through the shared `TugDiffDocument` — the same surface the Changes shade and the Diff card use — and Join stays refused, reading *"Review what the ladder resolved first"*, until `Reviewed` is pressed. The document is passed a new `openAllByDefault` prop: its default expansion is line-budgeted, and a 100-line resolution would have arrived folded shut, which would have made the acknowledgement a checkbox over hidden content — the exact thing this replaces.

What this deliberately does **not** gate: a rung-1 replay and a clean one-shot squash, whose `resolved` list is empty. No file was decided by machine, so they land as they always did.

**The regression test.** `delete_modify_is_not_claimed_by_rerere`, alongside the older `delete_modify_short_circuits_to_unresolved`. Same conflict, but it seeds an `rr-cache` first — a real recorded resolution over an unrelated file on a throwaway branch, then `reset --hard` back to the base (`rr-cache` survives a reset) — so rung 2 actually runs. It asserts `resolved.is_empty()`, `unresolved == ["f.txt"]`, and `candidate_commit.is_none()`. Before the fix it failed exactly as predicted: `[("f.txt", Rerere)]`, with a candidate equal to the base tree.

**⚠️ Never probe this with `tugutil dash join <name> --resolve`.** That verb does not stop at the candidate — it lands. That is how the empty `ebee1d49f` reached `main` while this was being diagnosed. `--preview` is the safe CLI probe (it touches nothing and is what at0425 drives); everything else belongs in the Rust tests above, which build their own scratch repos in tempdirs.

### What the tests assert now

`tests/app-test/at0425-dash-conflicted-landing.test.ts` used to accept **any** terminal face — `resolved`, `partial`, or `error` — because the false positive made a delete/modify report `resolved`. It now pins the face to `partial` and requires it to name the conflicting file, and it passes: *"Still conflicting — resolve by hand: roadmap/join-assessment.md"*. It also declares `@covers … resolve.rs`, so a future edit to the ladder selects this test through `just app-test-changed` — nothing did before, which is part of why the ladder's behavior went unwatched at the UI layer.

`tests/app-test/at0426-dash-resolution-review.test.ts` is the review gate's, and it drives the *other* half of the ladder: a genuine content conflict (the dash rewrites a base-modified file wholesale), resolved by rung 4 via a stub `tugdash.mergedriver`, so a candidate arrives deterministically without the AI rung or this repo's `rr-cache`. It asserts the shape the incident lacked — the outcome reads `clean`, and Join is *still* refused with *"Review what the ladder resolved first"*; the diff of what the driver chose is on screen; `Reviewed` is what arms Join. The join itself is never fired: landing would rewrite the developer's `main`.

Both fixtures run against the live repository, so two things are deliberate in them. The raw-`git` helper retries past an `index.lock`, because test files run in parallel and both fixtures build dashes in the same repo. And at0426 records the `rr-cache` entries it found and removes any the run added — rung 4 teaches rerere what it resolved, and while a fixture conflict's preimage can never match real work, the run still leaves the developer's repo as it found it.

One fragility worth knowing before it bites again: the dash lane renders *below* the changed-file list, so on a busy working tree the row starts under the composer and a bare `nativeClickAtElement` lands on the editor. Both tests now `scrollIntoView({ block: "center" })` before pressing a row control. The symptom is a "dead click" that is nothing of the kind — `elementFromPoint` at the button's centre returns `DIV.cm-line`.

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
2. ~~Fix `rerere_rung`'s marker-free harvest, and surface every machine-resolved file for review before anything lands~~ **Done, both halves.**
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
| `evaluateJoinLandGate`, `joinDisabledReason`, `resolutionAwaitsReview` | `tugdeck/src/lib/join-mode-controller.ts` |
| The shared diff surface the review renders through (`openAllByDefault`) | `tugdeck/src/components/tugways/tug-diff-document.tsx` |
| `.tug-button:disabled` (`pointer-events: none`, the opacity) | `tugdeck/src/components/tugways/internal/tug-button.css` |
| `--tugx-control-disabled-opacity` | `tugdeck/styles/themes/*.css` |
| The dash entry's shape (`bound_sessions`, `stage`, `review`) | `tugdeck/src/lib/changeset-types.ts` |
| App-tests over this lane | `tests/app-test/at0405-changes-dash-lane.test.ts`, `at0417-join-mode.test.ts`, `at0418-join-outcomes.test.ts`, `at0425-dash-conflicted-landing.test.ts`, `at0426-dash-resolution-review.test.ts` |
| Dash fixtures for tests (`createDash`, `releaseDash`, `commitRound`) | `tests/app-test/dash-fixture.ts` |
| **The resolution ladder** — `resolve_conflicts`, `rerere_rung`, `RawStages::load`, `has_rr_cache`, and the inline `mod tests` | `tugrust/crates/tugdash-core/src/resolve.rs` |
| `integrate_message` (the unconditional `tugdash(<name>): ` prefix), `join_in` | `tugrust/crates/tugdash-core/src/ops.rs` |
| The server's resolve handler (`do_changeset_join_resolve`) and the control dispatch | `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` |
| The AI rung's scribe seam and the progress deltas | `tugrust/crates/tugcast/src/feeds/join_resolve.rs` |
| The client's resolve overlay store (`ResolveState`, the delta/ok/err frames) | `tugdeck/src/lib/changeset-join-store.ts` |

State of the world at the last update (2026-08-15): `main` is at `25567b165`, which carries the reproduction and the half-one fix. No dashes exist, no debug instances are running, and the fixtures leave no `tugdash.mergedriver` config or `rr-cache` entry behind. Uncommitted and belonging to this line of work: this brief, and the review gate — `resolve.rs` (the per-file `diff`), `changeset-join-store.ts`, `join-mode-controller.ts`, the landing face and its CSS, `tug-diff-document.tsx`, `session-card.tsx`, their unit tests, and the new `at0426`. Green: `cargo nextest run` (2621), `bunx tsc --noEmit`, `bunx vite build`, `just app-test-changed` (20 files, 32 tests). `bun test` is 6759/1 — the one red is the pre-existing `layout-imposer-solutions` golden table, which is red on `main` and untouched here. The empty probe commit `ebee1d49f` described above was reset off `main` and is gone.

Next piece of work: **the tactical layer** — items 3–7 above, none of which the review gate paid down. Note in particular that the gate's own refusal, *"Review what the ladder resolved first"*, still reaches the user only as a `title` on a `pointer-events: none` button — unreachable by hover, exactly as item 4 describes. What saves it in practice is that the review block sitting under the button says the same thing in prose. Every other refusal in the lane has no such luck.

## Open questions

- Is the composer's join route (`/join <name>`) reachable in the state the shade was in? It shares `evaluateJoinLandGate`, but the fronting inconsistency above is the lane's, and whether the composer route sees the same broken state is unknown. Neither route was tried before falling back to the CLI.
- Should a landing be reachable at all from a session mid-turn, or should the shade offer to queue it for the turn's end?

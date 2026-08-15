# Joining a dash: what the first real landing showed

The dash-UI work landed on `main` as `5964a0a19` — by CLI, from the terminal, with the conflict resolved by hand. The Changes shade was open the whole time, was invoked deliberately, and did not respond. This is the post-mortem, written while it is fresh.

## What actually happened

The dash was built over six steps and arrived at the shade in the state the shade is for: six rounds, a written join draft, a clean build. Then:

1. `main` had moved. `3de067513 tugways(file-tip)` rewrote `identityTooltip` onto the shared `entity-tips` skeleton and deleted the local `.tug-session-identity-tip*` rules; the dash had added a live dash row to the same function. One file, twelve lines, both sides.
2. The shade said `conflicted` and named the file. Correct, and where its help ended.
3. Every control in the lane was a dead click. `Resolve`, `Join`, `Adopt` — no response, no explanation. `Release` was the only one not tried, and only because it does the opposite of what was wanted.
4. The landing happened in the terminal: `git merge main`, a hand resolution, `tugutil dash join`.

## The state was impossible before the buttons were dead

**The cause of the dead clicks is not yet established, and the first attempt at explaining it was wrong.** It blamed `turnInProgress` — the gate every control in the lane shares, and the first clause in `evaluateJoinLandGate`. That gate is real, but its precondition did not hold: the agent's turn had ended before the hand-off, so `canInterrupt` was false and the gate was open. A plausible mechanism found by reading is not a diagnosis.

What the same reading *did* turn up is a contradiction worth far more, because it is visible in the screenshot and provable from the source:

- `orderDashLane` returns a non-null `fronted` **only** when `boundDashId` matched an entry's owner key.
- The fronted row is then rendered with `bound={fronted.owner_id === boundDashId}` — which, given how `fronted` was derived, is necessarily `true`.
- A bound row renders **Leave**. The fronted row cannot render **Adopt**.

The shade showed the "This card's dash" label — which only the fronted row carries — above a row offering **ADOPT**. Under the lane's own logic that state cannot be constructed.

So the question is not "why did the buttons not fire". It is **why was the lane rendering a fronted row for a dash the card was not bound to** — and that session never was bound to `dash-ui`; the whole run drove the worktree from an unbound session. Whatever produced the inconsistent fronting is the thing to chase, and dead controls are plausibly downstream of it: a landing face wired to an entry the card has no binding for has no session id to send a control frame with.

That is a hypothesis too, and it is labelled as one.

### How to settle it

Cheap and definitive, and it should happen before any fix is designed: put an **unbound** session in front of a real dash and look at what the lane renders.

The strongest route is not manual clicking — it is `tests/app-test/at0405-changes-dash-lane.test.ts`, which already creates a real dash with `dash-fixture`'s `createDash`, seeds a session into the instance ledger, opens the Changes shade (`/commit`, then ⌘-Return), and asserts on the lane. What it does *not* cover is the state this incident was in: at0405 always reaches the fronted row by dispatching a synthesized `bind_dash_ok`, so **every existing test looks at a bound card**. An unbound-session case is a new test and a small one, and it either reproduces the contradiction or proves the shade was fed something the aggregate would not normally produce.

If it reproduces, read the lane's two inputs at that moment: `boundDashId` (from `cardSessionBindingStore`) and the project's dash entries from the `CHANGESET_ALL` aggregate. One of them is lying.

The release instance that produced the screenshot can also be inspected live — enable `diag/eval` on its bank, then read the deck state — but the dash is joined and gone, so that state is no longer sitting there. Reproduction is the route.

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

1. **Reproduce the dead lane and find the actual cause.** Nothing below should be designed before this is known. The fronted-row contradiction above is the specific thing to chase first.
2. **Then decide what a turn should legitimately block.** The blanket `turnInProgress` gate on every control — `Join`, `Resolve`, `Release`, `Adopt`/`Leave` — was not what broke this run, but it is still wrong on its own terms: a landing mutates the base while an agent may be mid-edit, so some gate is right, but `Resolve` touches only the dash and blocking it locks the one escape hatch a conflicted dash has.
3. **A refused control must state its reason without a hover.** Each button carries its reason as a native `title`, and `.tug-button:disabled` sets `pointer-events: none` — an element with no pointer events never hovers, so that reason can never render. This is dead code wherever it appears, independent of what caused this incident.
4. **Make disabled look disabled.** `--tugx-control-disabled-opacity` is `0.65` in the dark themes, `0.7` in the light. A filled action button at that strength reads as live, and when a whole cluster is disabled at once there is no full-strength control adjacent to calibrate against.
5. **Give a conflict somewhere to go.** The shade named the file and stopped. The diagnosis that made the hand resolution possible — *which commit on the base touched this file, and when* — was `git log --name-only` archaeology the UI had every fact needed to do.
6. **Fix the two message defects** — the doubled subject prefix, and whatever rewrote the draft.

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
| App-tests over this lane | `tests/app-test/at0405-changes-dash-lane.test.ts`, `at0417-join-mode.test.ts`, `at0418-join-outcomes.test.ts` |
| Dash fixtures for tests (`createDash`, `releaseDash`, `commitRound`) | `tests/app-test/dash-fixture.ts` |

State of the world when this was written: the dash is joined and torn down, its worktree gone; no debug instances are running (they went with the worktree); `main` is at `5964a0a19`; this brief is untracked.

## Open questions

- Is the composer's join route (`/join <name>`) reachable in the state the shade was in? It shares `evaluateJoinLandGate`, but the fronting inconsistency above is the lane's, and whether the composer route sees the same broken state is unknown. Neither route was tried before falling back to the CLI.
- Should a landing be reachable at all from a session mid-turn, or should the shade offer to queue it for the turn's end?

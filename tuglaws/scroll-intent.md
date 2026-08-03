# Scroll Intent — the attribution doctrine

*Who owns a scroll, and which writes yield to whom. The doctrine behind `SmartScroll` ([D93]) and every programmatic `scrollTop` writer in the transcript stack. Behavioral pins: `tests/app-test/at0333-follow-bottom-unattributed.test.ts`.*

## The doctrine

Two sentences govern every scroll write:

1. **Every scroll the machine cannot attribute to itself belongs to the user.**
2. **No deferred scroll write survives a user gesture.**

The first sentence closes the attribution model: `SmartScroll` knows which writes are its own (explicit programmatic scrolls, pins, restore heartbeats), so any movement it did not cause is user intent — even when no input event announces it. The second sentence is the supersede rule: a write that was armed *before* the user moved (a restore target, a two-pass correction) is describing a world the user has since rejected, and firing it late yanks them away from a position they chose. Both are instances of [L23] — internal implementation operations must never destroy user-visible state, and the scroll position the user is reading *is* user-visible state.

## The WKWebView attribution inventory

What each gesture actually delivers to the scroll container, and therefore what the machine can know:

| Gesture | Events delivered | Phase reached | Attribution |
|---|---|---|---|
| Wheel / trackpad scroll | `wheel`, then `scroll` | `dragging` (wheel skips `tracking`) | user, by event |
| Touch/pointer drag on content | `pointerdown` → `scroll`… → `pointerup` | `tracking` → `dragging` → `settling`/`decelerating` | user, by event |
| Scroll keys (PageUp/Down, Home, End, arrows, Space) | `keydown`, then `scroll` | `dragging` | user, by event |
| **Native scrollbar thumb drag** | **`scroll` only — no pointer, no wheel** | stays `idle` | **user, by doctrine sentence 1** |
| Explicit programmatic scroll (`scrollTo`, `scrollToBottom`, `scrollToElement`, restore heartbeat) | `scroll` (async, after the write) | `programmatic`; non-animated writes exit synchronously and arm the one-shot idle suppression for their deferred `scroll` event | ours |
| Pins and prepend compensation | `scroll` | stays `idle` (deliberate raw writes) | ours — distinguishable because they only ever move `scrollTop` **down** |
| Browser clamp on `scrollHeight` shrink | one `scroll`, indistinguishable from a user scroll-up | `idle` | **Machine.** Not self-evidently at-bottom: under window churn the height recovers before the event is delivered, so the position looks arbitrary. Commit-scoped clamps are detected and repaired by the list view; clamps outside a commit are never allowed to change follow-bottom |
| Position-stable click compensation (`use-position-stable-click.ts`) | `scroll` on the click call-stack | `idle` | **user** — it holds the click point under the user's cursor, so the user owns the resulting position |

The scrollbar row is the load-bearing one. A native thumb drag is completely silent apart from the `scroll` events themselves, so any model of the form "idle ⇒ we caused it" is falsified the moment a user grabs the scrollbar — which is why [D93]'s phase guard reads the way it does: ours = `programmatic`, or `idle` with the post-programmatic suppression armed; everything else in `idle` is the user.

The clamp row used to read "unattributed, but lands where `isAtBottom` holds — the at-bottom band absorbs it", and that sentence was wrong in a way that cost a whole class of sessions. It is corrected above rather than deleted so the correction is not quietly re-reverted. The evidence: on a transcript with eviction active (a 39,409px top spacer over a 5,487px rendered window), `scrollTop` jumped **upward by 2,660px in a single scroll event with `scrollHeight` identical — 44,262 — before and after**, with no user input. During a downward wheel gesture the same signature appeared twice at larger scale (−8,019px and −8,131px mid-burst). Every JavaScript channel that can move a scroller was instrumented and stayed silent: the `scrollTop` setter, `scrollTo`, `Element.prototype.scrollIntoView`, the `tug-region-scroll-set` restore dispatch, and `focusin`. No JS moved the scroller, and the geometry afterwards was intact — the only actor that fits is the browser clamping against a document that was transiently short. The band absorbs nothing, because by the time the event is delivered the height is back and the position is thousands of pixels adrift.

That is why the clamp is classified as **machine** and not as unattributed: "unattributed ⇒ user" is right about ownership and wrong about inference when the machine can prove it caused the move. Where it cannot prove it, the old rule stands unchanged and the user wins.

Consequences of the inventory, as shipped in `smart-scroll.ts` and `tug-list-view.tsx`:

- An unattributed **upward** `idle` scroll outside the at-bottom band disengages follow-bottom (deck-trace source `unattributed-scroll-up`). Without this, every growth pin slams the scroller back to the bottom against a scrollbar drag.
- An unattributed scroll **into** the at-bottom band re-engages follow-bottom — the disengage's mirror, and the path a scrollbar drag to the bottom takes.
- Downward unattributed scrolls outside the band change nothing: pins only move down, so a downward move is ambiguous, and follow-bottom state is left as it stands.

## The supersede table

Deferred writes and the gestures that void them:

| Deferred write | Armed by | Voided when | Mechanism |
|---|---|---|---|
| Cold-boot restore target (`applyRestoreTarget` heartbeat) | `setRestoreTarget` before content settles | `scrollTop` drifts more than `RESTORE_SUPERSEDE_DRIFT_PX` (8px) from the restore's own last write | `_restoreBaselineTop` read-back compare in `smart-scroll.ts` |
| Two-pass scroll correction (pass 2 of the estimated-jump protocol) | an estimated jump to an unmounted row (`scrollToIndex`, `scrollIndexIntoView`, `pageByEntryStep`) | `scrollTop` drifts more than `SCROLL_CORRECTION_SUPERSEDE_DRIFT_PX` (8px) from the pass-1 write's read-back (`armedTop`) | drift check at the top of the correction effect in `tug-list-view.tsx` |
| Follow-bottom growth pins | streaming content growth while following | follow-bottom disengages (any user scroll away, attributed or not) | `maybePinToBottom`'s follow-bottom gate |
| Anchor-state attribute refresh | every commit while unfrozen | never — it *reads* the user's position rather than writing one; it stands down while the scroll battery is frozen or the scroller is boxless | freeze + zero-geometry guards in the anchor-writer effect |

The `armedTop` / baseline pattern is the canonical implementation: record the **read-back** of your own write (clamping folded in), and treat any later position that differs by more than the supersede band as someone else's — then stand down. The band exists because sub-pixel and clamp jitter make exact equality wrong; 8px is established by the restore supersede and reused by the correction supersede.

## The rule for new writers

A new piece of code that wants to write `scrollTop` in or under a `TugListView` surface must do one of:

1. **Route through SmartScroll's chokepoints** (`scrollTo` / `scrollToElement` / `scrollToBottom`, or `maybePinToBottom` for follow-bottom pins). These arm the programmatic phase and the idle suppression, so the write self-attributes and the doctrine holds by construction.
2. **Justify itself against the inventory above** — and then extend the inventory here. A defensible raw write is one the doctrine can classify without new machinery: it only moves `scrollTop` down (pin-shaped), it runs on the user's own gesture call-stack (position-stable-click-shaped), or it explicitly disengages/supersedes first (find-reveal-shaped). **"Clamp-shaped" is no longer a defense** — this list used to offer "it lands where `isAtBottom` holds" as a sanctioned category, which licensed new raw writers on the same falsified model the inventory row carried. A clamp under window churn does not land at the bottom.
3. **Declare the write** by calling `SmartScroll.noteExternalWrite()` immediately afterwards. A raw write's `scroll` event does not dispatch until the current task ends, so anything reading the last-scroll-event position in between sees a stale baseline and can classify a deliberate write as a displacement. Declaring it syncs the baseline and advances the programmatic-write counter, making a raw write indistinguishable from a routed one to the commit bracket. The shipped raw writers — the front-insert prepend compensation, `focus-reveal`'s `revealWithin`, the transcript's `settleFindReveal` — all do this.

A raw upward write that is none of these is a bug waiting for a scrollbar: it will read as user intent to the disengage, or fight a user gesture the supersede rules exist to protect. If a deferred write cannot name the gesture that voids it, it does not ship.

## Window geometry is atomic

**Any windowing surface must apply its spacer/placeholder geometry in the same mutation batch as the row set that geometry complements.**

The spacer stands in for the rows the window left out, so the two are one piece of geometry and must land together. Splitting them across React's commit boundary — rows removed in the mutation phase, spacer height restored by a `useLayoutEffect` — leaves an interval in which the document is short by exactly the evicted rows' extent. Layout is lazy, so this is invisible until something forces layout in that interval. Then the browser clamps `scrollTop` to the short maximum and does **not** restore it when the spacer grows back microseconds later. The position is gone.

The readers that sit in that interval are ordinary, not exotic: every child layout effect (React runs children before parents), any `scrollHeight` read in a sibling effect declared earlier, any `clientHeight` read. On a streaming transcript a geometry read coincides with a window swap constantly — which is why the failure was intermittent per commit and relentless over a session.

Applying the height in the render pass closes the window by construction rather than by hunting readers, so a geometry read added later cannot reopen it. Two implementations, both valid:

- **React-native** (`TugListView`): the spacer elements carry `style={{ height }}` from the render body. The post-commit writer must be **deleted**, not kept alongside — React skips re-applying a `style` value it believes unchanged, so two writers go stale against each other.
- **Imperative** (`TugMarkdownView`): `applySpacers` is called in the same synchronous task as the block add/remove loops, so no other code runs between them.

## Repair is bounded to the commit phase

**A displacement is detected and repaired inside the synchronous commit, and nowhere else.**

A person cannot scroll during synchronous JavaScript — the event loop is not turning and no input is being processed — so a `scrollTop` difference observed across a commit is machine-caused with certainty rather than with confidence. That certainty is the entire licence for the repair. Any across-frames version of the rule ("the position moved and I don't know why, put it back") would fight the native scrollbar on every heartbeat, since a thumb drag is exactly a position that moved for no reason the machine can see.

Two details make it safe in practice:

- **The baseline is the last scroll-event position** (`SmartScroll.lastScrollEventTop`), not the previous commit's reading. The previous reading spans real wall time in which a thumb drag and a clamp are indistinguishable. Scroll-event timing discriminates them exactly: a drag delivers scroll events that refresh the baseline before any commit can bracket it, while a clamp moves `scrollTop` synchronously at forced layout and its scroll event cannot dispatch until the layout phase has ended. A drag followed by a clamp therefore repairs to the *post-drag* position — the user's most recent expressed intent.
- **A repair that does not hold is not retried.** If the next bracket finds the same displacement, the document genuinely shrank (a ledger shortfall) rather than dipping transiently, and re-writing a position the geometry cannot support would fight the browser every commit. The outcome is reported forward on the next record as `priorRepairHeld`.

Clamps that land **outside** a commit — a late-decoding image, a font swap, a CSS transition settling — are deliberately out of scope for positional repair. They cannot be distinguished from a scrollbar drag, and guessing wrong reverts a real gesture, which is worse than the failure being fixed. Attribution and recoverability cover them: such a clamp never changes follow-bottom, and the growth-time re-engagement below bounds its cost to a moment rather than a session.

## The four routes back to follow-bottom

Follow-bottom is a state the user can end and the machine cannot. It must never be a one-way door — even perfect attribution misfires eventually, and a state that cannot heal turns every miss into a session-long outage.

1. **Idle scroll into the band** (`idle-reengage`) — an unattributed scroll that lands within `AT_BOTTOM_PX` of the live edge, moving downward. The direction requirement stays here: this fires *during* movement, and a user travelling upward into the band is still heading away.
2. **Gesture end inside the band** (`gesture-end-reengage`, `gesture-end-at-bottom-reengage`) — direction still counts for a gesture ending *near* the bottom, but not for one ending *inside* the band. Gesture end has no motion left to contradict the position.
3. **The jump-to-bottom affordance** — the explicit click.
4. **Growth time, for an idle user inside the band** (`growth-at-bottom-reengage`) — content arriving re-engages before pinning.

The fourth exists because the first three all require the user to *move*. Someone parked at the live edge who touches nothing generates neither a scroll event nor a gesture, and from where they sit the card already looks pinned, so the affordance is a gesture they have no reason to perform. For them the state was terminal, and every append silently failed to arrive. Two field reports have this exact shape: a `/commit` receipt row and a `Session compacted` note, both ordinary appends onto a bottom-parked transcript, both failing to scroll in.

The fourth route carries two carve-outs — never mid-gesture (that decision belongs to gesture end; re-engaging mid-drag pins under the user's own thumb) and never while a restore target is pending (engaging clears the restore target, so a pin mid-restore would destroy the cold-boot placement).

Its accepted cost: a user can no longer hold a *disengaged* position within 60px of the live edge. That follows from the band being the definition of "at the bottom" throughout `SmartScroll` — a peek that stays within 60px is not leaving — but it is a real reduction in what the user can hold, so it is recorded rather than assumed.

## How to diagnose a scroll defect

Every one of these is live in a **release** build with no opt-in, because the sessions that hold the evidence are the ones nobody was watching:

- **The dev panel log** (Opt-Cmd-/): every follow-bottom transition with its source and geometry, every repair, every displacement. Readable from app-tests via `window.tugDevLog.getSnapshot()`.
- **`window.__deckTrace.dump()`**: the `scroll-displacement` and `follow-bottom` event kinds record through the disabled gate (`ALWAYS_RECORDED_KINDS`) and the window handle is bound in release builds. A displacement record carries the baseline, the observed position, both heights, the follow-bottom state, whether it was repaired, and whether the *previous* repair held.
- **`data-scroll-displacements`** on the scroll container: the count since mount. `"0"` on a settled transcript is the invariant.
- **The eviction A/B arm**: `window.__tug.setTranscriptEvictionDisabled(true)` renders the same transcript with windowing withheld. Displacement that vanishes in that arm and returns when it is re-enabled is window-geometry-caused.

Scroll position is appearance-adjacent state that lives in the DOM and in `SmartScroll`'s internals — never in React state ([L06]); the writers read live elements and refs, never captured snapshots ([L07]).

## Cross-references

- [D93] in `design-decisions.md` — the six-phase machine, the six listeners, and the amended attribution guard this doc grounds.
- The two-pass estimated-jump/correction protocol is documented at `pendingScrollCorrectionRef` in `tug-list-view.tsx`; its pass 2 is the supersedable correction above.
- `card-state-model.md` / `state-preservation.md` — where the anchor the anchor-writer serializes is saved and restored.
- `tests/app-test/at0333-follow-bottom-unattributed.test.ts` — the behavioral pins (scrollbar-silent disengage, correction supersede, re-engage, wheel re-engage).
- `tests/app-test/at0335-scroll-displacement.test.ts` — the clamp pins (counter published, clamp detected and repaired, window swaps clean, wheel reaches the bottom, a clamp never flips follow-bottom, quiet arrival, idle-user recovery).

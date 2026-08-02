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
| Browser clamp on `scrollHeight` shrink | `scroll` | `idle` | unattributed, but lands where `isAtBottom` holds — the at-bottom band absorbs it |
| Position-stable click compensation (`use-position-stable-click.ts`) | `scroll` on the click call-stack | `idle` | **user** — it holds the click point under the user's cursor, so the user owns the resulting position |

The scrollbar row is the load-bearing one. A native thumb drag is completely silent apart from the `scroll` events themselves, so any model of the form "idle ⇒ we caused it" is falsified the moment a user grabs the scrollbar — which is why [D93]'s phase guard reads the way it does: ours = `programmatic`, or `idle` with the post-programmatic suppression armed; everything else in `idle` is the user.

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
2. **Justify itself against the inventory above** — and then extend the inventory here. A defensible raw write is one the doctrine can classify without new machinery: it only moves `scrollTop` down (pin-shaped), it lands where `isAtBottom` holds (clamp-shaped), it runs on the user's own gesture call-stack (position-stable-click-shaped), or it explicitly disengages/supersedes first (find-reveal-shaped).

A raw upward write that is none of these is a bug waiting for a scrollbar: it will read as user intent to the disengage, or fight a user gesture the supersede rules exist to protect. If a deferred write cannot name the gesture that voids it, it does not ship.

Scroll position is appearance-adjacent state that lives in the DOM and in `SmartScroll`'s internals — never in React state ([L06]); the writers read live elements and refs, never captured snapshots ([L07]).

## Cross-references

- [D93] in `design-decisions.md` — the six-phase machine, the six listeners, and the amended attribution guard this doc grounds.
- The two-pass estimated-jump/correction protocol is documented at `pendingScrollCorrectionRef` in `tug-list-view.tsx`; its pass 2 is the supersedable correction above.
- `card-state-model.md` / `state-preservation.md` — where the anchor the anchor-writer serializes is saved and restored.
- `tests/app-test/at0333-follow-bottom-unattributed.test.ts` — the behavioral pins (scrollbar-silent disengage, correction supersede, re-engage).

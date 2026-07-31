# Perf brief 31 — the cost of a discrete gesture on a loaded deck {#top}

Sibling to `roadmap/jul30-perf-brief.md`, opening a second front. That brief prices **continuous motion at idle** — what a running animation costs per rendering update. This one prices a **discrete gesture**: what it costs to mount one small component while the deck holds real transcripts. Motion appears not to be implicated — the animation census is quiet during the gesture, and the cost is paid synchronously inside the keystroke's own JavaScript rather than at frame time — so for now the two fronts are treated as independent.

The scope is deliberately open. What follows is one gesture, measured hard; whether it is an instance of something general (any mutation on a loaded deck) or a local fault is not yet established, and the brief should not be read as having settled that.

**The headline:** opening a snippet editor in the Lens costs **255ms** on a deck carrying three session cards, and **45ms** on an empty one. An arrow key through the same list, in the same document, costs **5ms**. Whatever the editor itself costs is not the story — the same gesture in the same code gets five times more expensive as the rest of the document grows.

**Status:** measured and localized, not explained to the bottom and not fixed. No code change is proposed yet — two were tried and both reverted (see [#dead-ends]). Next: [W1] land the harness, then [W2] price style recalc against layout ([#work]). Last updated 2026-07-31.


## The report {#report}

Pressing Return to open a snippet, or Space to create one, lands a visible beat before the editor appears. Reported as release-only: the release instance hesitates, the debug instance is quick.

The build flavor is a red herring, and provably so. Swift Debug is unoptimized and production React is faster than dev React, so a Release build cannot be slower for either reason; and `snippets.json` is machine-global, so both instances render the same eleven rows. The variable is what is *on* the deck. The release instance is the loaded daily driver — read out of its own tugbank, its saved layout is three `session` cards, a `text` card, and the Lens pinned right, five-up. The debug instance is not.


## Measurements {#measurements}

One deck shape throughout: the release instance's saved layout, transcripts filled to 34k elements. Timings are keydown → the editor holds the caret.

| Condition | keydown → usable |
|---|---|
| ArrowDown through the same list | **5 ms** |
| Return (open) | **255 ms** |
| Space (create below) | **250 ms** |
| Return, empty deck (1 accordion card, 6k elements) | 45 ms |
| Return, transcripts `display: none` | **67 ms** |
| Return, transcripts `content-visibility: hidden` | 171 ms |

The gradient across the last three is the whole story: the gesture's cost is a function of how much document has to be walked, and the transcripts are ~90% of it.


## The mechanism {#mechanism}

Mounting the editor forces one synchronous style+layout flush of the entire document. Instrumenting every forced read during the gesture (patched `getBoundingClientRect` / `getComputedStyle`, timed and attributed by target element) gives:

- **21 forced reads, 104ms total.** `getComputedStyle` is free; the cost is entirely layout.
- **One read accounts for all of it** — a `getBoundingClientRect` on the editor well from inside a React layout effect (stack: app code called from React's commit). CodeMirror's own four measurements, immediately after, cost **0ms**.
- The remaining ~150ms (mount → paint) is the browser's own layout and paint for that frame, scaling the same way.

**The load-bearing corollary: whoever reads first pays the whole bill.** The reads are not independently expensive; the *first* one flushes everything pending and the rest are free. This is why removing a reader does nothing — the bill simply moves to the next one. It is the trap this investigation fell into twice, and the thing to remember before anyone proposes deleting a measurement.


## Ruled out {#ruled-out}

Each with a measurement, not an argument:

- **The open animation.** Removing the well's grow-from-zero tween left the beat exactly where it was; the 104ms moved from the animation's measurement to CodeMirror's first one. Reverted.
- **The root `data-focus-mode` write.** Every descend stamps an attribute on `<html>`, which invalidates style for every descendant, and arrows do not — a near-perfect suspect. Removing it in the focus manager changed nothing (255ms → 253ms). A monkeypatched run that appeared to show 14ms was positional: repeating the same patched gesture gave 257ms and 259ms. Reverted.
- **`contain: layout`** on `.tug-pane` and on the transcript scrollers — no effect.
- **Per-row `content-visibility: auto`** — nothing to skip; the transcript's list window holds 2 row elements.
- **Stylesheet injection per open** — rule count is constant at 3815 across three opens.
- **Key delivery, the focus projection, the snippets list, and the store** — all exonerated by the 5ms arrow through the identical list and document.
- **tugbank size** (88 entries) and **snippet count** (11, identical in both instances).


## The open question {#open-question}

Layout containment on the transcript subtrees does not isolate them, but removing them from the box tree entirely (`display: none`) recovers 188ms of the 255ms. `contain: layout` scopes *layout*; it does not scope selector matching or style recalc. That the former buys nothing and the latter buys everything points at **style recalc over the transcript subtrees** as the dominant term, not layout.

That is the next thing to measure, and it decides the shape of the fix: if the cost is style matching, the lever is what the transcripts present to the selector engine (rule shape, subtree size, invalidation scope); if it is layout after all, the lever is windowing the transcript. Worth pricing before either is built.

Two framings to keep separate while investigating: making the *flush cheaper* (transcripts stop being expensive to walk) versus making the *gesture not force one* (nothing on the mount path reads geometry synchronously). The second is narrower but fragile for the reason in [#mechanism] — it only holds while every reader on the path stays disciplined.


## Work {#work}

**[W1] Land the reproduction harness as a real perf app-test.** Everything above was measured through a scratch file that was then deleted; re-deriving it is the tax on every future session. It should exist as a checked-in instrument — an app-test that prints a timing report, with the ablations as knobs, so a change can be priced in one command instead of rebuilt from scratch. What it has to carry:

- **A loaded deck, seeded from the real shape.** Three `session` cards + the Lens pinned right, five-up, matching the release instance's saved layout. Transcript weight via `bindSession` + `driveSession({op: "ingestFrame", feedId: 0x40, decoded: {type: "assistant_text", …}})`, N blocks per session, N an env knob (the scratch used `AT9997_BLOCKS`, default 40, findings taken at 200 ≈ 34k elements). Blocks need real structure — headings, lists, inline code, a fenced block — not flat prose.
- **The timing probe.** Mount observed by `MutationObserver` (microtask granularity — a rAF poll rounds every answer up to the next frame and hides the commit time), then rAF for first paint and for the caret landing. Report keydown → mount → paint → focus, not a single number.
- **The forced-read census.** Patched `Element.prototype.getBoundingClientRect` and `window.getComputedStyle`, each timed, counted, and **attributed by target element** (`tagName` + first two classes). Attribution by element is what survives a minified bundle; stack frames do not. This census is what produced [#mechanism] and it is the instrument that matters most.
- **A weight readout** — element count, `getAnimations().length` — printed alongside every timing, so no number is ever recorded without the document it was taken against.
- **The ablations as switches**: transcripts `display: none`, `content-visibility: hidden`, `contain` on panes/scrollers, per-row skipping. These are the comparison that turns a timing into a finding.
- **A baseline gesture in the same document.** The 5ms ArrowDown is what makes the 255ms mean something; a report without it can be read as "the app is slow" rather than "this gesture is".

Assertions should be ratios and structure, never wall-clock budgets — a millisecond threshold on a shared machine is a flake. `@covers` is required (`just app-test-covers-check`), and it runs selectively, never in a sweep.

**[W2] Price style recalc against layout on the transcript subtrees** — the question in [#open-question], and the thing that decides the fix's shape. Wants W1 in place first.


## Dead ends, recorded {#dead-ends}

Both reverted; neither is in the tree. Recorded because each looked convincing and cost a round trip:

1. **Retiring the open tween.** Grounded in a real measurement (a 200ms `--tug-motion-duration-moderate` well animation) taken on an **empty deck**, where it genuinely was the dominant term. It is not, on a real one. The lesson is [#method]: an empty deck is not a small version of a loaded one, it is a different system.
2. **Restricting `data-focus-mode` to trapped modes.** Defensible on its own terms — the attribute is documented for "a modal trap is active", no CSS consumes it, and descend scopes already carry `data-key-within` — but it fixes nothing here, and it changes a projection contract that four app-tests pin. If it is ever wanted, it should be argued as a projection-contract cleanup on its own merits, not smuggled in as a performance fix.


## Method and caveats {#method}

Measured through a scratch app-test driving the real app: the release instance's saved layout, transcripts built by ingesting `assistant_text` frames, the same probe timing keydown → DOM mount → first frame → caret focus, with forced reads counted and attributed. The harness was deleted after use; it is worth re-landing as a proper perf app-test if this work continues.

Two caveats against `jul29B-perf-brief.md#record-overlap-law` discipline:

- **App-test instances, not release-main.** They serve the production bundle (Maker serving is hard-gated off for the harness), which is the right frontend, but the app is a Debug configuration and the machine is not controlled. The ratios here are large and repeated across runs; the absolute numbers are not release-grade.
- **Synthetic transcripts.** Markdown prose, headings, lists, and fenced code — structurally realistic, but not a captured session, and carrying none of the tool-call chrome, sticky headers, or pulsing dots a real transcript has. The real deck is likely worse, not better.

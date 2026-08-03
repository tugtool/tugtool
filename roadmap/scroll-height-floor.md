# Scroll height floor — make the transcript's extent monotone by construction {#scroll-height-floor}

A working brief for the interactive sessions that follow the `follow-bottom-clamp` join. It records what is now proven, states the governing assertions, and lays out the work in order. It is deliberately a brief, not a devise plan: the work is interactive and each stage should be designed at the keyboard, against the running app, with the proofs in `tests/app-test/at0336-conservation-probe.test.ts` as the measuring instruments.

## What is proven (2026-08-03) {#proven}

The full evidence chain is in `roadmap/follow-bottom-clamp.md` under "F1 diagnosed"; the diagnostic suite is `at0336-conservation-probe.test.ts`; the probe surface is `window.__tug.getListConservation(selector)`.

- **The eviction height ledger is exact.** Across 109 eviction events including full-transcript window swaps, the worst ledger-vs-live accounting error is 1.5px spread over 15 rows. Eviction-as-concept is sound; no revert is needed.
- **Every observed displacement — the ~24px turn-boundary dips and the 2,368px window-swap pull — is one mechanism: WebKit clamps the scroll offset synchronously at renderer removal, inside React's mutation phase.** React processes deletions before sibling style updates, so for one unobservable instant the removed cells are gone while the spacers still hold their old heights; WebKit clamps against that transient extent and nothing restores the position when the spacers grow microseconds later. No JavaScript read or write occurs in the gap (proven by wrapping every scroll mover and layout-forcing getter with stack capture), no inter-commit height dip exists (proven by the per-commit geometry ring), and scroll anchoring is not involved (proven by an `overflow-anchor: none` A/B, pixel-identical result).
- **The countermeasure works.** Pinning the scrollable extent with an absolutely-positioned one-pixel height post drives the identical swap sequence to zero displacements. That experiment is the last test in `at0336`.

The consequence for the previous plan: the [S02]/[S03] detect-and-repair machinery was built to undo a displacement that should instead be made impossible. It demotes to an assertion layer once the floor exists.

## Governing assertions {#assertions}

These are the user's cases, restated with the amendments the diagnosis forced. Everything that happens to the transcript's geometry and scroll position must be explainable by an explicit pin to a human-initiated or machine-initiated action; shrinkage is especially suspect because the transcript grows over time.

- **Case A (strengthened).** The transcript's scrollable extent is non-decreasing *at every instant, including mid-mutation* — not merely at observable boundaries, because the browser acts on states no scroll API can witness. The only exceptions are explicitly attributed shrinks: user collapse of a block, pane-width re-wrap, font/density/theme reflow, session clear, data-source swap. Each of those lowers the floor through a declared rebase write, never by letting the content dip out from under it.
- **Case B.** Follow-bottom is engaged unless a direct, attributed user action disengages it (wheel-up, scrollbar drag, keyboard navigation). With Case A enforced this becomes implementable: clamps are impossible and our own writes are counted, so an unattributed upward scroll *is* the user — which closes the scrollbar-drag hole (thumb drags deliver no pointer or wheel events, only scroll events). Amendments: user-requested machine scrolls (find-reveal, focus-reveal) disengage explicitly as part of their command; scroll anchoring is gated off while following, since holding mid-viewport content still is definitionally opposed to the pin.
- **Case C.** Scrolling caused by direct user action is never counteracted. This falls out of A + B once the repair layer is assertion-only; the one residual obligation is ordering — a user disengage must run in the capture phase, synchronously ahead of any pin scheduled in the same frame.

## The work, in order {#work}

**1. Productize the height floor in `TugListView`.** A render-phase element (the height post shape: absolutely positioned, one pixel wide, pointer-events none) whose height ratchets with the ledger's predicted total content height, so the scrollable extent cannot dip mid-mutation regardless of React's mutation order. Design questions to settle interactively: where the floor value comes from (ledger total vs. last observed `scrollHeight`), the rebase paths for each attributed shrink in Case A and how each declares itself (`noteExternalWrite`-style pins), slack policy (a floor briefly taller than settled content leaves scrollable emptiness at the bottom — decide how and when it snaps down, and that snap is itself a declared write), and interaction with `content-visibility` and the width-settle freeze.

**Stage 1 landed (2026-08-03).** The design questions resolved as follows, all on main:

- *Floor value*: the last settled extent, measured in the commit bracket — not the ledger total, which cannot know leading/trailing content or the block-axis pseudo-padding. The floor is `.tug-list-view-floor` (rendered with no height; the bracket is its single writer, [L06]) and is set to `extent − 1` every bracket. The `− 1` keeps the floor from ever defining `scrollHeight`, so `scrollHeight` stays a truthful content measurement; when a shrink makes the floor the thing `scrollHeight` reports, the true extent is recovered from the bottom spacer's bottom edge plus a self-calibrating inset (no `getComputedStyle`, guarded against viewport-defined readings).
- *Rebase = the same write* (set-to-extent, chosen over strict ratchet + enumerated paths): every bracket sets the floor to the settled extent, up or down, so no shrink path can be forgotten — a shrink nobody anticipated lowers the floor one commit later instead of leaving permanent phantom scroll space. A downward write is the declared rebase: it flushes layout so any clamp happens inside the declared write, pins it via `noteExternalWrite`, and records an always-recorded `extent-rebase` trace event (the Case A attribution pin). Slack is bounded at one commit; session clear, data-source swap, width re-wrap, and `content-visibility` all need no special casing.
- *Results*: the at0335 swap replica that deterministically displaced ~2,368px records **zero** displacements (at0336 5/5, every drive zero); the `forceCommitClamp` simulation drops the floor for its synchronous window so the detector stays testable. Two at0335 opens slated for stage 3 fell out during the work: `priorRepairHeld` null/false (the repair marker is now carried through quiet commits and judged against the baseline, not the new displacement's landing spot) and the 326px idle-recovery shortfall (`maybePinToBottom` now also judges at-bottom against the resting geometry — `lastScrollEventTop`/`lastScrollEventHeight` — because a whole turn landing in one commit made the idle user measure hundreds of pixels "away" from a bottom they never left). **at0335 is 9/9 for the first time.**

**2. Demote the repair machinery to assertions.** With the floor in place, the commit bracket stops repairing and starts asserting: any detected displacement is recorded loudly (deck-trace + dev log) as a bug, never silently counter-written. Keep the bracket, the counters, the registry, and the probe — they are the instruments that proved this diagnosis and they stay.

**3. Re-point `at0335` at zero.** The original success criterion — `data-scroll-displacements === "0"` — becomes honest again. Restore it, and fold the two remaining legitimate failures (the 326px idle-recovery shortfall, the `priorRepairHeld` null) into the interactive investigation. Keep `at0336` permanently as the conservation harness.

**4. Rebuild follow-bottom on Case B's polarity.** Engaged is the resting state; disengagement requires an attributed action; re-engagement happens on attributed arrival at the bottom. Includes the anchoring gate while following and the capture-phase disengage ordering from Case C. The gesture-end `isAtBottom` re-engage path from the previous plan is implemented but unpinned — pin it here.

**5. Amend the doctrine.** `tuglaws/scroll-intent.md` and [D93]: the clamp model is "removal-time, mid-mutation, no reader required," superseding "forced layout in the commit-phase gap." The floor becomes the stated defense; the bracket becomes the stated witness.

## Standing instruments {#instruments}

- `just app-test tests/app-test/at0336-conservation-probe.test.ts` — the five-test diagnostic suite: probe run, at0335-swap replica, anchoring-off variant, mover capture, height-post countermeasure. The replica and countermeasure tests are the before/after pair for stage 1.
- `window.__tug.getListConservation(selector)` — per-eviction ledger-vs-live records, mounted-cell audit, per-commit geometry ring.
- `window.__tug.getScrollDisplacementCount` / `forceCommitClamp` / `setTranscriptFollowBottom` — the bracket's seams from the previous plan.
- The at0335 magnitude assertions are the regression net until stage 3 restores the zero criterion.

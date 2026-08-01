# Perf brief aug01 — six surfaces, event-clean {#top}

Successor to `roadmap/jul30-perf-brief.md`, opening the next full audit round in the same bottom-up, surface-by-surface style. Between the two briefs, three investigations moved the ground: the jul31 discrete-gesture brief (`roadmap/jul31-perf-brief.md`) caught CM6's style injector rewriting a live `<style>` tag on every editor mount — a full-document style invalidation, fixed two-line; the 2026-07-31 live-deck session (`roadmap/animation-islands.md`) proved the running glyphs innocent and the **animation event churn** guilty; and the island meter's first arming caught the prompt editors' caret layer restarting its animation continuously at idle. jul30's organizing law (the quiet contract) survives intact; this round adds its sequel, proven the hard way:

**The island contract ([animation-islands.md#contract](animation-islands.md#contract)): an animation is free iff its event rate is zero at steady state** — started once, target never re-resolved, effect stack never demoted. Motion is not the cost; *events on motion* are, and each one bills a whole-document compositing walk priced by layer population. The bill is `event rate × walk cost`, both factors ours ([#walk-physics](animation-islands.md#walk-physics)); separate compositing scenes (WKWebView-per-pane) were tabled and rejected 2026-07-31 — the single-page model is the model.

**Standing constraints, restated from jul30 and 07-31:** the motion designs are fixed inputs — the pulsing dot's scale breath and emitted ring, the wave's bars, every site they ship at. Engineering serves the design; no opacity-only fallbacks, no glyph removal, no redundancy cuts. Measurement discipline is D5 plus the new artifact rule: never probe through `!important` overlays ([animation-islands.md#artifact](animation-islands.md#artifact)) — suppression sheets take a `:not(.probe-x)` exemption hole.

**Process:** as jul30 — worked interactively on `main`, one surface at a time, each advancing on the user's explicit call; no batch plans, no dash ceremony. Nothing here authorizes autonomous implementation.

**Instruments in hand:** `diag/anim-island.sh` (event census: restarts, aged transitions, glyph-subtree write reach, unmounts, rAF occlusion guard; plus `pids`/`walk` process-side) and `tests/app-test/at9996-anim-island-lab.test.ts` (the captivity lab: seeded release-shape deck, synthetic streaming knobs, cell matrix with the meter embedded). Both are Phase-0 quality — I5 hardens them.


## Evidence carried forward {#evidence}

The 2026-07-31 measurements this round stands on (method and full tables in [animation-islands.md#findings-0731](animation-islands.md#findings-0731)):

- **Running glyphs are free at rest, at every weight tried.** Lab at 11k and 34k nodes, 36–39 running dot/wave animations: 60fps, zero long frames, zero events. jul30 S3's unchecked exit box, measured twice, passes.
- **Token streaming does not implicate animations at lab weight.** stream-hot ≡ stream-cold ≡ stream-quiet; the streaming render cost is real (~46fps at a 50ms cadence) but animation-independent, and the synthetic text path produced **zero** island events.
- **The live deck churns animation events continuously.** 36 armed minutes on the release deck: **491 animation starts, 442 cancels** — dominated by the CM6 caret layer in the prompt editors (36 and 33 restarts on two editors) plus restarts on a session-status dot.
- **Live A/B, interleaved:** dots suppressed → `updateRendering` 64–82/5s; native with three working sessions → ~1900–2140. The delta is real and it is *events*, not motion — every cleanly-exempted single glyph, in every context including in-transcript, read free.
- **Instrument artifact, recorded:** an `!important` probe fighting a suppression sheet demotes the probed animation and measures the demotion it created. jul29B's unreproducible probe residue is the same ghost. Method rule now standing.
- **Retraction from the live session:** "one breathing dot = 10% of the main thread" was that artifact; withdrawn 2026-07-31.


## The six surfaces {#surfaces}

S1 (caret blink authoring), S2 (Pulse/sparklines), and S5 (imposer motion) closed in jul30 and stay closed — S1's *authoring* is done; its *lifecycle* reopens inside S6, which is a different defect on the same glyph. The round below carries S3/S4 forward under the island contract and opens three new surfaces.

### S3 — TugProgressIndicator `pulsing-dot` (carried) {#s3-pulsing-dot}

Status rewritten by the 07-31 findings: the glyph's motion is measured-free at rest and its authored form is exonerated axis by axis (`calc(var())` stops, percentage translate, the declared transition, the inline pose — all cleared). What remains is the island contract on its **hosting**:

- **The open question — which event channel fires under real work.** The synthetic text-streaming lab produced zero events; the live deck restarts status dots and strands transitions (one running `transform` CSSTransition caught live on a dot span). Prime suspect: the **turn/tool lifecycle** — tool_use→tool_result cycles drive glyph state crossings (settle transitions, demotions, remounts at entry boundaries), the event class the text cells never exercised. I5's `tool-churn` cell discriminates E1 (restart-on-remount) / E2 (recalc reach) / E3 (stranded transitions) with the meter's counters.
- **The fixes, all three tracks from [animation-islands.md#p2-fixes](animation-islands.md#p2-fixes), emphasis set by the cell verdict:** F1 identity stability (stable keys, memoized glyph host, idempotent `startLoops` — zero restarts across a 1000-commit run, assertable); F2 recalc firewall (strong form: shadow root with the component's own sheet — the componentization made literal, zero pixel change; lighter form if the lab proves it sufficient); F3 strand-proof crossings (watchdog: no transition outlives its resolved duration + slack; self-heals and logs).
- **Measured exit:** tool-churn cell at heavy weight → walk ≤ noise, zero restarts, zero aged transitions, with the full motion design running; live release deck, three working sessions → main thread within noise of the animations-suppressed floor.

### S4 — Wave (carried) {#s4-wave}

Inherits everything in S3 — same island contract, same fixes, same cells; the lab already runs its bars. Plus jul30's own unfinished item, unchanged: **the stuck-footer falling edge** — a wave on a settled deck is a missed turn-end event on some path (cancel, error, wedge-recovery), root-caused in the state machine, not the CSS. The meter's aged-transition and census counters make the hunt observable now.

### S6 — the CM6 implementation {#s6-cm6}

New surface, named by this round: CodeMirror's *implementation behavior* inside the page — distinct from S1, which tuned the blink's authored keyframes and left CM6's machinery unexamined. Three sub-fronts, one already fixed and owed its durable form:

- **S6a — style redeclarations.** jul31's root cause: style-mod's document path rewrites its `<style>` tag's entire `textContent` on every `EditorView` construction — the one invalidation WebKit cannot scope (full resolver rebuild + full-document recalc, ~102ms on the loaded deck, paid twice per mount), and invisible to rule-count checks because it nets zero rules. The two-part fix (rewrite guard + one shared module-level `EditorView.theme({})` as the initial typography-revision marker) took the Return-to-open gesture from 280/276/270ms to 61/45/41ms. **Owed:** the durable form — the style-mod guard is a patched dependency; decide vendoring/upstreaming/pinning, and land a regression probe (the identical-rewrite probe from at9997) so a CM6 upgrade cannot silently reintroduce it. Audit for other redeclaration sites: every `new EditorView` anywhere (prompt entries, text card, code views, expanded FileBlocks) paid this.
- **S6b — the caret layer's animation lifecycle.** The meter's first live catch: `cm-layer` in the prompt editors restarts its blink animation continuously at idle (36/33 restarts per editor per 36min) with matching cancels, and caret-reset-on-keystroke makes it per-key under typing — an animation event on the typing surface itself, per keypress, on the deck where events bill walks. Root-cause the restart source (CM6 `LayerView` rebuild cadence vs the `data-tug-text-editor-typing` suppression's add/remove cycle — a suppression that *toggles* `animation-name` is itself a start/cancel generator). The island contract applies verbatim: the blink should be one animation started once per focus, phase-reset without teardown, or suppressed without cancel-restart churn.
- **S6c — editor population.** Retained live CM6 editors in expanded FileBlocks (jul30 I3's census note) and every mounted prompt entry each carry layers, listeners, and a caret lifecycle. Census the standing editor population on the loaded deck; decide what a dormant editor holds. Wants S6b's findings first.
- **Measured exit:** zero caret-layer animation events across a 60s idle window and ≤1 per keystroke burst under typing (the reset itself, if kept, must be a phase write, not a teardown); editor mount priced at the jul31 post-fix floor with a standing regression probe; S6c census recorded with a decision.

### S7 — transcript entry lifecycle {#s7-entry-lifecycle}

New surface: the **hosting side** of every in-transcript island. The live deck rewrites entry-level className/attributes under turns (stamped probe classes vanished within minutes), remounts at entry/tool boundaries, and strands transitions; the lab's clean text path proves none of that is forced by token flow. This surface owns the render discipline of `tug-transcript-entry` and its children under real turns:

- Identity stability through the entry chain (keys, memo boundaries) so tool headers and their glyphs survive streaming re-renders — F1's landing zone.
- Style-write hygiene: what legitimately changes on an entry during a turn, and what churns (className rewrites carrying identical values, attribute stamps per commit). The meter's glyph-subtree write counter is the assertion instrument.
- The settle-crossing machinery under re-renders — where E3's stranded transitions are born (a crossing mid-flight when its element remounts). F3's watchdog lands here if the tool-churn cell convicts it.
- **Measured exit:** tool-churn cell → zero glyph remounts, zero subtree writes to running glyphs from unrelated commits, zero stranded transitions across turn end paths.

### S8 — streaming render cost {#s8-streaming-render}

New surface, opened by the lab's cleanest null: at a 50ms cadence the streaming cells dropped to ~46fps with ~85 long frames per 15s **with all animations suppressed** — an animation-independent render bill on the token path. jul30 P2 coalesced notifies and memoized the committed/tail layout split; something still costs a long frame per burst at weight. Price the partial-block re-render (a growing markdown block re-rendered per rev), the tail `buildRowLayout`, and the per-flush commit scope; the lab's cadence and block-size knobs are the instrument. This surface is deliberately scoped to *measurement first* — no fix direction is assumed; it may be honest cost at an unrealistic synthetic cadence, and the first task is a realism check against real-turn flush rates.

- **Measured exit:** streaming cells re-priced at realistic cadence with attribution (which stage pays the long frame); a fix workstream opened only if the realistic number is user-perceptible.


## Supporting investigations {#investigations}

### I5 — meter and lab hardening {#i5-instruments}

The Phase-0 instruments, brought to the standard the cells need: a per-ingest RPC timeout guard and hard iteration cap in the lab (the 34k stream-hot cell hung on a `driveSession ingestFrame` that never returned while the page stayed healthy); the **tool-churn cell** (tool_use/tool_result pairs at cadence × dots present/suppressed × weight) and a **caret cell** (focused editor, scripted keystrokes, meter armed) added to the matrix; external walk sampling integrated with cell timestamps (the sampler/cell alignment run by hand on 07-31 becomes one script); `diag/anim-island.sh` gains the restart-ledger identity notes from the live run. The meter's counters land in `lib/perf-monitor.ts` and TugDevPanel at the end of the round — the enforcement half of [animation-islands.md#p3-enforce](animation-islands.md#p3-enforce).

### I6 — layer-population diet {#i6-diet}

jul30 I3, promoted co-equal ([animation-islands.md#p2b-diet](animation-islands.md#p2b-diet)): the walk is O(mounted layers) and 3–5ms only because the deck mounts ~26k layer-minting elements; the events that legitimately remain (work starts, tool completions, pane gestures) should price below perception. Class-by-class A/B on the lab bench under a deliberately event-noisy probe; census stands from jul30 (`position: relative` 12,666, `overflow` 9,175, sticky 1,713, z-index 1,986). Target: one full walk on the loaded deck ≤ 1ms. No sweeping CSS rewrites on spec.


## Exit criteria {#exit}

- [ ] Tool-churn cell names the live event channel; S3/S4 fixes land with the cell green: zero restarts, zero aged transitions, zero glyph remounts, walk ≤ noise with full motion running at heavy weight.
- [ ] S6a durable: style-mod fix given its permanent form; identical-rewrite regression probe standing; redeclaration audit across all `EditorView` sites clean.
- [ ] S6b: caret-layer events zero at idle, bounded per keystroke; typing on the loaded release deck measurably indifferent to editor count and glyph count.
- [ ] S7: entry-lifecycle assertions green in the tool-churn cell (no remounts, no foreign writes into running glyphs, all turn-end paths stop the wave).
- [ ] S8: streaming cost attributed at realistic cadence; go/no-go recorded.
- [ ] I6: one full walk ≤ 1ms on the loaded deck (lab bench, D5 method).
- [ ] Release deck, three sessions working, all glyph sites lit: main thread within noise of the animations-suppressed floor, ×3 medians; prompt-editor keystroke latency independent of glyph count.
- [ ] Doctrine: `tuglaws/animation-doctrine.md` written with the quiet contract and the island contract as the two organizing laws, the artifact rule beside D5, and the counters as the enforcement surface; jul30's S3/S4 exit boxes closed by measurement.

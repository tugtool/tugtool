<!-- devise-skeleton v4 -->

## Post-compaction Context Truth {#fix-compact-more}

**Purpose:** After native `/compact` shipped (see [`roadmap/fix-compact.md`](fix-compact.md)), the post-compaction EXPERIENCE and ACCOUNTING shipped wrong: a misleading `post_tokens` figure is stamped as the CONTEXT window, and the transcript still shows every pre-compaction verbatim turn as if it were live context. This phase makes the readout HONEST (context = the true resident total, no fabricated number, no one-turn lag) and makes the transcript TRUTHFUL and identical live and on reload (Compaction Summary hoisted to the top, pre-compaction verbatim turns removed, the preserved segment + post-compaction turns kept, a clear "SESSION COMPACTED" state banner).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Native `/compact` (fix-compact.md, joined to main via `a4c7946cd`) dispatches over the stream-json bridge, compacts in place under the same session id and JSONL, and persists a `compact_boundary` + `isCompactSummary` record. That mechanism is correct and stays. What shipped wrong is everything *on top* of it.

**Accounting.** Commit `fd620588e` ("CONTEXT drops in place via compact_boundary post_tokens") tried to kill a one-turn lag: the compaction turn commits with a zero/pre-compaction `cost_update`, so the window-walk (`deriveContextWindows`) carries the stale pre-compaction peak forward until the next real turn corrects it. The fix stamped `compact_boundary.post_tokens` as the compaction turn's committed window (via a faked `TurnCost` in `buildTurnEntry`). But empirically (verified 2026-07-15, Claude Code 2.1.207) `compact_metadata.post_tokens` is a Claude-internal **conversation/summary** figure that is *below the empty-session base* (measured `post_tokens` 2534 and 5271, both < the 24 055 empty-session base). Stamping it as CONTEXT shows an absurd sub-base number. It must be reverted — but the lag must still die honestly, from data on hand.

**Transcript.** After compaction the model retains: the large fixed BASE (system prompt + tool defs + memory + MCP, re-sent every turn), the compaction SUMMARY, and a small PRESERVED SEGMENT (the most-recent turns kept verbatim — the boundary record carries `preservedSegment` / `preservedMessages` uuids). The pre-compaction verbatim turns are **no longer in the model's context**. Yet Tug's transcript still renders every one of them, live and on reload, so the user sees a wall of turns that the model can no longer see — the opposite of an honest view of relevant context.

Both defects share a root cause: the accounting and the transcript present pre-compaction material as if it were current. This phase corrects the presentation + accounting layer without touching the shipped compaction mechanism.

#### Strategy {#strategy}

- **Revert the fake, keep the goal.** Stop faking the compaction turn's `TurnCost` with raw `post_tokens`. Kill the lag with the HONEST resident total — `base + conversation` = `sessionInitTokens + post_tokens` — carried in a dedicated field, never masquerading as usage ([P01]).
- **Ride existing rails wherever they exist.** The context base-vs-conversation split (`computeRichContextBreakdown`), the transcript-truncation effect machinery (`truncate-transcript` / `append-compact-note` on `_transcript`), the "Session compacted" header verb, the `replayWindow` "turns loaded" affordance, and the Compaction Summary block (`DevCompactionCarryForward`) all already exist. This phase composes them; it does not rebuild them.
- **Truth by removal, not annotation.** The pre-compaction verbatim turns are *dropped* from the active transcript (a structural `_transcript` mutation, mirror of the `/rewind` truncation), not merely dimmed. The preserved segment is identified by count `N`, computed authoritatively in tugcode from the boundary's `preservedMessages` uuid graph and emitted on the `compact_boundary` frame.
- **Live == reload, by construction.** Reload is exact (tugcode owns the JSONL uuid graph). Live is made identical by emitting the same `preserved_turns` count on the live boundary frame and applying the same structural truncation to the same committed `_transcript`.
- **tugcode + tugdeck only.** No Rust changes: tugcast relays the (already-widened) `compact_boundary` frame opaquely.
- Sequence: revert-and-honest accounting (tugdeck) → preserved-count emission (tugcode) → transcript truncation (tugdeck) → presentation (banner/hoist/hint) → breakdown honesty check → integration.

#### Success Criteria (Measurable) {#success-criteria}

- The CONTEXT cell never shows a value below the session base after `/compact`. Immediately after a live `/compact` (no next turn yet) CONTEXT shows `sessionInitTokens + post_tokens` (the honest resident total), and it equals the value the CONTEXT popover's `totalUsed` shows (unit test on `deriveContextWindows` + reducer; visual check in-app).
- `grep -rn "post_tokens\|postTokens" tugdeck/src` shows `postTokens` used **only** as an input to the honest-total derivation — never written into a `TurnCost` field and never rendered as a standalone user-facing number (grep + Step-1 review).
- The per-turn TOKENS delta of the compaction turn is an honest negative (`window_post − window_pre`), and the window-walk still telescopes: `sessionInit + Σ perTurn = window(latest)` exactly (unit test).
- After `/compact` the active transcript shows: a "SESSION COMPACTED · <when>" banner, the Compaction Summary hoisted above the surviving turns, the preserved-segment turn(s) and all post-compaction turns — and **none** of the dropped pre-compaction turns (app-test asserts the dropped turns' text is absent and the surviving turns' text is present).
- The reloaded view (Maker ▸ Reload / app relaunch on a real compacted fixture JSONL) is row-for-row identical to the live post-compaction view (app-test on the fixture + a live compare).
- `/compact` is still offered in the slash popup for a session whose conversation is much smaller than its base, with a minimal-effect hint (visual check).
- `cd tugcode && bun test`, `cd tugdeck && bun test`, `cd tugdeck && bunx vite build`, and `just app-test` all pass; `cd tugrust && cargo nextest run` proves no Rust change.

#### Scope {#scope}

1. Revert the `post_tokens`-as-window hack in `buildTurnEntry` / `handleCompactBoundary`; kill the lag via an honest `sessionInitTokens + post_tokens` post-compaction window carried in a dedicated per-turn field and consumed by `deriveContextWindows`.
2. tugcode: compute the preserved-segment turn count `N` from `compactMetadata.preservedMessages` (replay) and `compact_metadata.preserved_messages` (live) and emit it as `preserved_turns` on the `compact_boundary` frame.
3. tugdeck: on the boundary, structurally truncate the active `_transcript` — drop pre-compaction turns except the last `N`, live and on reload — and hoist the Compaction Summary + render a "SESSION COMPACTED · <when>" banner with a "turns displayed / loaded" affordance.
4. A minimal-effect hint on the `/compact` slash entry when the conversation is much smaller than the base (never gating it).
5. Verify the base-vs-conversation `computeRichContextBreakdown` reads honestly post-compaction (the small `messages` slice falls out of the corrected window).
6. Tests: window-walk + reducer unit tests on real fixtures; tugcode replay-count unit test; app-tests for the live + reload post-compaction view.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Any change to the shipped compaction mechanism: native `/compact` dispatch, `compact_boundary` + `compact_summary` emission (live capture + JSONL replay), the modal indeterminate progress sheet. This is the layer on top.
- Building a *new* context-breakdown surface. `computeRichContextBreakdown` + the CONTEXT popover already split base vs conversation; this phase only ensures they read correctly after compaction.
- A compaction-history surface (multiple summaries per session). Multiple compactions collapse to the latest ([P07]) — a history surface stays a follow-on.
- Removing the legacy fake-compaction replay recognition ([D]/fix-compact [P06]) — old JSONLs still need it.
- Shrinking the base itself (system prompt / tool defs / memory / MCP). The base is a fixed floor `/compact` cannot touch; this phase only *explains* it honestly.

#### Dependencies / Prerequisites {#dependencies}

- fix-compact.md landed on main (`a4c7946cd`) — native `/compact`, the `compact_boundary`/`compact_summary` frames, and the `CompactBoundary.post_tokens` field (added by `fd620588e`) all present.
- Claude Code ≥ 2.1.207 (the empirical-verification version; `compact_metadata.preserved_segment` / `preserved_messages` present on the wire and in the JSONL).
- tugcode is a bun-compiled binary: every tugcode change needs `just build` before app-level verification.
- The real natively-compacted fixture already exists: `tugcode/src/__tests__/fixtures/compact-native/0967f3f0-013d-4849-b967-4b66dc702146.jsonl` (carries `preservedSegment` / `preservedMessages` / `postTokens`).

#### Constraints {#constraints}

- tugdeck laws ([L02] external state via `useSyncExternalStore`; [L06] appearance via CSS/DOM). The reducer stays pure; transcript mutation happens in the store wrapper via effects, exactly as `truncate-transcript` / `append-compact-note` do today ([D04]).
- HMR must never reload data/transcript; the reload-identical view is verified via Maker ▸ Reload or app relaunch, never HMR.
- No localStorage/sessionStorage; the summary's + boundary's durability is the JSONL.
- No local re-tokenization for the honest total — every term (`sessionInitTokens`, `post_tokens`) is a feed number.

#### Assumptions {#assumptions}

- `sessionInitTokens + post_tokens` is a faithful stand-in for the post-compaction resident window until the next real turn's `cost_update` supplies the exact `cache_read`. Empirically validated on the haiku scratch measurements: base 24.0K + `post_tokens` ~2.5K ≈ 26.4K, the measured next-turn window ([#empirical-accounting]).
- The preserved segment is always a contiguous suffix of the pre-compaction turns ending at the boundary (`preservedSegment.headUuid … tailUuid`), so "keep the last `N` turns" is exact, not an approximation ([#preserved-segment-analysis]).
- The live `compact_boundary` event carries `compact_metadata.preserved_messages` uuids (Claude Code 2.1.207). If a future release drops them, `preserved_turns` degrades to `null` and tugdeck falls back to keeping all turns live (reload still truncates exactly) — [Q01] fallback.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the devise-skeleton conventions: explicit `{#anchor}` headings, `[P##]` plan-local decisions, `[Q##]` open questions, `Spec S##` specs, `**Depends on:**` lines citing `#step-N` anchors, and `**References:**` lines citing plan artifacts (never line numbers).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] How is the preserved segment identified, live and on reload? (RESOLVED for reload; spike for live) {#q01-preserved-identification}

**Question:** Which committed turns are the "preserved segment" that survives compaction in the model's context, and how do we identify them deterministically on both the reload (JSONL) and live (stream) paths so the truncation is identical?

**Why it matters:** Getting this wrong either drops turns the model can still see (transcript lies short) or keeps turns it can't (transcript lies long). Live and reload must agree.

**Options considered:**
- Match `preservedMessages.uuids` (JSONL message uuids) to turns by `TurnEntry.promptUuid`. **Rejected:** `promptUuid` is the *user-prompt* uuid; `preservedMessages.uuids` are *assistant* message uuids (fixture: `preservedMessages.uuids = [e3791424, 9440a684]`, both assistant; the turn's `promptUuid` is the user `dcfada73`). Direct match fails.
- Emit a **count** `N` of preserved turns, computed in tugcode by walking `parentUuid` from each preserved uuid up to its enclosing user-prompt entry and de-duplicating; keep the last `N` pre-boundary turns. **Chosen** ([P03], [P05]).

**Resolution:** RESOLVED for reload (see [P03], [#preserved-segment-analysis]): tugcode replay owns the full parsed-entry graph (`indexByUuid`), computes `N` from `compactMetadata.preservedMessages`, and emits `preserved_turns: N` on the `compact_boundary` frame. In the fixture `N = 1` (both preserved assistant uuids descend from the single user prompt `dcfada73`). For **live**, [P03] emits the same `preserved_turns` off `compact_metadata.preserved_messages`; **Step 2 spike** confirms the live event carries `preserved_messages` on 2.1.207 and that `session.ts` can resolve the enclosing prompt (it tracks the running message graph). Fallback if live lacks the uuids: emit `preserved_turns: null`, live keeps all turns, a "reload to refresh" affordance shows, and the next Reload produces the canonical truncated view — documented degradation, never a wrong drop ([R02]).

#### [Q02] Where does the honest post-compaction total come from with no next turn? (RESOLVED) {#q02-honest-total}

**Question:** The compaction turn commits before any post-compaction `cost_update` exists, so the exact resident window is unknown. What honest number kills the lag?

**Why it matters:** The reverted hack showed `post_tokens` alone (below base). We need a number that is honest, on-hand, and never fabricated.

**Resolution:** RESOLVED — `window_post = sessionInitTokens + post_tokens` ([P01]). `sessionInitTokens` is the feed-exact base (`window(0)`); `post_tokens` is Claude's own post-compaction **conversation** figure (summary + preserved). Their sum is `base + conversation`, i.e. the true resident total. This is *not* "showing `post_tokens` as CONTEXT" — `post_tokens` is an addend, never the displayed number. Empirically validated (24.0K + 2.5K ≈ 26.4K measured next-turn window, [#empirical-accounting]). The next real turn's exact `cache_read` supersedes it via the existing zero-usage window-walk logic. Re-tokenizing summary + preserved ourselves was rejected: redundant with, and less authoritative than, Claude's own `post_tokens`.

#### [Q03] Do multiple compactions in one session stack or collapse? (RESOLVED) {#q03-multi-compaction}

**Question:** A long session can be compacted more than once. Does the view show every summary/boundary or only the latest?

**Resolution:** RESOLVED — collapse to latest ([P07]). `compactionSeed` is already latest-wins; each boundary truncates the (already-truncated) pre-boundary turns and hoists its own summary. The user sees one banner, one Compaction Summary, one preserved tail, and all turns since the latest compaction. This matches the model's actual context (only the latest summary + latest preserved segment are resident). A multi-summary history surface is a follow-on ([#roadmap]).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `sessionInit + post_tokens` diverges from the real next-turn window | low | low | It is provisional and self-correcting — the next real turn's exact `cache_read` replaces it via the zero-usage window-walk; only shown in the no-next-turn gap | CONTEXT visibly jumps when the first post-compaction turn lands |
| Live `preserved_messages` uuids absent on a future Claude release | med | low | `preserved_turns: null` fallback keeps all turns live; reload truncates exactly ([Q01], [R02]) | Live view keeps pre-compaction turns that reload drops |
| Truncation drops a post-compaction or preserved turn | high | low | Count-based, contiguous-suffix cut ([#preserved-segment-analysis]); app-test asserts survivors present and dropped turns absent on the real fixture | Any surviving-turn assertion fails |
| Removing pre-compaction turns breaks `/rewind` anchors | med | low | `/rewind` already truncates by `promptUuid`; dropped turns simply aren't rewind targets. Verify the rewind tests stay green | `reducer.rewind.test.ts` fails |

**Risk R02: Live and reload views disagree** {#r02-live-reload-divergence}

- **Risk:** Live keeps a pre-compaction turn that reload drops (or vice versa), so the view flickers on Reload.
- **Mitigation:** Both paths apply the *same* `preserved_turns` count to the *same* committed `_transcript` via the *same* effect ([P05]); tugcode computes `N` identically from JSONL and stream metadata ([P03]). Step 6 compares live vs reloaded row sets directly.
- **Residual risk:** The live-only `/compact` bubble turn (fix-compact [P01] documents it does not reappear on reload) means the live view has one extra scaffolding turn the reload lacks — an accepted, pre-existing asymmetry that does not affect the surviving-conversation set.

**Risk R03: Persistence carries a faked cost** {#r03-persistence-faked-cost}

- **Risk:** The reverted hack persisted the faked `TurnCost` to the SessionLedger (`record-telemetry`), so old rows carry `post_tokens` as `inputTokens`.
- **Mitigation:** The honest window lives in a dedicated field, not `TurnCost`, so new persistence is clean. Old persisted rows are self-healing: on reload the compaction turn is no longer the last turn (post-compaction turns exist), so the window-walk uses the real next turn's window and ignores the stale stamp.
- **Residual risk:** A session compacted-then-relaunched with *no* post-compaction turn would replay the stale `inputTokens` once; the honest-total recomputation ([P01]) applies on replay too, overriding it.

---

### Design Decisions {#design-decisions}

#### [P01] Honest post-compaction window = `sessionInitTokens + post_tokens`, in a dedicated field (DECIDED) {#p01-honest-window}

**Decision:** Revert the `fd620588e` hack that faked the compaction turn's `TurnCost` with raw `post_tokens` in `buildTurnEntry`. Instead, `handleCompactBoundary` stamps a dedicated per-turn field `compactionPostTotal = state.sessionInitTokens + event.postTokens` on the scratch entry (only when both are numbers); `buildTurnEntry` copies it onto the committed `TurnEntry` as `compactionPostTotal` and leaves `cost` as the real (zero-usage) `TurnCost`. `deriveContextWindows` gains a parallel per-turn override array: a turn with a `compactionPostTotal` uses it as `window(N)` directly.

**Rationale:**
- `post_tokens` alone is a sub-base conversation figure ([#empirical-accounting]); `base + conversation` is the true resident total ([Q02]).
- Keeping the value out of `TurnCost` stops it masquerading as usage — `perTurnContextSize`, `deriveSessionTotals`, and persistence read the real (zero) cost; only the window-walk consumes the override.
- The window-walk still telescopes because the override *is* `window(N)`; `perTurn = window(N) − window(N−1)` is the honest negative drop.

**Implications:**
- `TurnEntry` gains `compactionPostTotal?: number` (`code-session-store/types.ts`); the scratch entry's `compactionPostTokens` field is renamed/retyped to `compactionPostTotal` and holds the honest total, not raw `post_tokens`.
- `deriveContextWindows` signature grows an optional `windowOverrides: ReadonlyArray<number | null>` aligned to `usages`; callers (`dev-card-telemetry-renderers.tsx`, `telemetry.ts` `computeTokensSummary`, `end-state.test.ts`) pass `transcript.map(t => t.compactionPostTotal ?? null)`.
- The `compact_boundary` frame keeps `post_tokens` (still needed as the input addend); it is never rendered raw.

#### [P02] `post_tokens` is dropped from every rendered surface (DECIDED) {#p02-no-raw-post-tokens}

**Decision:** No user-facing surface renders `post_tokens` (or the old `compactionPostTokens`) as a standalone number. It survives only as the wire field feeding [P01]'s addition.

**Rationale:** It is a Claude-internal figure below the base; shown alone it reads as an impossibly tiny context.

**Implications:** Audit the CONTEXT cell (`dev-card-telemetry-renderers.tsx`), the CONTEXT popover (`ContextPopoverContent`), the compaction divider text (`compactionNoteText`, which shows `preTokens` — that stays, it is the honest pre-compaction size), and telemetry popovers. The grep in [#success-criteria] proves the absence.

#### [P03] tugcode emits `preserved_turns` on the `compact_boundary` frame (DECIDED) {#p03-preserved-turns-frame}

**Decision:** The `compact_boundary` frame gains `preserved_turns?: number`. tugcode computes it as the count of distinct enclosing user-prompt uuids among the boundary's preserved-message uuids: walk `parentUuid` from each preserved uuid up to the nearest `type: "user"` (non-scaffolding, non-summary) entry, collect the distinct prompt uuids, count them. Replay reads `compactMetadata.preservedMessages.uuids` (camelCase, from `JsonlEntry`); live reads `compact_metadata.preserved_messages.uuids` (snake_case) in `session.ts`. Absent/unresolvable ⇒ omit the field (tugdeck treats it as `null`).

**Rationale:**
- tugcode owns the authoritative uuid graph (replay's `indexByUuid`; the live running-message chain), so the count is computed once, server-side, and travels as a small integer instead of an array tugdeck would have to re-resolve.
- A count, not a uuid set, sidesteps the `promptUuid`-vs-assistant-uuid mismatch ([Q01]) and applies structurally to `_transcript` on both paths.

**Implications:**
- `CompactBoundary` (`tugcode/src/types.ts`) + its stub-replay union mirror + `JsonlEntry.compactMetadata` gain the shape; `translateJsonlEntry` and `routeTopLevelEvent`'s `compact_boundary` branch compute and attach `preserved_turns`.
- `CompactBoundaryEvent` (`tugdeck/src/lib/code-session-store/events.ts`) + the wrapper mapping (`code-session-store.ts`) carry `preservedTurns`.

#### [P04] The transcript truncation reuses the effect + `_transcript` machinery (DECIDED) {#p04-truncation-effect}

**Decision:** Dropping pre-compaction turns is a store-wrapper `_transcript` mutation driven by a reducer effect, exactly like `truncate-transcript` (`/rewind`) and `append-compact-note`. `handleCompactBoundary` emits a new `keep-recent-turns` effect carrying `preservedTurns`; the wrapper drops all committed turns before the boundary except the last `preservedTurns`, copy-on-write, invalidating the dropped turns' cached parses (as `truncate-transcript` does).

**Rationale:**
- The committed transcript lives in the wrapper's `_transcript`, not reducer state ([D04]); the reducer stays pure and emits an effect. This is the established pattern for structural transcript edits.
- Reusing the parse-invalidation + copy-on-write discipline keeps React mounts stable for survivors and avoids leaking parse-cache entries for dropped turns.

**Implications:**
- New effect kind `keep-recent-turns` (`effects.ts`) + its `code-session-store.ts` handler beside `append-compact-note` / `truncate-transcript`.
- The boundary handler emits BOTH the divider note (existing) and the truncation, ordered so the note seats on the correct surviving turn. On reload the boundary arrives with no open turn (scaffolding skipped), so `append-compact-note` seats on the last surviving turn after truncation.
- Live: the boundary arrives mid the `/compact` turn; the truncation targets the committed turns *before* that turn. `preservedTurns` counts pre-compaction conversation turns, so the live `/compact` bubble turn (not part of the count) is unaffected ([R02] asymmetry).

#### [P05] Live and reload apply the identical truncation to the identical `_transcript` (DECIDED) {#p05-live-reload-identical}

**Decision:** Both paths run `handleCompactBoundary` → `keep-recent-turns(preservedTurns)` against the same committed `_transcript`. No path-specific truncation logic.

**Rationale:** The committed turn set is the same on both paths (same JSONL underlies both); the count is computed identically in tugcode ([P03]); the wrapper mutation is deterministic. Identity falls out for free.

**Implications:** The app-test that cold-loads the fixture and the live compare assert the same surviving-turn set. The only permitted difference is the live-only `/compact` bubble turn ([R02]).

#### [P06] A "SESSION COMPACTED · <when>" banner + hoisted summary + turns affordance (DECIDED) {#p06-banner-hoist}

**Decision:** The post-compaction transcript header shows a state banner "SESSION COMPACTED · <relative when>" with a "N shown / M in session" affordance, and the Compaction Summary is hoisted above the surviving turns. Compose the existing pieces: the header already relabels the verb to "Session compacted" (`dev-load-control-bar.tsx`, `sessionVerb`/`isCompacted`); the "turns loaded" affordance already exists (`replayWindow` + `deriveLoadStatus`); the summary already renders in `DevCompactionCarryForward` at the top strip. The change is copy + placement, not new infrastructure.

**Rationale:**
- The banner communicates the post-compaction STATE (what the model can/can't see now) — the phase's outcome #5.
- Hoisting the summary to the top puts the model's actual pre-compaction memory where the reader looks first; the dropped verbatim turns no longer compete with it.

**Implications:**
- `DevCompactionCarryForward` stays the summary renderer; its placement is confirmed above the surviving turns (it already renders in the transcript top region, not inline).
- The banner's "when" comes from the same `createdAtMs`/ledger source the header already uses; the "N shown / M in session" reuses `deriveLoadStatus`'s `firstLoadedTurnIndex`/`totalTurns`, extended to account for compaction-dropped turns (dropped turns are not "collapsed history to load", they are gone — the affordance copy must not imply they can be loaded back).

#### [P07] Multiple compactions collapse to the latest (DECIDED) {#p07-latest-wins}

**Decision:** Latest-wins for the banner, summary, preserved tail, and truncation. Each new boundary truncates the already-truncated transcript and overwrites `compactionSeed`.

**Rationale:** Matches the model's resident context (only the latest summary + preserved segment survive). Consistent with the existing latest-wins `compactionSeed` ([Q03]).

**Implications:** No compaction-history state; `keep-recent-turns` is idempotent-ish (a second boundary drops fewer/zero additional turns if the first already trimmed).

#### [P08] `/compact` stays always offered; add a minimal-effect hint (DECIDED) {#p08-always-offered-hint}

**Decision:** `/compact` is never gated or removed. When the conversation is much smaller than the base (`window(latest) − sessionInitTokens` is a small fraction of `sessionInitTokens`), the slash-command entry (`slash-commands.ts`, `compact`) shows a hint that compaction will free little ("Compact — frees little; most context is fixed base").

**Rationale:** Outcome #4. The real-user case (base ≈ 38K, conversation ≈ 4K, freed ~2K) is honestly "small effect", but the command must remain available and the reason legible.

**Implications:** The hint is derived data (from `deriveContextWindows` + `sessionInitTokens`), computed where the slash popup builds its descriptions; no state zone added.

---

### Deep Dives {#deep-dives}

#### Empirical accounting (Claude Code 2.1.207, verified 2026-07-15) {#empirical-accounting}

Context = a large FIXED BASE (system prompt + tool defs + memory + MCP), re-sent every turn (Claude re-emits `system`/`init` per turn), PLUS the CONVERSATION. `/compact` summarizes only the conversation; it cannot shrink the base.

Measured (haiku scratch): empty-session base = 24.0K; after 5 large turns = 34.3K; after `/compact` = 26.4K (freed ~8K of ~10K conversation). Base is the floor.

`compact_metadata.post_tokens` (2534, 5271) is BELOW the empty-session base (24 055), so it is NOT the total working context — it is Claude's conversation/summary figure. **`sessionInitTokens (24.0K) + post_tokens (2.5K) ≈ 26.4K` = the measured next-turn window** — this is why [P01]'s honest total holds.

Real user session (Sonnet 5, high effort, full tools): base ≈ 38K, conversation ≈ 4K, so `/compact` freed only ~2K (42K→40K). The readout was HONEST; the effect was genuinely tiny because the base dominates — hence [P08]'s hint, not a gate.

The one-turn lag mechanics: the compaction turn commits a zero-usage `cost_update` (or reports the pre-compaction context it read). `deriveContextWindows` (`end-state.ts`) treats a zero-usage turn by looking ahead to the next real turn: if it is a drop, it resets to the post-compact window; if there is NO next turn yet, it carries the prior (pre-compaction peak) forward — that is the lag. [P01] closes it by using `compactionPostTotal` as `window(N)` for the trailing compaction turn.

#### Preserved-segment analysis (from the real fixture) {#preserved-segment-analysis}

Fixture `tugcode/src/__tests__/fixtures/compact-native/0967f3f0-…​.jsonl` (82 lines, 11 conversation turns, one manual `/compact`). The `compact_boundary` record (uuid `7b385523`) carries:

```
compactMetadata.preservedSegment = { headUuid: e3791424, anchorUuid: dd27b7ca, tailUuid: 9440a684 }
compactMetadata.preservedMessages = { anchorUuid: dd27b7ca,
    uuids:    [e3791424, 9440a684],
    allUuids: [e3791424, 9440a684] }
compactMetadata.preTokens = 26239, postTokens = 1442, cumulativeDroppedTokens = 24797
```

Walking `parentUuid`:
- `e3791424` (assistant thinking) → parent `dcfada73` (user prompt, line 64).
- `9440a684` (assistant text) → parent `e3791424` → `dcfada73`.
- `anchorUuid dd27b7ca` is the `isCompactSummary` user record itself (line 75), parent = the boundary.

So both preserved messages descend from the **single** user prompt `dcfada73` (the last pre-compaction turn). **`preserved_turns N = 1`.** The preserved segment is the contiguous suffix `{last pre-compaction turn}`. This validates the "keep last `N` turns" rule ([P03], [P05]): the preserved segment is always such a suffix (`headUuid … tailUuid` immediately before the boundary), so counting distinct enclosing prompts and keeping that many trailing turns is exact.

The pre-compaction turns to DROP: the 10 earlier fun-fact turns (lines 2–63). Survivors: turn on `dcfada73` (the preserved segment) + everything after the boundary. Live adds the `/compact` bubble turn on top (not counted).

#### What already exists (compose, don't rebuild) {#existing-infra}

| Capability | Where | This phase's use |
|---|---|---|
| Base-vs-conversation split | `computeRichContextBreakdown` (`telemetry.ts`); CONTEXT popover `ContextPopoverContent` (`dev-card-telemetry-renderers.tsx`) | Verify honest post-compaction ([#success-criteria]); no rebuild |
| Window-walk telescoping + compaction-boundary reset | `deriveContextWindows` / `ContextWindowStep` (`end-state.ts`) | Extend with `windowOverrides` for the honest total ([P01]) |
| Structural transcript edits via effect + `_transcript` | `truncate-transcript` + `truncateTranscriptAtAnchor`; `append-compact-note` (`code-session-store.ts`, `reducer.ts`) | Add sibling `keep-recent-turns` ([P04]) |
| "Session compacted" header verb | `sessionVerb`/`isCompacted` (`dev-load-control-bar.tsx`) | Banner copy ([P06]) |
| "Turns loaded" affordance | `replayWindow` + `deriveLoadStatus` (`dev-load-control-bar.tsx`) | "N shown / M in session" ([P06]) |
| Compaction Summary block | `DevCompactionCarryForward` (`dev-compaction-carry-forward.tsx`) | Hoisted summary ([P06]) |
| `compact_boundary` frame + `post_tokens` | `CompactBoundary` (`tugcode/src/types.ts`); live `session.ts`; replay `replay.ts`; `CompactBoundaryEvent` (`events.ts`) | Widen with `preserved_turns` ([P03]); keep `post_tokens` as [P01] input |

#### End-to-end flows after this plan {#flows}

**Live `/compact`:** user types `/compact` → modal indeterminate sheet (unchanged) → the send opens a turn → stream: `compact_boundary` (carries `pre_tokens`, `post_tokens`, `preserved_turns`) → `handleCompactBoundary` stamps `compactionPostTotal = sessionInit + post_tokens` on the scratch, emits the divider note AND `keep-recent-turns(N)` → the wrapper drops pre-compaction turns except the last `N` → `compact_summary` sets `compactionSeed` → summary hoists, banner renders → `result` commits the turn with the honest window; CONTEXT drops in place, TOKENS shows the honest negative delta.

**Reload of a compacted session:** replay walks the JSONL → `compact_boundary` frame (with `preserved_turns` computed from `compactMetadata`) → no open turn → `append-compact-note` seats the divider on the last surviving turn + `keep-recent-turns(N)` drops the pre-compaction turns → `compact_summary` sets `compactionSeed` → identical banner + hoisted summary + surviving turns. `replay_complete` finalizes. Row set is identical to live (minus the live-only `/compact` bubble).

---

### Specification {#specification}

**Spec S01: widened `compact_boundary` frame** {#s01-boundary-frame}

```
{ type: "compact_boundary",
  trigger?: string,
  pre_tokens?: number,
  post_tokens?: number,      // kept (fix-compact fd620588e); [P01] addend only, never rendered raw
  preserved_turns?: number,  // NEW ([P03]) — count of pre-compaction turns kept verbatim
  ipc_version: number }
```

- `preserved_turns` computed in tugcode: distinct enclosing user-prompt uuids among `preservedMessages.uuids` (replay: `compactMetadata`; live: `compact_metadata`), via `parentUuid` walk. Omitted when metadata is absent/unresolvable.
- tugdeck wrapper maps snake_case → `CompactBoundaryEvent { trigger?, preTokens?, postTokens?, preservedTurns? }`.

**Spec S02: honest window override in the walk** {#s02-window-override}

- `deriveContextWindows(usages, sessionInit, windowOverrides?)`: for turn `i`, if `windowOverrides[i]` is a finite number, `window(i) = windowOverrides[i]` and `perTurn(i) = window(i) − window(i−1)`; otherwise the existing zero-usage/real-usage logic runs unchanged.
- Callers pass `transcript.map(t => t.compactionPostTotal ?? null)`. The identity `sessionInit + Σ perTurn = window(latest)` holds (the override IS `window(i)`).

**Spec S03: `keep-recent-turns` effect** {#s03-keep-recent-effect}

- Reducer `handleCompactBoundary` emits `{ kind: "keep-recent-turns", preservedTurns: number | null }` alongside the divider (mid-turn note or `append-compact-note`).
- Wrapper: `preservedTurns === null` ⇒ no-op (live fallback, [Q01]). Otherwise drop every committed `TurnEntry` strictly before the boundary except the last `preservedTurns` conversation turns; copy-on-write; invalidate dropped turns' cached parses by `turn.<turnKey>.` prefix (mirror `truncate-transcript`). Ordering: apply the keep before `append-compact-note` so the note seats on the last *surviving* turn.
- Idempotent under [P07]: a later boundary trims only turns still present.

**Spec S04: reducer state/entry shape changes** {#s04-shapes}

- `ScratchEntry`: rename `compactionPostTokens?: number` → `compactionPostTotal?: number` (holds `sessionInit + post_tokens`, stamped in `handleCompactBoundary` only when both are numbers).
- `TurnEntry`: add `compactionPostTotal?: number` (copied by `buildTurnEntry`); `buildTurnEntry`'s `cost` no longer overridden — the faked-`TurnCost` branch is deleted.
- `compactionSeed` unchanged (`{ summary, preTokens }`).

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `compactionPostTotal` (per-turn, new) | store data | reducer scratch → committed `TurnEntry`; read via `useSyncExternalStore` | [L02] |
| Truncated `_transcript` (structural) | store data / structure | wrapper `_transcript` mutation via `keep-recent-turns` effect (reducer stays pure) | [L02], [D04] |
| `preservedTurns` on the boundary event | store data (transient) | wire frame → reducer event → effect | [L02] |
| "SESSION COMPACTED" banner appearance | appearance | CSS/DOM on `isCompacted` | [L06] |
| Minimal-effect hint text | derived (no state) | computed in the slash-popup description builder | — |

No new stores; one per-turn field added, one reducer effect added, one `deriveContextWindows` parameter added.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CompactBoundary.preserved_turns` | field | `tugcode/src/types.ts` (+ stub-replay mirror) | Spec S01 |
| `JsonlEntry.compactMetadata.preservedMessages` | field | `tugcode/src/replay.ts` | typed uuids for the count |
| `translateJsonlEntry` | fn (modify) | `tugcode/src/replay.ts` | compute + attach `preserved_turns` ([P03]) |
| `routeTopLevelEvent` compact branch | fn (modify) | `tugcode/src/session.ts` | live `preserved_turns` off `preserved_messages` ([P03]) |
| `CompactBoundaryEvent.preservedTurns` | field | `tugdeck/src/lib/code-session-store/events.ts` | remove/repurpose the stale `postTokens` doc |
| wrapper `compact_boundary` mapping | intake (modify) | `tugdeck/src/lib/code-session-store.ts` | map `preserved_turns`→`preservedTurns` |
| `deriveContextWindows` | fn (modify) | `tugdeck/src/lib/code-session-store/end-state.ts` | `windowOverrides` param (Spec S02) |
| `handleCompactBoundary` | fn (modify) | `tugdeck/src/lib/code-session-store/reducer.ts` | stamp `compactionPostTotal`; emit `keep-recent-turns` |
| `buildTurnEntry` | fn (modify) | `tugdeck/src/lib/code-session-store/reducer.ts` | delete faked-`TurnCost` branch; copy `compactionPostTotal` |
| `ScratchEntry.compactionPostTotal` / `TurnEntry.compactionPostTotal` | fields | `tugdeck/src/lib/code-session-store/types.ts` | Spec S04 |
| `keep-recent-turns` | effect kind + handler | `tugdeck/src/lib/code-session-store/effects.ts`, `code-session-store.ts` | Spec S03 |
| CONTEXT cell / popover callers | render (modify) | `tugdeck/src/components/tugways/cards/dev-card-telemetry-renderers.tsx` | pass `windowOverrides`; audit no raw `post_tokens` ([P02]) |
| `computeTokensSummary` | fn (modify) | `tugdeck/src/lib/code-session-store/telemetry.ts` | pass `windowOverrides` |
| SESSION COMPACTED banner + affordance | render (add) | `tugdeck/src/components/tugways/cards/dev-load-control-bar.tsx` | [P06] |
| `/compact` minimal-effect hint | description (modify) | `tugdeck/src/lib/slash-commands.ts` | [P08] |

#### New files {#new-files}

| File | Purpose |
|------|---------|
| (none required) | The compaction fixture already exists; new fixtures only if a multi-compaction case is needed for [P07] |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When |
|----------|---------|------|
| **Unit (tugcode)** | `preserved_turns` computed correctly from the real fixture's `preservedMessages` (expect `N=1`); no frame when metadata absent | Step 2 |
| **Unit (tugdeck end-state)** | `deriveContextWindows` with `windowOverrides` — trailing compaction turn shows `sessionInit + post_tokens`; telescoping identity holds | Step 1 |
| **Unit (tugdeck reducer/wrapper)** | `handleCompactBoundary` stamps `compactionPostTotal`; `keep-recent-turns` drops the right turns on the fixture; `buildTurnEntry` no longer fakes cost | Steps 1, 3 |
| **App-test** | Live + reload post-compaction view: banner, hoisted summary, survivors present, dropped turns absent, live≡reload | Step 6 |
| **On-demand real-claude** | Full live `/compact` (burns a real compaction) confirming CONTEXT drops in place honestly | Step 6, on-demand |

#### What stays out of tests {#test-non-goals}

- Mock-store or fake-DOM render tests — banned; the reducer/window-walk tests exercise the real functions on the real fixture, the app-tests drive the real app.
- Automated live compaction in CI — a real `/compact` costs a real model run; on-demand only.
- Re-testing the shipped compaction mechanism (fix-compact.md covers it) — this phase asserts only the accounting + view layer.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Applies to every step.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Revert the post_tokens hack; honest window via override | pending | — |
| #step-2 | tugcode: emit `preserved_turns` on the boundary frame | pending | — |
| #step-3 | tugdeck: truncate pre-compaction turns (live + reload) | pending | — |
| #step-4 | tugdeck: SESSION COMPACTED banner + hoisted summary + affordance | pending | — |
| #step-5 | Minimal-effect hint + breakdown honesty check | pending | — |
| #step-6 | Integration checkpoint: live ≡ reload post-compaction view | pending | — |

#### Step 1: Revert the post_tokens hack; honest window via override {#step-1}

**Commit:** `tugdeck(compact-accounting): honest post-compaction window (sessionInit + post_tokens), revert the raw-post_tokens stamp`

**References:** [P01] honest window, [P02] no raw post_tokens, [Q02], Spec S02, Spec S04, (#empirical-accounting, #existing-infra)

**Artifacts:**
- `deriveContextWindows` gains `windowOverrides?` (`end-state.ts`, Spec S02).
- `ScratchEntry`/`TurnEntry` field `compactionPostTokens` → `compactionPostTotal` (`types.ts`); `handleCompactBoundary` stamps `sessionInitTokens + postTokens`; `buildTurnEntry` deletes the faked-`TurnCost` branch and copies `compactionPostTotal`.
- CONTEXT cell + `computeTokensSummary` pass `windowOverrides`; audit for any raw `post_tokens` render ([P02]).

**Tasks:**
- [ ] Add `windowOverrides` to `deriveContextWindows` per Spec S02; keep the zero-usage / compaction-reset logic intact for non-overridden turns.
- [ ] Rename the scratch field to `compactionPostTotal`; in `handleCompactBoundary`, stamp `state.sessionInitTokens + event.postTokens` only when both are finite numbers (else leave unset).
- [ ] In `buildTurnEntry`, delete the `compactionPostTokens`→faked-`TurnCost` branch; keep the real `telemetry.cost`; copy `compactionPostTotal` onto the committed `TurnEntry`.
- [ ] Thread `transcript.map(t => t.compactionPostTotal ?? null)` into the CONTEXT-cell and `computeTokensSummary` `deriveContextWindows` calls (`dev-card-telemetry-renderers.tsx`, `telemetry.ts`).
- [ ] Grep-audit: `post_tokens`/`postTokens` appears only as the [P01] addend; no standalone render ([P02]).
- [ ] Update the `reducer.compact-boundary.test.ts` assertion added by `fd620588e` (committed turn's window == `postTokens`) to the honest total (`sessionInit + postTokens`).

**Tests:**
- [ ] `deriveContextWindows`: a trailing zero-usage turn with `windowOverrides[i] = sessionInit + post` yields `window(i) = sessionInit + post`, `perTurn(i) = (sessionInit+post) − prevWindow` (negative); identity `sessionInit + Σ perTurn = window(latest)` holds.
- [ ] `deriveContextWindows`: when a real turn FOLLOWS the compaction turn, that later turn has no override so `window(latest)` is its real feed window — CONTEXT self-corrects to the exact figure while the compaction turn keeps its honest override (self-correction, [R03]).
- [ ] Reducer: `handleCompactBoundary` stamps `compactionPostTotal`; `buildTurnEntry` commits real (zero) `cost` and the `compactionPostTotal` field.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 2: tugcode — emit `preserved_turns` on the boundary frame {#step-2}

**Commit:** `tugcode(compact-preserved): compute preserved-turn count from preservedMessages and emit on compact_boundary`

**References:** [P03] preserved_turns frame, [Q01], Spec S01, (#preserved-segment-analysis)

**Artifacts:**
- `CompactBoundary.preserved_turns` (`types.ts` + stub-replay mirror); `JsonlEntry.compactMetadata.preservedMessages` typed.
- Replay computation in `translateJsonlEntry`; live computation in `session.ts`'s `compact_boundary` branch.

**Tasks:**
- [ ] Add `preserved_turns?: number` to `CompactBoundary` and its stub mirror; type `compactMetadata.preservedMessages { uuids?: string[]; allUuids?: string[] }` on `JsonlEntry`.
- [ ] Replay: from `compactMetadata.preservedMessages.uuids`, walk `parentUuid` via `indexByUuid` to the nearest enclosing `type:"user"` non-scaffolding, non-`isCompactSummary` entry; count distinct prompt uuids; attach as `preserved_turns`. Omit if metadata absent.
- [ ] Live (`session.ts`): confirm the 2.1.207 live `compact_boundary` carries `compact_metadata.preserved_messages` (spike per [Q01]); resolve the enclosing prompt off the running message chain; attach `preserved_turns`, else omit (`null` fallback).
- [ ] Regenerate/confirm no fixture change needed — the existing fixture already carries `preservedMessages` (`N=1`).

**Tests:**
- [ ] Replay of the fixture emits `compact_boundary` with `preserved_turns === 1` ([#preserved-segment-analysis]).
- [ ] A boundary record with no `preservedMessages` emits no `preserved_turns` (field omitted).
- [ ] Existing replay/compact tests stay green.

**Checkpoint:**
- [ ] `cd tugcode && bun test`
- [ ] `just build`

---

#### Step 3: tugdeck — truncate pre-compaction turns (live + reload) {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(compact-truncate): drop pre-compaction verbatim turns, keep preserved segment + post-compaction turns`

**References:** [P04] truncation effect, [P05] live≡reload, [P07] latest-wins, Spec S01, Spec S03, (#flows, #preserved-segment-analysis)

**Artifacts:**
- `CompactBoundaryEvent.preservedTurns` + wrapper mapping.
- `keep-recent-turns` effect kind + wrapper handler (mirror `truncate-transcript` / `append-compact-note`).
- `handleCompactBoundary` emits `keep-recent-turns` alongside the divider, ordered so the note seats on the last survivor.

**Tasks:**
- [ ] Map wire `preserved_turns` → `CompactBoundaryEvent.preservedTurns`; update the stale `postTokens` doc on the event ([P02]).
- [ ] Add `keep-recent-turns` to `effects.ts`; wrapper handler drops committed turns before the boundary except the last `preservedTurns` (copy-on-write + parse invalidation); `null` ⇒ no-op ([Q01] fallback).
- [ ] `handleCompactBoundary`: emit `keep-recent-turns` before `append-compact-note`; verify the mid-turn (live) path still seats the note on the correct turn and the count targets pre-compaction conversation turns only ([R02]).
- [ ] Confirm `/rewind` truncation and anchors are unaffected (dropped turns aren't rewind targets).

**Tests:**
- [ ] Wrapper: feeding the fixture's frames, the committed transcript ends with the preserved turn + post-compaction turns; the 10 dropped turns' `turnKey`s are absent and their parse-cache entries invalidated.
- [ ] `keep-recent-turns` with `preservedTurns: null` is a no-op (live fallback).
- [ ] Second boundary trims only still-present turns ([P07]).
- [ ] `reducer.rewind.test.ts` stays green.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 4: tugdeck — SESSION COMPACTED banner + hoisted summary + affordance {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(compact-banner): SESSION COMPACTED state banner, hoisted summary, turns-shown affordance`

**References:** [P06] banner/hoist, (#existing-infra, #flows)

**Artifacts:**
- "SESSION COMPACTED · <when>" banner + "N shown / M in session" affordance in `dev-load-control-bar.tsx`, composing `isCompacted`/`sessionVerb`/`createdAtMs` and `replayWindow`/`deriveLoadStatus`.
- Confirmed placement of `DevCompactionCarryForward` above the surviving turns.

**Tasks:**
- [ ] Render the banner when `isCompacted`, using the existing `createdAtMs` source for `<when>`.
- [ ] Add the "N shown / M in session" affordance; adjust copy so compaction-dropped turns are NOT implied to be re-loadable (they are gone, unlike collapsed history) — distinguish from the load-previous affordance.
- [ ] Confirm the Compaction Summary hoists above the surviving transcript (it already renders in the top region; verify order after truncation).

**Tests:**
- [ ] (App-test coverage lands in Step 6; this step is UI wiring verified in the build + the Step 6 app-test.)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 5: Minimal-effect hint + breakdown honesty check {#step-5}

**Depends on:** #step-1

**Commit:** `tugdeck(compact-hint): minimal-effect /compact hint; verify base-vs-conversation breakdown post-compaction`

**References:** [P08] always-offered hint, [P02], Spec S02, (#existing-infra)

**Artifacts:**
- Derived minimal-effect hint on the `compact` slash entry (`slash-commands.ts`), computed from `window(latest) − sessionInitTokens` vs `sessionInitTokens`.
- Confirmation that `computeRichContextBreakdown` reads honestly post-compaction (small `messages` slice).

**Tasks:**
- [ ] Compute the conversation-vs-base ratio where the slash popup builds descriptions; show the hint when the conversation is a small fraction of the base; never gate the command.
- [ ] Verify the CONTEXT popover's `messages` slice equals `window(latest) − bootstrap` after compaction (falls out of Step 1's honest window) and `totalUsed` equals the CONTEXT cell — add/adjust a `telemetry` unit test if a gap surfaces.

**Tests:**
- [ ] `computeRichContextBreakdown` unit: post-compaction window ⇒ `messages` small, `totalUsed == window`, `totalUsed == CONTEXT cell value`.
- [ ] Hint helper: small conversation ⇒ hint present; large conversation ⇒ absent; command always in `LOCAL_SLASH_COMMANDS`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 6: Integration checkpoint — live ≡ reload post-compaction view {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only — app-test additions commit here if new files are created)`

**References:** [P01], [P03], [P05], [P06], [Q01], (#success-criteria, #flows, #preserved-segment-analysis)

**Tasks:**
- [ ] `just build`; launch the debug app.
- [ ] App-test: cold-load the real compacted fixture (model on the existing compact/replay app-tests) and assert — banner present, summary hoisted above survivors, the preserved turn + post-compaction turns present, the dropped fun-fact turns' text ABSENT, CONTEXT ≥ base.
- [ ] On-demand real-claude: run `/compact` on a several-turn scratch card; verify CONTEXT drops in place to `~sessionInit + post_tokens` (not below base) with no next turn, the honest negative TOKENS delta, the banner + hoisted summary + truncated turns; then quit + relaunch and confirm the reloaded view is row-for-row identical (minus the live-only `/compact` bubble, [R02]).
- [ ] Multi-compaction: `/compact` twice; confirm one banner, latest summary, latest preserved tail ([P07]).
- [ ] [Q01] live spike sign-off: confirm the live boundary carried `preserved_turns` (not the null fallback) on 2.1.207.

**Tests:**
- [ ] `just app-test` (full suite incl. the new/extended compact view test).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` (proves no Rust change)
- [ ] `cd tugcode && bun test && cd ../tugdeck && bun test && bunx vite build`
- [ ] `just app-test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** After `/compact`, the CONTEXT readout is the honest resident total (`sessionInit + post_tokens`, never below base, no one-turn lag, no fabricated number), and the active transcript — live and on reload, identically — shows a "SESSION COMPACTED · <when>" banner, the Compaction Summary hoisted to the top, the preserved-segment turn(s) and all post-compaction turns, and none of the dropped pre-compaction verbatim turns; `/compact` stays always offered with a minimal-effect hint when the base dominates.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] CONTEXT never below base post-compaction; equals the popover `totalUsed`; lag gone (Step 1 unit + Step 6 in-app).
- [ ] No surface renders raw `post_tokens` (grep, [P02]).
- [ ] Pre-compaction verbatim turns dropped; preserved + post-compaction turns kept (Step 3 unit + Step 6 app-test).
- [ ] Live ≡ reload view (Step 6 compare).
- [ ] `/compact` always offered with a minimal-effect hint (Step 5).
- [ ] [Q01] live-identification confirmed or the documented fallback in effect.

**Acceptance tests:**
- [ ] App-test: cold replay of the real compacted fixture renders banner + hoisted summary + survivors, drops the pre-compaction turns.
- [ ] tugcode unit: `preserved_turns === 1` on the fixture.
- [ ] tugdeck unit: honest window override telescopes; truncation keeps the right turns.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Compaction-history surface (multiple summaries per session) instead of latest-wins ([P07]).
- [ ] Surface `cumulative_dropped_tokens` (fixture: 24 797) in the banner or telemetry popover as a "freed since session start" figure.
- [ ] Fold the compaction SUMMARY tokens as their own labeled slice in the CONTEXT breakdown (vs lumped into `messages`).

| Checkpoint | Verification |
|------------|--------------|
| Honest CONTEXT | Step 1 unit + Step 6 in-app (≥ base, no lag) |
| Truncated transcript | Step 3 wrapper test + Step 6 app-test |
| Live ≡ reload | Step 6 row-set compare |
| preserved_turns emitted | Step 2 tugcode test |

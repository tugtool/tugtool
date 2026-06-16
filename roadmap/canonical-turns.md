<!-- devise-skeleton v4 -->

## Canonical Turns — One Authority, Then Turns Everywhere {#canonical-turns}

**Purpose:** Make "turn" a single, canonical count that every layer agrees on (Phase 1), then convert the user-facing restore window, transcript numbering, load bar, and session picker to speak turns (Phase 2). At the end, the picker's turn count, the ledger's `turn_count`, tugcode's reported `totalTurns`, and the transcript's highest turn badge are the **same number** for any session.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-15 |

---

### Plan Shape {#plan-shape}

This is a **two-phase** plan in one document. Phase 1 establishes the canonical count (approach **B**: one authority — tugcode's `turn_complete` segmentation, surfaced as the `totalTurns` it already emits on `replay_complete` — persisted in the tugcast ledger, read by everyone, reconciled-to-exact whenever the authority runs). Phase 2 is the plumbing and UI work to adopt turns as the canonical user-facing metric. Phase 2 steps depend on Phase 1 landing. There is one combined **Step Status Ledger** spanning both phases; `/tugplug:implement` walks it top to bottom.

The **load-bearing invariant** of the whole plan: **`tugcode.totalTurns == scanner total == ledger.turn_count == picker subtitle N == highest transcript turn badge`** — for any session, including a windowed restore. Every decision below exists to make that equality true by construction and to keep any one touch point from breaking it.

---

### Phase 1 Overview — Canonical Count {#phase-1-overview}

#### Context {#context-p1}

Three independent code paths currently count "turns," and they apply different rules. The tugcast Rust disk scanner (`external_sessions.rs`) increments `turn_count` for any `type:"user"` JSONL line whose content passes `is_user_submission_content` — a predicate that excludes only `tool_result` echoes. tugcode's wire/replay segmenter applies the *same* base predicate **plus** a second gate, `isNonSubmissionUserString`, that excludes `/compact` summaries, slash-command scaffolding, and `<task-notification>` wake strings, and it opens a turn for wake events. The client commits one `TurnEntry` per tugcode `turn_complete`.

For **tug-spawned / live** sessions this is already consistent: the ledger bumps `record_turn` once per *live* `turn_complete` (replay-bracketed ones are skipped), which equals what the client commits. The divergence is isolated to **never-opened external sessions** (Claude Code terminal sessions): their `turn_count` comes only from the Rust scanner's looser rule, and because replayed `turn_complete`s are excluded from `record_turn`, that estimate is never corrected even after the session is opened. A 5-prompt session that used `/compact` once reads "10 turns" in the picker but shows 5 user turns in the transcript.

Two further hazards make naïve fixes unsafe, both confirmed in the code. First, **replay is windowed** (`resolveWindow` emits only the trailing turns), so a count derived by tallying replayed `turn_complete` frames undercounts to the window — but tugcode **already emits the true `totalTurns`** on `replay_complete`, so the authority number is available for free. Second, **`record_spawn` merges `turn_count = MAX(ledger, scan_cache_seed)`** and the picker serves external rows straight from `external_scan_cache`; a stale, pre-fix cached count therefore survives the rule change and can be re-applied through the merge.

#### Strategy {#strategy-p1}

- Define the canonical turn rule **once**, as a written spec doc, so every implementation cites one source.
- Name the **authority**: tugcode's `turn_complete` segmentation, surfaced as the `totalTurns` value it already reports on `replay_complete`. That single number is what the ledger reconciles to and what every other touch point must equal.
- Make the tugcast **ledger** the single persisted value the picker reads for tug rows (and the **scan cache** the persisted value for external rows) — both produced by the canonical rule.
- Bring the Rust disk scanner into *full* spec conformance and **bump the scan-cache epoch** so no pre-fix cached count survives the rule change.
- **Reconcile** the ledger to tugcode's `totalTurns` on every `replay_complete`, so an opened session converges to canonical and stays correct even though `record_spawn`'s `MAX` seed runs first.
- **Decouple** picker visibility and the resume-vs-new gate from the *count* — key them on resumable content existing, so a (correctly) stricter count can never make a real session vanish or mis-gate.
- Build a **real-JSONL golden corpus** that the Rust scanner test and the tugcode segmenter test both assert against, and pin the full chain with a **four-way equality** test.

#### Success Criteria (Measurable) {#success-criteria-p1}

- For every fixture in the golden corpus, scanner `turn_count` == tugcode `totalTurns` == hand-verified expected value. (corpus contract tests, both languages)
- A session that uses `/compact`, a slash command, and a scheduled wake produces identical counts from scanner and segmenter. (specific corpus fixture)
- After resuming a never-opened external session, the ledger `turn_count` equals tugcode's `totalTurns` — even when the prior scan estimate or `MAX` seed differed. (reconcile integration test)
- A stale, inflated `external_scan_cache` row written by the old rule cannot survive the epoch bump or a resume. (cache-epoch test)
- No session with resumable content (`file_size > 0`) is hidden from the picker or gated to `mode=new` because its canonical count is low. (visibility/gate regression test)
- The four-way equality holds on a real session. (equality contract test, #step-7)

#### Scope {#scope-p1}

1. A written canonical turn-rule spec in `tuglaws/`.
2. A shared real-JSONL golden corpus with expected per-session turn counts.
3. Full spec conformance for the Rust disk scanner **plus** a scan-cache epoch bump.
4. A tugcode contract test proving the segmenter matches the corpus.
5. Ledger reconciliation to tugcode's `totalTurns` on replay, with the `record_spawn` `MAX` seed provably corrected.
6. Decoupling picker visibility + resume/new gate from the count.

#### Non-goals (Explicitly out of scope) {#non-goals-p1}

- Any user-facing UI change (that is Phase 2).
- Re-deriving counts for never-opened sessions by running tugcode over every disk file (defeats the cheap-scan purpose; the scanner remains a spec-faithful estimate).
- Changing the `rewind` chop logic's `isUserSubmissionContent` use (it counts user-submission *anchors*, a related-but-distinct concept — see [#rewind-carveout]).
- Changing the wire *shape* of `SessionRow` / `CardBinding` (the `turn_count` field already exists; only the *gate* that reads it changes).

#### Dependencies / Prerequisites {#dependencies-p1}

- Access to real session JSONLs under `~/.claude/projects` that exercise `/compact`, slash commands, and wake turns (for the corpus — real fixtures only).

#### Constraints {#constraints-p1}

- Rust workspace is `-D warnings`; tests must be warning-clean (`cargo nextest run`).
- tugcode is a bun-compiled binary; changes do not take effect until rebuilt — checkpoints must rebuild it.
- Corpus fixtures must come from real session JSONLs, never fabricated transcripts.

#### Assumptions {#assumptions-p1}

- tugcode emits exactly one `turn_complete` per opened turn, and reports `totalTurns` on `replay_complete` (both already true).
- The ledger row (tug rows) and the scan cache (external rows) are the only persisted turn counts any UI reads.

---

### Phase 2 Overview — Turns as the Canonical Metric {#phase-2-overview}

#### Context {#context-p2}

With one trustworthy count in hand, the user-facing surfaces still speak inconsistent units. The restore window is sized in "message-rows" (`DEFAULT_REPLAY_WINDOW_MESSAGES`, `RequestReplay.lastMessages`); the transcript badge `#NNNN` numbers rows; the load bar's progress numerator counts *fine-grained* `turn.messages` elements while its denominator counts the row-window (the unit mismatch patched this morning in `dev-load-control-bar.tsx`); the picker shows only bytes. Phase 2 makes all of these speak turns, and replaces the flat row badge with a hierarchical turn/message address. It is de-risked by the fact that **tugcode already reports `firstLoadedTurnIndex` and `totalTurns`** on `replay_complete` — the client just doesn't consume them yet.

#### Strategy {#strategy-p2}

- Express the restore window **size** in turns end to end (protocol constant, wire field, tugcode replay honoring "last N turns" via a `lastTurns` window variant beside the existing `lastMessages`).
- Carry the absolute **turn** base for numbering (`firstLoadedTurnIndex`, already emitted) instead of a row offset.
- Rework the load bar to count turns committed against turns requested — superseding the row/fine-grained mismatch.
- Replace the `#NNNN` badge with `#t{turn}m{message}` (turn absolute, message = index into the turn's `messages`), landing turn-level numbering first, then per-message addressing of the assistant's inline pieces.
- Show both `N turns` and byte size in the picker subtitle.
- Keep scroll-anchor relocation row-based (a scroll position is inherently a row/pixel quantity); only window *sizing* and *labels* move to turns.

#### Success Criteria (Measurable) {#success-criteria-p2}

- The restore label reads "Restoring the most recent N turns…" and the load bar reports turns committed / turns requested, settling to the real count for a short session (no phantom full-window readout). (real-session app-test)
- Every transcript entry renders a `#t{turn}m{message}` address; the highest turn index shown equals tugcode's `totalTurns` and the picker's `N turns` for the same session. (real-session app-test, four-way equality)
- The picker subtitle shows `N turns · <size>`. (pure-logic formatter test + app-test)
- Paging in older history does not renumber a turn's message addresses (turn-local `m` is stable; only the absolute turn base shifts). (window-math unit test)

#### Scope {#scope-p2}

1. Restore-window unit conversion (protocol + wire + tugcode `lastTurns` variant).
2. Store fields: `restoreWindowTurns`, `firstLoadedTurnIndex` (replacing the message-row equivalents in `ReplayWindowMeta`/events/reducer).
3. `dev-restore-window.ts` sizing in turns.
4. Load bar turn-based progress + label.
5. `#t{turn}m{message}` badge formatter and wiring; per-message addressing of assistant inline blocks.
6. Picker subtitle showing turns + bytes.

#### Non-goals (Explicitly out of scope) {#non-goals-p2}

- Sub-addressing *within* a single tool call or thinking block (the `m` index stops at `turn.messages` elements).
- Changing scroll/anchor restoration to a turn basis (stays row/pixel based — [P06]).
- Visually distinguishing an estimated vs reconciled picker count ([Q03], deferred).

#### Dependencies / Prerequisites {#dependencies-p2}

- Phase 1 complete: a canonical count exists, is persisted, reconciled, and the gates are decoupled from it ([P01]–[P09]).

#### Constraints {#constraints-p2}

- tugdeck tuglaws: external state enters React only via `useSyncExternalStore` [L02]; appearance via CSS/DOM [L06]; registrations in `useLayoutEffect` [L22]. See [State Zone Mapping](#state-zone-mapping).
- Use `bun` (never npm); HMR is always running for tugdeck (no manual builds); tugcode must be rebuilt after edits.
- App-level verification via `just app-test <file>` ending in a greppable `VERDICT: PASS|FAIL`; pure-logic tests via `bun test`.

#### Assumptions {#assumptions-p2}

- A turn renders as its `messages` in wire order; the user submission, when present, is `messages[0]`.
- The existing load-bar control-bar appearance machinery (`data-mode`/`data-visible`, dwell) is unchanged; only the counted unit and label change.

---

### Reference and Anchor Conventions {#reference-conventions}

This plan uses explicit `{#anchor}` headings (kebab-case, no phase numbers), plan-local decisions `[P01]`, open questions `[Q01]`, specs `S01`, risks `R01`. Steps cite artifacts by ID and anchor, never by line number. Global design decisions, if cited, use `[D##]`.

---

### Open Questions {#open-questions}

#### [Q01] Estimate vs exact for never-opened sessions (DECIDED) {#q01-estimate-vs-exact}

**Question:** Must the picker count be exact-from-authority for sessions that have never been opened in Tug?

**Why it matters:** Running tugcode's full translator over every on-disk session to get an exact count would defeat the cheap disk-scan that makes the picker fast over large project dirs.

**Resolution:** DECIDED (see [P02], [P03], [P08]). The scanner produces a *spec-faithful estimate* for never-opened sessions, pinned to the authority by the shared corpus and protected by a cache epoch; the ledger is reconciled to tugcode's exact `totalTurns` the first time the session is replayed.

#### [Q02] Window-unit conversion vs anchor math (DECIDED) {#q02-window-anchor}

**Question:** Does sizing the restore window in turns force the scroll-anchor relocation math off its current row basis?

**Resolution:** DECIDED (see [P06]). Window *size* and *labels* move to turns; anchor relocation stays row/pixel based. The two are bridged at load time (a turn-sized request yields a set of rows; the anchor is then placed within those rows as today).

#### [Q03] Surface "estimated" vs "reconciled" counts (DEFERRED) {#q03-estimated-badge}

**Question:** Should the picker visually mark a never-opened session's count as an estimate?

**Resolution:** DEFERRED — minor UX, and with [P03]/[P08] the estimate is spec-faithful and converges on first open. Revisit as a picker follow-on if estimates ever prove visibly wrong on real corpora.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Scanner/segmenter rule drift | high | med | Shared golden corpus asserted in both languages + four-way equality test | Any change to the turn rule |
| Window-unit conversion breaks anchor restore | med | med | Keep anchor row-based; real-session app-test | Scroll position wrong after resume |
| Per-message badge noise/perf | med | low | Subdued styling; land turn-base first; measure on real session | Visible clutter or scroll jank |
| Stale tugcode binary masks changes | med | med | Checkpoints rebuild tugcode before testing | Test contradicts the edit |
| Stale scan-cache count resurrected via `MAX` | high | med | Cache epoch bump + reconcile-after-spawn + test | Picker count wrong after rule change |
| Stricter count hides/mis-gates a real session | high | low | Decouple visibility/gate from count; regression test | A resumable session vanishes |

**Risk R01: Cross-language rule drift** {#r01-rule-drift}

- **Risk:** The Rust scanner and the tugcode segmenter re-implement the turn rule in different languages and silently diverge again.
- **Mitigation:** One spec doc; one real-JSONL corpus; a contract test in *each* language asserting the same expected counts; the four-way equality test; reconcile-on-replay so tugcode's `totalTurns` always wins for opened sessions.
- **Residual risk:** A never-opened session can still carry an estimate until first open; bounded to the scanner's spec-faithful approximation.

**Risk R02: Anchor restoration regression** {#r02-anchor}

- **Risk:** Moving the window to turns disturbs faithful scroll restoration.
- **Mitigation:** [P06] keeps the anchor row-based; a real-session app-test asserts post-resume scroll position.
- **Residual risk:** Sessions with extreme single-turn sizes may load more rows than a row-window would; acceptable and visible in the load bar.

**Risk R05: Scan-cache resurrection** {#r05-cache-resurrection}

- **Risk:** `external_scan_cache` rows are keyed on `(file_size, file_mtime)` and survive the rule change; `record_spawn`'s `turn_count = MAX(ledger, seed)` re-applies a stale inflated count.
- **Mitigation:** [P08] — bump a cache epoch so the rule change invalidates and re-scans every row; rely on reconcile-after-spawn so the authoritative `totalTurns` is the final written value; test that a stale inflated cache row cannot survive an epoch bump or a resume.
- **Residual risk:** Between `record_spawn` and `replay_complete` (sub-second) the picker may briefly show a `MAX` seed; corrected by reconcile.

**Risk R06: Stricter count hides/mis-gates a session** {#r06-visibility-regression}

- **Risk:** The picker hides `turn_count == 0` rows and the mode gate is `turn_count > 0 || is_alive`; a correctly stricter rule could push a borderline session to 0 and make it vanish or gate to `mode=new`.
- **Mitigation:** [P09] — key visibility and the resume/new gate on resumable content (`file_size > 0` / `is_alive`), independent of the count; regression test + the `turn_count >= 1 ⇐ file_size > 0` invariant on the corpus.
- **Residual risk:** A truly content-free file (no submission, no wake) stays hidden — which is correct.

---

### Design Decisions {#design-decisions}

#### [P01] A turn is one `turn_complete`; tugcode is the authority (DECIDED) {#p01-authority}

**Decision:** The canonical turn count equals the number of `turn_complete` events tugcode's segmenter produces, surfaced as the `totalTurns` value tugcode already reports on `replay_complete`. tugcode's segmentation rule is the single definition of "what opens a turn."

**Rationale:**
- It is already the live truth: the ledger bumps `record_turn` per live `turn_complete`, and the client commits one `TurnEntry` per `turn_complete`.
- It is the only path that sees the full, ordered wire stream with the wake/compaction/scaffolding context applied, and it already computes the total even under a window.

**Implications:**
- The disk scanner and any other counter are defined as *approximations of, or reconciliations to,* `totalTurns` — never independent rules.

#### [P02] Reconcile the ledger to `totalTurns` on replay (DECIDED) {#p02-reconcile-totalturns}

**Decision:** On every live `replay_complete`, the ledger row's `turn_count` is **set** to the frame's `totalTurns`. The picker reads that value (tug rows). Reconcile must NOT be derived by counting replayed `turn_complete` frames — replay is windowed and would undercount.

**Rationale:**
- `totalTurns` is the authority and is already on the wire; counting windowed frames is both wrong and fragile under Phase 2's turn-window.
- Reconcile runs *after* `record_spawn` seeds the row, so the authoritative value is always the final written one for an opened session.

**Implications:**
- The bridge parses `replay_complete.totalTurns`; a new ledger `set_turn_count` (SET, not increment) writes it; live `record_turn` continues for post-replay turns, building on the reconciled base.

#### [P03] The disk scanner implements the FULL rule, corpus-pinned (DECIDED) {#p03-scanner-full-rule}

**Decision:** The Rust scanner is brought into full conformance with the spec: it excludes `/compact` summaries, slash-command scaffolding, and `<task-notification>` strings from user-submission counting, and counts wake openers as turns — then is pinned to the corpus.

**Rationale:**
- Today it mirrors only `is_user_submission_content` (half the rule), so it over-counts on `/compact`/slash/scaffolding.
- A spec-faithful estimate is what makes never-opened counts trustworthy before reconciliation.

**Implications:**
- New Rust predicates mirroring `isNonSubmissionUserString` and wake detection; corpus test in tugcast.

#### [P04] Badge address is `#t{turn:4}m{message:2}` (DECIDED) {#p04-badge-format}

**Decision:** Transcript entries are addressed `#t{TURN}m{MESSAGE}` — `TURN` zero-padded to 4, `MESSAGE` to 2 — with `TURN` absolute (session-global, 1-based) and `MESSAGE` the 1-based index into that turn's `messages`. Padding is cosmetic: values overflow their width gracefully and **no parser or data assumption caps `MESSAGE` at 99 or `TURN` at 9999**.

**Rationale:**
- Mirrors the data shape (a turn contains an ordered message sequence) and resolves the old "is a turn one number or two?" ambiguity.
- Turn-local `m` is stable under windowing; only the absolute turn base shifts.

**Implications:**
- A new formatter replaces `formatSequenceNumber`; numbering base becomes turn-based.

#### [P05] `m` indexes every `turn.messages` element (DECIDED) {#p05-message-granularity}

**Decision:** `MESSAGE` enumerates every element of `turn.messages` in wire order — `user_message`, `assistant_text`, `assistant_thinking`, `tool_use`, `system_note`. The assistant's inline blocks therefore become individually addressed and individually badged.

**Rationale:**
- Gives every atomic content piece a stable address (the point of the scheme), and justifies the two-digit `m` field.

**Implications:**
- A rendering change: the single assistant row paints one (subdued) badge per inline message, not one badge for the row.

#### [P06] Window sized in turns; anchor stays row-based (DECIDED) {#p06-window-turns-anchor-rows}

**Decision:** The restore window's size and all user-facing labels are expressed in turns. The internal scroll-anchor `depthFromEnd`/relocation math in `dev-restore-window.ts` remains row/pixel based.

**Rationale:**
- A scroll position is inherently a row/pixel quantity; turns are the wrong unit for it.
- The window request (turns) and the anchor (rows) meet at load time: a turn-sized request yields rows, and the anchor is placed within them as today.

**Implications:**
- `RequestReplay.lastMessages` → `lastTurns`; tugcode replay returns the most recent N turns; anchor helpers keep their row signatures.

#### [P07] The client never recomputes a display count (DECIDED) {#p07-no-client-recompute}

**Decision:** The picker reads the persisted count — `SessionRow.turn_count` (ledger for tug rows, `external_scan_cache` for external rows, both produced by the canonical rule). The transcript's turn numbering derives from the same tugcode stream (`firstLoadedTurnIndex` + local). A contract test asserts the transcript's highest turn index equals tugcode's `totalTurns` and the ledger count for a corpus session.

**Rationale:**
- Two client-side rules would re-introduce exactly the drift this plan removes.

**Implications:**
- No standalone "count turns for the picker" code on the client; the picker's external-row path is acknowledged to read the (faithful) scan cache.

#### [P08] Scan-cache epoch + reconcile-after-spawn (DECIDED) {#p08-cache-epoch}

**Decision:** Keep `record_spawn`'s `turn_count = MAX(ledger, seed)` merge (it prevents a bare `0` insert from shadowing rich metadata), but (a) bump an `external_scan_cache` **epoch/version** so the Step 3 rule change invalidates every cached count and forces a faithful re-scan, and (b) rely on **reconcile-after-spawn** ([P02]) so an opened session's final `turn_count` is always tugcode's `totalTurns`, regardless of the `MAX` seed.

**Rationale:**
- Changing `MAX` to "lower-wins" would reintroduce the zero-shadow bug it was added to fix; the safer fix is a faithful seed plus an authoritative final SET.
- The cache epoch is the only thing that prevents pre-fix inflated counts from leaking forever (cache is keyed on file size/mtime, which don't change for a dormant session).

**Implications:**
- A schema/epoch bump on `external_scan_cache`; a test that a stale inflated cache row is neither served nor merged after the epoch bump / on resume.

#### [P09] Resumability and visibility gate on content, not count (DECIDED) {#p09-decouple-gates}

**Decision:** The picker's "hide zero-turn rows" and the resume-vs-new gate key on **resumable content existing** (`file_size > 0` / `is_alive`), not on `turn_count > 0`. The count is a *display* quantity; it must never decide whether a session appears or how it is restored.

**Rationale:**
- A turn count that is (correctly) stricter must not be able to make a real session disappear or restore as fresh.
- Decoupling makes the count's correctness and the gate's correctness independent — each is then individually testable.

**Implications:**
- Update the Rust picker-union zero-turn filter and the `protocol.ts` / client mode gate to read content existence; add the `turn_count >= 1 ⇐ file_size > 0` invariant + a regression test that a content-bearing, low-count session still appears and resumes.

---

### Deep Dives {#deep-dives}

#### Touch-point inventory {#touch-points}

Every place a turn count is produced or consumed, and where the plan controls it. The invariant ([#plan-shape]) holds iff every row is green.

| Touch point | Role | Controlled by |
|---|---|---|
| tugcode `totalTurns` / `firstLoadedTurnIndex` on `replay_complete` | **authority** | [P01]; consumed by [P02] (reconcile) and Phase 2 (badge base) |
| tugcode live `turn_complete` → `record_turn` (+1) | live increment | unchanged; builds on reconciled base ([P02]) |
| Rust scanner `ExternalSessionMeta.turn_count` | external estimate | [P03] full rule |
| `external_scan_cache.turn_count` (keyed size/mtime) | persisted external estimate | [P08] epoch bump |
| `record_spawn` `MAX(turn_count, seed)` | resume seed merge | [P08] kept + corrected by reconcile |
| ledger reconcile (`set_turn_count` = `totalTurns`) | authoritative SET | [P02] |
| `SessionRow` / `CardBinding.turn_count` wire | read | unchanged shape |
| picker subtitle | read | [P07], Step 14 |
| picker visibility (`==0` hidden) | gate | [P09] → keyed on content |
| resume/new gate (`>0`) | gate | [P09] → keyed on content |
| client `TurnEntry` / badge base | read | Phase 2 (#step-9, #step-12) |
| `rewind` `priorSubmissions` (`isUserSubmissionContent`) | rewind anchors | [#rewind-carveout] — separate |

#### Rewind carve-out {#rewind-carveout}

`session.ts`'s chop/`priorSubmissions` logic counts `isUserSubmissionContent` *without* the `isNonSubmissionUserString` gate, because `/rewind` anchors on genuine user submissions, not on the turn metric (it intentionally does not anchor on wake turns). This is a deliberately separate concept and is **out of scope**. If Step 1's spec renames or relocates the shared predicate, keep rewind compiling against its own copy or an explicitly-shared-but-distinct helper — do not silently fold rewind into the turn rule.

---

### Specification {#specification}

#### Spec S01: Canonical turn rule {#s01-turn-rule}

A **turn** is one *committed response cycle* — exactly one tugcode `turn_complete`. A turn is **opened** by exactly one of:

- a **user submission** — a JSONL `type:"user"` record whose `message.content` is a genuine submission: `isUserSubmissionContent` is true (string content, or an array with ≥1 non-`tool_result` block) **and** `isNonSubmissionUserString` is false (not an `isCompactSummary` continuation, not slash-command scaffolding — `<command-name>`, `<command-message>`, `<command-args>`, `<local-command-stdout>`, `<local-command-caveat>` — and not a `<task-notification>` envelope);
- a **wake opener** — a `<task-notification>` envelope (Cohort A wake) that tugcode re-routes to `wake_started`.

A turn is **not** opened by: `tool_result` echoes, `/compact` summaries, slash-command scaffolding strings, or any assistant/system record. The canonical count is the number of opened turns = the number of `turn_complete` events = tugcode's reported `totalTurns`. **Wake turns count.**

#### Spec S02: Transcript address {#s02-address}

- Format: `#t{TURN:0>4}m{MESSAGE:0>2}` (padded-not-capped, [P04]).
- `TURN` = `firstLoadedTurnIndex + localTurnIndex + 1` (absolute, 1-based).
- `MESSAGE` = 1-based index into `turn.messages` ([P05]).
- Examples: turn 7 user submission `#t0007m01`; its assistant text `#t0007m02`; a thinking block `#t0007m03`; first tool call `#t0007m04`. Wake turn 12's first assistant message `#t0012m01` (no `m01` user message).

#### Spec S03: Restore window in turns {#s03-window}

- `DEFAULT_REPLAY_WINDOW_TURNS` replaces `DEFAULT_REPLAY_WINDOW_MESSAGES` as the default window size.
- Wire: a `lastTurns` `ReplayWindow` variant replaces `lastMessages`; tugcode replay returns the most recent N **turns'** records and reports `firstLoadedTurnIndex` + `totalTurns` + `hasOlder`.
- Load bar: denominator = requested turns; numerator = turns committed in the loaded window (count of `TurnEntry`); on completion, report the real turns loaded (a short session shows "3 of 3 turns", never a phantom full window).
- Label: "Restoring the most recent N turns…".

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `firstLoadedTurnIndex` (numbering base) | local-data | store snapshot → `useSyncExternalStore` | [L02] |
| `restoreWindowTurns` / turns-committed (load bar) | local-data | store snapshot → `useSyncExternalStore` | [L02] |
| Picker `turn_count` | local-data | wire `SessionRow` → store → `useSyncExternalStore` | [L02] |
| `#t…m…` badge text | structure (derived render) | pure render from store data; no React state | [L02] |
| Load-bar mode / visibility | appearance | existing `data-mode`/`data-visible` DOM attrs | [L06], [L22] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tuglaws/turn-metric.md` | The canonical turn-rule spec (S01) and address scheme (S02). |
| `tugrust/crates/tugcast/tests/fixtures/turns/` (corpus) | Real-JSONL golden corpus + expected counts (shared intent). |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `is_non_submission_user_string` | fn | `tugcast/src/external_sessions.rs` | Mirror of tugcode's gate ([P03]). |
| wake detection in scan loop | logic | `tugcast/src/external_sessions.rs` | Count wake openers; exclude scaffolding/compact ([P03]). |
| scan-cache epoch / version | schema | `tugcast/src/session_ledger.rs` (`external_scan_cache`) | Invalidate on rule change ([P08]). |
| `set_turn_count` | fn | `tugcast/src/session_ledger.rs` | Authoritative SET to `totalTurns` ([P02]). |
| `record_spawn` MAX merge | logic | `tugcast/src/session_ledger.rs` | Kept; corrected by reconcile ([P08]). |
| reconcile on `replay_complete` | logic | `tugcast/src/feeds/agent_bridge.rs` | Parse `totalTurns`, call `set_turn_count` ([P02]). |
| picker zero-turn filter / mode gate | logic | `tugcast` picker union + `protocol.ts` + client | Key on content, not count ([P09]). |
| corpus contract + four-way equality test | test | `tugcast` + `tugcode` + app-test | Same expected counts; full-chain equality (R01). |
| `DEFAULT_REPLAY_WINDOW_TURNS` | const | `tugdeck/src/protocol.ts` | Replaces `DEFAULT_REPLAY_WINDOW_MESSAGES` ([P06]). |
| `lastTurns` `ReplayWindow` variant | type/logic | `tugdeck/src/protocol.ts` + tugcode `resolveWindow` | Beside `lastMessages` ([P06]). |
| `restoreWindowTurns` | field | `code-session-store` | Replaces `restoreWindowMessages`. |
| `firstLoadedTurnIndex` | field | `ReplayWindowMeta` / events / reducer | Consume tugcode's existing report. |
| window sizing in turns | fns | `tugdeck/src/lib/dev-restore-window.ts` | Anchor stays row-based ([P06]). |
| turn-based numerator/label | logic | `dev-load-control-bar.tsx` | Supersedes the row/fine-grained patch. |
| `formatTurnMessageAddress` | fn | `tug-transcript-entry.tsx` | Replaces `formatSequenceNumber` ([P04]). |
| per-message badge render | logic | `dev-card-transcript.tsx` | One badge per inline message ([P05]). |
| picker subtitle `N turns` | fn | `dev-picker-format.ts` | Adds turns beside size ([P07]). |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When |
|----------|---------|------|
| Golden / Contract | Scanner & segmenter counts match the corpus; four-way equality | Phase 1 rule conformance |
| Unit | Window math, address formatter, turn-count derivation | Pure logic both phases |
| Integration (Rust) | Reconcile-on-replay; cache-epoch; visibility/gate | Phase 1 ledger paths |
| Real-app (`just app-test`) | Picker count == highest badge == `totalTurns`; load bar/window in turns | Phase 2 user-facing |

#### What stays out of tests {#test-non-goals}

- No mock-store assertion or call-count tests; no fake-DOM/RTL render tests (banned patterns).
- Address rendering and the four-way equality on a windowed session are verified in a real app-test, not a jsdom harness.
- The formatter/window math are tested as pure functions (`bun test`), not through React.
- Corpus fixtures are real session JSONLs only — never fabricated.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Integration-checkpoint steps use `Commit: N/A (verification only)`.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Author the canonical turn-rule spec | pending | — |
| #step-2 | Build the real-JSONL golden corpus | pending | — |
| #step-3 | Scanner full rule + scan-cache epoch | pending | — |
| #step-4 | tugcode segmenter contract test | pending | — |
| #step-5 | Reconcile ledger to `totalTurns` on replay | pending | — |
| #step-6 | Decouple visibility + resume/new gate from count | pending | — |
| #step-7 | Phase 1 integration + four-way equality | pending | — |
| #step-8 | Restore window unit → turns (protocol + wire + replay) | pending | — |
| #step-9 | Store: restoreWindowTurns + firstLoadedTurnIndex | pending | — |
| #step-10 | Window sizing in turns (dev-restore-window) | pending | — |
| #step-11 | Load bar speaks turns | pending | — |
| #step-12 | `#t…m…` badge formatter + turn-based base | pending | — |
| #step-13 | Per-message badge rendering | pending | — |
| #step-14 | Picker subtitle shows turns + bytes | pending | — |
| #step-15 | Phase 2 integration + windowed equality | pending | — |

---

#### Step 1: Author the canonical turn-rule spec {#step-1}

**Commit:** `docs(turns): canonical turn-rule + address spec in tuglaws`

**References:** [P01] authority, [P04] badge format, [P05] message granularity, Spec S01, Spec S02, (#context-p1, #rewind-carveout)

**Artifacts:**
- `tuglaws/turn-metric.md` — the written rule (S01), address scheme (S02), the `totalTurns` authority flow, and the rewind carve-out.

**Tasks:**
- [ ] Write the rule exactly as S01 (open / not-open lists, wake counts), citing the existing predicates by name.
- [ ] Write the address scheme S02 (turn absolute, message into `turn.messages`, padded-not-capped).
- [ ] State the authority/ledger/scanner/cache relationship ([P01]/[P02]/[P03]/[P08]) and the four-way equality invariant.
- [ ] Note the rewind carve-out ([#rewind-carveout]).

**Tests:**
- [ ] N/A (doc) — reviewed against the code predicates it names.

**Checkpoint:**
- [ ] `tuglaws/turn-metric.md` exists and every predicate/field it references (`isUserSubmissionContent`, `isNonSubmissionUserString`, `totalTurns`) resolves to real code.

---

#### Step 2: Build the real-JSONL golden corpus {#step-2}

**Depends on:** #step-1

**Commit:** `test(turns): real-JSONL golden corpus with expected counts`

**References:** Spec S01, Risk R01, (#strategy-p1)

**Artifacts:**
- Real session JSONLs (copied/redacted from `~/.claude/projects`) covering: plain user turns only; a `/compact`; a slash command; a scheduled wake; tool_result echoes; and at least one **windowed-size** session (more turns than the default window). Each paired with a hand-verified expected turn count.

**Tasks:**
- [ ] Select real sessions for each case; record the expected count per file (derived by reading the JSONL against S01).
- [ ] Place fixtures where both the tugcast Rust test and the tugcode test can read them.

**Tests:**
- [ ] A manifest test asserting each fixture loads and has a recorded expectation (guards against an empty/missing corpus).

**Checkpoint:**
- [ ] Corpus present; each fixture has an expected count; `cd tugrust && cargo nextest run -p tugcast` discovers the fixtures.

---

#### Step 3: Scanner full rule + scan-cache epoch {#step-3}

**Depends on:** #step-2

**Commit:** `fix(tugcast): scanner counts turns by the full rule; bump cache epoch`

**References:** [P03] scanner full rule, [P08] cache epoch, Spec S01, Risks R01, R05, (#context-p1)

**Artifacts:**
- `is_non_submission_user_string` (Rust mirror) + wake detection in the scan loop of `external_sessions.rs`; an `external_scan_cache` epoch/version bump that invalidates pre-fix rows.

**Tasks:**
- [ ] Add the exclusion predicate: `isCompactSummary`, the scaffolding prefixes, and `<task-notification>` strings do not count as user submissions.
- [ ] Count wake openers as turns so the rule matches the segmenter.
- [ ] Bump the scan-cache epoch so existing cached counts are invalidated and re-scanned with the faithful rule.

**Tests:**
- [ ] Corpus contract test: scanner `turn_count` equals expected for every fixture (especially `/compact` + slash + wake).
- [ ] Cache-epoch test: a cache row written under the old epoch is not served — it re-scans.
- [ ] Existing `external_sessions` tests updated where they asserted the old looser count.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` green, warning-clean.

---

#### Step 4: tugcode segmenter contract test {#step-4}

**Depends on:** #step-2

**Commit:** `test(tugcode): segmenter totalTurns matches corpus`

**References:** [P01] authority, [P07] no client recompute, Spec S01, Risk R01

**Artifacts:**
- A tugcode test that runs the replay translator over each corpus fixture and reads `totalTurns` from `replay_complete`.

**Tasks:**
- [ ] Feed each fixture through the translator; assert `totalTurns` equals the expected value.
- [ ] Cross-check the expected values are identical to the ones the Rust test asserts (same corpus, same numbers).

**Tests:**
- [ ] Per-fixture assertion in tugcode's test suite.

**Checkpoint:**
- [ ] tugcode tests green; `totalTurns` equals the Rust scanner's `turn_count` for every fixture.

---

#### Step 5: Reconcile ledger to `totalTurns` on replay {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(tugcast): reconcile ledger turn_count to totalTurns on replay`

**References:** [P02] reconcile, [P08] cache epoch, Spec S01, Risk R05, (#touch-points)

**Artifacts:**
- Bridge parsing of `replay_complete.totalTurns`; a `set_turn_count` ledger method (SET, not increment); the reconcile call wired on each live `replay_complete`.

**Tasks:**
- [ ] In `agent_bridge.rs`, on a live (non-nested) `replay_complete`, read `totalTurns` and call `set_turn_count` for the session.
- [ ] Add `set_turn_count` to `session_ledger.rs` (overwrites `turn_count`; bumps `last_used_at`).
- [ ] Confirm ordering: `record_spawn` (MAX seed) runs first, reconcile SETs after — final value is `totalTurns`. Live `record_turn` continues for post-replay turns.

**Tests:**
- [ ] tugcast integration test: resume an external fixture whose scanner/seed differs from `totalTurns`; assert the ledger row equals `totalTurns` afterward.
- [ ] Assert a stale inflated `MAX` seed does not survive the resume (final value == `totalTurns`).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` green; reconcile + seed-correction tests pass.

---

#### Step 6: Decouple visibility + resume/new gate from count {#step-6}

**Depends on:** #step-3

**Commit:** `fix(sessions): gate visibility + resume on content, not turn_count`

**References:** [P09] decouple gates, Risk R06, (#touch-points)

**Artifacts:**
- The picker-union zero-turn filter and the resume-vs-new gate keyed on `file_size > 0` / `is_alive` instead of `turn_count > 0`, across the Rust picker path, `protocol.ts` doc/gate, and the client (`dev-session-restore.ts` / `dev-session-ledger-store.ts`).

**Tasks:**
- [ ] Change the Rust picker union to not hide a row that has resumable content (`file_size > 0`) even when `turn_count == 0`.
- [ ] Change the mode gate basis to content existence; update the `CardBinding` gate docstring accordingly.
- [ ] Update the client gate consumers to the new basis.

**Tests:**
- [ ] Rust: a content-bearing, zero/low-count session still appears in `list_sessions` and gates to `mode=resume`.
- [ ] Invariant test over the corpus: every fixture with `file_size > 0` has `turn_count >= 1` (sanity), and a synthesized-low-count content row is not hidden.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` green; `bun run check` clean (protocol/client gate compiles).

---

#### Step 7: Phase 1 integration + four-way equality {#step-7}

**Depends on:** #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [P01], [P02], [P08], [P09], Risk R01, (#success-criteria-p1, #plan-shape)

**Tasks:**
- [ ] Verify scanner total, tugcode `totalTurns`, and reconciled ledger agree on every corpus fixture (including the windowed-size one).
- [ ] Live spot-check: spawn, run 2–3 turns incl. a slash command, confirm ledger == transcript `turn_complete` count.
- [ ] Confirm no corpus session with content is hidden or mis-gated.

**Tests:**
- [ ] Four-way equality assertion on a real session: `scanner total == tugcode totalTurns == ledger turn_count == picker subtitle N`.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` green; tugcode tests green; equality assertion passes; live spot-check matches.

---

#### Step 8: Restore window unit → turns {#step-8}

**Depends on:** #step-7

**Commit:** `feat(replay): size the restore window in turns`

**References:** [P06] window turns/anchor rows, Spec S03, (#context-p2)

**Artifacts:**
- `DEFAULT_REPLAY_WINDOW_TURNS` and a `lastTurns` `ReplayWindow` variant in `protocol.ts`; tugcode `resolveWindow` honoring "last N turns" and reporting `firstLoadedTurnIndex`/`totalTurns`/`hasOlder`.

**Tasks:**
- [ ] Add the protocol constant and the `lastTurns` window variant beside `lastMessages`.
- [ ] Extend tugcode's `resolveWindow` to select the most recent N turns directly (it already cuts at turn boundaries and reports the turn offsets).
- [ ] Rebuild tugcode.

**Tests:**
- [ ] tugcode replay test: `lastTurns: N` returns exactly the last N turns' records (corpus fixture) with the correct `firstLoadedTurnIndex` and `totalTurns`.

**Checkpoint:**
- [ ] tugcode rebuilt; replay test green; `bun run check` clean in tugdeck.

---

#### Step 9: Store — restoreWindowTurns + firstLoadedTurnIndex {#step-9}

**Depends on:** #step-8

**Commit:** `refactor(store): turns-based replay window + numbering base`

**References:** [P06], [P07], Spec S03, (#state-zone-mapping)

**Artifacts:**
- `restoreWindowTurns` (replacing `restoreWindowMessages`) and `firstLoadedTurnIndex` consumed from `replay_complete` into `ReplayWindowMeta` / events / reducer / snapshot.

**Tasks:**
- [ ] Replace the message-row fields with their turn equivalents through events.ts → reducer.ts → types.ts → snapshot.
- [ ] Keep references `Object.is`-stable per [L02] (no spurious snapshot churn).

**Tests:**
- [ ] Reducer unit test: a replay event carrying `firstLoadedTurnIndex`/`totalTurns`/`hasOlder` projects onto the snapshot with stable identity across quiescent rebuilds.

**Checkpoint:**
- [ ] `bun run check` clean; reducer tests green (`bun test`).

---

#### Step 10: Window sizing in turns (dev-restore-window) {#step-10}

**Depends on:** #step-9

**Commit:** `refactor(restore): window size in turns, anchor stays rows`

**References:** [P06] window turns/anchor rows, Spec S03, Risk R02, (#q02-window-anchor)

**Artifacts:**
- `dev-restore-window.ts` helpers sizing the resume window in turns; anchor `depthFromEnd`/relocation kept row-based.

**Tasks:**
- [ ] Convert `resolveRestoreWindow` and the default to turns; document the unit in the module header.
- [ ] Leave `anchorDepthFromEnd` / `anchorRowIndexInWindow` on rows; bridge at the call site.

**Tests:**
- [ ] Unit: window resolves to the default turns when the anchor is within it, deeper when parked above; anchor relocation still lands the saved row.

**Checkpoint:**
- [ ] `bun test` for the window math green; `bun run check` clean.

---

#### Step 11: Load bar speaks turns {#step-11}

**Depends on:** #step-9

**Commit:** `feat(load-bar): report turns committed of turns requested`

**References:** Spec S03, [P07], (#context-p2)

**Artifacts:**
- `dev-load-control-bar.tsx` restore branch counting turns: numerator = `TurnEntry` count in the loaded window, denominator = requested turns; completion reports the real turns loaded. Label "Restoring the most recent N turns…".

**Tasks:**
- [ ] Replace the fine-grained `turn.messages.length` numerator with a turn count (supersedes the earlier row/fine-grained patch).
- [ ] Use `restoreWindowTurns` as the denominator; on completion set both to the actual turns loaded.
- [ ] Update the label and the `formatValue` readout to read "turns".

**Tests:**
- [ ] Pure-logic test of the restore branch's value/max selection for active vs landed, full vs short session.

**Checkpoint:**
- [ ] `bun run check` clean; load-bar value/format unit test green.

---

#### Step 12: `#t…m…` badge formatter + turn-based base {#step-12}

**Depends on:** #step-9

**Commit:** `feat(transcript): turn/message address badge`

**References:** [P04] badge format, Spec S02, (#state-zone-mapping)

**Artifacts:**
- `formatTurnMessageAddress(turn, message)` in `tug-transcript-entry.tsx` (replacing `formatSequenceNumber`); `dev-card-transcript.tsx` numbering the user row (`m01`) and assistant row from `firstLoadedTurnIndex`.

**Tasks:**
- [ ] Add the formatter (`#t{turn:0>4}m{message:0>2}`, padded-not-capped); remove/redirect `formatSequenceNumber`.
- [ ] Derive `TURN` from `firstLoadedTurnIndex + localTurnIndex + 1`; user row carries `m01`.
- [ ] Keep this step at row granularity (user `m01`, assistant block `m02`) to isolate the formatter from the rendering change.

**Tests:**
- [ ] Formatter unit tests incl. overflow (`m100`, `t10000`) and wake turn (no `m01` user).

**Checkpoint:**
- [ ] `bun test` formatter green; `bun run check` clean; HMR shows `#t…m…` on rows.

---

#### Step 13: Per-message badge rendering {#step-13}

**Depends on:** #step-12

**Commit:** `feat(transcript): address each inline message in a turn`

**References:** [P05] message granularity, Spec S02, Risk R03, (#context-p2)

**Artifacts:**
- The assistant row paints one subdued `#t{turn}m{message}` address per `turn.messages` element (text, thinking, each tool call), `message` = its index in the array.

**Tasks:**
- [ ] Render a badge per inline message segment, indexed into `turn.messages`.
- [ ] Apply subdued styling so the addresses don't overwhelm content.

**Tests:**
- [ ] Real-app: open a session with a multi-tool turn; confirm sequential `m` indices within the turn.

**Checkpoint:**
- [ ] `just app-test <transcript-address-test>` ends `VERDICT: PASS`; addresses increment within a turn and reset across turns.

---

#### Step 14: Picker subtitle shows turns + bytes {#step-14}

**Depends on:** #step-7

**Commit:** `feat(picker): show turn count beside session size`

**References:** [P07] no client recompute, [P09] decouple gates, (#success-criteria-p2)

**Artifacts:**
- `formatSessionRowSubtitle` rendering `[timestamp, N turns, size, id]`, reading `row.turn_count` (no client recompute).

**Tasks:**
- [ ] Add the `N turns` segment (singular/plural) from `SessionRow.turn_count`, beside the existing byte size.
- [ ] Update the module comment that currently says size is "deliberately not a turn count".

**Tests:**
- [ ] Pure-logic formatter test: subtitle includes both turns and size; pluralization correct; segments dropped when absent.

**Checkpoint:**
- [ ] `bun test` formatter green; `bun run check` clean; HMR shows `… · N turns · <size> · id …`.

---

#### Step 15: Phase 2 integration + windowed equality {#step-15}

**Depends on:** #step-11, #step-13, #step-14

**Commit:** `N/A (verification only)`

**References:** [P04], [P06], [P07], Risk R01, (#success-criteria-p2, #plan-shape)

**Tasks:**
- [ ] On a real **windowed** session: resume it, confirm the load bar reads "N of N turns", the restore label says turns, the highest transcript turn badge equals `totalTurns` and the picker's `N turns`, and paging older history doesn't renumber a turn's `m` addresses.

**Tests:**
- [ ] Real-app aggregate asserting the four-way equality on a windowed session: `highest turn badge == tugcode totalTurns == ledger turn_count == picker subtitle N`.

**Checkpoint:**
- [ ] `just app-test <turns-end-to-end-test>` ends `VERDICT: PASS`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A single canonical turn count produced by tugcode (`totalTurns`), persisted in the ledger, reconciled on replay, faithfully estimated and cache-epoch-guarded by the disk scanner, decoupled from the visibility/resume gates — and surfaced consistently in the restore window, load bar, transcript address (`#t…m…`), and picker subtitle.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Scanner total, tugcode `totalTurns`, and reconciled ledger agree on every corpus fixture and on a live session. (#step-7)
- [ ] A stale inflated scan-cache count cannot survive the rule change or a resume. (#step-3, #step-5)
- [ ] No content-bearing session is hidden or mis-gated by a low count. (#step-6)
- [ ] Restore window, load bar, and labels are in turns; a short session shows the real count. (#step-15)
- [ ] Every transcript entry shows a `#t…m…` address; highest turn index equals `totalTurns` and the picker count. (#step-15)
- [ ] Picker subtitle shows `N turns · <size>`. (#step-14)

**Acceptance tests:**
- [ ] Rust: `cargo nextest run` green (corpus + reconcile + cache-epoch + visibility).
- [ ] tugcode: segmenter `totalTurns` matches the corpus.
- [ ] tugdeck: window/formatter `bun test` green; `just app-test` end-to-end `VERDICT: PASS` (four-way equality, windowed).

#### Roadmap / Follow-ons (Not required for phase close) {#roadmap}

- [ ] [Q03] Visually mark estimated (never-opened) vs reconciled picker counts.
- [ ] Sub-addressing within a tool call / thinking block (beyond `turn.messages` granularity).

| Checkpoint | Verification |
|------------|--------------|
| Canonical count agrees across stack | `cargo nextest run` + tugcode corpus test + equality assertion |
| Stale cache cannot resurrect | cache-epoch + reconcile tests |
| No session lost to a low count | visibility/gate regression test |
| Turns surfaced end to end | `just app-test` windowed equality `VERDICT: PASS` |

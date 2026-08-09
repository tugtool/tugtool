## Session Identity Rollout — the dot, the name, and the two lines {#session-identity}

**Purpose:** Roll the Session Identity design spike out of the gallery card and into the app, so that every surface that names a session — the card masthead, the Lens Sessions rows, the new-session picker, the reference atom, and the flat-text citation — leads with a live pulsing dot, puts the user's own name first, and says what the session is doing in exactly two lines beneath it.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-09 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tug refers to a session five ways: a UUID, its 8-character short id, a minted `adjective-noun` callsign, a description written by the SharedAgent, and an optional user-provided name. An earlier pass consolidated the *plumbing* — one resolver (`tugdeck/src/lib/session-identity.ts`), one component family (`TugSessionIdentity`), a ledger-authoritative citation path — and a follow-up audit closed the bugs and doctrine drift in it. What that pass did **not** settle was the **content**: what each surface actually says, in what order, and with what mark in front of it.

The Session Identity gallery card (`tugdeck/src/components/tugways/cards/gallery-session-identity.tsx`) is where that was settled, over a review round that ran to a firm downselect. This plan carries those decisions into the real surfaces. Three of the decisions are structural rather than cosmetic and are why this is a plan rather than a patch: the session **icon retires in favor of a live phase dot** on every surface (which requires a session-keyed liveness door that does not exist yet); the **user's name leads the title** (which requires the resolver to stop merging the user's name and the agent's description into one `title` field); and the stack under the title drops from three levels to **two** (which retires the standing-intent line from chrome and takes the word `PULSE` out of user-facing ink entirely).

Two findings from the code survey make server work unavoidable, and both were confirmed against the source rather than assumed. First, the agent-written description is **frozen the moment a user renames a session** — enforced twice, in `record_synopsis`'s SQL and again ahead of the model call in `session_overview.rs`. Under the old design that was right (name and description competed for one line); under the new one they occupy different lines, and the freeze would leave every renamed session with a permanently dead description line. Second, the activity line's rest form promises a turn count and an on-disk size, but **both are scan-derived**: `turn_count` is refreshed only by the segmentation engine on a `list_sessions` scan, and `file_size` is documented in `tugdeck/src/protocol.ts` as absent on `session_updated` pushes and live rows. On the live card's own masthead — precisely where the design puts them — the size is usually missing and the count lags a turn behind.

#### Strategy {#strategy}

- **Data model first, surfaces last.** The resolver split ([P04]) and the liveness door ([P03]) land before any surface changes, so each surface change is a composition rather than a re-derivation.
- **Server before client where the client would otherwise render a lie.** The synopsis freeze ([P09]) and the turn-end freshness refresh ([P10]) ship first, so that when the masthead starts showing a description and a turn count they are real from the first frame.
- **One component, three mounts.** The masthead, the Lens row, and the picker row wear the same shape, so `TugSessionRow` grows that shape once ([P11]) and all three compose it. Nothing is hand-rolled at a mount site; the component library is the consistency mechanism, not a convention.
- **Retire, don't accumulate.** Each step that adds the new form removes the old one in the same commit — the icon, the intent line, the `PULSE` stand-in, the width control, the `title` field. A step that leaves both forms standing has not finished.
- **The gallery is the bench, so it moves last.** The identity app-tests drive the gallery card; the card's "shipped today, for contrast" frame becomes false the moment the component changes, so the card and the tests are reconciled in the same step as the component ([#step-5]) and the card is retitled to record what shipped at the end ([#step-11]).
- **Every step is independently green.** `cargo nextest run`, `bunx tsc --noEmit`, `bun test`, `bunx vite build`, and a scoped `just app-test` selection at each checkpoint — never a full corpus sweep.

#### Success Criteria (Measurable) {#success-criteria}

- A Session card's masthead shows three rows — `[dot] <title>  [wave] [x]`, the description, and the activity line with its tape — with **no** width-control icon and **no** `project/` prefix on the title. (Verify: app-test asserts `[data-slot="session-masthead"]` has exactly one dot, no `[data-testid="tug-pane-title-bar-width-button"]` inside a masthead pane, and three text rows.)
- A session with a user-set name renders `<name> : <callsign>` on the masthead, the Lens row, the picker row, and the atom; a session without one renders the bare callsign. (Verify: unit tests on the formatter `sessionTitleParts`; app-test reads the rendered runs on all four.)
- Under a width squeeze on a named session, the **callsign** is the run that ellipsizes and the user's name survives intact. (Verify: app-test measures `scrollWidth`/`clientWidth` on the two runs in a narrowed pane.)
- No surface renders the string `PULSE`. (Verify: a unit-test grep gate over `tugdeck/src/components/` and `tugdeck/src/lib/` asserting no user-facing `PULSE` literal outside gallery cards and internal identifiers.)
- The phase dot never paints danger for a session whose liveness is merely unknown. (Verify: unit test on `useSessionPhase`'s no-card fallback returning the `idle` key, plus an app-test on a picker row for a closed session.)
- A session renamed by the user still receives a rolling description. (Verify: Rust test that `record_synopsis` writes with `name_user_set = 1`.)
- Immediately after a turn completes, the masthead's activity line reports the post-turn turn count and a non-null size. (Verify: Rust test that the turn-end refresh writes both and that `build_session_updated_frame` carries `file_size`.)
- Copying a session atom — from a chip's right-click, from the masthead title's right-click, or from the telemetry popover — writes the same flavor set. (Verify: extend `tests/app-test/at0376-session-atom-clipboard.test.ts` to the masthead title path.)

#### Scope {#scope}

1. Rust: lift the synopsis freeze; refresh turn count and file size at turn end; carry `file_size` on the `session_updated` push.
2. Resolver: split `SessionIdentity.title` into `customName` and `description`; add the title-grammar formatter.
3. Liveness: add `useSessionPhase(sessionId)`; correct the unknown-liveness fallback from danger to idle; refactor `SessionPhaseDot` onto it.
4. `TugSessionIdentity`: dot-led mark, title grammar, text-ink atom, live phase, right-click copy, missing form without a slash.
5. `TugSessionRow`: absorb the title/description/activity shape with an optional tape.
6. The three surfaces: the masthead (rebuilt on the shared shape, width control removed, telemetry popover gains the atom), the Lens Sessions rows, the picker rows.
7. Banish user-facing `PULSE` ink.
8. Doctrine: amend `[D132]`; reconcile the gallery card and the identity app-tests.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the citation's flat-text grammar, the commit trailer pair, or the clipboard flavor set. The atom's *face* changes; its *payloads* do not.
- Reviving the `text/html` clipboard flavor (struck in the earlier round and staying struck).
- Adding the short id to the atom's sidecar segment — see [Q01].
- Changing the Changes card's `session_row_title` in `tugrust/crates/tugcast/src/feeds/changeset.rs` to the new grammar — see [Q02].
- Fork-lineage grammar, the `minted_tags` arbiter, or anything about how callsigns are minted.
- The `/resume <tag>` resolution path (still client-cache-backed while citations are ledger-authoritative) — untouched here.
- Any change to `sessionIdentityLine`'s output. It is the pane-title channel and is deliberately constant for the life of a binding; see [P05].

#### Dependencies / Prerequisites {#dependencies}

- The Session Identity gallery card in its post-downselect state (`gallery-session-identity.tsx` / `.css`), which is the visual contract this plan implements.
- `tugcast`'s segmentation engine and incremental scan entry points, all already public in `tugrust/crates/tugcast/src/external_sessions.rs`: `stat_size_mtime`, `resume_seed_from_cache`, `parse_candidate`, `engine_turn_count`.
- The ledger writers `reconcile_turn_count_from_engine` and `upsert_scan_cache` in `tugrust/crates/tugcast/src/session_ledger.rs`.
- A Rust change requires `just build-app` before any app-test run — `app-test` refreshes `dist` but never rebuilds the app binary.

#### Constraints {#constraints}

- **Warnings are errors.** `tugrust/.cargo/config.toml` enforces `-D warnings`; both `cargo build` and `cargo nextest run` fail on any warning.
- **The masthead must not reflow.** Its slot height is a fixed token; every row truncates rather than wrapping. Chrome that changed height with its content would move every card beneath it.
- **`sessionIdentityLine` must stay constant for a binding.** The tab strip, the Window menu, and the slot-stack picker read it through the pane-title channel, which is not a notification path.
- **Picker cells are pure render functions** (no `useState`/`useRef`/`useEffect`), per the picker redesign's `[D17]`. Any new hook used there must be a pure subscription read.
- Laws in play: `[L02]` external state through `useSyncExternalStore` only; `[L06]`/`[L24]` appearance via CSS and DOM, never React state; `[L09]` the pane owns the chrome slot, this content owns what is in it; `[L13]` motion belongs to the animator/indicator; `[L19]` component authoring; `[L20]` token sovereignty; `[L26]` mount identity (the masthead is keyed by session).
- Ledger databases are never opened with a foreign `sqlite3`; use `just db-inspect` for any inspection.

#### Assumptions {#assumptions}

- The SharedAgent's Summarize lane can absorb the additional renamed-session traffic that lifting the freeze creates; the lane's existing debounce is the throttle. See [R01].
- A single-session incremental re-parse at turn end is cheap because the resume-seed path avoids a full re-stream on ordinary appends (`tuglaws/turn-metric.md`). See [R02].
- Every surface in scope already resolves identity through `useSessionIdentity`, so the `customName`/`description` split reaches them without new wiring.
- The theme's session-color tokens stay authored even though the atom stops painting from them; the dot's phase tones are the atom's color channel now.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` headings and rich `**References:**` lines. Plan-local decisions are `[P01]`…; `[D##]` refers to the global `tuglaws/design-decisions.md`. No step cites line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Should the atom's sidecar segment carry the short id? (DEFERRED) {#q01-sidecar-short-id}

**Question:** `sessionAtomSegment` in `tugdeck/src/lib/session-atom.ts` builds an `AtomSegment` whose `label` and `value` are both `<project>/<callsign>` — the short id is absent. Should the segment carry the id so a pasted atom can re-resolve exactly rather than by callsign?

**Why it matters:** A callsign is permanent and unique, so today's payload is unambiguous. But an atom pasted into a document that outlives this ledger has no id to resolve against, while the flat-text citation beside it does.

**Options:**
- Add `sessionId` to the segment (widens the generic `AtomSegment` shape for one atom type).
- Encode it into `value` as the citation form (changes what the wire marker carries).
- Leave it — the callsign is already a unique permanent key.

**Plan to resolve:** Revisit when a second consumer of the sidecar needs exact resolution. Nothing in this rollout depends on it.

**Resolution:** DEFERRED — out of scope here; the atom's payloads are explicitly unchanged by this plan (see [#non-goals]).

#### [Q02] Should the Changes card's session title adopt the new grammar? (DEFERRED) {#q02-changeset-title-grammar}

**Question:** `session_row_title` in `tugrust/crates/tugcast/src/feeds/changeset.rs` composes a session's display title server-side with the old precedence — user name, else callsign, else prompt snippet, else short id. The new grammar is `<name> : <callsign>`, with both present.

**Why it matters:** The Changes card is a sixth surface naming sessions. Left alone it shows a *different* answer from the five surfaces in scope, which is the exact inconsistency this work exists to remove.

**Options:**
- Change `session_row_title` to the composed grammar now (adds a Rust surface and its tests to this plan).
- Leave it and file a follow-on.

**Plan to resolve:** Follow-on. The Changes card was not among the five surfaces named for this rollout, and the grammar change there is independent of everything here.

**Resolution:** DEFERRED — tracked in [#roadmap].

#### [Q03] Does the masthead keep the sparkline and activity-line popovers? (DECIDED) {#q03-masthead-popovers}

**Question:** The shipped masthead hangs two popovers off its third row: clicking the tape opens `SessionPulseCard`; clicking the activity run opens the recent-pulses history.

**Resolution:** DECIDED — both stay, unchanged. Neither is `PULSE` ink (the history popover's heading is "Recent pulses", and its intent groupings are where the retired standing-intent line survives per [P06]). Removing an existing affordance is not part of this rollout.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| R01 Summarize-lane token cost rises | med | high | Existing lane debounce; renamed sessions were previously exempt and now are not | Observable lane backlog or cost complaint |
| R02 Turn-end engine re-parse is slow | high | low | Reuse the incremental resume-seed path, never a naive full parse | A turn-end refresh visibly delays a `session_updated` push |
| R03 Masthead reflow / height drift | med | med | Fixed height token; every row truncates; app-test asserts the height is content-independent | Any masthead row wrapping |
| R04 `identity.title` rename fanout misses a caller | med | med | Remove the field entirely so the compiler finds every reader | `tsc` clean but a surface renders empty |
| R05 Identity app-tests assert the retired form | high | high | Update `at0374` in the same commit as the component | at0374 red after [#step-5] |
| R06 `session_updated` push clobbers a known `file_size` with null | med | high | Every push looks the size up from the scan cache, not just the turn-end one | Picker size readout blanking after an unrelated push |

**Risk R02: Turn-end re-parse cost** {#r02-turn-end-parse-cost}

- **Risk:** Running `engine(file)` on every turn completion could re-stream a large JSONL each turn, adding latency to the turn-end push.
- **Mitigation:**
  - Compose the existing incremental path — read the scan-cache row, `resume_seed_from_cache`, then `parse_candidate` **with** that seed — which `tuglaws/turn-metric.md` certifies never re-streams in full on an ordinary append.
  - Do the work off the turn's critical path: the refresh runs after the turn-complete intercept has already forwarded the frame.
  - Skip entirely when `stat_size_mtime` reports the file unchanged since the cached `(file_size, file_mtime)`.
- **Residual risk:** A turn that lands a compaction or a history edit does force a full re-stream, by the engine's own rules. That is correct and rare.

**Risk R06: Push clobbering a known size** {#r06-push-clobbers-size}

- **Risk:** `file_size` is optional on the wire and `normalizeSessionRow` maps a missing one to `null`. If only the turn-end push carries a size, every *other* `session_updated` push (a rename, a state change, a card bind) would overwrite a known size with null and blank the readout.
- **Mitigation:**
  - `build_session_updated_frame` reads the scan-cache size for the row on **every** push, so no push is a downgrade.
  - A unit test asserts a rename-triggered push still carries the size.
- **Residual risk:** A session with no scan-cache row at all (never scanned, never had a turn) reports no size, which is honest — the activity grammar drops the segment ([S03]).

---

### Design Decisions {#design-decisions}

#### [P01] The pulsing dot is the session mark; the chatbox icon retires (DECIDED) {#p01-dot-is-the-mark}

**Decision:** Every surface that names a session leads with a live `TugProgressIndicator variant="pulsing-dot"` reading the session's phase. `MessageSquareText` / `MessageSquareOff` leave `TugSessionIdentity` entirely.

**Rationale:**
- One mark everywhere, and the mark is alive: it says what the session is *doing*, not merely what kind of thing it is.
- The icon and the dot were previously both present on rows, which spent two marks on one job.

**Implications:**
- The unresolvable citation loses its slashed-icon treatment and states failure by shape alone ([P13]).
- `at0374`'s icon-bearing assertions must change in the same commit as the component ([R05]).

#### [P02] Unknown liveness reads idle, never danger (DECIDED) {#p02-doubt-reads-idle}

**Decision:** Any session whose live state cannot be reached — no bound card, services not yet constructed, a closed or external row — renders the **idle** dot. Red is reserved for genuine failure (`errored`, and a dead transport under a live card).

**Rationale:**
- Red is the error channel; spending it on "we do not know" makes every ordinary closed session look broken.
- `SessionPhaseDot` currently falls back to `OFFLINE_PHASE_INPUT` (`transportState: "offline"`), which `sessionSessionPhaseVisual` maps to `{ role: "danger", state: "aborted" }`. Under [P01] the dot appears on far more surfaces than before, so this latent wrong reading would become widespread.

**Implications:**
- The no-card fallback becomes `{ phase: "idle", transportState: "online", interruptInFlight: false }`.
- A card that exists but whose transport is genuinely offline still reads danger — that is a real failure, not doubt.

#### [P03] One session-keyed liveness door: `useSessionPhase(sessionId)` (DECIDED) {#p03-use-session-phase}

**Decision:** Add `useSessionPhase(sessionId): string` to `tugdeck/src/lib/code-session-store/use-session-phase.ts`, returning the flattened phase **key**. It resolves session → card via `useCardIdForSession`, card → services via `cardServicesStore`, services → snapshot via the card's `codeSessionStore`, and folds the snapshot through `sessionSessionPhaseKey`. `SessionPhaseDot` is refactored to consume it.

**Rationale:**
- Identity is session-keyed and liveness is card-keyed; the join has to happen somewhere, and doing it once is what lets an atom (which holds only a session id) show a live dot at all.
- The snapshot is the whole session state and wakes on every transcript event. Returning the *key* — a short string — means React bails out of the re-render unless the reading actually changed, which is what keeps the identity surfaces quiet.
- Liveness stays **out** of the identity record, exactly as `session-identity.ts` documents: two subscriptions, two keys, meeting in the component.

**Implications:**
- Every store read enters through `useSyncExternalStore` ([L02]).
- Hook rules forbid conditional calls, so the hook is always called and answers `"idle"` when there is nothing to read ([P02]).
- The picker's pure-renderer rule permits it: it is a subscription read with no local state.

#### [P04] `SessionIdentity.title` splits into `customName` and `description` (DECIDED) {#p04-identity-title-split}

**Decision:** Remove `title` from `SessionIdentity`. Add `customName: string | null` (the user's `/rename`, from `sessionNameStore`) and `description: string | null` (the agent's synopsis, from `sessionSynopsisStore`). They are never merged.

**Rationale:**
- The user's name and the agent's description now occupy *different lines* on every surface, so a field that merged them cannot serve either.
- Removing the field rather than deprecating it makes the compiler enumerate every reader ([R04]).

**Implications:**
- Known readers to update: `session-masthead.tsx`, `session-picker-cells.tsx`, `tug-session-identity.tsx` (the tooltip body), `components/lens/sections/cards-section.tsx`, `components/lens/sections/cards-data-source.ts`.
- `cards-section.tsx` uses `identity.title` for a close-button label and a filter-highlighted run; both take `customName ?? description ?? tag` explicitly at the call site rather than a revived merge.

#### [P05] The title grammar is `<customName> : <callsign>`, and the callsign gives way first (DECIDED) {#p05-title-grammar}

**Decision:** A named session's title renders the custom name in the title weight, then a quieter ` : <callsign>`. An unnamed session renders the bare callsign. Under a width squeeze the **callsign** truncates and the custom name survives. A new pure formatter `sessionTitleParts(identity): { name: string; callsign: string | null }` produces the two runs. `sessionIdentityLine` is **unchanged**.

**Rationale:**
- A user-supplied name is the user explicitly saying what the session is called; it cannot rank below a callsign Tug minted for itself.
- The callsign stays visible because it is the permanent citable handle that a rename never changes — and it is the run that can be sacrificed, because the tooltip and every copy path still carry it whole.
- `sessionIdentityLine` feeds the pane-title channel, which is not a notification path and is documented as constant for the life of a binding. Changing it would make the tab strip stale on rename; a separate formatter avoids that entirely.

**Implications:**
- Two runs in the DOM, not one — which is a deliberate departure from the shipped chip's one-text-node rule, and `at0374`'s node-counting assertion changes accordingly ([R05]).
- CSS: the name run is `flex: none` when a callsign follows it, and the callsign run carries `min-width: 0; overflow: hidden; text-overflow: ellipsis`. When the name run stands alone it takes `min-width: 0` and may ellipsize, since it is then the only run there is.
- The masthead drops the `project/` prefix from its title ink; the prefix survives in the tooltip, the citation, and the telemetry popover.

#### [P06] Two levels under the title, not three (DECIDED) {#p06-two-levels}

**Decision:** The stack is title → description → activity. The standing-intent level (the `TugPulse` headline) leaves chrome on all three surfaces.

**Rationale:**
- The description already says what the session is for; a standing goal beside it is a second goal-shaped line reading as an echo.
- The intent is not lost: it survives in the recent-pulses popover, where it heads its run of beats ([Q03]).

**Implications:**
- The Lens row stops rendering `usePulseOverview`'s text as its middle line and renders the description instead.
- `TugPulse`'s `headline` prop stops being passed by the three surfaces. The component keeps it — the popover and other consumers still use it.

#### [P07] `PULSE` is an internal name and never user-facing ink (DECIDED) {#p07-pulse-is-internal}

**Decision:** No surface renders the string `PULSE`. Stores, modules, tests, and CSS class names keep the name; labels, legends, and stand-ins lose it.

**Rationale:**
- With the activity line always carrying something true to say ([S03]), nothing needs a placeholder word — and a band that names itself is furniture where a sentence belongs.

**Implications:**
- `HEADLINE_FALLBACK` in `tugdeck/src/components/tugways/tug-pulse.tsx` (a `<span className="tug-pulse-headline-stand-in">PULSE</span>`) is removed; an absent headline renders no run. Its "keeps the line's height" job is obsolete because the surfaces no longer render a headline level at all ([P06]).
- A grep-gate unit test keeps it out, exempting gallery cards (which discuss the vocabulary) and non-ink identifiers.

#### [P08] The activity line's grammar (DECIDED) {#p08-activity-grammar}

**Decision:** At rest, the activity line reads `<turns> turns, <size>. Last updated: <stamp>. Ready.`; segments with no value drop out. During a turn it carries the live beat. See [S03] for the normative form.

**Rationale:**
- The row was previously a placeholder much of the time; these are facts the ledger already holds and a reader actually wants.
- `Last updated:` is labeled because a bare date-time beside a size and a turn count is ambiguous about which fact it dates.

**Implications:**
- The masthead needs `turn_count`, `file_size`, and `last_used_at` for its own session — hence [P10].
- The existing `restingActivityText` helper in `tugdeck/src/lib/pulse-line/resting-line.ts` composes a *different* sentence (`Completed at … Ready.`). The new grammar is a new formatter; the resting-line module stays for its own callers.

#### [P09] The synopsis freeze is lifted (DECIDED) {#p09-lift-synopsis-freeze}

**Decision:** Remove both enforcement points so the Summarize lane keeps describing renamed sessions: the `AND name_user_set = 0` clause in `SessionLedger::record_synopsis`, and the early return on `row.name_user_set` in `tugrust/crates/tugcast/src/feeds/session_overview.rs`.

**Rationale:**
- The freeze existed because a generated line must not speak *over* the user's word. Under the new design they never compete — the name is the title, the description is the line beneath it.
- Without lifting it, every renamed session shows a permanently stale or empty description line, which is the most-used state on the most-visible surface.

**Implications:**
- Sessions renamed before this change fill their description in on their next activity; no migration is needed.
- The doc comments on both sites, and on `SessionRow.synopsis` in both `session_ledger.rs` and `tugdeck/src/protocol.ts`, must be rewritten — they currently *state* the freeze as the contract.
- The existing test asserting the freeze inverts to assert the write. See [R01] for cost.

#### [P10] Turn count and size refresh at turn end and ride every push (DECIDED) {#p10-turn-end-freshness}

**Decision:** On turn completion, tugcast re-derives `engine(file)` and the on-disk size for that session incrementally, writes both (`reconcile_turn_count_from_engine` + `upsert_scan_cache`), and broadcasts `session_updated`. `build_session_updated_frame` gains a `file_size` field sourced from the scan cache on **every** push.

**Rationale:**
- The activity line's rest form is read the instant a turn ends, which is exactly when the old numbers were most stale.
- Sourcing the size on every push rather than only the turn-end one avoids the clobber described in [R06].
- The engine is the single count authority (`tuglaws/turn-metric.md`); this reuses it rather than adding a second counter.

**Implications:**
- Composed from existing public entry points in `external_sessions.rs`: `stat_size_mtime` → skip if unchanged; else `resume_seed_from_cache` + `parse_candidate` for an incremental parse.
- `tugdeck/src/protocol.ts`'s `file_size` doc comment — which currently states pushes never carry it — must be corrected.

#### [P11] One row shape: `TugSessionRow` absorbs the masthead's form (DECIDED) {#p11-one-row-shape}

**Decision:** `TugSessionRow` grows the title/description/activity shape with an optional tape, and the masthead composes it. The masthead stops hand-building its own stack.

**Rationale:**
- The user's direction is explicit: use the component library as the consistency mechanism. Three surfaces showing the same thing must not be three authorings of it.
- `TugSessionRow` already carries `description` and `sparkline` props, so the shape is reachable rather than aspirational.
- It is the same argument the row/gallery relationship already rests on: the gallery approves a shape and the Lens wears it *by construction*.

**Implications:**
- The row's existing `metadata` prop and the four-line form are removed — those facts are the activity grammar's rest form now ([P08]).
- The `TugSessionRowFit` set is pruned to what is actually mounted; `gutter`/`reveal`/`wash`/`duplex` were auditions and only `inset` ships.
- The masthead keeps ownership of its chrome-specific concerns — the dwell queue, the telemetry popover, the wave widget — and delegates only the three-row shape.

#### [P12] Picker rows carry no tape (DECIDED) {#p12-picker-no-tape}

**Decision:** The new-session picker's rows render no sparkline. The Lens rows and the masthead keep theirs.

**Rationale:**
- A picker is read at rest while choosing; the dot already says which rows are working, and a tape per row is motion competing with a decision.

**Implications:**
- `TugSessionRow`'s `sparkline` prop stays optional and the picker simply omits it.

#### [P13] The atom paints in text ink; the dot is its only color channel (DECIDED) {#p13-atom-text-ink}

**Decision:** The atom keeps its rounded pill shape but drops the theme's session color: the run takes the ordinary text color and the border a `currentcolor` mix. The live dot is the pill's only color. The missing form keeps the dashed border and muted ink, forces the idle dot, and stays inert.

**Rationale:**
- A colored pill around a colored dot was two tints saying one thing, and the dot's tint is the one carrying information.
- With the icon gone ([P01]) there is nothing left to slash, so shape alone states unresolvability — which it already did, alongside the slash.

**Implications:**
- `at0374`'s assertion that the chip paints a non-transparent session ground inverts ([R05]).
- The session-color tokens stay authored in the six theme files; they are simply not consumed by this component. Removing them is out of scope.

#### [P14] The atom is a live component (DECIDED) {#p14-atom-is-live}

**Decision:** A session atom renders as a subscribed component wherever it appears — pasted into a composer, in a Gazette ref, on a History line. Its dot reads the session's phase this second and its name tracks renames. It is never a static string or a baked image.

**Rationale:**
- The user's direction: the dot must be live and the custom name must change live as the user changes it.
- Identity liveness already exists via `useSessionIdentity`; [P03] supplies the phase half.

**Implications:**
- Rules out the Canvas→PNG bake used for some atom chips (see the SVG-in-img constraint recorded for `at0205`) — a session atom must stay a mounted component.

#### [P15] The width control leaves masthead-bearing panes (DECIDED) {#p15-no-width-control}

**Decision:** The card-width control in `tugdeck/src/components/chrome/tug-pane.tsx` is not rendered when the pane wears a masthead. Non-masthead content panes keep it.

**Rationale:**
- The masthead's first row is identity and its two chrome affordances (telemetry, close); a third control competes with the name.
- Width remains reachable by its command and by the Lens's width presets, so the affordance is relocated rather than removed.

**Implications:**
- The condition is the masthead's presence, not the card family — one predicate, already available where the control is rendered.
- Any app-test asserting `tug-pane-title-bar-width-button` on a Session card must move to a non-masthead pane.

#### [P16] Right-clicking the masthead title copies the atom (DECIDED) {#p16-masthead-right-click-copy}

**Decision:** The masthead's title run carries a right-click → Copy that writes the full session-atom flavor set via `writeSessionAtomToClipboard`. The telemetry popover additionally *displays* the rendered atom above the flat citation.

**Rationale:**
- The atom should be reachable without opening anything; right-click is the idiom every other Tug chip already uses.
- Showing the atom in the popover puts the two copyable forms side by side, each labeled by what a paste of it yields.

**Implications:**
- Uses the existing `useCopyableButton` / `useCopyableText` hooks — no new clipboard machinery.

---

### Deep Dives {#deep-dives}

#### Why the phase fallback is a bug, not a default {#phase-fallback}

`SessionPhaseDot` today reads a card's services, then that card's `codeSessionStore` snapshot, and falls back to `OFFLINE_PHASE_INPUT = { phase: "idle", transportState: "offline", interruptInFlight: false }` when either is absent. `sessionSessionPhaseKey` gives transport precedence over everything, so `"offline"` wins and `sessionSessionPhaseVisual` maps it to `{ role: "danger", state: "aborted" }` — a red, stopped dot.

That was tolerable while the dot appeared only on rows that *had* a card (the picker renders no dot at all for cardless rows today). Under [P01] the dot becomes the session mark on the atom and on every picker row, where "no bound card" is the common case rather than a transient. The fallback therefore has to change with the rollout, and it changes to the honest reading: we do not know, so the session is quiet. This is [P02], and it is the reason that decision is written as a correction rather than a preference.

#### The two data-freshness gaps, precisely {#data-freshness}

Two independent facts, both scan-derived:

- **`turn_count`.** `tuglaws/turn-metric.md` names `engine(session file)` the sole authority and explicitly removes the old live `+1`-per-`turn_complete` writer. `SessionLedger::record_turn` now only touches `last_used_at`. The count is refreshed by `reconcile_turn_count_from_engine`, whose only production caller is the external scan in `external_sessions.rs`. So a live session's count is whatever the last scan saw.
- **`file_size`.** It is not a column on the Rust `SessionRow` at all — it lives in the `external_scan_cache` table and is joined in only on the `list_sessions` path. `build_session_updated_frame` therefore cannot carry it today, which `tugdeck/src/protocol.ts` documents as fact.

[P10] closes both at the same seam: the supervisor already intercepts every outbound `turn_complete` / `turn_cancelled` frame, so the refresh hangs off an existing interception rather than a new one. The incremental parse is the same one the scanner uses, so no new counting code appears anywhere.

#### What the gallery card decided, and where each decision lands {#gallery-to-code}

**Table T01: the gallery's decisions mapped to their landing sites** {#t01-decision-map}

| Gallery decision | Lands in | Plan artifact |
|---|---|---|
| Dot replaces the icon | `tug-session-identity.tsx`, all three surfaces | [P01] |
| White = idle *and* unknown; red = errors only | `use-session-phase.ts` fallback | [P02] |
| `<name> : <callsign>`, callsign truncates first | `session-identity.ts` formatter + CSS | [P05] |
| Two levels under the title | `tug-session-row.tsx`, all three surfaces | [P06] |
| No `PULSE` ink | `tug-pulse.tsx` + grep gate | [P07] |
| Activity grammar with `Last updated:` | new formatter + Rust freshness | [P08], [P10] |
| Masthead: 3 rows, no width control | `session-masthead.tsx`, `tug-pane.tsx` | [P11], [P15] |
| Rows: Lens keeps the tape, picker does not | `cards-session-cell.tsx`, `session-picker-cells.tsx` | [P11], [P12] |
| Atom: text ink, live, right-click copy | `tug-session-identity.tsx` | [P13], [P14] |
| Atom in the telemetry popover; right-click the title | `session-masthead.tsx` | [P16] |
| Citation, clipboard flavors, lineage unchanged | — | [#non-goals] |

---

### Specification {#specification}

**Spec S01: The title grammar** {#s01-title-grammar}

`sessionTitleParts(identity: SessionIdentity): { name: string; callsign: string | null }`, a pure function in `tugdeck/src/lib/session-identity.ts`.

- `customName` non-null → `{ name: customName, callsign: tag ?? shortId }`.
- `customName` null → `{ name: tag ?? shortId, callsign: null }`.
- Rendered as two runs joined by `" : "`. The separator belongs to the callsign run so it disappears with it.
- Truncation: the callsign run ellipsizes; the name run does not, unless it is the only run.
- No `project/` prefix. `sessionIdentityLine` retains it and is untouched.

**Spec S02: The description line** {#s02-description-line}

- Renders `identity.description` when non-null.
- Otherwise renders `Created <stamp>`, formatted by `formatRestingStamp` from `tugdeck/src/lib/pulse-line/resting-line.ts`, painted a step quieter than a real description to mark it as a fact standing in.
- Never blank, never a placeholder word, never italic (the theme sans has no italic face — an italic run paints nothing).
- The line always occupies its height so a description arriving does not move the row beneath it.

**Spec S03: The activity line** {#s03-activity-line}

`sessionActivityRestLine(row): string`, a pure formatter.

- Form: `<turns> turns, <size>. Last updated: <stamp>. Ready.`
- `<turns>` pluralizes (`1 turn`). Omitted entirely when `turn_count` is 0.
- `<size>` uses the existing `formatByteSize` from `session-picker-format.ts`. The whole `, <size>` segment drops when `file_size` is null or 0.
- `Last updated: <stamp>.` drops when `turn_count` is 0 (a session never used has nothing to date) or `last_used_at` is absent. `<stamp>` uses `formatRestingStamp`.
- `Ready.` always closes.
- Degenerate case — nothing known — is exactly `Ready.`
- **During a turn** the line is replaced by the live beat, which keeps its existing dwell pacing and middle-truncation behavior.

**Spec S04: The dot vocabulary** {#s04-dot-vocabulary}

Phase key → visual is `sessionSessionPhaseVisual`, unchanged. What changes is reach and fallback:

| Reading | Key | Visual |
|---|---|---|
| Idle, and unknown/closed/external/unreachable | `idle` | inherit, stopped |
| A turn in flight | `streaming` / `tool_work` / … | action, running |
| Parked on the user | `awaiting_approval` | caution, running |
| Agents working, no turn | `background` | inherit, running |
| Genuine failure | `errored`, transport offline under a live card | danger, aborted |

Sizes: `TUG_SESSION_ROW_INDICATOR_SIZE` (28) for the Lens; 16 for the masthead and the picker; 12 / 10 for the atom at `sm` / `2xs`. All are ring boxes — the dot paints at 60% and the ring overhangs into block padding rather than setting line height.

**Spec S05: The atom face** {#s05-atom-face}

- Resolved: rounded pill, transparent ground, `currentcolor`-mix border, text-ink run, live dot, right-click → Copy, click → raise when a card exists.
- Missing: same shape, dashed border, muted ink, forced idle dot, fully inert, tooltip `Session not found`.
- Pending: inert and **not** slashed or dashed — claiming "not found" before asking is the same lie in the other direction.
- Payloads unchanged: `text/plain` is the citation, the sidecar is the generic atom segment, the wire marker is the backticked mention. No `text/html`.

**Spec S06: `session_updated` and the turn-end refresh** {#s06-push-and-refresh}

- `build_session_updated_frame` gains `"file_size": Option<i64>`, read from the `external_scan_cache` row for the session on every push. Absent row → `null`.
- On `turn_complete`, after the frame is forwarded: `stat_size_mtime(path)`; if `(size, mtime)` equals the cached pair, stop. Else `resume_seed_from_cache` + `parse_candidate` for an incremental parse; write `reconcile_turn_count_from_engine(session_id, count)` and `upsert_scan_cache(row)`; broadcast.
- `turn_cancelled` takes the same path (a cancelled turn still appended records).

**Spec S07: The identity record** {#s07-identity-record}

`SessionIdentity` loses `title` and gains:

```ts
/** The user's own name for this session — `/rename`, never an auto title. */
customName: string | null;
/** The agent's rolling description. Independent of `customName`. */
description: string | null;
```

`composeSessionIdentity` sets `customName` from `name` and `description` from `synopsis`, with no fallback between them.

#### State Zone Mapping {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Session phase key (`useSessionPhase`) | local-data | store + `useSyncExternalStore` (binding → services → session store) | [L02] |
| `customName` / `description` | local-data | existing identity stores + `useSyncExternalStore` | [L02] |
| Turn count / size / last-used | local-data | `useSessionLedger` row + `useSyncExternalStore` | [L02] |
| Dot appearance per phase | appearance | `data-phase` + CSS via `TugProgressIndicator` | [L06], [L13] |
| Title truncation (which run ellipsizes) | appearance | CSS `flex`/`min-width`/`text-overflow` | [L06] |
| Description-is-a-stamp styling | appearance | `data-stamp` attribute + CSS | [L06] |
| Atom missing/pending state | appearance | `data-missing` attribute + CSS | [L06] |
| Activity-line dwell queue | local-data | existing `useState`/`useRef` in the masthead | [L22] |
| Masthead telemetry popover open | structure | `useState` (decides what is mounted) | [L24] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/code-session-store/use-session-phase.ts` | `useSessionPhase(sessionId)` — the session-keyed liveness door ([P03]) |
| `tugdeck/src/lib/session-activity-line.ts` | `sessionActivityRestLine` and its helpers ([S03]) |
| `tugdeck/src/lib/__tests__/session-activity-line.test.ts` | Grammar unit tests |
| `tugdeck/src/lib/__tests__/pulse-ink-gate.test.ts` | The no-`PULSE`-ink grep gate ([P07]) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SessionIdentity.title` | field | `tugdeck/src/lib/session-identity.ts` | **Removed** ([P04]) |
| `SessionIdentity.customName` / `.description` | field | same | Added ([S07]) |
| `sessionTitleParts` | fn | same | New formatter ([S01]) |
| `sessionIdentityLine` | fn | same | **Unchanged** — pane-title channel ([P05]) |
| `useSessionPhase` | hook | `use-session-phase.ts` | New ([P03]) |
| `SessionPhaseDot` | component | `tugdeck/src/components/tugways/session-phase-dot.tsx` | Re-keyed to `sessionId`, consumes the hook |
| `TugSessionIdentity` | component | `tugdeck/src/components/tugways/tug-session-identity.tsx` | Dot-led, two-run title, text ink, live |
| `TugSessionRow` | component | `tugdeck/src/components/tugways/tug-session-row.tsx` | Absorbs the shape; `metadata` and the audition fits removed ([P11]) |
| `SessionMasthead` | component | `tugdeck/src/components/tugways/session-masthead.tsx` | Composes the row; popover atom; title right-click ([P16]) |
| `HEADLINE_FALLBACK` | const | `tugdeck/src/components/tugways/tug-pulse.tsx` | **Removed** ([P07]) |
| `record_synopsis` | fn | `tugrust/crates/tugcast/src/session_ledger.rs` | Freeze clause removed ([P09]) |
| `build_session_updated_frame` | fn | `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` | Carries `file_size` ([S06]) |
| `refresh_session_metrics` | fn | `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` | New turn-end refresh ([P10]) |

---

### Documentation Plan {#documentation-plan}

- [ ] Amend `[D132]` in `tuglaws/design-decisions.md`: the dot as the session mark, the title grammar and its truncation rule, the two-level stack, `PULSE` as an internal name, the `customName`/`description` split, and the lifted synopsis freeze.
- [ ] Correct the `synopsis` doc comments in `tugrust/crates/tugcast/src/session_ledger.rs` and `tugdeck/src/protocol.ts` — both currently state the freeze as the contract.
- [ ] Correct the `file_size` doc comment in `tugdeck/src/protocol.ts` — it states pushes never carry it.
- [ ] Update the gallery card's docstring to record what shipped, and retire its "shipped today, for contrast" frame.
- [ ] Update `roadmap/session-reference-plan.md` Specs S02/S06 with the shipped deltas from this rollout.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Rust unit** | Ledger writes, freeze removal, frame shape, refresh path | Every Rust step |
| **TS unit** | Pure formatters (`sessionTitleParts`, `sessionActivityRestLine`), the identity record, the phase fallback | Resolver and grammar steps |
| **Grep gate** | Structural invariants a reviewer cannot enforce by habit | `PULSE` ink, `resolveSessionIdentity` in components |
| **App-test** | What only paints in a real browser on real theme tokens: which run truncates, the dot's computed color, the absence of the width control | Component and surface steps |

#### What stays out of tests {#test-non-goals}

- **Render tests over a fake DOM.** Banned in this project; the identity surfaces are covered by app-tests against the real app.
- **Mock-store assertion tests.** The stores are exercised through their real subscribe/snapshot contracts.
- **Screenshot diffs of the masthead.** Too brittle for a chrome tier whose content changes every turn; the assertions are structural and computed-style instead.
- **The full app-test corpus.** Selection is derived via `@covers`; a sweep is never run on the implementer's initiative.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Rust changes require `just build-app` before any app-test run.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Rust: lift the synopsis freeze | pending | — |
| #step-2 | Rust: turn-end freshness and `file_size` on every push | pending | — |
| #step-3 | Resolver: split `title` into `customName` + `description` | pending | — |
| #step-4 | Liveness: `useSessionPhase` and the doubt rule | pending | — |
| #step-5 | `TugSessionIdentity`: dot-led, live, text ink | pending | — |
| #step-6 | `TugSessionRow`: absorb the title/description/activity shape | pending | — |
| #step-7 | The masthead, rebuilt | pending | — |
| #step-8 | The Lens rows and the picker rows | pending | — |
| #step-9 | Banish user-facing `PULSE` ink | pending | — |
| #step-10 | Integration checkpoint | pending | — |
| #step-11 | Doctrine and gallery reconciliation | pending | — |

---

#### Step 1: Rust — lift the synopsis freeze {#step-1}

**Commit:** `tugcast(session-identity): let the Summarize lane describe renamed sessions`

**References:** [P09] Lift the synopsis freeze, Risk R01, (#context, #data-freshness)

**Artifacts:**
- `tugrust/crates/tugcast/src/session_ledger.rs` — `record_synopsis` without the freeze clause
- `tugrust/crates/tugcast/src/feeds/session_overview.rs` — no pre-model early return on `name_user_set`
- Corrected doc comments on both, on the Rust `SessionRow.synopsis`, and on the TS `SessionRow.synopsis`

**Tasks:**
- [ ] Remove `AND name_user_set = 0` from `record_synopsis`'s `UPDATE`. Keep the `COALESCE(synopsis, '') != ?2` guard — it is what suppresses pointless broadcasts.
- [ ] In `session_overview.rs`, drop the `Ok(Some(row)) if row.name_user_set` arm that returns early, so a renamed row falls through to the `Ok(Some(row)) => row.synopsis` arm and its previous description still seeds the revision prompt.
- [ ] Rewrite the doc comment on `record_synopsis` to state the new contract and *why* it changed (name and description occupy different lines now), so a future reader does not restore the freeze as a "fix".
- [ ] Update `SessionRow.synopsis`'s doc comment in `session_ledger.rs` and the matching one in `tugdeck/src/protocol.ts` — both currently assert the freeze.

**Tests:**
- [ ] Invert the existing freeze test: `record_synopsis` on a row with `name_user_set = 1` now writes and returns `true`.
- [ ] A renamed row's `name` is untouched by a synopsis write (the two fields are independent).
- [ ] Existing `session_overview` tests still pass for the un-renamed path.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`

---

#### Step 2: Rust — turn-end freshness and `file_size` on every push {#step-2}

**Depends on:** #step-1

**Commit:** `tugcast(session-identity): refresh turn count and size at turn end, and carry size on every push`

**References:** [P10] Turn-end freshness, Spec S06, Risk R02, Risk R06, (#data-freshness)

**Artifacts:**
- `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` — `build_session_updated_frame` carrying `file_size`; a new `refresh_session_metrics` on the turn-complete path
- `tugdeck/src/protocol.ts` — corrected `file_size` doc comment

**Tasks:**
- [ ] Add a scan-cache size lookup to the ledger (a small `file_size_for(session_id) -> Option<i64>` reading `external_scan_cache`), and have `build_session_updated_frame` include `"file_size"` from it on **every** push. This is what prevents an unrelated push from nulling a known size ([R06]).
- [ ] Add `refresh_session_metrics(session_id, path)`: `stat_size_mtime` first and return early when `(size, mtime)` matches the cached pair; otherwise `resume_seed_from_cache` → `parse_candidate` with the seed → `reconcile_turn_count_from_engine` + `upsert_scan_cache`. Never a naive full parse ([R02]).
- [ ] Call it from the existing `turn_complete` / `turn_cancelled` interception in the supervisor, **after** the frame is forwarded, so the refresh is off the turn's critical path.
- [ ] Broadcast `session_updated` after the write so the client sees both new numbers together.
- [ ] Correct `tugdeck/src/protocol.ts`'s `file_size` comment, which states pushes never carry it.

**Tests:**
- [ ] `build_session_updated_frame` includes `file_size` when a scan-cache row exists and `null` when it does not.
- [ ] A rename-triggered push still carries the size (the [R06] regression).
- [ ] `refresh_session_metrics` is a no-op when `(size, mtime)` is unchanged.
- [ ] After appending a turn to a fixture JSONL, the refresh writes the new engine count and the new size.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `just build-app`

---

#### Step 3: Resolver — split `title` into `customName` + `description` {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(session-identity): split the identity record's title into customName and description`

**References:** [P04] Title split, [P05] Title grammar, Spec S01, Spec S07, Risk R04, (#gallery-to-code)

**Artifacts:**
- `tugdeck/src/lib/session-identity.ts` — record shape, `composeSessionIdentity`, `sessionTitleParts`
- Every reader updated: `session-masthead.tsx`, `session-picker-cells.tsx`, `tug-session-identity.tsx`, `components/lens/sections/cards-section.tsx`, `components/lens/sections/cards-data-source.ts`

**Tasks:**
- [ ] Remove `title` from `SessionIdentity`; add `customName` and `description` per [S07]. Removing rather than deprecating is deliberate — the compiler enumerates every reader ([R04]).
- [ ] Add `sessionTitleParts` per [S01] as a pure function beside the other formatters.
- [ ] Update each reader to name what it actually wants. `cards-section.tsx` (close-button label and filtered run) and `cards-data-source.ts` take `customName ?? description ?? tag` explicitly at the call site — do **not** reintroduce the merge inside the resolver.
- [ ] `tug-session-identity.tsx`'s tooltip body shows the description line; leave its citation and lineage lines alone.
- [ ] Leave `sessionIdentityLine` and `sessionCitation` untouched.

**Tests:**
- [ ] `composeSessionIdentity` sets the two fields independently: a row with both a user name and a synopsis exposes both; neither falls back to the other.
- [ ] An auto title (`name_user_set: false`) never becomes `customName` — the name store already holds only user-set names, and this pins it.
- [ ] `sessionTitleParts` for named, unnamed, and legacy tagless (short-id) sessions.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test`

---

#### Step 4: Liveness — `useSessionPhase` and the doubt rule {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(session-identity): add the session-keyed phase door and stop painting doubt as danger`

**References:** [P02] Doubt reads idle, [P03] `useSessionPhase`, Spec S04, (#phase-fallback, #state-zone-mapping)

**Artifacts:**
- `tugdeck/src/lib/code-session-store/use-session-phase.ts` — new
- `tugdeck/src/components/tugways/session-phase-dot.tsx` — re-keyed to `sessionId`, consuming the hook

**Tasks:**
- [ ] Write `useSessionPhase(sessionId): string`, composing `useCardIdForSession` → `cardServicesStore.getServices` → the card's `codeSessionStore` snapshot → `sessionSessionPhaseKey`, folding `countRunningJobs(snap.jobs)` and `snap.pendingAsk !== null` exactly as `SessionPhaseDot` does today.
- [ ] Return the flattened **key**, not the snapshot, so React bails out unless the reading changed. Note this in the docstring — it is the whole reason the hook is safe on identity surfaces.
- [ ] No-card / no-services fallback answers `"idle"` ([P02]). Delete `OFFLINE_PHASE_INPUT`; it encoded the danger reading.
- [ ] Re-key `SessionPhaseDot` from `cardId` to `sessionId` and have it consume the hook. Keep the `drift` prop and keep the drift seeded by a stable per-session key.
- [ ] Update `SessionPhaseDot`'s two existing call sites (`cards-session-cell.tsx`, `session-picker-cells.tsx`) to pass a session id. The picker can now render a dot for **every** row, not only rows with a card — which is the point of [P02].
- [ ] Leave `session-card-telemetry-renderers.tsx` alone; it holds the store directly and is not an identity surface.

**Tests:**
- [ ] The hook answers `"idle"` for an unknown session id.
- [ ] The hook answers `"idle"` (not an offline/danger key) for a session with a binding but no constructed services.
- [ ] Given a snapshot with running jobs and `phase: "idle"`, the hook answers `"background"`.
- [ ] `sessionSessionPhaseVisual("idle")` is not the danger role — pins [P02] at the mapping level.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test`

---

#### Step 5: `TugSessionIdentity` — dot-led, live, text ink {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(session-identity): lead with the live dot, put the user's name first, paint the atom in text ink`

**References:** [P01] Dot is the mark, [P05] Title grammar, [P13] Text ink, [P14] Live atom, Spec S01, Spec S05, Risk R05, (#t01-decision-map)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-session-identity.tsx` / `.css`
- `tests/app-test/at0374-session-identity-tiers.test.ts` — assertions updated to the shipped form
- `gallery-session-identity.tsx` — the contrast frame retired

**Tasks:**
- [ ] Replace the `MessageSquareText` / `MessageSquareOff` marks with a `TugProgressIndicator` pulsing dot driven by `useSessionPhase(identity.id)`. Remove both lucide imports and `TUG_SESSION_IDENTITY_LINE_ICON_SIZE`'s icon meaning (the masthead reads it for its text inset — replace that with a dot-advance token published the same way, so the inset still comes from one source).
- [ ] Render the title as two runs per [S01], with the CSS truncation rule from [P05]: the callsign gives way, the name survives, and a lone name run may ellipsize.
- [ ] Repaint the chip per [P13]: transparent ground, `currentcolor`-mix border, text-ink run. Remove the session-color token references from this component's CSS and its `@tug-pairings` block. Keep the missing form's dashed border and muted ink; force its dot to `idle`.
- [ ] Keep right-click → Copy exactly as it is (`useCopyableText` with `writeSessionAtomToClipboard`). It already satisfies [P14]'s copy half.
- [ ] Update `at0374`: the run is now two elements not one text node; the chip's ground is transparent rather than session-tinted; the missing chip has no slashed icon. Assert what the design now claims — a dot is present, the callsign run is the one that truncates, both sizes still differ.
- [ ] Retire the gallery card's "shipped today, for contrast" frame, which becomes a duplicate of the proposed form.

**Tests:**
- [ ] `at0374` — the two-run title, the callsign truncating first under a narrow mount, the transparent chip ground, the inert missing atom, both chip sizes.
- [ ] `at0376` — the atom clipboard round trip still passes unchanged (payloads are untouched).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`
- [ ] `just app-test at0374-session-identity-tiers.test.ts at0376-session-atom-clipboard.test.ts`

---

#### Step 6: `TugSessionRow` — absorb the title/description/activity shape {#step-6}

**Depends on:** #step-5

**Commit:** `tugdeck(session-identity): give TugSessionRow the one shape all three surfaces wear`

**References:** [P06] Two levels, [P11] One row shape, [P12] Picker has no tape, Spec S02, Spec S03, (#gallery-to-code)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-session-row.tsx` / `.css`
- `tugdeck/src/lib/session-activity-line.ts` — new, per [S03]
- `tugdeck/src/lib/__tests__/session-activity-line.test.ts` — new

**Tasks:**
- [ ] Write `sessionActivityRestLine` per [S03], reusing `formatByteSize` from `session-picker-format.ts` and `formatRestingStamp` from `resting-line.ts`. Do not modify `resting-line.ts` — it composes a different sentence for its own callers.
- [ ] Reshape `TugSessionRow` to title / description / activity with an optional trailing tape on the activity row. Remove the `metadata` prop and the `intent` prop's role in these mounts ([P06]).
- [ ] Prune `TugSessionRowFit` to the one fit that ships (`inset`), deleting the audition fits and their CSS. Rewrite the module docstring, which currently documents five fits and a PULSE three-part split.
- [ ] Publish the dot advance and the text inset as tokens so the two lines under the title hang off the *title*, not the dot — one source, read by both the row's CSS and any mount site that needs it.
- [ ] Per [S02], the description row renders the creation stamp when there is no description, marked with a `data-stamp` attribute for the quieter treatment ([L06]).

**Tests:**
- [ ] `sessionActivityRestLine` across the grammar: zero turns, one turn (singular), no size, no stamp, everything present, and the degenerate `Ready.`
- [ ] The description falls back to the creation stamp and carries `data-stamp`.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`

---

#### Step 7: The masthead, rebuilt {#step-7}

**Depends on:** #step-6

**Commit:** `tugdeck(session-identity): rebuild the masthead on the shared row shape and free its title row`

**References:** [P11] One row shape, [P15] No width control, [P16] Right-click copies the atom, Spec S02, Spec S03, Risk R03, (#state-zone-mapping)

**Artifacts:**
- `tugdeck/src/components/tugways/session-masthead.tsx` / `.css`
- `tugdeck/src/components/chrome/tug-pane.tsx` — width control suppressed on masthead panes

**Tasks:**
- [ ] Rebuild the masthead's three rows on the shared shape from [#step-6], keeping the masthead's own concerns local: the dwell queue, the two popovers ([Q03]), and the wave widget.
- [ ] Feed the activity row from the session's ledger row (`turn_count`, `file_size`, `last_used_at`) at rest and the dwell queue's beat during a turn, per [S03].
- [ ] Lift the tape so it reads visually centered across rows two and three, as the gallery settled — a relative offset, so the flow box does not move anything beneath it. Pin the tape's color to the chrome foreground and raise its line/area alphas: the masthead's ground is the tinted chrome band, not the pane background, and the instrument's pane-ground defaults wash out against a saturated light-theme band.
- [ ] Add the title's right-click → Copy writing the atom's full flavor set ([P16]), via `useCopyableButton`.
- [ ] Add the rendered atom to the telemetry popover above the citation, pulled left by the pill's inline padding so its run aligns with the other values' column.
- [ ] In `tug-pane.tsx`, suppress the width control when the pane wears a masthead ([P15]). Move any app-test asserting `tug-pane-title-bar-width-button` to a non-masthead pane.
- [ ] Confirm the masthead's height token is unchanged and content-independent ([R03]).

**Tests:**
- [ ] App-test: the masthead renders exactly one dot, three text rows, and no width-control button; a named session shows both runs; the height is identical for a named and an unnamed session.
- [ ] App-test: right-clicking the title offers Copy and writes the atom (extend `at0376`).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 8: The Lens rows and the picker rows {#step-8}

**Depends on:** #step-7

**Commit:** `tugdeck(session-identity): put the Lens rows and the picker rows on the one shape`

**References:** [P06] Two levels, [P11] One row shape, [P12] Picker has no tape, Spec S02, Spec S03, Spec S04

**Artifacts:**
- `tugdeck/src/components/lens/sections/cards-session-cell.tsx`
- `tugdeck/src/components/tugways/cards/session-picker-cells.tsx`

**Tasks:**
- [ ] Lens: title from `sessionTitleParts`, description per [S02], activity per [S03], the 28px dot, and keep the tape and the `drift` jitter.
- [ ] Lens: stop rendering `usePulseOverview` as the middle line ([P06]); the description takes that row.
- [ ] Picker: the same three rows at the 16px dot, **no** tape ([P12]). Drop the separate `metadata` line — `formatSessionRowSubtitle`'s facts are the activity grammar's rest form now.
- [ ] Picker: keep the state-replaces-the-line rule for rows that are not simply resumable (live elsewhere, in use in a terminal, failed) — those rows have one thing to say and it is not their turn count.
- [ ] Picker: render a dot for every row now that a cardless session reads idle rather than danger ([P02]).
- [ ] Confirm the picker's cells stay pure render functions — `useSessionPhase` and `useSessionIdentity` are subscription reads, which the rule permits.

**Tests:**
- [ ] App-test: a Lens session row shows the title grammar, a description row, and an activity row; a named session's callsign is the run that truncates.
- [ ] App-test: a picker row for a closed session shows an idle (non-danger) dot and no tape.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 9: Banish user-facing `PULSE` ink {#step-9}

**Depends on:** #step-8

**Commit:** `tugdeck(session-identity): retire PULSE as user-facing ink`

**References:** [P07] `PULSE` is internal, (#success-criteria)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-pulse.tsx` — `HEADLINE_FALLBACK` removed
- `tugdeck/src/lib/__tests__/pulse-ink-gate.test.ts` — new grep gate

**Tasks:**
- [ ] Remove `HEADLINE_FALLBACK` and the branch that substitutes it; an absent headline now renders no run. Its height-holding job is obsolete because the three surfaces no longer render a headline level ([P06]).
- [ ] Rewrite the surrounding docstring, which explains the stand-in at length.
- [ ] Add the grep gate: walk `tugdeck/src/components/` and `tugdeck/src/lib/`, assert no user-facing `PULSE` literal, exempting gallery cards and non-ink identifiers (class names, store names, module names).
- [ ] Sweep for any remaining rendered `PULSE` the gate flags.

**Tests:**
- [ ] The grep gate itself.
- [ ] Existing `TugPulse` tests still pass with no headline supplied.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`

---

#### Step 10: Integration checkpoint {#step-10}

**Depends on:** #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [P01]–[P16], (#success-criteria)

**Tasks:**
- [ ] Walk every success criterion in [#success-criteria] against the running app and record the result.
- [ ] Confirm the five surfaces agree: masthead, Lens row, picker row, atom, and citation all name the same session the same way.
- [ ] Confirm no surface renders `PULSE`, no width control sits on a masthead pane, and no closed session shows a red dot.

**Tests:**
- [ ] The identity app-test suite (`at0373`–`at0381`) plus the surfaces touched here.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`
- [ ] `just build-app`
- [ ] `just app-test-changed` (a scoped selection — never the full corpus)

---

#### Step 11: Doctrine and gallery reconciliation {#step-11}

**Depends on:** #step-10

**Commit:** `tuglaws(session-identity): record the shipped identity scheme in D132`

**References:** [P01]–[P16], [Q01] deferred, [Q02] deferred, (#documentation-plan)

**Artifacts:**
- `tuglaws/design-decisions.md` — `[D132]` amended
- `roadmap/session-reference-plan.md` — shipped deltas
- `gallery-session-identity.tsx` / `.css` — retitled to record what shipped

**Tasks:**
- [ ] Amend `[D132]` per [#documentation-plan]: the dot as the mark, the title grammar and its truncation rule, the two-level stack, `PULSE` as internal, the `customName`/`description` split, the lifted freeze, and the turn-end freshness contract.
- [ ] Record the retirements so they are not re-proposed: the chatbox session icon, the three-level stack, the four-line row, the audition fits, the session-colored atom, red-for-idle, and the masthead width control.
- [ ] Update the gallery card's docstring from "proposed" to "shipped", and note the two deferred questions ([Q01], [Q02]) as the surviving open items.
- [ ] Record the deferred items in `roadmap/session-reference-plan.md`.

**Tests:**
- [ ] N/A (documentation).

**Checkpoint:**
- [ ] `cd tugdeck && bun test` (the grep gates still pass)
- [ ] `just app-test at0041-gallery-close-reopen.test.ts at0374-session-identity-tiers.test.ts`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Every surface that names a session leads with a live pulsing dot, puts the user's name before the callsign, and says what the session is doing in two lines — served by one resolver, one identity component, and one row shape.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] The masthead shows three rows with no width control and no `project/` prefix (app-test).
- [ ] `<name> : <callsign>` renders on all four graphical surfaces, and the callsign is the run that truncates (app-test + unit).
- [ ] No user-facing `PULSE` ink anywhere (grep gate).
- [ ] A closed or cardless session shows an idle dot, never a red one (unit + app-test).
- [ ] A renamed session still receives a rolling description (Rust test).
- [ ] The activity line reports a correct turn count and size immediately after a turn ends (Rust test).
- [ ] `SessionIdentity.title` no longer exists; `customName` and `description` are independent (`tsc` + unit).
- [ ] `[D132]` records the shipped scheme and its retirements.

**Acceptance tests:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test && bunx vite build`
- [ ] `just build-app && just app-test-changed`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [Q02] — align the Changes card's `session_row_title` with the new grammar.
- [ ] [Q01] — decide whether the atom's sidecar segment carries the short id.
- [ ] `/resume <tag>` resolving through the client cache while citations are ledger-authoritative — consider a tag arm on `resolve_sessions`.
- [ ] R05 — post-fork commits cite the parent session (`TUG_SESSION_ID` is not fork-aware).
- [ ] Retire the theme session-color tokens if nothing else adopts them after [P13].

| Checkpoint | Verification |
|------------|--------------|
| Rust freshness and freeze | `cd tugrust && cargo nextest run` |
| Resolver and grammar | `cd tugdeck && bun test` |
| Component and surfaces | `just app-test-changed` after `just build-app` |
| Whole-app health | `bunx tsc --noEmit && bunx vite build` |

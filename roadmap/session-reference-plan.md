<!-- devise-skeleton v4 -->

## Session Reference — one identity, one resolver, one component family {#session-reference}

**Purpose:** Make Tug refer to a session the same way everywhere: one structured identity record produced by one resolver, rendered by one component family (`TugSessionIdentity`) at declared density tiers, with a text-only citation form, a fork-lineage grammar, a rolling generated description (the synopsis), and the nine data-layer repairs the surfaces depend on.

This plan implements `roadmap/session-reference-brief.md` (design complete; every question there is decided). The visual reference is running code: the gallery spike card `tugdeck/src/components/tugways/cards/gallery-session-identity.tsx` / `.css` (Component Gallery ▸ Feedback ▸ "Session Identity"). Read both before implementing. Nothing in the spike's CSS is inherited by the app — it is scaffolding to be replaced by tokens, never copied.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tug names sessions in at least seven forms across at least fifteen surfaces, with five near-parallel precedence rules and no shared component. The audit is in the brief; the load-bearing facts, verified against the code as of this writing:

- **Five parallel precedence rules, no two identical:** `sessionChipDisplay` (orphaned since the Z4B diet), `sessionRowTitle`, `sessionEntryTitle` (a hash-equality sniff) — all in `tugdeck/src/lib/session-name.ts`; Rust `session_row_title` (no tag arm) and `session_display_name` in `tugrust/crates/tugcast/src/feeds/changeset.rs` (~line 724 / 755).
- **The title-string composer** is `sessionCardTitleOverride` in `tugdeck/src/lib/session-card-title.ts` — it appends a `(branch)` suffix off-`main` and is consumed by the Session card and the Lens (`cards-data-source.ts` `sessionLabel`).
- **The 8-char short id is computed independently in three places** (`session-name.ts` `SESSION_ID_TRUNCATE`, and twice in `changeset.rs`), never stored.
- **The tab strip shows the literal registry title "Session"** for a stacked Session card: `tug-tab-bar.tsx` gates its `cardTitleStore` consult on `tab.componentId === "text"` (~line 445).
- **The Gazette ref chip prints the full 36-char UUID**: `RefChip` in `tugdeck/src/components/gazette/gazette-card.tsx` labels via `target.split("/").pop()`, a no-op on a UUID.
- **Commit trailers are raw body ink**: `Tug-Session: <display> (<full-uuid>)` is written by `session_trailer()` (`tugrust/crates/tugdash-core/src/ops.rs` ~line 812) and by the changeset commit path fed from `changes-route-controller.ts` (~line 269), and the History card renders it unparsed. Only `Tug-Dash:` has a typed field (`GitLogCommit.tug_dash`, `tugrust/crates/tugcast-core/src/types.rs` ~line 193, parsed in `tugrust/crates/tugcast/src/feeds/git.rs` via `%(trailers:key=Tug-Dash,...)`).
- **External sessions fake a tag**: `deriveStableTag` (`session-tag.ts`) synthesizes a non-unique display tag, used by `session-picker-data-source.ts` and `session-picker-cells.tsx`.
- **Fork silently mints an unrelated fresh id**: the rewind-fork path in `tugcode/src/session.ts` (~line 7337) mints `crypto.randomUUID()` and the ledger row/tag stay behind on the old id.
- **Tag mint machinery**: client mint in `session-tag.ts` (`mintTag`, 512×1024 lexicon in `session-tag-lexicon.ts`), server claim-or-suffix in `tugrust/crates/tugcast/src/session_ledger.rs` (`record_spawn` ~line 2353, `tag_base` ~line 4909, `TAG_SUFFIX_CAP`); suffix exhaustion silently lands a NULL tag (~line 2412).

Root cause: [D123] ("a pane's name is one string produced in one place", `lib/pane-title.ts`) was never extended to session identity. This work is [D123] applied to the session.

#### Strategy {#strategy}

- **Data layer first.** The Rust repairs (tag arm, mint hardening, external backfill, live ai-title, fork lineage, trailers) unblock the client work and are independently landable.
- **Resolver before components.** `resolveSessionIdentity` consolidates the five rules and deletes them; every later step consumes it, so it lands before any pixel moves.
- **Component before surfaces.** `TugSessionIdentity` (chip/line tiers, then row, then masthead) ships with its tokens and the session color; surfaces then adopt tier by tier.
- **The masthead and the strip removal are one arc**: the masthead lands carrying the PULSE, then the Z2 strip comes out with every one of its owned behaviors re-homed in the same step range — never a window where the voice speaks in two places or in none.
- **The synopsis is last among features** — it rides existing `SharedAgent` infrastructure and only changes what the description *line* says; every surface renders correctly before it exists (honest empty line).
- **Doctrine closes the phase**: the D-number entry, the pane-model masthead amendment, and the lineage grammar are written once the shipped shapes are final.

#### Success Criteria (Measurable) {#success-criteria}

- `git grep -n "sessionChipDisplay\|sessionRowTitle\|sessionEntryTitle\|deriveStableTag"` in `tugdeck/src` returns no production call sites (tests of the resolver excepted). (Verify by grep.)
- Every surface in **Table T02** renders identity through `resolveSessionIdentity` + `TugSessionIdentity` (or `paneTitleBarTextFor` for pane chrome); no surface composes `project/tag` strings ad hoc. (Verify by grep for `"/" +`-style composition at the named sites and by the app-tests in each adoption step.)
- The tab strip shows `project/callsign` for a stacked Session card. (App-test.)
- The Gazette ref chip never shows a UUID. (App-test.)
- A commit made from the Changes card carries both `Tug-Session: <tag> (<shortid>)` and `Tug-Session-Id: <uuid>` trailers, the History card renders the citation chip beside the SHA, and neither trailer line appears in the rendered body. (Rust unit test + app-test.)
- A fork's tag is `<root>-<Letter><Number>`, recorded in the ledger, and the original session keeps its tag. (Rust unit test + tugcode test.)
- No mint path can land a NULL tag; the ledger's bare-`-N` suffix path is gone. (Rust unit tests.)
- `bun run audit:theme-contrast` passes with the session color present in all six themes.
- `cd tugrust && cargo nextest run` green; `bunx vite build` green; `just app-test-changed` green at each step.

#### Scope {#scope}

1. `resolveSessionIdentity` resolver; deletion of the five parallel rules.
2. `TugSessionIdentity` component family (chip / line / row / masthead tiers) and its tokens.
3. The session color role token, hand-authored in the six theme files.
4. `TugSessionRow` growth to the four-line identity stack; picker and Lens adoption.
5. The masthead tier in `TugPane`; `--tug-masthead-height`; the telemetry placard.
6. Removal of the Z2 `SessionPulseStrip` with every owned behavior re-homed.
7. The synopsis job on `SharedAgent`'s Summarize lane, with persistence and `/rename` precedence.
8. The citation flat-text form; commit-trailer write and read paths; History card rendering.
9. The session atom as a real Tug atom: clipboard flavors + wire marker.
10. Fork lineage grammar carried through spawn and ledger; mint hardening; external-session tag backfill; live `ai-title` capture; tag arm in the Rust feed.
11. `tag → session_id` resolution and `/resume <tag>`.
12. Adoption at every surface in Table T02.
13. The doctrine entry and companion tuglaws updates.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Phase 2 annotator pattern-matching** for citations in free prose. Deferred; prerequisites recorded in the brief (the commit-SHA detector hex collision — `detect-commit-sha.ts` matches 7–40 hex with a digit, so the session detector must claim the whole `<tag> (<hex>)` run first — and the History card sitting outside any `AnnotationScope`).
- **Mastheads for non-session cards.** The mechanism generalizes (structured `cardTitleStore` payload), but nothing else adopts it here.
- **The Z2 status row** (STATE / TIME / TOKENS / CONTEXT / WORK): content, layout, position, and tokens all stay exactly as they are. Removing the PULSE row beneath it is the only change in that region; any resulting seating difference against the prompt entry is corrected with spacing alone.
- **`/retag`** — the tag is immutable.
- Per-session tint — **retired, do not re-propose** (see [P05]).

#### Dependencies / Prerequisites {#dependencies}

- The gallery spike card (`gallery-session-identity.tsx` / `.css`, registered in `gallery-registrations.tsx`) — the visual reference; it stays alive through the work as the fixture bench.
- Existing components composed, never re-rolled: `CardTitleBar` / `TugPane` (`components/chrome/tug-pane.tsx`), `TugPulse` (`tug-pulse.tsx`, `layout="inline"`, `trailing` accessory, published knobs `--tugx-pulse-bar-height` / `--tugx-pulse-baseline`), `TugSessionRow` (`tug-session-row.tsx`, `inset` fit), `TugProgressIndicator` (`variant="pulsing-dot"` with `sessionSessionPhaseVisual`), `TugPlacard`, `TugLabel` (middle truncation), `TugCopyBadge`.
- `SharedAgent` (`tugrust/crates/tugcast/src/shared_agent.rs`): `JobClass::{Classify, Summarize}`, the headline register macro `headline_rules!` (~line 1288), `SUMMARIZE_INSTRUCTIONS`.
- Clipboard/atom machinery: `lib/tug-native-clipboard.ts` (`writeClipboardViaNative(text, atoms)`, `dev.tug.prompt-atoms` sidecar), `lib/atom-mention-marker.ts` (`wrapAtomMention`, `parseAtomMentionSegments`).
- Trailer machinery: `tugchanges_core::append_trailers` (`tugrust/crates/tugchanges-core/src/trailer.rs`).

#### Constraints {#constraints}

- Rust workspace: **warnings are errors** (`-D warnings`).
- `changes.db` schema changes require bumping `CHANGES_SCHEMA_VERSION` with a registered migration. `sessions.db` (per-instance) uses the self-healing `ALTER TABLE` pattern (`migrate_sessions_add_name_user_set`, `session_ledger.rs` ~line 2046) — follow it for new columns. Every writable ledger open goes through `tugcore::ledger_db` (`no_ad_hoc_ledger_opens` test).
- Tugdeck laws: [L02] external state via `useSyncExternalStore` only; [L06] appearance via CSS/DOM; [L19] `.tsx`/`.css` pairs with `data-slot`; [L20] token sovereignty — compose `TugPulse` through its published knobs, never reach inside. Read `tuglaws/tuglaws.md`, `tuglaws/pane-model.md`, `tuglaws/component-authoring.md` before tugdeck steps and name the laws in commits.
- Theme tokens are hand-authored in `tugdeck/styles/themes/{brio,nocturne,bravura,harmony,aria,vivace}.css`; validate with `bun run audit:theme-contrast` (no theme may exceed the `brio` budget).
- Verify tugdeck changes with `bunx vite build`; app-tests via `just app-test-changed` (`@covers` headers mandatory on new tests); Rust tests via `cd tugrust && cargo nextest run`.
- Never hand-roll UI that exists as a `Tug*` component; borrowing its CSS is still hand-rolling.
- tugcode is a compiled binary — rebuild it after `tugcode/src` changes; Rust changes need `just build-app` before app-tests exercise them.

#### Assumptions {#assumptions}

- The spike card's measured geometry (Table T01) is final; it was measured in the running app, not estimated.
- `--tug-masthead-height: 72px` is **RATIFIED** — fixed, never content-driven.
- The tag lexicon (`session-tag-lexicon.ts`) is large enough (512 × 1024); growth is opportunistic and out of scope.
- Legacy commits carrying the old one-line `Tug-Session: <display> (<full-uuid>)` trailer exist in history forever and must parse gracefully (Spec S03).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the devise-skeleton conventions (`tuglaws/devise-skeleton.md`): explicit `{#anchor}` headings everywhere a later citation lands (kebab-case, no phase numbers); stable two-digit labels — plan-local decisions `[P01]`, open questions `[Q01]`, specs `Spec S01`, tables `Table T01`, lists `List L01`, risks `Risk R01` — never reused (deletions leave gaps); `**Depends on:**` lines citing step anchors (`#step-N`); and `**References:**` lines on every execution step citing plan artifacts by label and anchor, never by line number. `[D##]` citations refer to the global `tuglaws/design-decisions.md`. File line numbers quoted in prose (e.g. "~line 2353") are investigation aids current as of the Last-updated date — locate by the named symbol, not the number.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Synopsis re-run trigger (DEFERRED to implementation tuning) {#q01-synopsis-trigger}

**Question:** What re-runs the synopsis — turn count, elapsed time, or a topic-shift signal?

**Why it matters:** Too eager burns Haiku calls and strobes the line; too lazy leaves a stale description, which is the exact failure the incipit was retired for.

**Options:** piggyback on the session-overview emit cadence (the PULSE headline's existing trigger, `EMIT_FLOOR` 8s floor in `feeds/session_overview.rs`) at a lower rate, e.g. every N completed turns; or a debounced turn-boundary trigger.

**Plan to resolve:** The brief deliberately leaves this to be tuned against real output. Step 15 starts from "on turn completion, debounced, no more than once per 60s" and tunes in-app. **Resolution: DEFERRED** into #step-15's checkpoint; the shipped constant gets a doc comment stating the tuning rationale.

#### [Q02] Where the synopsis persists (DECIDED here) {#q02-synopsis-persistence}

**Question:** Where does the synopsis survive reload without a re-run?

**Resolution: DECIDED** — a `synopsis TEXT` column on the `sessions` table in `sessions.db`, added by a self-healing `ALTER TABLE` migration (the `name_user_set` pattern). It rides `SessionRow` on the wire beside `name`/`tag`. Rationale: the description is per-session ledger state exactly like `name`; the client must never invent it; tugbank defaults are the wrong shape (they are per-user knobs, not per-session data). Recorded as [P07].

#### [Q03] Where the strip's focus stop lands (DECIDED here) {#q03-focus-stop}

**Question:** The Z2 strip's PULSE label registers a `useFocusable` leaf (`SESSION_CYCLE_ORDER_PULSE`) in the card's cycle. Chrome is the Pane's ([L09]), so a stop moving into the masthead crosses an ownership boundary.

**Resolution: DECIDED** — the stop is **retired**, not moved. The masthead's PULSE line is chrome and takes no card-cycle focus stop; the telemetry placard widget is the masthead's one interactive affordance and participates as pane-chrome control like the close button, not in the card's cycle. `SESSION_CYCLE_ORDER_PULSE` and its `CycleScope` registration are deleted with the strip — no dangling order entry. Recorded in [P09]. If review during #step-14 finds a real keyboard path lost, reopen there with the keyboard-focus-nav subsystem's owner (that subsystem is tabled; propose no new chords).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Masthead height breaks geometry math | high | med | one fixed token + mirrored JS constant + pane-scoped `--tugx-pane-chrome-height` re-pointing scrim/sheet/banner | any layout that measures chrome |
| Strip removal drops a pacing behavior | med | med | explicit re-home inventory (List L01) walked in #step-14 | a PULSE line that strobes or a dead compaction stretch |
| TS/Rust lexicon drift | med | low | generated Rust lexicon + drift test reading the TS source (Spec S05) | lexicon edits |
| Legacy trailer breaks History parse | med | high (legacy commits are everywhere) | Spec S03 legacy grammar; unit tests over both forms | any unparsed `Tug-Session` ink in History |
| Synopsis quality (labels, staleness) | med | med | reuse the PULSE headline register rules verbatim; `/rename` freeze | tuning in #step-15 |

**Risk R01: Masthead height regressions** {#r01-masthead-height}

- **Risk:** Surfaces that assume 36px chrome mis-measure a 72px masthead. The JS side is small — exactly two consumers of `CARD_TITLE_BAR_HEIGHT` (`tug-pane.tsx` ~line 87 and `TITLE_BAR_VISIBLE_MIN_Y` ~line 825). The real fan-out is the CSS token `--tug-chrome-height`, which positions everything below the title bar: the pane scrim (`tug-pane.css` ~line 610 — under a 72px masthead it would dim and deaden the masthead's bottom half, telemetry placard included, whenever a sheet is up), the sheet panel top (`tug-sheet.css` ~line 63 — the Changes sheet lives on the Session card), and the pane banner (`tug-pane-banner.css` ~line 59 — the Session card mounts `TugPaneBanner` via `session-card-banner-spec.ts`).
- **Mitigation:** `--tug-masthead-height` declared identically in all six themes; a `MASTHEAD_HEIGHT = 72` JS constant beside `CARD_TITLE_BAR_HEIGHT = 36` (`tug-pane.tsx` ~line 87); a pane-scoped `--tugx-pane-chrome-height` published on the `.tug-pane` element — `var(--tug-masthead-height)` when the masthead is up, `var(--tug-chrome-height)` otherwise — with scrim, sheet, and banner re-pointed to it in #step-13; the masthead never reflows (overflow truncates via `TugLabel`).
- **Residual risk:** app-tests with hard-coded chrome offsets on the Session card; fix as they surface via `just app-test-changed`.

**Risk R02: The strip owns more than a line of text** {#r02-strip-behaviors}

- **Risk:** The dwell queue, compaction pin, `pulse/enabled` behavior, sparkline pairing, and focus stop silently die with the strip.
- **Mitigation:** List L01 is the re-home inventory; #step-14's checkpoint walks it item by item; the dwell queue moves as code, not a rewrite.
- **Residual risk:** `TUG_SESSION_ROW_SPARK_WIDTH`/`_HEIGHT` docstrings reference the strip's constants — they must be re-pointed, not orphaned.

**Risk R03: History filter/regression on stripped bodies** {#r03-history-body}

- **Risk:** Stripping trailer lines from the displayed body changes what the History filter matches.
- **Mitigation:** strip only `Tug-Session:` / `Tug-Session-Id:` (and keep `Tug-Dash:` stripping consistent with them); the typed fields remain filterable server-side later; unit-test the stripper on bodies with interleaved trailers.
- **Residual risk:** none meaningful — the trailer text was never useful filter ink.

---

### Design Decisions {#design-decisions}

> These transcribe the brief's decision register into plan-local decisions so steps can cite them. Nothing here is open; the brief is the authority, and rejected alternatives marked *do not re-propose* there stay rejected.

#### [P01] Two registers, one identity (DECIDED) {#p01-two-registers}

**Decision:** Presence — a surface that *is* the session (masthead, picker row) renders the callsign as typography: chatbox icon (`MessageSquare`), bold sans, no enclosure. Citation — a surface that *refers* to a session from foreign context wraps the same identity in the session atom (a rounded pill). The title bar is never a citation.

**Rationale:** An enclosed chip reads as a link to the thing elsewhere; on a surface that is the thing, that reading is a lie.

**Implications:** `TugSessionIdentity` takes a register/tier, never a format; the phase dot is row furniture and never rides a citation.

#### [P02] One resolver, one structured record (DECIDED) {#p02-one-resolver}

**Decision:** `resolveSessionIdentity(sessionId) → { project, branch, tag, lineage, title, state, liveness }` grows from `session-card-title.ts`, absorbing and deleting `sessionChipDisplay`, `sessionRowTitle`, `sessionEntryTitle`, and the hash sniff. The Rust changeset feed grows a tag arm so the client never re-derives. No surface composes identity strings itself.

**Rationale:** [D123]'s `composePaneTitleBarText` proved consolidation before change; five parallel rules is the disease being cured.

**Implications:** `session-name.ts` shrinks to nothing or dies; consumers (picker cells, Lens cell/data source, Session card, Z4B remnants) re-point in one step.

#### [P03] Density tiers, not formats (DECIDED) {#p03-density-tiers}

**Decision:** Four tiers — **Chip** (atom; hover → full identity via `TugPlacard`; click → raise/open), **Line** (`project/callsign` + optional truncated title), **Row** (four-line identity stack), **Masthead** (top three lines in card chrome). Surfaces choose a tier.

**Implications:** Consumers per Table T02.

#### [P04] Callsign typography: one bold run (DECIDED) {#p04-callsign-run}

**Decision:** Always `<project>/<callsign>` as a single bold sans run — one face, one weight, one color, **one text node**. Never monospace in session chrome. The mark is the chatbox icon; the icon gap is one token (`--tugx-session-identity-icon-gap`), identical in both registers and at every tier.

**Rationale:** Two spans opened a gap after the slash and truncated independently (`tugto… syrupy-beam`); mono belongs to flat text only.

#### [P05] One theme-authored session color (DECIDED) {#p05-session-color}

**Decision:** A new role token, one hand-authored value per theme file, **seeded from the `agent` family** (the model's violet in `brio`). One color knob drives the atom's ground, border, ink, and icon by mixing toward transparent and toward the theme's text token. Per-session hashed tint is **retired — do not re-propose** (color is a semantic channel; a hashed hue reads as meaning while meaning nothing).

**Implications:** six theme edits + `bun run audit:theme-contrast`; the atom is a rounded pill, deliberately not the squared `TugBadge`.

#### [P06] The session atom is a real Tug atom (DECIDED) {#p06-real-atom}

**Decision:** Copying a session atom writes every clipboard flavor per Spec S06; pasting into a Tug surface re-materializes the atom; the `text/plain` flavor **is** the citation; the wire marker rides `atom-mention-marker.ts` unchanged in mechanism.

#### [P07] The description is a rolling synopsis (DECIDED) {#p07-synopsis}

**Decision:** The incipit is retired as the description source. A third job on `SharedAgent`'s Summarize lane composes a synopsis from recent turns and re-runs as work moves. Precedence: `/rename` wins and freezes the line; else synopsis; else honestly empty. Persistence per [Q02]: a `synopsis` column on `sessions`.

**Rationale:** A first prompt describes where a session *started*; the description must be current. The infrastructure (pooled Haiku worker, two latency lanes, recycle caps) already exists.

**Implications:** wording register reuses `headline_rules!` (`shared_agent.rs` ~line 1288); `ai-title` capture stays (the field is still consumed) but stops mattering for display.

#### [P08] The masthead is a fixed 72px second chrome tier (DECIDED) {#p08-masthead}

**Decision:** The Session card's chrome becomes a three-line masthead — `project/callsign` + pane controls; description; PULSE (inline) — with a trailing pulse/info widget opening a `TugPlacard` (state, turns, created/compacted stamps, branch, citation + copy). `--tug-masthead-height: 72px`, **ratified**, declared in all six themes, mirrored as a JS constant; overflow truncates; the masthead never reflows. Chrome remains the Pane's ([L09]/[L25]); `cardTitleStore`'s override keeps its string and gains a masthead sidecar (Spec S02); `TugPane` renders masthead density when the pane's **active** card publishes one, one-line bar otherwise — in a multi-tab pane the chrome follows the frontmost tab, swapping 36↔72 on tab switch ([P14]).

**Implications:** branch leaves identity — the `(branch)` title suffix retires; branch lives only in the placard. The load-control bar's "Session created …" line is an absorption candidate (placard).

#### [P09] The Z2 PULSE strip is removed, not duplicated (DECIDED) {#p09-strip-removal}

**Decision:** Once the masthead carries the PULSE, `SessionPulseStrip` (`session-pulse-strip.tsx` / `.css`, mounted at `session-card.tsx` ~line 4423) comes out. Everything it owns is re-homed or deliberately retired per List L01. The Z2 **status row is unchanged** — content, layout, position, tokens; spacing alone corrects its seat against the prompt entry. The focus stop is retired per [Q03].

#### [P10] The citation is the only flat-text form; commits carry two trailers (DECIDED) {#p10-citation}

**Decision:** `<tag> (<shortid8>)` (with project context when the context doesn't supply it) is the only sanctioned flat-text session reference and the only place monospace appears. Commits carry `Tug-Session:` (the citation, human) **and** `Tug-Session-Id:` (full tug session UUID, machine, never displayed). tugcast parses both server-side into typed `GitLogCommit` fields, following `tug_dash` exactly, and strips the trailer lines from the displayed body. Transcript export filenames become `tug-session-<tag>-<shortid>`. Annotator pattern-matching is deferred (Non-goals).

#### [P11] Fork lineage grammar (DECIDED) {#p11-lineage}

**Decision:** A fork's tag is `<root-tag>-<Letter><Number>`: letter = branch point (first rewind point forked from is `A`), number = sequence from that point; fork-of-fork extends (`stocky-pixie-A1-B2`). Storage: the fork records its root tag + lineage segments; display derives via the resolver. The ledger's bare-`-N` collision suffix **retires** — on tag-unique violation the server rerolls a fresh tag against the whole ledger; `-<Letter><Number>` becomes the only sanctioned suffix. The fork spawn threads the lineage tag; no more silent fresh mint.

#### [P12] Tag space and immutability (DECIDED) {#p12-tag-space}

**Decision:** Two words, keep the lexicon; grow opportunistically, never structurally. **Never recycle a tag** — uniqueness holds against every row ever held, including trashed. No `/retag`. External sessions get real minted tags backfilled at scan time; `deriveStableTag` retires from production. The deferred `tag → session_id` resolver and `/resume <tag>` land as part of this work.

#### [P13] The unresolvable citation (DECIDED) {#p13-unresolvable}

**Decision:** The atom keeps its shape, slashes its icon (`MessageSquareOff`), drops the session color for muted ink, takes a dashed border, and is fully inert (no navigation, no hover placard). Tooltip: *Session not found*. Liveness is never a property of a reference — sessions are never dead.

#### [P14] The masthead follows the frontmost tab (DECIDED) {#p14-masthead-active-tab}

**Decision:** In a multi-tab pane, the pane wears the masthead exactly when its **active** card publishes the sidecar — the chrome swaps 36↔72 on tab switch and the content region reflows with it. A stacked Session card behind another tab contributes nothing to the chrome; its identity still reads on the tab strip (Line tier) and in the slot-stack picker.

**Rationale:** The masthead is the identity of the card you are looking at, not of the pane; a pinned 72px chrome over a Text tab would caption one card with another card's identity.

**Implications:** the height swap is a real geometry event — `--tugx-pane-chrome-height` (Risk R01) changes with the active tab; the #step-13 app-test covers the switch both ways.

---

### Deep Dives {#deep-dives}

#### The strip re-home inventory {#strip-inventory}

**List L01: What `SessionPulseStrip` owns and where each piece lands** {#l01-strip-inventory}

Verified against `tugdeck/src/components/tugways/cards/session-pulse-strip.tsx`:

1. **Dwell queue** (`MIN_DWELL_MS = 1_800`, `lastSwapAtRef` coalescing; user submit clears immediately) → moves as code into the masthead's PULSE feeding logic. This pacing makes the voice readable; it must not be reimplemented.
2. **Compaction pin** (`Compacting context…` held for a `/compact` from this card, fed by `compactionProgressStore`, an app-wide singleton) → moves with the PULSE line.
3. **`pulse/enabled` tugbank default** — strip hides entirely when off. In the masthead, hidden must not collapse chrome: the masthead keeps its 72px and the PULSE line is simply absent.
4. **Activity sparkline** (`TugSparkline` on the trailing edge) → rides `TugPulse`'s `trailing` accessory in the masthead. `TUG_SESSION_ROW_SPARK_WIDTH` / `_HEIGHT` in `tug-session-row.tsx` are documented as deliberately matching the strip's numbers; when the strip's constants move or die, that pairing and its docstring are updated, never silently orphaned.
5. **Focus stop** (`useFocusable` leaf, `SESSION_CYCLE_ORDER_PULSE` inside the card's `CycleScope`) → **retired** per [Q03]; the cycle order entry is deleted, leaving no dangling order.

#### Trailer read path today, and the change {#trailer-read-path}

`feeds/git.rs` builds `git log` with `--format=%H%x1f…%x1f%(trailers:key=Tug-Dash,valueonly,separator=%x1e)%x1f%b` and splits on `%x1f` (record parse ~line 438; `tug_dash` extracted at field 8). The change appends two more `%(trailers:key=…)` fields for `Tug-Session` and `Tug-Session-Id` (each `%x1e`-joined when repeated; keep the first), populates `GitLogCommit.tug_session` / `tug_session_id`, and strips all `Tug-Session:` / `Tug-Session-Id:` lines from the `%b` body before it ships. Note `%b` retains trailer lines — git does not remove them — which is exactly why the History card shows raw trailer ink today.

#### Trailer write paths today, and the change {#trailer-write-path}

Two writers, one grammar:

- **Dash lane:** `session_trailer()` in `tugdash-core/src/ops.rs` reads `sessions.db` read-only via `TUG_SESSION_ID` and currently emits `<display> (<full-uuid>)`. It changes to `SELECT tag FROM sessions …`, emits the citation `<tag> (<shortid8>)` (the name never appears in the trailer — the tag is the callsign; a legacy tagless row degrades to the bare `<shortid8>` per Spec S03), and the caller `with_dash_trailers` pushes both `("Tug-Session", citation)` and `("Tug-Session-Id", full_id)` through `tugchanges_core::append_trailers`.
- **Main lane:** `changes-route-controller.ts` (~line 269) carries `{ name, id }` from the CHANGESET entry into `getChangesetVerbStore().commit(...)`; the Rust changeset-commit handler appends the trailer. The payload changes to carry the tag (available after the feed's tag arm, #step-1), and the Rust side emits the same two trailers.

#### The masthead in the pane {#masthead-in-pane}

`TugPane` consults `cardTitleStore` for the active card's override (`tug-pane.tsx` ~line 1371) and composes via `lib/pane-title.ts` (`composePaneTitleBarText` / `paneTitleBarTextFor`, [D123]/[D125]). The evolution: the string stays and the masthead rides beside it as a sidecar (Spec S02) — the card's re-`set` on every identity change is what keeps every list consumer notified. `paneTitleBarTextFor` keeps returning the one-line string for every list surface (tab strip, Window menu, slot-stack picker — the **Line** tier is exactly this string) with no change at all, while `TugPane` renders masthead chrome when the active card carries the sidecar ([P14]: the chrome follows the frontmost tab). The pane owns the masthead DOM (chrome is the Pane's); the card publishes only data. The JS audit is the two `CARD_TITLE_BAR_HEIGHT` consumers (`TITLE_BAR_VISIBLE_MIN_Y` ~line 825 plus grep); the CSS audit is `--tug-chrome-height`'s consumers per Risk R01 (scrim, sheet, banner).

#### Tag mint hardening {#tag-mint-hardening}

`record_spawn`'s claim-or-suffix (~line 2353): on `sessions_tag` unique violation it suffixes `-2`, `-3`… up to `TAG_SUFFIX_CAP`, then lands NULL silently (~line 2412). The change: on violation, reroll a complete fresh `adjective-noun` from a Rust copy of the lexicon (Spec S05), retry against the ledger (bounded attempts, then extend with more rerolls — never NULL, never a bare `-N`). `tag_base` (~line 4909) and `is_tag_unique_violation` survive only as far as the reroll loop needs them; the `-N`-stripping semantics retire. Lineage suffixes (`-A1`) must pass the mint untouched — the reroll never fires for them because a lineage tag is minted unique by construction (root tag unique + point/sequence allocated from the ledger's own lineage rows).

---

### Specification {#specification}

**Spec S01: `resolveSessionIdentity`** {#s01-resolver}

New module `tugdeck/src/lib/session-identity.ts` (grown from `session-card-title.ts`, which it absorbs):

```ts
export interface SessionIdentity {
  /** Project leaf name (basename of projectDir). */
  project: string;
  /** Workspace branch, or null — telemetry only, never rendered in identity. */
  branch: string | null;
  /** The callsign, including any lineage suffix; null only for a legacy tagless row. */
  tag: string | null;
  /** Parsed lineage segments, e.g. ["A1","B2"]; empty for a root session. */
  lineage: readonly string[];
  /** The description: /rename name if user-set, else synopsis, else null. */
  title: string | null;
  /** Ledger state: "live" | "closed" | "failed". */
  state: SessionRow["state"] | null;
  /** Phase for the row dot (from the session phase store); null off-row. */
  liveness: string | null;
  /** Full tug session id (plumbing: tooltips, copy affordance). */
  id: string;
  /** First 8 chars of id — THE short id; computed here and nowhere else. */
  shortId: string;
}
export function resolveSessionIdentity(sessionId: string): SessionIdentity;
/** The Line-tier / pane-title string: `<project>/<tag>` (no branch suffix — [P08]). */
export function sessionIdentityLine(identity: SessionIdentity): string;
/** The citation: `<tag> (<shortId>)`, optionally project-prefixed. */
export function sessionCitation(identity: SessionIdentity, opts?: { project?: boolean }): string;
```

Reads `sessionNameStore`, `sessionTagStore`, the synopsis (rides `SessionRow`, cached in a small store per [L02]), and the card-binding project dir. Pure formatting helpers are exported separately for unit tests. Fallback rule everywhere: tag; a legacy tagless session degrades to `shortId` — never the full UUID.

**Spec S02: `TugSessionIdentity` and the masthead payload** {#s02-component}

New pair `tugdeck/src/components/tugways/tug-session-identity.tsx` / `.css` ([L19], `data-slot`):

- `tier: "chip" | "line" | "row" | "masthead"`; `register` is implied (chip = citation; the rest = presence).
- Chip: the session atom — rounded pill, session color, `MessageSquare` icon, `<project>/<tag>` one bold run; `missing` prop per [P13]; hover placard (full identity + citation + copy via `TugCopyBadge`); click raises/opens via the caller's intent. Sizes `sm` / `2xs`.
- Line: icon + one bold run, no enclosure.
- Row/Masthead: the identity stack (callsign; description; `TugPulse layout="inline"`; row adds metadata line) with geometry per Table T01. Composes `TugSessionRow`, `TugProgressIndicator`, `TugPulse` through published knobs only ([L20]).
- Owned tokens (`--tugx-session-identity-*`): `icon-gap`, `lead-gap: 5px`, `line-gap: 1px`, `row-dot-size: 16px`, `row-indent: 10px`, `row-pad: 12px`; CSS knob defaults live as `var(--x, default)` fallbacks at point of use.
- `cardTitleStore` evolution: the card **keeps publishing the resolved Line string** — `version()` bumps only on `set`/`clear`, so a never-changing key would sever the notification contract every list consumer rides (a rename/synopsis/tag change would notify the identity stores and leave `deck-canvas.tsx` ~315, `host-menu-state.ts` ~1016, `tug-pane.tsx` ~1378, and `tug-tab-bar.tsx` ~198 stale; the tab bar's `overrideKey` string join would also stop discriminating on an object). The masthead rides as a **sidecar**: `set(cardId, title: string, masthead?: SessionMastheadPayload)` with `SessionMastheadPayload = { kind: "session-masthead"; sessionId: string }`; `get()` stays `string | null` (no reader changes anywhere) and a new `getMasthead(cardId)` serves the pane. The Session card re-`set`s on every identity change exactly as today, which is what keeps the store self-notifying; the pane still resolves display data via the resolver at render, so the sidecar stays a key, not a snapshot.

**Spec S03: Citation and trailer grammar** {#s03-citation-grammar}

- Citation: `<tag> (<shortid8>)`; project-prefixed `<project>/<tag> (<shortid8>)` when context doesn't supply the project. `shortid8` = first 8 chars of the tug session UUID.
- Tagless fallback (legacy rows only): the citation degrades to `<shortid8>` alone — no parentheses (a doubled hash is noise).
- Trailers written on every Tug commit (both lanes):

```
Tug-Session: stocky-pixie (f6e43925)
Tug-Session-Id: f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f
```

- `GitLogCommit` gains `tug_session: Option<String>` (raw citation value) and `tug_session_id: Option<String>`; both `#[serde(default, skip_serializing_if…)]` like `tug_dash`. Body ships with all `Tug-Session*` trailer lines stripped.
- Resolution precedence for display: `tug_session_id` (full UUID, exact ledger join) → parse `tug_session`'s parenthesized token (36-char = legacy full UUID; 8-hex = short id, matched by prefix against the ledger) → unresolvable ([P13]). Legacy one-line trailers (`<display> (<full-uuid>)`) therefore resolve exactly.
- Transcript export filename: `tug-session-<tag>-<shortid>`.

**Spec S04: The session color and masthead tokens (six themes)** {#s04-tokens}

Each of `brio,nocturne,bravura,harmony,aria,vivace`.css gains, hand-authored beside the existing role declarations: the session role value seeded from that theme's `agent` family (in `brio`: the violet of `--tug7-*-agent-rest`), exposed at whatever layer the theme's role tokens use so `TugSessionIdentity` can derive ground/border/ink/icon from the one knob via `color-mix` toward transparent and toward the theme text token; and `--tug-masthead-height: 72px` beside `--tug-chrome-height: 36px`. Contrast: `bun run audit:theme-contrast` must pass in all six.

**Spec S05: Lineage storage and the Rust lexicon** {#s05-lineage-storage}

- `sessions` table gains (self-healing ALTERs): `root_tag TEXT` (the lineage root's tag; NULL for a root session) and `lineage TEXT` (dash-joined segments, e.g. `A1-B2`; NULL for a root). The display tag column keeps the full composed tag (`stocky-pixie-A1-B2`) so existing tag-unique indexing and lookups are unchanged; `root_tag`+`lineage` are the structured record the resolver and future tooling read.
- Fork allocation: the branch-point letter is allocated per (root session, rewind point) — first point forked from is `A`, next distinct point `B`; the number sequences forks from that point. The ledger owns allocation (a query over the root's existing fork rows) so two racing forks cannot collide.
- Rust lexicon: `tugrust/crates/tugcast/src/session_tag_lexicon.rs` generated from `tugdeck/src/lib/session-tag-lexicon.ts` by a `just` recipe (checked in, regenerated on lexicon edits); a Rust unit test reads the TS file from the repo at test time and asserts the two lists match — drift fails the build.

**Spec S06: Clipboard flavors** {#s06-clipboard}

| Flavor | Payload |
|---|---|
| `dev.tug.prompt-atoms` | `{"kind":"session","tag":"tugtool/syrupy-beam","id":"f6e43925"}` |
| `text/plain` | `tugtool/syrupy-beam (f6e43925)` — the citation |
| `text/html` | `<span data-tug-session="f6e43925">tugtool/syrupy-beam</span>` |
| wire marker | `` `@tugtool/syrupy-beam` `` via `wrapAtomMention` |

Written through `writeClipboardViaNative(text, atoms)`; paste re-materialization and replay re-mint ride `parseAtomMentionSegments` — the session atom **joins** the existing system, no parallel one.

**Spec S07: The synopsis job** {#s07-synopsis-job}

- A third job on `JobClass::Summarize` in `shared_agent.rs`, prompt built like `SUMMARIZE_INSTRUCTIONS` but for a standing description rather than a moving headline; register rules from `headline_rules!` apply verbatim (*"a headline with no verb is a label, and a label is a failure"* — the synopsis wants the same discipline in a descriptive register).
- Input: the session's recent turns (the session-overview digest machinery in `feeds/session_overview.rs` is the precedent for composing it).
- Output: written to `sessions.synopsis`, broadcast on the existing `session_updated` push so `SessionRow.synopsis` reaches the client.
- Precedence enforced at write: a row with `name_user_set = 1` never runs the job (frozen); the client resolver prefers `name` when `name_user_set`, else `synopsis`, else empty.
- Trigger: [Q01] — start "on turn completion, debounced ≥60s", tune in #step-15.

**Table T01: Stack geometry (measured on the spike, ships as tokens)** {#t01-geometry}

| | value | note |
|---|---|---|
| lead gap (callsign → description) | 5px | `--tugx-session-identity-lead-gap` |
| line gap (lower three lines) | 1px | `--tugx-session-identity-line-gap` |
| line-height, all stack lines | `--tug-line-height-tight` | **explicit, never inherited** — inherited ~1.45 body leading puts a 13px run in a 19px box; margin cannot take that back |
| `--tugx-pulse-bar-height` in the stack | 18px (default 34px) | move `--tugx-pulse-baseline` to 13px with it — baseline is stated from the bar's top; shrinking one without the other clips descenders ([L20]: published knobs only) |
| row dot | 16px ring box | overhangs left by its own inset so the **dot** lands on the row margin (dot paints at 60% of box); overhangs block-wise into padding so it doesn't set line height — `TugSessionRow`'s `inset` fit, smaller |
| row sub-line indent | 10px | |
| row block padding | 12px | block padding and leading are opposite jobs — tight leading makes four lines one entry; padding stands the block off the rules |
| row height, four lines | 93px | 69px content in 24px padding |
| `--tug-masthead-height` | **72px, RATIFIED** | fixed; JS mirrors as a constant |

**Table T02: Surface adoption map** {#t02-surfaces}

| Surface | Today | Becomes | Tier |
|---|---|---|---|
| Session card title bar | `sessionCardTitleOverride` string incl. `(branch)` | masthead payload | Masthead |
| Tab strip (`tug-tab-bar.tsx` `TabView`) | literal "Session" (override gated `componentId === "text"`) | `paneTitleBarTextFor` for every card | Line |
| Slot-stack picker / Window menu | [D123] pane title (already correct once the override drops `(branch)`) | unchanged path, new string | Line |
| Picker rows (`session-picker-cells.tsx`) | incipit-first `TugListRow`, tag buried, `deriveStableTag` | four-line stack on grown `TugSessionRow` | Row |
| Lens Sessions group (`cards-session-cell.tsx`, `cards-data-source.ts`) | `sessionLabel` string; filter projection passes `branch: null` while the row passes real branch | resolver + row/line rendering; the branch inconsistency dies with branch-in-identity | Row |
| Gazette refs (`gazette-card.tsx` `RefChip`) | full 36-char UUID | session case → chip | Chip |
| Changes card orphan hint (+ bucket headers where useful) | `prior_owner_name` feed string, no identifier | chip | Chip |
| History card commit line (`tug-history-list.tsx`) | trailer as raw body ink (truncated incipit + full UUID) | citation chip beside SHA + dash badge; trailers stripped from body | Chip |
| Telemetry placard | — (new) | branch, stamps, citation + copy | — |

#### State Zone Mapping {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| synopsis text | external (ledger) | rides `SessionRow` → small `sessionSynopsisStore` (clone of `session-name-store.ts`), `useSyncExternalStore` | [L02] |
| masthead payload | structure (pane/card channel) | `cardTitleStore` string + masthead sidecar; the card's re-`set` on identity change keeps `version()` firing | [L02], [L24] |
| atom hover placard open | appearance | `TugPlacard`'s own mechanism (existing component) | [L06] |
| phase dot pulse | appearance | CSS animation via `TugProgressIndicator` (existing) | [L06], [L13] |
| PULSE dwell queue | local-data (timers) | refs + timers inside the masthead PULSE feeder (as in the strip today) | [L22] |
| tag → id reverse map | external | grows on `sessionTagStore` (documented follow-on in its header) | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/session-identity.ts` | Spec S01 resolver + citation/line helpers (absorbs `session-card-title.ts`) |
| `tugdeck/src/lib/__tests__/session-identity.test.ts` | resolver unit tests |
| `tugdeck/src/lib/session-synopsis-store.ts` | [L02] store for `SessionRow.synopsis` |
| `tugdeck/src/components/tugways/tug-session-identity.tsx` / `.css` | Spec S02 component family |
| `tugrust/crates/tugcast/src/session_tag_lexicon.rs` | generated Rust lexicon (Spec S05) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `resolveSessionIdentity`, `sessionIdentityLine`, `sessionCitation` | fn | `session-identity.ts` | Spec S01 |
| `TugSessionIdentity` | component | `tug-session-identity.tsx` | Spec S02 |
| `SessionMastheadPayload` | type | `card-title-store.ts` | Spec S02 — sidecar beside the string; `getMasthead(cardId)` |
| `cardTitleTextFor` | fn | `lib/pane-title.ts` | per-tab label for the tab strip (#step-16) |
| `MASTHEAD_HEIGHT` | const | `tug-pane.tsx` | mirrors `--tug-masthead-height` |
| `--tugx-pane-chrome-height` | CSS property | `tug-pane.css` (+ scrim/sheet/banner re-points) | Risk R01, [P14] |
| `SessionRow.synopsis` | field | `tugdeck/src/protocol.ts` + Rust `SessionRow` | lockstep comment like `tag` |
| `GitLogCommit.tug_session`, `.tug_session_id` | fields | `tugcast-core/src/types.rs` | Spec S03 |
| `session_row_title` | fn | `feeds/changeset.rs` | gains tag arm (#step-1) |
| `record_spawn` reroll | fn | `session_ledger.rs` | Spec S05 / [P11] |
| `sessions.root_tag`, `sessions.lineage`, `sessions.synopsis` | columns | `session_ledger.rs` | self-healing ALTERs |
| `session_trailer` | fn | `tugdash-core/src/ops.rs` | citation + id pair |
| deleted: `sessionChipDisplay`, `sessionRowTitle`, `sessionEntryTitle`, `deriveStableTag` (production), `sessionCardTitleOverride`, `SessionPulseStrip`, `SESSION_CYCLE_ORDER_PULSE` | — | various | [P02], [P09], [P12] |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (bun test)** | pure resolver/citation/lineage string logic | `session-identity.test.ts`, marker/clipboard parsing |
| **Unit (cargo nextest)** | mint reroll, lineage allocation, trailer write/parse/strip, synopsis precedence, lexicon drift | all Rust steps |
| **App-test (selective)** | real surfaces on the real app: masthead, picker rows, tab strip, Gazette chip, History line, strip removal | every tugdeck step; `just app-test-changed` via `@covers` |
| **Contract** | TS↔Rust lockstep: `SessionRow` fields, lexicon drift test | #step-2, #step-15 |

#### What stays out of tests {#test-non-goals}

- Synopsis wording quality — tuned by eye against real output ([Q01]); the register rules are enforced by the existing grounding code, not new tests.
- jsdom render tests / mock stores — banned pattern; surfaces are covered by app-tests on the real app.
- Sparkline pixel output — covered by existing at0205 pinning; only the constant-pairing docstring moves.
- Full app-test sweeps — selection is derived (`@covers`); core tier only if a change lands in pre-assertion harness files.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Every step. Rust steps: `cd tugrust && cargo nextest run` and a `just build-app` before any dependent app-test. Tugdeck steps: `bunx vite build` before declaring done.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Tag arm in the Rust changeset feed | pending | — |
| #step-2 | Mint hardening: reroll, no NULL, no bare `-N` | pending | — |
| #step-3 | External-session tag backfill at scan time | pending | — |
| #step-4 | Live `ai-title` capture | pending | — |
| #step-5 | Fork carries lineage | pending | — |
| #step-6 | Trailer writers: citation + machine id | pending | — |
| #step-7 | Trailer read: typed fields, stripped body | pending | — |
| #step-8 | Session color + masthead height tokens (six themes) | pending | — |
| #step-9 | `resolveSessionIdentity` and the great deletion | pending | — |
| #step-10 | `TugSessionIdentity`: chip + line tiers | pending | — |
| #step-11 | The atom on the clipboard | pending | — |
| #step-12 | Row tier: `TugSessionRow` grows; picker + Lens adopt | pending | — |
| #step-13 | The masthead | pending | — |
| #step-14 | Z2 strip removal and re-homing | pending | — |
| #step-15 | The synopsis | pending | — |
| #step-16 | Citation surfaces: tab strip, Gazette, Changes, History | pending | — |
| #step-17 | `tag → session_id` and `/resume <tag>` | pending | — |
| #step-18 | Doctrine | pending | — |
| #step-19 | Integration checkpoint | pending | — |

#### Step 1: Tag arm in the Rust changeset feed {#step-1}

**Commit:** `tugcast(session-identity): carry the tag through the changeset feed's naming`

**References:** [P02] One resolver, (#context, #trailer-write-path), Table T02

**Artifacts:** `session_row_title` and `session_display_name` in `tugrust/crates/tugcast/src/feeds/changeset.rs` gain the tag arm; `prior_owner_name` and `display_name` speak tag before short id.

**Tasks:**
- [ ] `session_row_title(row)` precedence becomes: user-set `name` → `tag` → last-prompt snippet → 8-char id. (Note today's rule takes *any* `name` including auto ai-title; per the brief the callsign leads — only a user-set name outranks the tag. Check `name_user_set` on `SessionRow`.)
- [ ] `session_display_name(pfe)` gains the tag between user-set name and the id hash; plumb `owner_tag` onto `ProjectFileEvent` from the ledger join (the pattern of `owner_name` / `owner_name_user_set`, `session_ledger.rs` ~line 651).
- [ ] Extend the changeset feed's wire shape (`display_name` consumers) release notes in doc comments; the client hash sniff (`sessionEntryTitle`) is deleted later in #step-9 — do not break its equality detection in the interim (the fallback hash for a tagless row must remain exactly `id[..8]`). Verified benign: with the tag arm, a tagged row's `display_name` no longer equals the hash, so the sniff returns the real name/tag either way; a legacy tagless row still hits the hash path exactly — the interim needs no client change.

**Tests:**
- [ ] Rust unit tests: tagged row → tag; user-named row → name; tagless legacy row → today's exact fallbacks.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 2: Mint hardening — reroll, no NULL, no bare `-N` {#step-2}

**Commit:** `tugcast(session-identity): retire the -N suffix backstop for a full mint reroll`

**References:** [P11] Fork lineage, [P12] Tag space, Spec S05, (#tag-mint-hardening)

**Artifacts:** generated `session_tag_lexicon.rs` + `just` recipe + drift test; `record_spawn`'s collision path rerolls; NULL-tag landing removed.

**Tasks:**
- [ ] Add the `just` recipe generating `tugrust/crates/tugcast/src/session_tag_lexicon.rs` from `tugdeck/src/lib/session-tag-lexicon.ts`; check in the output.
- [ ] Drift test: read the TS lexicon from the repo at test time; assert list equality.
- [ ] Rework the claim-or-suffix loop (`session_ledger.rs` ~line 2353): on `sessions_tag` unique violation, reroll a fresh `adjective-noun` (seeded RNG acceptable, must exclude nothing — the unique index is the arbiter) and retry; bound attempts generously (e.g. 64) and on exhaustion return an error rather than landing NULL — with 524k combinations this is unreachable in practice.
- [ ] Retire `tag_base` `-N` semantics and the `TAG_SUFFIX_CAP` NULL fallback; update the `[P03]/Spec S02` doc comments that describe them.
- [ ] Lineage-suffixed tags (`-A1`, `-A1-B2`) pass through the mint untouched (they arrive pre-composed from the fork path, #step-5).
- [ ] A candidate carrying lineage segments **never rerolls** — a reroll would write an unrelated `adjective-noun` into `tag` while `root_tag`/`lineage` still name the lineage, a silent contradiction the resolver would render. On a unique violation for a lineage-suffixed candidate, return an error (the fork path re-allocates the segment instead, #step-5); "unreachable by construction" is an argument, not a guard.

**Tests:**
- [ ] Reroll on collision lands a different valid tag (deterministic RNG injection).
- [ ] Existing suffix tests (`record_spawn_suffixes_a_taken_tag`, `record_spawn_suffixes_a_backfill_that_collides`, ~line 5256/5329) rewritten to the reroll contract.
- [ ] No path lands `tag = NULL` for a fresh spawn.
- [ ] Negative: a colliding lineage-suffixed candidate errors rather than rerolling.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 3: External-session tag backfill at scan time {#step-3}

**Depends on:** #step-2

**Commit:** `tugcast(session-identity): mint real tags for external sessions at scan time`

**References:** [P12] Tag space, (#context)

**Artifacts:** `scan_external_sessions` (`external_sessions.rs` ~line 1123) mints and persists a real tag for each discovered session lacking one.

**Tasks:**
- [ ] At scan/adoption, for an external row with no ledger tag: mint via the Rust lexicon + ledger uniqueness (the #step-2 machinery) and persist, so the tag is stable ever after and unique like any other.
- [ ] Remove the `deriveStableTag` fallbacks in `session-picker-data-source.ts` (~line 95) and `session-picker-cells.tsx` (~line 210); rows now always carry a real tag after first scan. `deriveStableTag` itself (and its remaining test usage) dies in #step-9's deletion pass.

**Tests:**
- [ ] Rust: a scan over a fixture JSONL dir lands unique persisted tags; a rescan does not re-mint.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`
- [ ] `just build-app`, then `just app-test-changed` (picker rows show minted tags for external sessions)

---

#### Step 4: Live `ai-title` capture {#step-4}

**Depends on:** #step-1

**Commit:** `tugcode(session-identity): forward ai-title records into the ledger live`

**References:** [P07] Synopsis (the field is still consumed), (#context)

**Artifacts:** the bridge forwards `ai-title` stream records to tugcast as they arrive; the ledger updates `sessions.name` (with `name_user_set = 0`) without waiting for an external scan.

**Tasks:**
- [ ] In tugcode's stream-json handling (`tugcode/src/session.ts`), recognize the `ai-title` record (`aiTitle` field — the shape the external scan already parses at `external_sessions.rs` ~line 927) and forward it over the existing tugcode→tugcast session-metadata path (locate the path `/rename` uses; reuse it with `user_set: false`).
- [ ] tugcast ledger write: update `name` only when `name_user_set = 0` (never clobber a `/rename`); broadcast `session_updated`.
- [ ] Rebuild the tugcode binary.

**Tests:**
- [ ] Rust: ledger update respects `name_user_set`.
- [ ] tugcode test (existing harness style): an `ai-title` record in the stream produces the forward.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` and tugcode's test suite

---

#### Step 5: Fork carries lineage {#step-5}

**Depends on:** #step-2

**Commit:** `tugcode+tugcast(session-identity): fork threads a lineage-suffixed tag through the spawn`

**References:** [P11] Fork lineage, Spec S05, (#context)

**Artifacts:** the rewind-fork path threads `<root>-<Letter><Number>`; ledger records `root_tag` + `lineage`; the original session keeps its row and tag.

**Tasks:**
- [ ] Self-healing ALTERs for `sessions.root_tag` / `sessions.lineage` (`migrate_sessions_add_name_user_set` pattern).
- [ ] Ledger allocation API: given the root session id and the rewind point (identify a point by the truncation position/message id the fork used), return the next `<Letter><Number>` — letter per distinct point, number sequencing within it — from the root's existing fork rows.
- [ ] tugcode rewind-fork (`session.ts` ~line 7337): after minting `newId`, request the lineage tag from tugcast (or send the fork metadata with the rebind it already performs — "tell tugcast so the card→session binding is rebound + persisted") so `record_spawn` for the fork carries the composed tag + lineage fields instead of minting fresh.
- [ ] Resolver-side lineage parsing lands in #step-9 (display derives from `tag`; `lineage` segments ride `SessionRow` — add the fields to `tugdeck/src/protocol.ts` in lockstep now, defaulted null).

**Tests:**
- [ ] Rust: two forks from one point → `A1`, `A2`; a fork from a second point → `B1`; fork-of-fork → `A1-B2`; racing allocations cannot collide (ledger-serialized).
- [ ] A forced lineage-tag collision re-allocates the segment; `tag` never contradicts `root_tag`+`lineage` (#step-2's guard).
- [ ] tugcode: fork rebind carries the lineage tag; original row untouched.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` and tugcode tests

---

#### Step 6: Trailer writers — citation + machine id {#step-6}

**Depends on:** #step-1

**Commit:** `tugdash-core+tugcast(session-identity): commits carry the citation and the machine id trailer`

**References:** [P10] Citation, Spec S03, (#trailer-write-path)

**Artifacts:** both commit lanes emit `Tug-Session: <tag> (<shortid8>)` + `Tug-Session-Id: <uuid>`.

**Tasks:**
- [ ] `session_trailer()` (`tugdash-core/src/ops.rs` ~line 812): select `tag` (and `name` only for the tagless fallback); return the citation per Spec S03; add a sibling returning the full id; `with_dash_trailers` (~line 844) pushes both.
- [ ] Main lane: the trailer is appended in `feeds/agent_supervisor.rs` (~line 1592, `append_trailers` over `("Tug-Session", "<name> (<id>)")`; the wire fields land at ~line 1428) — **not** in a changeset-commit handler. It emits the same pair; the client payload (`changeset-verb-store.ts` ~line 539, fed from `changes-route-controller.ts` ~line 269) carries `tag` alongside `{ name, id }` (available since #step-1).
- [ ] `tugchanges_core::append_trailers` idempotency: confirm a re-draft doesn't duplicate either line (existing behavior; add the second key to its tests).

**Tests:**
- [ ] Rust: trailer pair content on both lanes; tagless legacy fallback; no-session-env omits both (existing `no session env` test extended).
- [ ] The old-grammar fixtures in `feeds/agent_supervisor.rs` (~line 6683) and `feeds/changeset.rs` (~line 1975) move to the new pair.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`

---

#### Step 7: Trailer read — typed fields, stripped body {#step-7}

**Depends on:** #step-6

**Commit:** `tugcast(session-identity): parse Tug-Session trailers into typed GitLogCommit fields`

**References:** [P10] Citation, Spec S03, (#trailer-read-path)

**Artifacts:** `GitLogCommit.tug_session` / `.tug_session_id`; body stripped of both trailer lines.

**Tasks:**
- [ ] Extend the `--format` string in `feeds/git.rs` (~line 407) with `%(trailers:key=Tug-Session,valueonly,separator=%x1e)` and the id key; extend the record parse (~line 438) and keep only the first `%x1e` value, as `tug_dash` does.
- [ ] Strip `Tug-Session:` / `Tug-Session-Id:` lines from the `%b` body before shipping (and align `Tug-Dash:` stripping so History bodies carry no Tug trailer ink at all).
- [ ] Mirror the fields in `tugproto` / the TS `GitLogCommit` shape.

**Tests:**
- [ ] Rust: new-form pair parses; legacy one-line form lands in `tug_session` with `tug_session_id` None; body stripping preserves non-trailer lines and interleaved trailers.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 8: Session color + masthead height tokens (six themes) {#step-8}

**Commit:** `tugdeck(session-identity): theme-authored session color and masthead height`

**References:** [P05] Session color, [P08] Masthead, Spec S04

**Tasks:**
- [ ] Hand-author the session role value in all six theme files, seeded from each theme's `agent` family (in `brio` the violet of `--tug7-*-agent-rest`); expose one knob the component derives ground/border/ink/icon from.
- [ ] Add `--tug-masthead-height: 72px` beside `--tug-chrome-height` in all six.
- [ ] Audition on the spike card against live fixtures (swap `--gsi-session-color` to the real token).

**Tests:**
- [ ] `bun run audit:theme-contrast` — no theme exceeds the `brio` budget.

**Checkpoint:**
- [ ] `bun run audit:theme-contrast` && `bunx vite build`

---

#### Step 9: `resolveSessionIdentity` and the great deletion {#step-9}

**Depends on:** #step-1, #step-5

**Commit:** `tugdeck(session-identity): one resolver; delete the five parallel naming rules [L02]`

**References:** [P02] One resolver, [P04] Callsign run, [P08] branch retires from identity, Spec S01, Table T02

**Artifacts:** `lib/session-identity.ts` + tests; `session-card-title.ts` absorbed; `session-name.ts` deleted; `deriveStableTag` production-dead.

**Tasks:**
- [ ] Implement Spec S01 (including lineage parse from `tag`/`lineage` fields and the synopsis-aware title precedence — synopsis store wired but empty until #step-15).
- [ ] Re-point consumers: `cards-data-source.ts` `sessionLabel` (drop the `(branch)` composition — `sessionIdentityLine` has no branch), `session-picker-cells.tsx` (`sessionRowTitle` call ~line 200), the Lens session cell, the Session card's title publication, any `sessionChipDisplay` remnants.
- [ ] Delete `session-name.ts` and **both** its test files (`lib/session-name.test.ts` and `lib/__tests__/session-name.test.ts`), `sessionCardTitleOverride`, the picker's `deriveStableTag` import, and the `deriveStableTag` usage in `lib/__tests__/session-picker-data-source.test.ts` (~line 102); keep `mintTag` (client optimistic mint stays).
- [ ] Fix the Lens filter-projection `branch: null` inconsistency by removing branch from the label entirely (it was only ever in the string via the suffix).

**Tests:**
- [ ] `session-identity.test.ts`: precedence (user name → tag → shortId), lineage parse, citation forms incl. tagless fallback, line form has no branch.

**Checkpoint:**
- [ ] `bun test tugdeck/src/lib/__tests__/session-identity.test.ts` && `bunx vite build`
- [ ] `just app-test-changed` (title bar reads `project/tag` with no `(branch)`; picker/Lens agree)
- [ ] `git grep -n "sessionChipDisplay\|sessionRowTitle\|sessionEntryTitle" tugdeck/src` → nothing

---

#### Step 10: `TugSessionIdentity` — chip + line tiers {#step-10}

**Depends on:** #step-8, #step-9

**Commit:** `tugdeck(session-identity): TugSessionIdentity chip and line tiers [L19][L20]`

**References:** [P01] Registers, [P03] Tiers, [P04] Run, [P05] Color, [P13] Unresolvable, Spec S02, Table T01

**Artifacts:** `tug-session-identity.tsx` / `.css`; gallery spike re-mounted on the real component (prototype `SessionAtom` / `CallsignText` retired from the spike).

**Tasks:**
- [ ] Build chip (atom: pill, session color, sizes `sm`/`2xs`, `missing` state per [P13], hover `TugPlacard`, middle-truncation for deep lineage chains with full lineage on the tooltip) and line (icon + one bold run) tiers with the owned tokens (icon gap first).
- [ ] Register in the gallery: the spike card swaps its prototypes for the real component — the spike remains the fixture bench and its CSS shrinks to scaffolding only.

**Tests:**
- [ ] App-test (`@covers` the new component + spike card): atom renders one text node for the run; missing state inert (no click intent), dashed border attribute; both sizes.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 11: The atom on the clipboard {#step-11}

**Depends on:** #step-10

**Commit:** `tugdeck(session-identity): the session atom joins the clipboard and wire-marker system`

**References:** [P06] Real atom, Spec S06, (#s03-citation-grammar)

**Tasks:**
- [ ] Copy path: chip copy affordance writes all flavors via `writeClipboardViaNative` (`text/plain` = the citation; sidecar `{"kind":"session",…}`; html span).
- [ ] Paste path: the composer's atom-paste handling accepts `kind: "session"` and re-materializes the chip; submitted prompts carry `` `@project/tag` `` via `wrapAtomMention`; replay re-mints via `parseAtomMentionSegments` — extend the existing kinds, no parallel mechanism.

**Tests:**
- [ ] Unit: marker wrap/parse round-trip for a session mention.
- [ ] App-test: copy from the gallery atom → paste into the Session card composer → chip re-materializes; paste of the plain flavor elsewhere yields the citation.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 12: Row tier — `TugSessionRow` grows; picker + Lens adopt {#step-12}

**Depends on:** #step-10

**Commit:** `tugdeck(session-identity): four-line identity stack; picker and Lens adopt the row tier`

**References:** [P03] Tiers, Table T01, Table T02, (#t01-geometry)

**Artifacts:** `TugSessionRow` gains description + metadata lines (the four-line stack) at the 16px dot size; picker leaves `TugListRow`; Lens Sessions group renders the same stack.

**Tasks:**
- [ ] Grow `TugSessionRow` per Table T01 — explicit tight line-height on every stack line; `TugPulse` knobs set to 18px bar / 13px baseline from outside ([L20]); dot ring-box overhang per the `inset` fit at 16px; 5px lead gap / 1px line gaps; 12px block padding. The Lens keeps its 28px indicator where it stands today — the size is a caller choice, not a component change.
- [ ] Picker adoption (`session-picker-cells.tsx`): four lines — callsign (dot leads, no icon), description, PULSE, metadata (`time · turns · size` from `SessionRow`); id leaves ink for tooltip/trash-label as today.
- [ ] Lens Sessions group adoption via the resolver.

**Tests:**
- [ ] App-test: row height 93px at four lines; dot on the row margin; callsign-first ordering; renamed/unnamed/external fixtures.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 13: The masthead {#step-13}

**Depends on:** #step-10

**Commit:** `tugdeck(session-identity): the Session card grows a masthead [L09]`

**References:** [P08] Masthead, [P14] Frontmost tab, [Q03] focus stop, Spec S02, Table T01, Risk R01, (#masthead-in-pane)

**Artifacts:** structured `cardTitleStore` payload; `TugPane` masthead rendering; `MASTHEAD_HEIGHT` constant; telemetry placard widget.

**Tasks:**
- [ ] `card-title-store.ts`: the sidecar per Spec S02 — `set(cardId, title, masthead?)` + `getMasthead(cardId)`; `get()` stays `string | null`, so the read sites need no change (verify the inventory: `tug-tab-bar.tsx` ~198/~442/~803, `deck-canvas.tsx` ~315, `host-menu-state.ts` ~1016, `tug-pane.tsx` ~1378). `paneTitleBarTextFor` keeps returning the line string for list surfaces unchanged.
- [ ] `tug-pane.tsx`: render masthead chrome when the **active** card carries the sidecar ([P14]: the chrome follows the frontmost tab, 36↔72 on tab switch) — lead line (`TugSessionIdentity` line tier + existing pane controls), description line, PULSE line (`TugPulse layout="inline"`, knobs per Table T01), trailing wave widget → `TugPlacard` with state, turns, created/compacted stamps, **branch**, and the citation + `TugCopyBadge`.
- [ ] `MASTHEAD_HEIGHT = 72` beside `CARD_TITLE_BAR_HEIGHT`; audit every `CARD_TITLE_BAR_HEIGHT` consumer (`TITLE_BAR_VISIBLE_MIN_Y` and grep) for masthead-height awareness.
- [ ] Publish `--tugx-pane-chrome-height` on the `.tug-pane` element (`var(--tug-masthead-height)` when the masthead is up, else `var(--tug-chrome-height)`); re-point the scrim (`tug-pane.css` ~line 610), the sheet top (`tug-sheet.css` ~line 63), and the banner top (`tug-pane-banner.css` ~line 59) to it (Risk R01) — a sheet, scrim, or banner on a masthead pane must seat below all 72px.
- [ ] Session card publishes the sidecar **beside** the Line string (the string keeps re-`set`ting on every identity change — that is the notification contract); absorb the load-control bar's "Session created …" line into the placard.
- [ ] Overflow: middle-truncation via `TugLabel`; the masthead never reflows. `pulse/enabled` off → PULSE line absent, height unchanged.
- [ ] During this step the Z2 strip still exists — the PULSE speaks twice for the life of one step range; #step-14 lands immediately after (do not commit gaps to main between 13 and 14 without noting the duplication).

**Tests:**
- [ ] App-test: masthead height exactly 72; three lines with Table T01 leading; placard opens with citation + branch; one-line bar unchanged on non-session cards.
- [ ] App-test: sheet, scrim, and banner seat below the 72px masthead (Risk R01); a rename while the masthead is up repaints the tab strip, Window menu, and slot-stack picker (the string re-`set` contract).
- [ ] App-test ([P14]): a multi-tab pane stacking [Session, Text] swaps chrome 36↔72 with the active tab, both directions.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 14: Z2 strip removal and re-homing {#step-14}

**Depends on:** #step-13

**Commit:** `tugdeck(session-identity): remove SessionPulseStrip; re-home its behaviors into the masthead`

**References:** [P09] Strip removal, [Q03] focus stop, List L01, Risk R02

**Tasks:**
- [ ] Move the dwell queue and compaction pin as code into the masthead's PULSE feeder (pane side, fed by the same stores).
- [ ] Delete `session-pulse-strip.tsx` / `.css` and the mount at `session-card.tsx` ~line 4423; delete `SESSION_CYCLE_ORDER_PULSE` and its `CycleScope` registration.
- [ ] Sparkline rides the masthead PULSE's `trailing` accessory; update the `TUG_SESSION_ROW_SPARK_WIDTH`/`_HEIGHT` pairing docstrings in `tug-session-row.tsx` to point at the new home.
- [ ] Status row: content/layout/tokens untouched; correct its seat against the prompt entry with spacing alone.

**Tests:**
- [ ] App-test: no strip in the DOM; rapid PULSE lines still dwell ≥ `MIN_DWELL_MS` in the masthead; compaction pin holds through `/compact`; `pulse/enabled` off leaves a 72px masthead with no PULSE line; status row geometry unchanged.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 15: The synopsis {#step-15}

**Depends on:** #step-4, #step-9

**Commit:** `tugcast+tugdeck(session-identity): the rolling synopsis rides the Summarize lane`

**References:** [P07] Synopsis, [Q01] trigger, [Q02] persistence, Spec S07

**Tasks:**
- [ ] `sessions.synopsis` column (self-healing ALTER); `SessionRow.synopsis` in Rust + TS lockstep; `session_updated` broadcast on write.
- [ ] The job in `shared_agent.rs` / a feed module beside `session_overview.rs`: digest composition from recent turns, prompt per Spec S07 (register rules from `headline_rules!`), Summarize lane, trigger per [Q01]'s starting point.
- [ ] Freeze rule: `name_user_set = 1` suppresses the job and the write.
- [ ] Client: `session-synopsis-store.ts`; the resolver's `title` precedence goes live (name→synopsis→null); masthead/row description lines fill in.
- [ ] Tune trigger + register against real output in-app; record the shipped constant's rationale in a doc comment ([Q01] resolution).

**Tests:**
- [ ] Rust: persistence, freeze rule, broadcast; the job never runs for `name_user_set` rows.
- [ ] App-test: a renamed session shows the name; an un-renamed one shows the synopsis after a turn; a fresh session shows an empty description line.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` && `just build-app` && `just app-test-changed`

---

#### Step 16: Citation surfaces — tab strip, Gazette, Changes, History {#step-16}

**Depends on:** #step-7, #step-10

**Commit:** `tugdeck(session-identity): every citation surface adopts the chip; the tab strip reads the pane title`

**References:** [P01] Registers, [P10] Citation, [P13] Unresolvable, Table T02, Spec S03

**Tasks:**
- [ ] Tab strip: `paneTitleBarTextFor` is the wrong shape here — it resolves the pane's **active** card, and a tab label is per-tab. `TabView` (~line 445) and the overflow menu (~line 803) in `tug-tab-bar.tsx` drop the `componentId === "text"` gate and compose per tab: `composePaneTitleBarText({ metaTitle: tab.title, titleOverride: cardTitleStore.get(tab.id) })`, hoisted as `cardTitleTextFor(cardId, registryTitle)` in `lib/pane-title.ts` beside the existing pair so the rule stays in one place.
- [ ] Gazette: `RefChip` gains a session case (the `gazette-ref-action.ts` `case "session"` intent already exists) rendering the chip via the resolver; the raw-UUID label dies.
- [ ] Changes card: the orphan hint (and bucket headers where useful) renders the chip instead of the `prior_owner_name` feed string.
- [ ] History: `tug-history-list.tsx` renders the citation chip beside the SHA + dash badge from the typed fields, resolution per Spec S03 (unresolved → [P13] slashed inert atom); trailer ink is gone from bodies (server-stripped in #step-7).
- [ ] Transcript export filename becomes `tug-session-<tag>-<shortid>` (locate the export path by grep for the current bare-hash filename).
- [ ] `gallery-commit-surfaces.tsx` fixtures (~lines 60–158) move to the two-trailer grammar — except **one** retained legacy one-line trailer, kept deliberately as the Spec S03 legacy-form specimen.

**Tests:**
- [ ] App-tests per surface: stacked Session card tab shows `project/tag`; a Gazette session ref shows the chip; History commit row shows the chip and a legacy-trailer commit resolves; an alien citation renders the slashed atom, inert.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 17: `tag → session_id` and `/resume <tag>` {#step-17}

**Depends on:** #step-9

**Commit:** `tugdeck(session-identity): the tag becomes addressable — /resume <tag>`

**References:** [P12] Tag space (addressability), Spec S01

**Tasks:**
- [ ] Reverse map on `sessionTagStore` (its header names this exact follow-on) fed from the same three sources; exact-match `resolveTag(tag) → sessionId | null`.
- [ ] `/resume <tag>` as a composer slash route (the `/` layer — the `!` namespace is retired): resolves the tag and drives the existing resume path the picker uses (`onOpen(projectDir, "resume", sessionId, display)` shape at `session-card.tsx` ~line 1790).
- [ ] Unresolvable tag → composer error affordance, not a silent no-op.

**Tests:**
- [ ] Unit: reverse-map correctness incl. lineage tags.
- [ ] App-test: `/resume <tag>` of a closed ledger session opens it.

**Checkpoint:**
- [ ] `bunx vite build` && `just app-test-changed`

---

#### Step 18: Doctrine {#step-18}

**Depends on:** #step-16

**Commit:** `tuglaws(session-identity): the session-identity decision and the masthead amendment`

**References:** [P01]–[P13], (#success-criteria)

**Tasks:**
- [ ] New `[D##]` (next free number after D129 — D130 as of this writing; re-check at landing) in `tuglaws/design-decisions.md`: session identity is one structured record produced by one resolver; every surface renders it through `TugSessionIdentity` at a declared density tier; the tag is the immutable callsign and always leads; the UUID never leads; the citation is the only sanctioned flat-text form. Name the retired alternatives (per-session tint, mono callsign, incipit leading, `(branch)` suffix, bare-`-N` suffix) with *do not re-propose*.
- [ ] Masthead amendment to the pane-chrome sections of `tuglaws/pane-model.md`.
- [ ] Lineage/suffix grammar recorded beside the tag machinery (module docs in `session_ledger.rs` / `session-tag.ts`).

**Checkpoint:**
- [ ] Doc review against the shipped code; links resolve.

---

#### Step 19: Integration checkpoint {#step-19}

**Depends on:** #step-3, #step-11, #step-12, #step-14, #step-15, #step-16, #step-17, #step-18

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), Table T02

**Tasks:**
- [ ] Walk every Success Criteria item; walk Table T02 surface by surface in the running app.
- [ ] Grep gates: no `sessionChipDisplay|sessionRowTitle|sessionEntryTitle|deriveStableTag|sessionCardTitleOverride` production references; no `SessionPulseStrip`.

**Tests:**
- [ ] `cd tugrust && cargo nextest run` (full workspace)
- [ ] `bunx vite build` && `bun run audit:theme-contrast`
- [ ] `just app-test-changed` over the phase's accumulated diff; core tier (`just app-test`) if any pre-assertion harness file moved.

**Checkpoint:**
- [ ] All of the above green in one pass.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tug refers to a session one way everywhere — one resolver, one component family at four tiers, one citation grammar, lineage-bearing tags, a rolling synopsis, and commit trailers that resolve — with the five parallel naming rules deleted and the doctrine recorded.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every Success Criteria item verified (#success-criteria).
- [ ] Step Status Ledger fully `done` with commits recorded.
- [ ] `[D##]` doctrine entry landed; pane-model masthead amendment landed.

**Acceptance tests:**
- [ ] The #step-19 integration pass.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: content-annotator pattern-matching for citations in free prose (prerequisites: whole-citation detector claiming the run before the commit-SHA scanner; an `AnnotationScope` on the History card).
- [ ] Mastheads for other cards with real content identity (file card path + dirty state).
- [ ] Opportunistic lexicon growth (more 4–5-letter nouns).

| Checkpoint | Verification |
|------------|--------------|
| Data layer | `cd tugrust && cargo nextest run` |
| Client build | `bunx vite build` |
| Themes | `bun run audit:theme-contrast` |
| Surfaces | `just app-test-changed` per step; #step-19 sweep |

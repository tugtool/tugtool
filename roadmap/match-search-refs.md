<!-- devise-skeleton v4 -->

## Match / Search / Refs — File-Reference Commands in the Dev Card {#match-search-refs}

**Purpose:** Port the C++ `match` (filename matcher), `search` (content grep), and
`ref` (numbered-reference opener) tools into Tug.app as three **local slash commands**
(`/match`, `/search`, `/ref`) whose results stream into the Dev card transcript as a
numbered, clickable file-reference list — clicking a result (or typing `/ref N`) opens
the file in a Text card at the referenced location.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-11 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The repository carries three well-loved C++ command-line tools in `roadmap/`:
`match-tool.cpp` (walks a directory tree and lists files whose **filenames** match one
or more needles), `search-tool.cpp` (walks files and greps their **contents**, reporting
`path:line:column` + the matched line), and `ref-tool.cpp` (reads the numbered
`TextRef` list the other two write to `REFS_PATH` and opens ref *N* in an editor). All
three revolve around one shared object — a **`TextRef`**: a numbered `filename` +
optional `line` + optional column-`spread` + the matched line text. `match`/`search`
each *produce* a numbered ref list (the newer run overwrites `REFS_PATH`), and `ref`
*consumes* it by number.

We want great Rust versions of these, surfaced natively in the Dev card. The Dev card's
prompt entry already has a **local slash-command system** (client-side commands that run
Tug-side work without sending a Claude turn — `/btw`, `/model`, `/diff`, …) and a
transcript that already renders **non-context "ink" rows** (the `$` shell route's `#s`
exchanges, which record what the *user* did and never enter Claude's context). File
references are also already a solved click target: `ToolFileRef` rows in tool-call blocks
dispatch `open-file`, which opens/reveals the file in a Text card. This plan composes
those three existing mechanisms — slash commands (front door), a streaming tugcast feed
(the Rust port), and non-context transcript ink with clickable refs (output) — into the
match/search/ref experience.

#### Strategy {#strategy}

- **Front door = local slash commands, not routes.** `/match`, `/search`, `/ref` are
  pure local commands: one entry each in the `LOCAL_SLASH_COMMANDS` registry plus one
  handler each in the dev card's exhaustive `slashCommandSurfaces` map. No route-table
  changes — routes are a fixed 3-recipient concept (Code/Shell/btw); these are Tug-side
  computations, not recipients. ([P01])
- **One Rust feed hosts both ops.** A new tugcast feed (`refs`) with a `REFS_INPUT` /
  `REFS_OUTPUT` `SessionScopedFeed` pair runs both `match` and `search` over a shared
  gitignore-aware directory walk lifted from the existing file-watcher. Cloned structurally
  from the `$` shell feed. ([P02])
- **Stream results; make them cancellable.** Result rows are emitted incrementally as
  they are found (the block grows live under a pulsing header) and a run can be cancelled
  mid-flight, exactly like the shell feed's exec/kill. ([P04])
- **Unified `refs` transcript origin, non-context ink.** Both commands mint a new
  `"refs"`-origin transcript turn (addressed `#r{n}`), following the shell `#s` doctrine:
  refs are the user's own investigation, never sent into Claude's context unless the user
  invokes the block's **Share** gesture. ([P03])
- **Ledger-backed, latest-only.** The newest run's refs replace the previous ones in a
  per-session ledger (clobber-on-new), so `/ref N` and a Maker ▸ Reload always resolve
  against the most recent list — mirroring how `REFS_PATH` was a single overwritten file.
  ([P05])
- **Two row renderers, one block chrome.** `match` rows (numbered filename) and `search`
  rows (numbered `path:line` + highlighted line preview) are two small renderers sharing
  one refs block chrome (Share + Copy affordances, like `ShellExchangeBlock`). ([P08])
- **Build in vertical slices.** Rust ops (pure, unit-tested) → feed wiring → frontend
  store + origin → block + clickable refs → the slash commands → `/ref` opener → reload
  restore → column-span highlight → the option cluster. Each step is a commit with a
  falsifiable checkpoint, most runnable in the live-HMR app.

#### Success Criteria (Measurable) {#success-criteria}

> Falsifiable.

- Typing `/search <needle>` in the Dev card streams a numbered `#r` result block into
  the transcript whose rows appear incrementally; each row reads `path:line` with the
  matched line text, and clicking one opens that file in a Text card scrolled to the
  line. (Spec S03, Spec S05)
- Typing `/match <needle>` streams a numbered `#r` result block of matching **filenames**
  (no line); clicking a row opens the file. (Spec S02, Spec S05)
- `/ref 3`, `/ref 3-5`, and `/ref 3 7 9` open refs 3 / 3–5 / 3,7,9 from the **most
  recent** match-or-search block, honoring the deck's "open new text files" (`openTarget`)
  preference; an out-of-range number reports a subdued error and opens nothing invalid.
  (Spec S06)
- A `/search` over a large workspace can be cancelled mid-stream (the in-flight block
  settles with the rows found so far); an invalid `-e` regex yields zero results and no
  crash. (Spec S03, Risk R02)
- Running a second `/match` or `/search` replaces the ref list; after a Maker ▸ Reload
  the transcript restores exactly the last block and `/ref N` still resolves against it.
  (Spec S07, [P05])
- `cargo nextest run` passes (Rust ops + walk + ledger), `bunx tsc --noEmit` and
  `bunx vite build` succeed, and `just app-test` passes an end-to-end match/search/ref
  scenario. (#exit-criteria)

#### Scope {#scope}

1. A Rust `refs` feed in `tugcast` with a shared gitignore + secret-aware directory walk,
   a `match` operation (filename matching) and a `search` operation (content grep), a
   `TextRef` wire model, streaming result frames, and cancellation.
2. A `refs_ledger.rs` persisting the latest ref list per `tug_session_id` (clobber-on-new)
   and a `list_refs` CONTROL read for restore.
3. Frontend `REFS_INPUT`/`REFS_OUTPUT` protocol wiring, a per-card `RefsSessionStore`,
   a new `"refs"` `TurnOrigin` with `#r` addressing, a `RefsResultMessage`, the reducer /
   data-source / transcript-cell plumbing to render it, and Share/non-context-ink parity
   with shell.
4. A refs result block (shared chrome) with two row renderers (`match` filename row,
   `search` `path:line`+preview row), each row a clickable file reference.
5. The `/match`, `/search`, `/ref` local slash commands (registry + exhaustive handlers)
   with typed getopt-style flag parsing per Lists L01/L02.
6. `/ref` number resolution (single / range / list) against the latest refs, opening each
   honoring the `openTarget` pref, capped and warned past a ceiling.
7. Restore of the latest ref block on card reload via the ledger.
8. Column-span highlight for `search` refs — extending the Text-card reveal chain to accept
   a column range (line-granular reveal ships earlier; this sharpens it).
9. A transient option cluster (Case / Regex / All-files / Any-needle) — rendered adjacent
   to the prompt entry (NOT a route chrome slot) while the draft begins with `/match `/
   `/search ` — that writes the equivalent typed flags into the draft, persisted via tugbank
   defaults.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Search-and-replace** (`search -r`) and its **dry-run** (`-n`) — file-mutating; deferred
  entirely (see #roadmap).
- The dropped CLI-only flags that the Tug model subsumes: `-c` color, `-p` pipe,
  `-f` full-path, `-o` open, `-r`/`REFS_PATH` refs-file, `-t` terse (display is Tug's
  concern; opening is a click; refs live in the transcript + ledger).
- **`/find`** — a *transcript* live-search command. `find-route.md` already plans **Find**
  as a route-based transcript search (a different mechanism from filesystem grep). A
  `/find` slash alias into that surface is a follow-on gated on that plan (see #roadmap);
  it is NOT built here.
- A general "searchable file-type allowlist" (the C++ `SEARCHABLES` concept). Tug's skip
  model is gitignore + `SecretFilter`; there is no extension allowlist and this plan does
  not add one ([P11]).
- Fuzzy filename matching for `/match` — `match` is deterministic (substring / exact /
  glob), distinct from the existing fuzzy file-picker ([P11]).

#### Dependencies / Prerequisites {#dependencies}

- **Slash-command surface** (frontend): `LOCAL_SLASH_COMMANDS` in
  `tugdeck/src/lib/slash-commands.ts` (the registry; completion, matching, arg-parsing,
  history, and the not-sent-to-Claude classifier all derive from it), and
  `slashCommandSurfaces` in `tugdeck/src/components/tugways/cards/dev-card.tsx` (the
  exhaustive `Record<LocalCommandName, (args: string) => void>` handler map; a registry
  entry without a handler is a compile error). `/btw` is the worked clone target
  (registry entry with `takesArgs: true`; handler at the `btw:` key; responder at
  `[TUG_ACTIONS.RUN_SLASH_COMMAND]`).
- **Shell feed as structural template** (Rust + frontend): `tugcast/src/feeds/shell.rs`
  (dispatcher + per-session actor + serde-tagged `ShellInput`), `tugcast/src/shell_ledger.rs`
  (sqlite ledger + `list_exchanges`), the `main.rs` wiring block (feed at `feeds::session_scoped::SessionScopedFeed::new(FeedId::SHELL_OUTPUT, …)`, `mpsc::channel` input,
  `shell_dispatcher_task` spawn, `feed_router.register_session_feed` + `register_input`),
  `tugdeck/src/lib/shell-session-store.ts` (per-card store: `exec`/`kill`, frame send on
  `FeedId.SHELL_INPUT`, `_fold` into `CodeSessionStore.ingestShellExchange`), and the
  transcript render path (`ShellTurnCell` in
  `tugdeck/src/components/tugways/cards/dev-card-transcript.tsx`, `resolveCommandBlock`
  in `dev-command-block-registry.ts`, `ShellExchangeBlock`/`shell-exchange-view.ts`,
  `dataSource.shellOrdinalForRow`).
- **Directory-walk infra** (Rust, in `tugcast`): `ignore::WalkBuilder` usage in
  `tugcast/src/feeds/file_watcher.rs` (`walk_with_cap`, `WALK_CAP = 50_000`,
  `.git_ignore(true)`, `.git`-skip), `SecretFilter` in `tugcast/src/feeds/secret_filter.rs`
  (`new(workspace_root)`, `is_secret(relative_path)`, `SECRET_FILE_DENYLIST`,
  `.tugattachignore`), the safe file read in `tugcast/src/fs_read.rs`
  (`MAX_READ_BYTES = 8 MiB` size guard, `std::fs::read`, `String::from_utf8` → non-UTF-8
  treated as binary), `PathResolver` (`tugcast/src/path_resolver.rs`, relativization),
  and `rayon` + `regex` (workspace deps) for parallel content scanning. The `FileTreeFeed`
  in `tugcast/src/feeds/filetree.rs` is the closest existing "query (carrying `root`) →
  session-scoped result" analog and shows the `FileTreeQuery { root: Option<PathBuf>, … }`
  shape.
- **File-open / reveal chain** (frontend): `ToolFileRef`
  (`tugdeck/src/components/tugways/cards/blocks/tool-file-ref.tsx` — dispatches `open-file`
  with `{ path, line?, endLine? }`, carries `data-tug-focus="refuse"` + `data-no-activate`
  + `mousedown` preventDefault), `openFileInCard`
  (`tugdeck/src/lib/open-file-in-card.ts` — path-keyed reuse, then the `openTarget` default
  `"reuse"|"newTab"|"new"`), `TUG_ACTIONS.OPEN_FILE` handler in
  `tugdeck/src/action-dispatch.ts`, and the Text-card reveal
  (`text-card-open-registry.ts`, `text-card.tsx`, `tug-text-card-editor.tsx`
  `revealLineFn` — currently **line-granular** via a `Decoration.line` flash).
  `grep-tool-block.tsx` / `glob-tool-block.tsx` are the visual precedent for a list of
  clickable file-reference rows.
- **Workspace root** (frontend): `binding.projectDir` — already threaded into the shell
  store and carried as `root` on `FILETREE_QUERY` / `git_diff_request` frames
  (`tugdeck/src/lib/card-services-store.ts`). This is the walk root ([P06]).
- **tugbank defaults** for option-cluster persistence (`/api/defaults/<domain>/<key>`) —
  templates: `default-model-store.ts` / `editor-settings-store.ts`. No `localStorage`.

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS.** The Rust workspace enforces `-D warnings`
  (`tugrust/.cargo/config.toml`); `cargo build` and `cargo nextest run` fail on any
  warning. Fix warnings immediately.
- **Verify with `bunx vite build`.** The debug app loads the production rollup bundle; an
  import that works under dev esbuild can still fail the build. `bunx vite build` must
  succeed before any tugdeck change is declared done.
- **Tuglaws** (tugdeck): [L02] external state via `useSyncExternalStore`; [L03]
  registrations in `useLayoutEffect`; [L06] appearance via CSS/DOM, never React state;
  [L22] store-observer for state that drives direct DOM writes. See #state-zone-mapping.
- **No `localStorage`/`sessionStorage`/IndexedDB** — persistence via tugbank / the Rust
  ledger.
- **Security:** the `SecretFilter` denylist is **never** bypassed by any flag (including
  `-a`/`-s`) — secrets must never surface in refs ([P11], Risk R03).
- **Real, not fake:** no mock-store or jsdom render tests; end-to-end verification drives
  the real Dev card via `just app-test` / the live app.

#### Assumptions {#assumptions}

- The Dev card has a `tug_session_id` and a `projectDir` (workspace root) available at the
  point the slash handler runs — the same values the `ShellSessionStore` is constructed
  with (`tugdeck/src/lib/card-services-store.ts`).
- Result **numbering is emission-order and stable once assigned**: a `#r{n}` number is
  fixed when its row is first emitted and never renumbered, so `/ref N` is well-defined
  even though rows stream in (rayon) rather than fully sorted ([P12]).
- A `refs` origin turn carries exactly one `RefsResultMessage` (the whole ref list for one
  run), mirroring how a `shell` turn carries exactly one `ShellExchangeMessage`.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Explicit `{#anchor}` headings, kebab-case, no phase numbers in anchors. Plan-local
decisions are `[P01]`…; global tuglaws/design-decisions are cited by their own IDs
(`[L02]`, `[D##]`). Never cite line numbers — cite anchors and symbol names.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Streaming result ordering & numbering (OPEN) {#q01-ordering}

**Question:** `search` scans files in parallel (`rayon`), so results arrive out of the
walk order. How are rows ordered and numbered given they stream in?

**Why it matters:** `/ref N` must resolve to a stable target; renumbering mid-stream would
make `N` ambiguous. The C++ tool sorted all refs then numbered 1..N — impossible to
reproduce faithfully while streaming.

**Options:**
- Emit per-file batches; assign `#r{n}` in emission order; never renumber (streaming-native).
- Buffer everything, sort by `path`/`line`, number at completion (loses streaming).

**Plan to resolve:** Decide up front (streaming is a hard requirement per [P04]).

**Resolution:** DECIDED (see [P12]) — emission-order numbering, stable once assigned. Each
file's own matches are emitted together and sorted by (line, column) within the file; files
stream as their scans complete. A deliberate, documented divergence from the C++ global
sort, justified by streaming.

#### [Q02] `-a` / `-s` skip semantics in the Tug model (OPEN) {#q02-skip-flags}

**Question:** The C++ `search` distinguished `SEARCHABLES` (a file-type allowlist) from
`SKIPPABLES` (skipped dirs), with `-a` = "not just searchables" and `-s` = "include
skippables". Tug has no searchables allowlist — only gitignore + `SecretFilter`. What do
`-a`/`-s` mean here?

**Why it matters:** Wrong mapping either leaks secrets or makes a flag meaningless.

**Options:**
- Collapse both intents into one flag that walks into **gitignored** dirs
  (node_modules/target/…) while `SecretFilter` still applies.
- Keep two flags with contrived distinct meanings.

**Plan to resolve:** Decide during Rust op design.

**Resolution:** DECIDED (see [P11]) — one flag `-a` ("all files": also descend into
gitignored paths); `SecretFilter` is **always** enforced regardless. `-s` is accepted as an
alias of `-a` for muscle memory. No searchables allowlist is introduced.

#### [Q03] Merged-per-line vs one-row-per-match for `search` (OPEN) {#q03-merge}

**Question:** The C++ default merged all matches on a line into one `TextRef` (with a
multi-stretch spread); `-l` split them one-per-line. Which is the Tug default, and how does
merging interact with the clickable row + column highlight?

**Why it matters:** Determines the row model (`columns: Spread` vs a single column) and
how many `#r` numbers a busy line consumes.

**Options:** Default merged (one row per matching line, multi-span highlight), `-l` splits.

**Plan to resolve:** Mirror the C++ default.

**Resolution:** DECIDED — default **merged** (one `#r` row per matching line, carrying a
list of column spans); `-l` emits one row per match. Line-granular reveal ignores the
spans; the column-span highlight step ([P10], #step-11) paints all spans on the line.

#### [Q04] `/find` slash alias (OPEN) {#q04-find-alias}

**Question:** The invocation also mentioned `/find`. Should it ship here?

**Why it matters:** Scope. `find-route.md` already designs Find as a *transcript* search
route — a separate engine from filesystem grep.

**Resolution:** DEFERRED — out of scope (#non-goals). Add `/find` as a thin slash alias
into the Find route surface once/if `find-route.md` lands; tracked in #roadmap.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Content grep over a huge workspace stalls the feed | med | med | Streaming + `rayon` + `WALK_CAP` + `MAX_READ_BYTES` size cap + cancellation; see #r01-scan-cost | A `/search` visibly hangs or floods rows |
| Invalid `-e` regex from the user | low | med | `Regex::new` in a guarded path → zero results + a subdued notice, never a panic; #r02-regex | A bad pattern crashes or errors loudly |
| Binary / non-UTF-8 files scanned | low | high | Reuse `fs_read` UTF-8 gate; skip non-text bytes; never emit secret paths (`SecretFilter`); #r03-binary-secrets | Garbage rows or a secret path appears |
| Column-span highlight paints a spurious WebKit wash | low | med | Publish only non-collapsed real `Range`s; assert range/attr state, not pixels; #r04-highlight-wash | A caret-only highlight shows a wash |
| A second run mid-stream races the ledger clobber | med | low | Clobber is keyed to a run id; late frames from a superseded run are dropped; #r05-clobber-race | Stale rows from a prior run linger |

**Risk R01: Scan cost** {#r01-scan-cost}
- **Risk:** A workspace-wide content grep is O(bytes) and can be large.
- **Mitigation:** Stream rows as found (no wait-for-all); scan files in parallel via
  `rayon`; cap the walk at `WALK_CAP`; skip files over `MAX_READ_BYTES`; support cancel
  (a `cancel` input frame reaping the run). `match` (filename-only) never reads file bodies.
- **Residual risk:** A pathological tree still costs CPU; acceptable for a user-initiated,
  cancellable command.

**Risk R02: Regex safety** {#r02-regex}
- **Risk:** `search -e <pattern>` with an invalid or pathological regex.
- **Mitigation:** Construct `Regex` in a guarded path; invalid → the run completes with
  zero results and a subdued notice frame (no panic). The `regex` crate has no catastrophic
  backtracking (linear-time automaton), so ReDoS is not a concern.
- **Residual risk:** A valid but broad pattern returns many rows — bounded by streaming +
  cancel.

**Risk R03: Binary files & secrets** {#r03-binary-secrets}
- **Risk:** Scanning could emit garbage from binary files or, worse, surface a secret path.
- **Mitigation:** Reuse the `fs_read` UTF-8 gate (non-UTF-8 → skip). `SecretFilter` is
  applied to every candidate path and is **never** bypassed by any flag.
- **Residual risk:** None material for text refs.

**Risk R04: Highlight wash** {#r04-highlight-wash}
- **Risk:** A collapsed Range in a CSS Custom Highlight paints a spurious wash in WebKit
  (known gotcha, per project memory).
- **Mitigation:** Only register non-empty column spans; for a bare line (no spans) fall
  back to the existing line flash. Test asserts range/attribute state, not screenshot pixels.
- **Residual risk:** None.

**Risk R05: Clobber race** {#r05-clobber-race}
- **Risk:** Starting a new run while a prior run still streams could interleave rows or
  double-write the ledger.
- **Mitigation:** Each run carries a `run_id`; the store and feed drop frames whose
  `run_id` is not the current one; the ledger records only on a run's completion, keyed by
  `tug_session_id` (latest overwrites).
- **Residual risk:** A superseded run's CPU keeps briefly until it observes cancellation.

---

### Design Decisions {#design-decisions}

#### [P01] Front door is local slash commands, not routes (DECIDED) {#p01-slash-not-route}

**Decision:** `/match`, `/search`, `/ref` are local slash commands — a `LOCAL_SLASH_COMMANDS`
registry entry plus a `slashCommandSurfaces` handler each — with **no** `ROUTE_ITEMS` /
`ROUTE_PREFIX_ALIAS` / `RETURN_ACTION_BY_ROUTE` changes.

**Rationale:**
- Routes model *recipients* (Code = Claude, Shell = the shell, btw = Claude-off-record).
  These commands are Tug-side computations, not a new recipient; the slash system is the
  designed surface for "run local Tug work without a Claude turn."
- Adding to the registry auto-wires completion (`/m`→`/match` inline + popup), the
  `/name args` parser, submit interception (before the Claude-send gates, so it works
  mid-turn), history, and the "don't forward to Claude" classifier — zero extra edits.
- The exhaustive `Record<LocalCommandName, …>` handler map makes a missing handler a
  compile error, not a silent no-op.

**Implications:**
- Edit `tugdeck/src/lib/slash-commands.ts` (registry) and
  `tugdeck/src/components/tugways/cards/dev-card.tsx` (handlers + store construction).
- All three declare `takesArgs: true` (they take a query / numbers).
- `/ref` needs no Rust — it is pure frontend resolution against the current refs ([P09]).

#### [P02] One `refs` tugcast feed hosts both match and search (DECIDED) {#p02-one-feed}

**Decision:** A single new feed module `tugcast/src/feeds/refs.rs` with a `REFS_INPUT` /
`REFS_OUTPUT` `SessionScopedFeed` pair runs both operations, selected by a serde-tagged
input enum (`{ type: "match" | "search" | "cancel", … }`), over a shared walk helper.

**Rationale:**
- `match` and `search` share the walk, the skip rules, the `TextRef` result shape, the
  session multiplexing, streaming, cancellation, and the ledger. One feed = one `main.rs`
  wiring block, one dispatcher, one store — far less duplication than two feeds.
- The C++ tools already share `REFS_PATH`; one feed preserves that unity.

**Implications:**
- Follows the shell feed's structure: `SessionScopedFeed::new(FeedId::REFS_OUTPUT, …)`,
  an `mpsc` input channel, a `refs_dispatcher_task`, `register_session_feed` +
  `register_input(FeedId::REFS_INPUT, …)` in `main.rs`, and `pub mod refs;` in
  `feeds/mod.rs`.
- Frontend has one `RefsSessionStore` and one `RefsResultMessage`; `match`/`search` differ
  only by a `kind` field + which row renderer draws them.

#### [P03] Unified `refs` transcript origin, non-context ink (DECIDED) {#p03-refs-origin}

**Decision:** Results render as a new `TurnOrigin` value `"refs"` (addressed `#r{n}`),
excluded from Claude's context exactly like `shell` (`#s`) turns; the only path into
Claude's context is the block's **Share** gesture.

**Rationale:**
- A match/search is the user's own file investigation — the same doctrine that makes shell
  exchanges non-context ink applies verbatim.
- A distinct origin gets its own ordinal counter and addressing letter without disturbing
  `#u`/`#a`/`#s`.

**Implications:**
- `TurnOrigin` in `tugdeck/src/lib/code-session-store/types.ts` gains `"refs"`; add a
  `RefsResultMessage` (`kind: "refs_result"`). The reducer mints a `refs` turn via a
  `buildRefsTurnEntry` and the transcript **skips refs messages inside Claude turns** the
  same way it skips shell messages. The `#r` ordinal is a precomputed `refsRowOrdinal`
  descriptor field (mirror `shellRowOrdinal`), 1..N within the single restored block.
- The refs block carries a Share affordance wired to the same share path shell uses.

#### [P04] Streaming result frames with cancellation (DECIDED) {#p04-streaming}

**Decision:** The feed emits incremental frames — `refs_started` (run_id, kind, command,
root, started_at), one or more `refs_rows` (a batch of `TextRef`s with their assigned
`#r` numbers), and `refs_complete` (run_id, total, settled_at, `cancelled` flag) — and
accepts a `cancel` input frame that reaps the in-flight run.

**Rationale:**
- The user explicitly wants streaming ("streaming results would be great"). A workspace
  grep is long enough that whole-result posting feels dead; incremental rows feel alive.
- Cancellation is the natural partner (a long/mistaken run must be stoppable), and the
  shell feed already proves the exec/kill shape.

**Implications:**
- `RefsSessionStore` appends rows to the in-flight `RefsResultMessage` as `refs_rows`
  arrive (an [L02] store update, not DOM). The block header pulses while in-flight (reuse
  the shell in-flight header treatment) and shows a Stop affordance dispatching `cancel`.
- `match` uses the same frames (it just streams fast).

#### [P05] Ledger-backed, latest-only, clobber-on-new (DECIDED) {#p05-ledger}

**Decision:** A `tugcast/src/refs_ledger.rs` sqlite ledger stores **only the latest** ref
list per `tug_session_id`; a new completed run overwrites the previous. A `list_refs`
CONTROL read returns it for restore.

**Rationale:**
- Mirrors the C++ `REFS_PATH` — a single file each run overwrote. "Save the latest one
  only; new matches or searches clobber it; just like the filesystem does."
- Restores the last block across Maker ▸ Reload so `/ref N` survives a reload, matching the
  shell ledger's restore contract.

**Implications:**
- Model on `shell_ledger.rs` (`default_path()` → a sibling `refs.db`, `open`/`open_in_memory`,
  a `record_run` that deletes the session's prior rows then inserts the new list, a
  `list_refs(tug_session_id)`), wired through the supervisor for the CONTROL read
  (`supervisor.set_refs_ledger`), and consumed on the frontend like
  `list_shell_exchanges` (a CONTROL send in the store constructor, a `list_refs_ok`
  handler in `action-dispatch.ts` → an `applyRestoredRefs`).

#### [P06] Walk root is always the workspace root (DECIDED) {#p06-root}

**Decision:** Both operations always walk from the card's **workspace root**
(`binding.projectDir`), sent as `root` in the `REFS_INPUT` frame; there is no per-card cwd
tracking and no path argument.

**Rationale:**
- The user chose "always workspace root." It is deterministic, needs no shell-cwd coupling,
  and matches how `FILETREE_QUERY` / `git_diff_request` already carry `root: projectDir`.

**Implications:**
- The store is constructed with `projectDir` (like `ShellSessionStore`) and stamps it on
  every frame; the feed builds `WalkBuilder::new(root)` + `SecretFilter::new(root)` from it.
- No `-C`/path-arg parsing in the flag grammar (Lists L01/L02).

#### [P07] Typed flags are source of truth; the cluster writes flags (DECIDED) {#p07-flags-truth}

**Decision:** Command behavior is driven by getopt-style **typed flags** parsed from the
query (Lists L01/L02); the option cluster (#step-12) is sugar that inserts/removes the
equivalent flag tokens in the draft. Persisted cluster defaults (tugbank) seed the initial
toggles; a per-invocation typed flag always wins.

**Rationale:**
- Faithful to the C++ tools and scriptable; the cluster adds discoverability without a
  second, divergent source of state.
- Slash commands have no persistent route chrome slot, so the cluster is inherently
  draft-scoped — writing flags into the draft is the clean bridge.

**Implications:**
- A shared `refs-flags.ts` parses/normalizes flags for both commands and is the single
  place the cluster and the submit path agree on. The cluster is a later, separable step;
  Phase-1 commands work on typed flags alone.
- Because there is **no route** ([P01]), there is no Z4B / route-chrome slot to host the
  cluster. It mounts as a **transient affordance adjacent to the prompt entry**, gated on
  the live draft matching `/match `/`/search ` (observed like the existing argument-hint /
  completion extensions), and unmounts otherwise. If that mount proves fiddly, the
  documented fallback is **persisted-defaults-only** (no live cluster) — the typed flags
  still fully drive behavior.

#### [P08] Two row renderers share one refs block chrome (DECIDED) {#p08-two-renderers}

**Decision:** One `RefsResultBlock` chrome (header with the command, Share + Copy, pulsing
in-flight state) dispatches to one of two row renderers by result kind: a `match` row
(numbered filename) and a `search` row (numbered `path:line` + highlighted line preview).

**Rationale:**
- The two result shapes differ (filename vs `path:line`+preview) but share every affordance;
  one chrome + two small renderers is the least code and matches the user's chosen plan.
- `grep-tool-block.tsx` / `glob-tool-block.tsx` are the row visual precedents;
  `ShellExchangeBlock` is the chrome precedent.

**Implications:**
- A pure `refs-result-view.ts` derives display data (paths relativized against root, line
  previews, span offsets) without rendering — unit-testable like `shell-exchange-view.ts`.

#### [P09] `/ref` resolves numbers against the latest refs, honoring `openTarget` (DECIDED) {#p09-ref-open}

**Decision:** `/ref` parses a number spec — single (`3`), range (`3-5`), and
space-separated list (`3 7 9`), combinable — resolves each against the **latest**
`RefsResultMessage`, and opens each via the existing `open-file` path, honoring the
deck-wide `openTarget` ("open new text files") preference. A range/list is capped
(default 10) with a subdued warning past the cap; an out-of-range number reports a subdued
error and is skipped.

**Rationale:**
- Ports `ref-tool.cpp` (which opened every requested ref). The Tug open path
  (`openFileInCard`) already honors `openTarget` (`reuse`/`newTab`/`new`) and path-keyed
  reuse — `/ref` should not reinvent card placement.
- A cap prevents `/ref 1-500` from spraying the deck.

**Implications:**
- `/ref` is pure frontend: parse spec → look up the current refs (from the store /
  latest `refs` turn) → `dispatchAction({ action: OPEN_FILE, path, line?, endLine? })`
  per ref. Search refs pass `line` (+ column range once [P10] lands); match refs pass
  only `path`.

#### [P10] Line-granular reveal first; column-span highlight extends the chain (DECIDED) {#p10-column-highlight}

**Decision:** Clickable refs first reveal **line-granular** (works today: `open-file` →
`revealLine(line)`); a later step extends the reveal chain end-to-end to accept a **column
range** and paint the exact match span(s) on `search` refs.

**Rationale:**
- Line-granular is production-ready and unblocks the whole vertical slice immediately; the
  column highlight is a self-contained sharpening that touches a known, isolated chain.

**Implications:**
- The column step threads a column range through: the `open-file` payload
  (`action-vocabulary.ts` `OPEN_FILE`), `openFileInCard`'s signature, the `revealOnOpen`
  seed shape + `TextCardOpenEntry.revealLine`/`openFile` (`text-card-open-registry.ts`,
  `text-card.tsx`), and `revealLineFn` in `tug-text-card-editor.tsx` (a `Decoration.mark`
  or a registered `CSS.highlights` range instead of the line-only flash). `ToolFileRef` (or
  the search row's own handler) passes the columns. Respect Risk R04 (no collapsed-range
  wash).

#### [P11] Flag set, defaults, and skip model per tool (DECIDED) {#p11-flags}

**Decision:** Port the flags in Lists L01 (`match`) and L02 (`search`) with the C++
defaults preserved (they differ deliberately by tool); drop the CLI-only flags per
#non-goals. The skip model is gitignore + `SecretFilter` (never bypassed); `-a`/`-s`
descend into gitignored paths only ([Q02]). `match` is deterministic (substring / exact /
glob), not fuzzy.

**Rationale:**
- "The differences between the programs serve their different purposes" — `match` defaults
  case-**insensitive** (quick filename lookup), `search` defaults case-**sensitive** (precise
  code grep); preserving that respects muscle memory.

**Implications:** see Lists L01/L02 and #semantics.

#### [P12] Emission-order, stable `#r` numbering (DECIDED) {#p12-numbering}

**Decision:** `#r{n}` numbers are assigned in the order rows are emitted and never
renumbered; within a single file, that file's matches are sorted by (line, column).

**Rationale:**
- Streaming ([P04]) precludes a global pre-sort. Stable emission-order numbering keeps
  `/ref N` well-defined. A documented divergence from the C++ global sort.

**Implications:** the feed assigns numbers as it emits `refs_rows`; the store trusts the
server's numbers; `/ref` indexes the accumulated list by those numbers.

#### [P13] Generalize the ink-turn insertion machinery for shell + refs (DECIDED) {#p13-ink-insertion}

**Decision:** The transcript-insertion helpers that today special-case shell turns —
`appendTurnInterleavingShell` and `upsertShellTurn` in
`tugdeck/src/lib/code-session-store/reducer.ts` (run via the store wrapper's
`append-transcript` / `ingest-shell-turn` effects, NOT inside the reducer) — are
**generalized to treat `refs` as an "ink" origin alongside `shell`** (i.e. the origin
predicate becomes `origin === "shell" || origin === "refs"`), rather than being
duplicated per origin.

**Rationale:**
- Both helpers do exactly what `refs` needs and both currently hardcode `origin === "shell"`:
  - `upsertShellTurn` replaces the turn with the same `turnKey` in place (mint → settle,
    preserving mount identity / row position) — this is precisely the **streaming
    upsert** a `refs` turn needs as each `refs_rows` batch updates the same in-flight
    turn ([P04]).
  - `appendTurnInterleavingShell` slides a newly appended non-ink (Claude) turn left past
    a run of *trailing ink turns* whose timestamp is greater — the **reload race** where a
    ledger restore (here `list_refs`) lands before the JSONL replay ([P05], Risk R05).
    A live `refs` turn, if treated as a *non-ink* turn, would be wrongly slid left past
    trailing shell turns; treating it as ink fixes both directions.
- Generalizing (not copying) leaves "non-context ink origin" as one reusable category —
  a strictly better foundation for any future ink origin than a second shell-shaped copy.

**Implications:**
- `upsertShellTurn` → an ink-origin upsert (or a shared `upsertInkTurn`) that `ingestRefs`
  routes streaming updates through; `appendTurnInterleavingShell`'s trailing-walk predicate
  includes `refs`. The reducer's existing shell skip (`if (message.kind === "shell_exchange") continue;`)
  gains a sibling `refs_result` skip.
- These are pure helpers on `_transcript` in the store wrapper — the same layer, no reducer
  state changes.

---

### Deep Dives {#deep-dives}

#### End-to-end data flow {#data-flow}

```
/search foo -i         (prompt entry)
  → performSubmit: matchLocalSlashCommand → RUN_SLASH_COMMAND {name:"search", args:"foo -i"}
  → dev-card.tsx slashCommandSurfaces.search(args)
  → RefsSessionStore.run("search", args)         (parse flags via refs-flags.ts)
  → conn.send(FeedId.REFS_INPUT, {type:"search", tug_session_id, run_id, root, needles, flags})
  → [Rust] refs_dispatcher_task → per-session actor
       walk(root)  (ignore::WalkBuilder + SecretFilter)  → rayon scan (regex) 
       → emit refs_started / refs_rows* / refs_complete  on REFS_OUTPUT (session-scoped)
       → on complete: refs_ledger.record_run(tug_session_id, run_id, rows)   (clobber)
  → RefsSessionStore._fold(frame) → CodeSessionStore.ingestRefs(...)
  → reducer buildRefsTurnEntry → a "refs"-origin TurnEntry (one RefsResultMessage)
  → dev-card-transcript RefsTurnCell → RefsResultBlock → match/search row renderer
  → row click / `/ref N` → dispatchAction(OPEN_FILE {path,line?,endLine?}) → openFileInCard → Text card
```

Restore: `RefsSessionStore` constructor sends a `list_refs` CONTROL frame; the
`list_refs_ok` response (handled in `action-dispatch.ts`) → `applyRestoredRefs` re-ingests
the latest run as a `refs` turn.

#### Wire frames (contract) {#wire-frames}

Input (`REFS_INPUT`, serde-tagged, snake_case on the wire):
- `{ "type":"match",  "tug_session_id", "run_id", "root", "needles":[…], "flags":{ any, exact, dirs, case_sensitive, first_only } }`
- `{ "type":"search", "tug_session_id", "run_id", "root", "needles":[…], "replacement":null, "flags":{ any, regex, case_insensitive, all_files, per_line } }`
- `{ "type":"cancel", "tug_session_id", "run_id" }`

Output (`REFS_OUTPUT`, session-scoped; `tug_session_id` spliced in by the feed):
- `{ "type":"refs_started",  "run_id", "kind":"match|search", "command", "root", "started_at" }`
- `{ "type":"refs_rows",     "run_id", "rows":[ TextRef, … ] }`  (streamed batches)
- `{ "type":"refs_complete", "run_id", "total", "cancelled":bool, "settled_at" }`

`TextRef` (wire): `{ "index":u32, "path":string, "line":u32|null, "columns":[[start,end],…], "preview":string|null }` — `match` rows carry `line:null`, empty `columns`, `preview:null`; `search` rows carry `line`, one-or-more `columns` (merged per line unless `-l`), and the matched-line `preview`.

CONTROL: `list_refs` request `{ action:"list_refs", tug_session_id }` → `list_refs_ok`
`{ run_id, kind, command, rows:[TextRef,…] }` (the latest run only).

---

### Specification {#specification}

**Spec S01: Terminology** {#s01-terminology}

- **TextRef** — a numbered file reference: `index` (`#r{n}`), `path`, optional `line`,
  zero-or-more column `spans`, optional matched-line `preview`.
- **Ref list** — the ordered TextRefs of one run; the *latest* run's list is "the current
  refs" that `/ref` resolves against and the ledger stores.
- **run_id** — a per-run identifier (assigned by the store) used to fence streaming frames
  and the ledger clobber ([P12], Risk R05).

**Spec S02: `/match` behavior** {#s02-match}

- `/match <needle>…` walks the workspace root, gitignore + `SecretFilter` applied, and
  emits a TextRef (`line:null`) for each **file** whose filename matches. Default: all
  needles must match (AND), case-insensitive substring, files only. Flags per List L01.
- Fast enough to stream to completion near-instantly; rows are clickable and open the file.

**Spec S03: `/search` behavior** {#s03-search}

- `/search <needle>…` walks the workspace root, reads each candidate text file (UTF-8
  gate, size cap), and emits a TextRef per matching **line** (merged spans; `-l` splits),
  carrying `line`, column spans, and the line `preview`. Default: all needles on a line
  (AND), case-sensitive, string search; `-e` = regex. Flags per List L02. Streams
  incrementally; cancellable; invalid regex → zero results + notice.

**Spec S04: `/ref` behavior** {#s04-ref}

- `/ref <spec>` where `<spec>` is any mix of `N`, `A-B`, and space-separated numbers.
  Resolves against the latest ref list; opens each ref via `open-file` honoring
  `openTarget`; caps at 10 with a subdued warning; out-of-range → subdued error, skipped.
  `search` refs open at `line` (+ column span once [P10] lands); `match` refs open at the
  file top.

**Spec S05: Clickable rows** {#s05-rows}

- Every result row is a clickable file reference built on `ToolFileRef` semantics
  (`data-tug-focus="refuse"`, `data-no-activate`, `mousedown` preventDefault so the click
  never steals first responder), dispatching `open-file` with `{ path, line?, endLine? }`.

**Spec S06: Non-context ink + Share** {#s06-ink}

- `refs` turns are `#r`-addressed and excluded from Claude context (skipped inside Claude
  turns, like `shell`). The block's **Share** affordance is the only path that surfaces a
  result into Claude's context.

**Spec S07: Latest-only persistence** {#s07-persistence}

- Only the latest run persists (per `tug_session_id`); a new completed run clobbers it. A
  card reload restores exactly that run as a `refs` turn.

**List L01: `/match` flags & defaults** {#l01-match-flags}

- Default: case-insensitive, **substring**, **AND** (all needles), files only.
- `-a` — any needle (OR) instead of all.
- `-e` — exact filename match (whole basename).
- `-d` — include directories as candidates.
- `-s` — case-sensitive.
- `-1` — stop at the first match.
- Glob patterns in a needle are honored via `globset`. NOTE: `globset` is currently only a
  *transitive* dep of `ignore` — to `use` it, add it as a **direct** workspace dependency
  (`tugrust/Cargo.toml`) in #step-1; do not rely on the transitive edge.
- **Dropped:** `-c -f -o -p -r` (subsumed by the Tug model, #non-goals).

**List L02: `/search` flags & defaults** {#l02-search-flags}

- Default: case-**sensitive**, **string** search, **AND** (all needles on a line), merged
  spans per line, gitignore + `SecretFilter` skip.
- `-i` — case-insensitive.
- `-e` — needles are regexes (`regex` crate).
- `-y` — any needle (OR) instead of all.
- `-a` (alias `-s`) — descend into gitignored paths too; `SecretFilter` still applies
  ([Q02]).
- `-l` — one row per match (no per-line merge).
- **Dropped:** `-c -t -r -n` (color/terse subsumed; replace/dry-run deferred, #non-goals).

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `RefsSessionStore` snapshot (in-flight run, live, run_id) | structure/local-data | store `subscribe`/`getSnapshot` + `useSyncExternalStore` | [L02] |
| Refs result rows (the `refs` `TurnEntry` + streamed appends) | local-data | `CodeSessionStore` reducer + `useSyncExternalStore` | [L02] |
| `#r` ordinal | local-data | precomputed `refsRowOrdinal` descriptor field in `DevTranscriptDataSource` (single-pass, mirror `shellRowOrdinal`) | [L02] |
| Row click → `open-file` | structure | `dispatchAction(OPEN_FILE)` | [L02] |
| In-flight pulsing header / Stop affordance | appearance | CSS/DOM `data-state`, no React state | [L06] |
| Line reveal flash / column-span highlight | appearance | CM6 decoration / `CSS.highlights` imperative | [L06] |
| Option-cluster toggle values | local-data | store [L02] + tugbank default persistence | [L02] |
| Option-cluster chip appearance | appearance | CSS/DOM | [L06] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/feeds/refs.rs` | The `refs` feed: `RefsInput` enum, `refs_dispatcher_task`, per-session actor, streaming emit, cancel; hosts `match` + `search` ops. ([P02], [P04]) |
| `tugrust/crates/tugcast/src/feeds/walk.rs` | Shared gitignore + `SecretFilter`-aware walk helper lifted from `file_watcher.rs`; skip predicates. ([P06], [Q02]) |
| `tugrust/crates/tugcast/src/feeds/text_ref.rs` | `TextRef` data model + (de)serialization; column-span type. |
| `tugrust/crates/tugcast/src/refs_ledger.rs` | Latest-only sqlite ledger (`refs.db`); `record_run` (clobber) + `list_refs`. ([P05]) |
| `tugdeck/src/lib/refs-session-store.ts` | Per-card store driving `REFS_INPUT`; `run(kind,args)`, `cancel()`, `_fold` → `ingestRefs`; restore via `list_refs`. |
| `tugdeck/src/lib/refs-flags.ts` | Shared getopt-style flag parser/normalizer for `/match` + `/search` (Lists L01/L02); consumed by the store and the option cluster. |
| `tugdeck/src/components/tugways/cards/refs-result-block.tsx` | Shared refs block chrome (header, Share, Copy, in-flight pulse) + dispatch to row renderers. ([P08]) |
| `tugdeck/src/components/tugways/cards/refs-result-view.ts` | Pure view derivation (relativized paths, previews, spans) — unit-tested. ([P08]) |
| `tugdeck/src/components/tugways/cards/blocks/refs-match-row.tsx` | `match` filename row (clickable). |
| `tugdeck/src/components/tugways/cards/blocks/refs-search-row.tsx` | `search` `path:line`+preview row (clickable, span highlight). |
| `tugdeck/src/components/tugways/chrome/refs-option-cluster.tsx` | Transient Case/Regex/All/Any cluster (mounted adjacent to the prompt entry while composing `/match `/`/search `) writing flags into the draft (#step-12). ([P07]) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `pub mod refs; pub mod walk; pub mod text_ref;` | mod decls | `tugcast/src/feeds/mod.rs` | register new modules |
| `mod refs_ledger;` + wiring | mod + wiring | `tugcast/src/main.rs` | clone the shell block: feed, `mpsc`, dispatcher spawn, `register_session_feed`/`register_input`, `set_refs_ledger` |
| `REFS_OUTPUT` / `REFS_INPUT` FeedIds | const | `tugdeck/src/protocol.ts` **and** `tugcast_core::protocol` | propose `0x62`/`0x63`; **verify no collision** before use |
| `CONTROL_ACTION_LIST_REFS = "list_refs"` | const | `tugdeck/src/protocol.ts` + tugcast supervisor | restore read |
| `set_refs_ledger` / `list_refs` handling | fn | tugcast supervisor (`agent_supervisor.rs`) | mirror `set_shell_ledger` + `list_shell_exchanges` |
| `TurnOrigin` += `"refs"` | type | `tugdeck/src/lib/code-session-store/types.ts` | new origin |
| `RefsResultMessage` (`kind:"refs_result"`) | interface | `tugdeck/src/lib/code-session-store/types.ts` | one per `refs` turn; carries `runId, opKind, command, refs[], inFlight, cancelled` |
| `ingestRefs(...)` | method | `tugdeck/src/lib/code-session-store.ts` | mirror `ingestShellExchange`; started/rows/complete actions |
| `buildRefsTurnEntry` + reducer actions + Claude-turn skip | fn | `tugdeck/src/lib/code-session-store/reducer.ts` | mirror `buildShellTurnEntry` + the shell skip |
| `refsRowOrdinal` | descriptor field | `tugdeck/src/lib/dev-transcript-data-source.ts` | precomputed single-pass (mirror `shellRowOrdinal`), 1..N within the restored block |
| `upsertShellTurn` → ink upsert, `appendTurnInterleavingShell` predicate | fn | `tugdeck/src/lib/code-session-store/reducer.ts` | generalize to `shell`+`refs` ink origins ([P13]); streaming upsert + reload interleave |
| `Participant` union + gutter icons, `DevTranscriptCellKind` | type | `tug-transcript-entry.tsx`, `dev-transcript-data-source.ts` | add `"refs"` (documented additive extension) |
| `RefsTurnCell` | component | `tugdeck/src/components/tugways/cards/dev-card-transcript.tsx` | mirror `ShellTurnCell`; participant `"refs"`, identifier, `#r` badge |
| `LOCAL_SLASH_COMMANDS` += match/search/ref | const | `tugdeck/src/lib/slash-commands.ts` | `{ name, description, takesArgs:true }` ×3 |
| `slashCommandSurfaces` += match/search/ref | handlers | `tugdeck/src/components/tugways/cards/dev-card.tsx` | call `refsSessionStore.run(...)` / `.resolveRefs(...)` |
| `RefsSessionStore` construction | wiring | `tugdeck/src/lib/card-services-store.ts` / `use-dev-card-services.ts` | build with `tugSessionId` + `projectDir` (like `ShellSessionStore`) |
| `OPEN_FILE` payload + `openFileInCard` + reveal chain | types/fns | `action-vocabulary.ts`, `open-file-in-card.ts`, `text-card-open-registry.ts`, `text-card.tsx`, `tug-text-card-editor.tsx` | column-range extension (#step-11) |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When |
|----------|---------|------|
| **Unit (Rust)** | `match` op (substring/exact/glob, AND/OR, case, dirs), `search` op (string/regex, case, multi-needle, merge/`-l`, spans), `walk` skip (gitignore + secret + `-a`), `refs_ledger` (clobber + `list_refs`) | Core logic + edge/error paths |
| **Unit (TS)** | `refs-flags.ts` parsing (Lists L01/L02, defaults, unknown flags), `refs-result-view.ts` derivation, `/ref` spec parsing (single/range/list, cap, out-of-range) | Pure logic on real strings |
| **App-test** | Drive the real Dev card: `/match`, `/search` (streaming rows), row-click opens a Text card at line, `/ref 3-5`, cancel, reload-restore | End-to-end behavior |
| **Build** | `cargo nextest run`, `bunx tsc --noEmit`, `bunx vite build` | Before "done" |

#### What stays out of tests {#test-non-goals}

- No mock-store or jsdom render tests (banned) — search/flag logic is tested on real
  strings; UI via `just app-test`.
- No screenshot pixel-diff of the reveal flash / column highlight — assert range/attribute
  state (WebKit collapsed-range wash gotcha, Risk R04).
- Search-and-replace paths — not built (#non-goals), nothing to test.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Commit on `main` (repo policy — the user commits).
> Each step is a slice; most are runnable in the live-HMR app (Rust steps run via nextest).

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Shared walk helper + `TextRef` model + `match` op (pure Rust) | pending | — |
| #step-2 | `search` op — content grep (pure Rust) | pending | — |
| #step-3 | `refs` feed — wiring, streaming, cancel | pending | — |
| #step-4 | `refs_ledger` — latest-only + `list_refs` | pending | — |
| #step-5 | Frontend protocol + `RefsSessionStore` + `refs` origin | pending | — |
| #step-6 | Refs block chrome + two row renderers + clickable refs | pending | — |
| #step-7 | `/match` + `/search` slash commands + typed flags | pending | — |
| #step-8 | `/ref` resolution + multi-open honoring `openTarget` | pending | — |
| #step-9 | Reload restore via the ledger | pending | — |
| #step-10 | Integration checkpoint (core vertical slice) | pending | — |
| #step-11 | Column-span highlight for `search` refs | pending | — |
| #step-12 | Transient option cluster + tugbank persistence | pending | — |
| #step-13 | Final integration checkpoint | pending | — |

#### Step 1: Shared walk helper + `TextRef` model + `match` op (pure Rust) {#step-1}

**Commit:** `refs(rust): shared gitignore walk + TextRef model + match filename op`

**References:** [P02] One-feed, [P06] Workspace root, [P11] Flags/skip, [P12] Numbering,
Spec S02, List L01, ([Q02] skip model, #wire-frames)

**Artifacts:**
- `tugcast/src/feeds/walk.rs` — a reusable `walk_files(root, opts) -> impl Iterator`
  built on `ignore::WalkBuilder` (`.git_ignore(true)`, `.hidden(false)`, `require_git(false)`,
  `.git`-skip), applying `SecretFilter::new(root)`; an `include_gitignored` option for
  `-a`/`-s`; optional `include_dirs`. Factor from `file_watcher.rs`'s `walk_with_cap`.
- `tugcast/src/feeds/text_ref.rs` — `TextRef { index, path, line: Option<u32>, columns: Vec<(u32,u32)>, preview: Option<String> }` + serde.
- `match` op in `tugcast/src/feeds/refs.rs` (op fn, feed wiring comes in #step-3):
  `run_match(root, needles, MatchFlags) -> Vec<TextRef>` — substring/exact/glob filename
  match, AND/OR, case per flags, dirs per `-d`, `-1` stop-at-first.
- `pub mod walk; pub mod text_ref; pub mod refs;` in `feeds/mod.rs`.

**Tasks:**
- [ ] Add `globset` as a **direct** workspace dep (`tugrust/Cargo.toml`) — it is only a
      transitive dep of `ignore` today and cannot be `use`d without declaring it (List L01).
- [ ] Lift the `WalkBuilder` setup into `walk.rs`; keep `WALK_CAP`; apply `SecretFilter`
      always; add `include_gitignored`.
- [ ] Implement `run_match` with List L01 semantics; default case-insensitive substring, AND.
- [ ] Relativize emitted paths against `root` via `PathResolver` conventions.

**Tests:**
- [ ] Unit: substring vs exact vs glob; AND vs `-a`; case default vs `-s`; `-d` includes a
      dir; `-1` stops; a gitignored file is skipped without `-a` and included with it; a
      `SecretFilter` denylisted path (`.env`) is **never** emitted even with `-a`.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` passes; `cargo build` clean (no warnings).

---

#### Step 2: `search` op — content grep (pure Rust) {#step-2}

**Depends on:** #step-1

**Commit:** `refs(rust): search content-grep op (string/regex, rayon, merged spans)`

**References:** [P04] Streaming (op returns per-file batches), [P11] Flags, [P12] Numbering,
Spec S03, List L02, Risk R01, Risk R02, Risk R03, ([Q03] merge)

**Artifacts:**
- `search` op in `refs.rs`: `scan_file(path, needles, SearchFlags) -> Vec<TextRef>` reading
  via the `fs_read` UTF-8/size-gated pattern; string search (default) or `regex` (`-e`);
  case per `-i`; AND (default) / `-y` any across needles on a line; merge spans per line
  unless `-l`; compute `line`, column `spans`, and the line `preview`.
- A `run_search(root, needles, flags) -> impl ParallelIterator`/callback that walks via
  `walk.rs` and scans files with `rayon`, yielding per-file `Vec<TextRef>` batches (feed
  consumes them in #step-3).

**Tasks:**
- [ ] Implement per-file scan with List L02 semantics; guard `Regex::new` (invalid → empty,
      no panic); skip non-UTF-8 and oversized files.
- [ ] Merge multiple matches on a line into one `TextRef` with multiple spans; `-l` splits.
- [ ] Parallelize file scans with `rayon`; keep each file's matches sorted by (line, col).

**Tests:**
- [ ] Unit: string vs `-e` regex; `-i` case; AND vs `-y`; merged spans vs `-l`; multi-needle
      on one line; invalid regex → zero + no panic; binary file skipped; correct
      `line`/`columns`/`preview` on a known fixture.

**Checkpoint:**
- [ ] `cargo nextest run -p tugcast` passes; `cargo build` clean.

---

#### Step 3: `refs` feed — wiring, streaming, cancel {#step-3}

**Depends on:** #step-2

**Commit:** `refs(rust): REFS feed — dispatcher, streaming frames, cancellation`

**References:** [P02] One-feed, [P04] Streaming, [P12] Numbering, Risk R01, Risk R05,
(#wire-frames, #data-flow)

**Artifacts:**
- `RefsInput` serde-tagged enum (`match`/`search`/`cancel`) + `refs_dispatcher_task` +
  per-session actor in `refs.rs`, cloned from `shell.rs`'s dispatcher/actor shape.
- Streaming emit of `refs_started` / `refs_rows` (batched) / `refs_complete`; assign
  `#r` indices in emission order ([P12]); a `run_id` fence; `cancel` reaps the run.
- **Actor run policy:** a new `match`/`search` for a session **cancels-and-replaces** any
  in-flight run for that same session (rather than queuing) — the ledger is latest-only
  ([P05]), so a superseded run's results would be clobbered anyway; the prior run's
  `run_id` is fenced off and its `refs_complete` is dropped (Risk R05).
- `main.rs` wiring: `SessionScopedFeed::new(FeedId::REFS_OUTPUT, …)`, `mpsc` input channel,
  `refs_dispatcher_task` spawn, `register_session_feed(&refs_output_feed)`,
  `register_input(FeedId::REFS_INPUT, refs_input_tx)`.
- `REFS_OUTPUT`/`REFS_INPUT` FeedId constants in `tugcast_core::protocol` and
  `tugdeck/src/protocol.ts`. **Confirmed free:** `0x60`/`0x61` are shell and the next used
  value is `0x70` (`TUG_FEED`), so `0x62`/`0x63` are open — still re-grep both files before
  committing the values.

**Tasks:**
- [ ] Add the FeedIds `REFS_OUTPUT = 0x62` / `REFS_INPUT = 0x63` (confirmed free above;
      re-grep to be safe) in `tugcast_core::protocol` and mirror in `protocol.ts`.
- [ ] Implement the dispatcher/actor; stream `match` (fast) and `search` (rayon) through the
      same frames; fence late frames by `run_id`; handle `cancel`; a new run for a live
      session cancels-and-replaces the prior in-flight run.

**Tests:**
- [ ] Rust integration (feed-level): a `search` request over a temp tree emits
      `refs_started` → `refs_rows` (monotonic `#r`) → `refs_complete`; a `cancel` mid-run
      yields `refs_complete{cancelled:true}`.

**Checkpoint:**
- [ ] `cargo nextest run -p tugcast` passes; `cargo build` clean.

---

#### Step 4: `refs_ledger` — latest-only + `list_refs` {#step-4}

**Depends on:** #step-3

**Commit:** `refs(rust): latest-only refs ledger + list_refs control read`

**References:** [P05] Ledger, Spec S07, (#wire-frames)

**Artifacts:**
- `tugcast/src/refs_ledger.rs` cloned from `shell_ledger.rs`: `default_path()` → sibling
  `refs.db`, `open`/`open_in_memory`, schema (one run per session: `tug_session_id`
  primary-ish key, `run_id`, `op_kind`, `command`, serialized `rows`), `record_run`
  (delete prior rows for the session, insert the new list), `list_refs(tug_session_id)`.
- `main.rs`: build the ledger (like `shell_ledger`), pass to the dispatcher (record on
  `refs_complete`, skip if cancelled) and `supervisor.set_refs_ledger`.
- Supervisor `list_refs` CONTROL handler returning `list_refs_ok`.

**Tasks:**
- [ ] Implement clobber-on-complete; do not persist cancelled runs.
- [ ] Wire the CONTROL read through the supervisor.

**Tests:**
- [ ] Unit: `record_run` twice for one session leaves only the latest; `list_refs` returns
      it; a different session is unaffected.

**Checkpoint:**
- [ ] `cargo nextest run -p tugcast` passes; `cargo build` clean.

---

#### Step 5: Frontend protocol + `RefsSessionStore` + `refs` origin {#step-5}

**Depends on:** #step-3

**Commit:** `refs(deck): REFS protocol, RefsSessionStore, refs turn origin + ingest`

**References:** [P02] One-feed, [P03] Refs-origin, [P04] Streaming, [P13] Ink-insertion,
Spec S06, [L02], (#data-flow, #p13-ink-insertion), Dependencies (#dependencies)

**Artifacts:**
- `tugdeck/src/protocol.ts`: `REFS_OUTPUT`/`REFS_INPUT` FeedIds (match Rust) +
  `CONTROL_ACTION_LIST_REFS`.
- `tugdeck/src/lib/refs-session-store.ts`: an [L02] store built with `tugSessionId` +
  `projectDir`; `run(kind, parsedFlags)` sends `REFS_INPUT`, `cancel()` sends `cancel`,
  `_fold(frame)` mirrors started/rows/complete into `CodeSessionStore.ingestRefs`;
  constructor sends `list_refs` for restore.
- `types.ts`: `TurnOrigin` += `"refs"`; `RefsResultMessage`.
- `code-session-store.ts` `ingestRefs`; `reducer.ts` `buildRefsTurnEntry` + started/rows/
  complete actions + a `refs_result` skip inside Claude turns (sibling of the existing
  `shell_exchange` skip).
- **Generalize the ink-turn insertion helpers** ([P13]): `upsertShellTurn` →
  ink-origin upsert (used by streaming `ingestRefs` to replace the in-flight turn by
  `turnKey` as `refs_rows` arrive) and `appendTurnInterleavingShell`'s trailing-walk
  predicate to include `refs` — both in `reducer.ts`, invoked via the store wrapper's
  `ingest-shell-turn` / `append-transcript` effects.
- `dev-transcript-data-source.ts`: a `refsRowOrdinal` **precomputed descriptor field** in
  the single-pass row build (mirror `shellRowOrdinal`, NOT a live per-row method). Because
  the ledger restores only one block ([P05]), the ref ordinal is simply `1..N` within that
  block — no session-wide counter.
- Construct `RefsSessionStore` in `card-services-store.ts` / `use-dev-card-services.ts`
  (subscribe `REFS_OUTPUT` via `subscribeSessionFeed`, like shell); thread it to the
  `slashCommandSurfaces` handlers in `dev-card.tsx` (parity with `shellSessionStore`).

**Tasks:**
- [ ] Add FeedIds; confirm the code-session feed filter does NOT consume `REFS_OUTPUT`
      (refs reach only `RefsSessionStore`, mirroring the shell filter exclusion).
- [ ] Generalize `upsertShellTurn` + `appendTurnInterleavingShell` to ink origins
      (`shell` + `refs`) per [P13]; route streaming `refs_rows` updates through the
      ink upsert so the in-flight turn settles in place (not a duplicate row).
- [ ] Implement the store + ingest + reducer; append `refs_rows` to the in-flight message
      as [L02] store updates (not DOM).

**Tests:**
- [ ] Unit (real reducer/store, mirror `code-session-store.shell-exchange.test.ts`):
      started+rows+complete builds one `refs` turn; successive `refs_rows` upsert in place
      (row count stays 1, refs accumulate); a cancelled complete marks the message; a
      `refs` turn interleaves correctly when a restore lands after a trailing shell turn
      ([P13]).

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean; `bunx vite build` succeeds.
- [ ] Live (temporary log): sending a `run` frame yields `refs_*` frames the store folds
      (assert via `tugDevLogStore`).

---

#### Step 6: Refs block chrome + two row renderers + clickable refs {#step-6}

**Depends on:** #step-5

**Commit:** `refs(deck): RefsResultBlock chrome + match/search rows, clickable file refs`

**References:** [P08] Two-renderers, [P03] Refs-origin, Spec S05, Spec S06, Spec S02,
Spec S03, [L02], [L06], (#state-zone-mapping)

**Artifacts:**
- `RefsTurnCell` in `dev-card-transcript.tsx` (mirror `ShellTurnCell`: participant `"refs"`,
  `#r` badge from the precomputed `refsRowOrdinal` descriptor field, timestamp). Extend the
  `Participant` union + gutter-icon registry in `tug-transcript-entry.tsx` and add
  `"refs"` to `DevTranscriptCellKind` (both are documented additive extension points).
- `refs-result-block.tsx` (shared chrome: command header, Share + Copy, in-flight pulse via
  `data-state` [L06]) dispatching to `refs-match-row.tsx` / `refs-search-row.tsx` by
  `opKind`.
- `refs-result-view.ts` (pure derivation).
- Rows built on `ToolFileRef` semantics → `open-file` (line-granular for search;
  file-top for match) (Spec S05).

**Tasks:**
- [ ] Render a streaming refs turn; rows grow as the message updates; in-flight header
      pulses; completed shows total.
- [ ] Wire Share (reuse the shell block's share path) and Copy.

**Tests:**
- [ ] App-test: a synthesized/real refs turn renders both row kinds; clicking a search row
      opens a Text card scrolled to the line; clicking a match row opens the file.

**Checkpoint:**
- [ ] `bunx vite build` succeeds; live: a refs turn renders and rows open Text cards.

---

#### Step 7: `/match` + `/search` slash commands + typed flags {#step-7}

**Depends on:** #step-6

**Commit:** `refs(deck): /match and /search local slash commands + flag parsing`

**References:** [P01] Slash-not-route, [P07] Flags-truth, [P11] Flags, List L01, List L02,
(#dependencies)

**Artifacts:**
- `slash-commands.ts`: `LOCAL_SLASH_COMMANDS` += `{name:"match", takesArgs:true}`,
  `{name:"search", takesArgs:true}`.
- `refs-flags.ts`: parse `/match`/`/search` args into needles + normalized flags (Lists
  L01/L02); unknown flag → subdued notice, ignored.
- `dev-card.tsx` `slashCommandSurfaces`: `match`/`search` handlers → `refsSessionStore.run`.
- Stop/cancel affordance in the in-flight block dispatches `refsSessionStore.cancel()`.

**Tasks:**
- [ ] Register the commands (completion/`/m`-inline/history auto-derive).
- [ ] Parse flags; run the op; stream rows; wire cancel.

**Tests:**
- [ ] Unit: `refs-flags` parses representative `/match`/`/search` lines (defaults, each flag,
      combined, unknown).
- [ ] App-test: `/search foo` streams a `#r` block; `/match foo` lists filenames; a long
      `/search` is cancellable.

**Checkpoint:**
- [ ] `bunx vite build` succeeds; live: both commands produce clickable `#r` blocks.

---

#### Step 8: `/ref` resolution + multi-open honoring `openTarget` {#step-8}

**Depends on:** #step-7

**Commit:** `refs(deck): /ref number resolution + multi-open via openTarget`

**References:** [P09] Ref-open, Spec S04, (#dependencies)

**Artifacts:**
- `slash-commands.ts`: `{name:"ref", takesArgs:true}` (accept `/r` inline-completion prefix).
- `dev-card.tsx` handler `ref`: parse the spec (single/range/list), resolve against the
  latest refs (from `RefsSessionStore` / the latest `refs` turn), `dispatchAction(OPEN_FILE)`
  per ref honoring `openTarget`, cap at 10 with a subdued warning, out-of-range → subdued
  error.

**Tasks:**
- [ ] Implement spec parsing + resolution + capped multi-open.

**Tests:**
- [ ] Unit: spec parser (`3`, `3-5`, `3 7 9`, mixed, cap, out-of-range).
- [ ] App-test: after a `/search`, `/ref 3-5` opens refs 3–5 per the `openTarget` pref.

**Checkpoint:**
- [ ] `bunx vite build` succeeds; live: `/ref` opens the right files.

---

#### Step 9: Reload restore via the ledger {#step-9}

**Depends on:** #step-4, #step-8

**Commit:** `refs(deck): restore latest refs block on card reload`

**References:** [P05] Ledger, Spec S07, (#data-flow)

**Artifacts:**
- `action-dispatch.ts`: `list_refs_ok` handler → `applyRestoredRefs` re-ingesting the latest
  run as a `refs` turn (mirror `applyRestoredShellExchanges`).
- `RefsSessionStore` constructor already sends `list_refs` (#step-5); wire the response.

**Tasks:**
- [ ] Restore the latest run on mount; `/ref N` resolves against the restored list.

**Tests:**
- [ ] App-test: run `/search`, Maker ▸ Reload, the last `#r` block reappears and `/ref N`
      still resolves.

**Checkpoint:**
- [ ] `bunx vite build` succeeds; live: reload restores the last refs block.

---

#### Step 10: Integration checkpoint (core vertical slice) {#step-10}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, Spec S02, Spec S03, Spec S04, Spec S07)

**Tasks:**
- [ ] Verify end-to-end: `/match`, `/search` (streaming + cancel), row-click opens at line,
      `/ref` single/range/list, clobber on a new run, reload restore.

**Tests:**
- [ ] App-test: the aggregate match/search/ref scenario on a real workspace.

**Checkpoint:**
- [ ] `cargo nextest run` + `bunx vite build` + `just app-test` pass.

---

#### Step 11: Column-span highlight for `search` refs {#step-11}

**Depends on:** #step-10

**Commit:** `refs(deck): column-span highlight when opening a search ref`

**References:** [P10] Column-highlight, Risk R04, Spec S03, (#symbols)

**Artifacts:**
- Extend the reveal chain to carry a column range: `OPEN_FILE` payload
  (`action-vocabulary.ts`), `openFileInCard` signature, `revealOnOpen` seed +
  `TextCardOpenEntry.revealLine`/`openFile` (`text-card-open-registry.ts`, `text-card.tsx`),
  and `revealLineFn` (`tug-text-card-editor.tsx`) painting a `Decoration.mark` or a
  registered `CSS.highlights` range for the span(s) instead of the line-only flash.
- `refs-search-row.tsx` passes the first span's columns on click (and `/ref` for search
  refs).

**Tasks:**
- [ ] Thread columns end-to-end; paint only non-empty spans (bare line → existing flash,
      Risk R04).

**Tests:**
- [ ] App-test: clicking a search ref highlights the exact match span (assert range/attr
      state, not pixels).

**Checkpoint:**
- [ ] `bunx vite build` succeeds; live: the matched span highlights on open.

---

#### Step 12: Transient option cluster + tugbank persistence {#step-12}

**Depends on:** #step-10

**Commit:** `refs(deck): Case/Regex/All/Any option cluster writing flags into the draft`

**References:** [P07] Flags-truth, [P11] Flags, [L02], [L06], [L11], (#state-zone-mapping,
#p07-flags-truth)

**Artifacts:**
- `refs-option-cluster.tsx`: a `TugOptionGroup` mounted as a **transient affordance adjacent
  to the prompt entry** (NOT a route Z4B slot — these commands have no route, [P01]), shown
  only while the live draft begins with `/match `/`/search ` (observe the draft the same way
  the argument-hint / completion extensions do). Toggling a chip inserts/removes the
  equivalent flag token in the draft (via `refs-flags.ts`); `data-tug-focus="refuse"` so it
  never steals the editor's first responder ([L11]).
- Persist toggle defaults via tugbank (`/api/defaults/refs/options`), seeding initial state;
  a per-invocation typed flag overrides. **Fallback (per [P07]):** if the transient mount
  proves fiddly, ship **persisted-defaults-only** (no live cluster) — typed flags still
  fully drive behavior; do not block the phase on the cluster.

**Tasks:**
- [ ] Choose the mount point adjacent to the prompt entry and gate it on the live draft
      prefix; render the cluster only while composing `/match `/`/search `.
- [ ] Chips ⇄ flag tokens in the draft; persist/read the tugbank default.

**Tests:**
- [ ] App-test: toggling Regex/Case on a `/search` draft inserts `-e`/`-i`; the run reflects
      it; toggles persist across a Maker ▸ Reload.

**Checkpoint:**
- [ ] `bunx vite build` succeeds; live: cluster writes flags and persists.

---

#### Step 13: Final integration checkpoint {#step-13}

**Depends on:** #step-10, #step-11, #step-12

**Commit:** `N/A (verification only)`

**References:** (#exit-criteria, #success-criteria)

**Tasks:**
- [ ] Full pass: streaming + cancel, clickable refs with column highlight, `/ref`
      multi-open, clobber + reload restore, option cluster + persistence, non-context-ink +
      Share.

**Tests:**
- [ ] App-test: the aggregate scenario including column highlight and the option cluster.

**Checkpoint:**
- [ ] `cargo nextest run` + `bunx tsc --noEmit` + `bunx vite build` + `just app-test` pass.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three local slash commands — `/match`, `/search`, `/ref` — where
`/match`/`/search` run Rust filename/content search from the workspace root and stream a
numbered, clickable, cancellable, non-context `#r` file-reference block into the Dev card
transcript (latest-only, ledger-restored), and `/ref` opens refs by number into Text cards
honoring the deck's open preference.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `/search` streams a numbered `#r` block; rows appear incrementally; a click opens the
      file at its line (with the match span highlighted after #step-11). (Spec S03, S05, P10)
- [ ] `/match` lists matching filenames; a click opens the file. (Spec S02, S05)
- [ ] `/ref 3` / `3-5` / `3 7 9` open the right refs from the latest block honoring
      `openTarget`, capped and warned. (Spec S04, P09)
- [ ] A run is cancellable; an invalid `-e` regex yields zero results, no crash. (P04, R02)
- [ ] A new run clobbers the ledger; a reload restores the last block; `/ref N` still
      resolves. (Spec S07, P05)
- [ ] Refs never enter Claude context except via Share; `SecretFilter` paths never appear.
      (Spec S06, R03)
- [ ] `cargo nextest run`, `bunx tsc --noEmit`, `bunx vite build`, `just app-test` all pass.

**Acceptance tests:**
- [ ] Rust unit + feed + ledger suites (Steps 1–4).
- [ ] TS unit suites (`refs-flags`, `refs-result-view`, `/ref` parser).
- [ ] App-test aggregate match/search/ref scenario (Steps 10, 13).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `/find` — a thin slash alias into the transcript-search Find route once `find-route.md`
      lands ([Q04]).
- [ ] Search-and-replace (`search -r`) with a dry-run preview and an undo-safe apply.
- [ ] A `searchable`/`skippable` config surface (extension allowlist) if the gitignore +
      `SecretFilter` model proves too coarse.
- [ ] Sorted (not emission-order) numbering as an option, if users want the C++ global sort.

| Checkpoint | Verification |
|------------|--------------|
| Rust ops correct | `cargo nextest run -p tugcast` (match/search/walk/ledger) |
| Streaming + cancel | app-test: rows arrive incrementally; cancel settles the block |
| Clickable refs | app-test: row click opens a Text card at line (+span after #step-11) |
| `/ref` multi-open | app-test: `/ref 3-5` opens per `openTarget` |
| Latest-only + restore | app-test: new run clobbers; reload restores; `/ref` resolves |
| Non-context ink | refs excluded from Claude context; Share is the only bridge |
| Build + tests | `cargo nextest run` + `bunx vite build` + `just app-test` |

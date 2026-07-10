# The Turn Metric — One Canonical Count, Origin-First

*"How many turns is this session?" has exactly one answer, and "who spoke in
this turn?" is never inferred — it is stated. This document is the single
definition of both. Every counter in the codebase — the tugcast segmentation
engine, the disk scanner, the tugcast ledger, the session picker, the tugcode
replay/live segmenter, the transcript badge — either **is** the authority or
**reconciles to** it. None of them invents its own rule, and none of them
fabricates an attribution the user did not make.*

---

## The authority

A session's canonical turn count is **`engine(session file)`** and nothing
else. A single Rust **segmentation engine** in tugcast
(`tugcast/src/turn_engine.rs`, `segment_turns`) parses a session's JSONL into
an ordered list of origin-tagged turns and produces the count. That engine is
the **single producer** of the count for *both* the picker (the pre-open disk
scan) and the resume authority. The count is a pure function of the file, so
it is recomputable anywhere and cannot drift from itself.

tugcode's replay/live segmenter still segments for **rendering** — it tells
the reducer how to lay out a turn — but it is **not** a count authority. Its
rendering segmentation is held byte-for-byte equal to the engine by a contract
over the real local session corpus (S03, the real-corpus contract). The one
place tugcode segments without the engine behind it is the **in-flight live
turn** that has not yet been written to disk — that is rendering of an
uncommitted turn, the lone accepted transient (Risk R05), never a second
source of the number.

There is exactly **one writer** of the persisted count. The ledger's
`turn_count` is a *cache* of `engine(file)`, refreshed only via the engine.
The three competing writers of the old model — a scan-cache seed, a
wire-`totalTurns` reconcile parsed off tugcode, and a live `+1` per
`turn_complete` — are removed (S03).

---

## S01 — The origin-first turn model

A session is an ordered list of **turns**. Each turn has:

- an **`origin`**: `user` | `assistant` | `shell` (`#s` — a `$`-route command
  exchange, threaded into the transcript as non-context ink; see [D111]);
- a **`messages`** sequence (the content substrate);
- a **user message present iff `origin === user`**. There is no other case.
  A turn with `origin: assistant` has no user message, because the user did
  not submit one — and none is fabricated to stand in for the user. A
  `shell`-origin turn holds a single `shell_exchange` message and likewise
  has no user message.

### What opens a turn

A turn opens when exactly one of these happens:

1. **A genuine user submission** opens an `origin: user` turn. This is a
   `type:"user"` JSONL record carrying real submitted content (text and/or
   image) that is none of the exclusions below. The user-message slot exists
   *because the user actually submitted*.

2. **Assistant content with no open turn** opens an `origin: assistant` turn —
   with no user row and no user message. This single mechanism covers every
   non-user opener:
   - a **wake** / `<task-notification>` continuation,
   - a **`/compact`** continuation resuming after a summary,
   - a **`--continue` leading orphan** (assistant output before any user
     submission in the file),
   - any other **orphan assistant output** that arrives with no turn open.

   A **wake** is this same assistant-originated opener carrying an optional
   `wakeTrigger` annotation. The wake is an *annotation on* an
   assistant-originated turn, not a separate attribution path.

### What does NOT open a turn

These `type:"user"` records are skipped and open no turn (the engine and
tugcode must agree on every one of them):

- **`tool_result` echoes** — array content whose only blocks are
  `tool_result` (no genuine submitted block);
- **`/compact` summary continuations** — a bare-string record with
  `isCompactSummary === true` (the "This session is being continued…"
  summary `/compact` injects); the *assistant* content that follows it opens
  an `origin: assistant` turn, but the summary record itself opens nothing;
- **slash-command scaffolding** — a bare string starting with one of
  `<command-name>`, `<command-message>`, `<command-args>`,
  `<local-command-stdout>`, `<local-command-caveat>`;
- **`isMeta === true` records** — SDK bookkeeping (image-coordinate /
  source-path hints, skill-body loaders, `/loop` content imports), skipped
  before any content split regardless of content shape;
- **the interrupt-marker sentinel** — a record whose combined text is
  `[Request interrupted by user…]` (exact, or the prefix followed by a
  space-led suffix before the closing `]`) **and** which carries **no**
  `permissionMode` field. Both signals must agree: the SDK injects the marker
  without `permissionMode`, whereas every real user submission carries one,
  so a user who literally types the marker text still counts.

An `assistant` or `system` record on its own does **not** get skipped — it
opens an `origin: assistant` turn if no turn is open (that is the
assistant-originated opener above), and otherwise extends the open turn.

### The count

The canonical count is the **number of turn containers**, of every origin —
user-originated and assistant-originated alike, each honestly attributed
([P04] count-all). The synthesized openers the old model counted as phantom
`#u` rows are still counted — now as honest `#a` turns. **Wakes,
continuations, and orphans count. Interrupt markers and `isMeta` records do
not.**

The **highest rendered address equals the count** by construction (S02).

---

## S02 — Per-row addressing by speaker

Each attribution row is addressed **`#{speaker}{turn}`**:

- **`#u{turn}`** — a user row (genuine user submission only);
- **`#a{turn}`** — an assistant row;
- **`#s{turn}`** — a shell row: one `$`-route command exchange (command +
  output + exit), rendered as visually-distinct non-context ink ([D111]).
  A `shell`-origin turn renders exactly this one row — no `#u`.

There is **no `#x`** ("other") prefix. Wakes and continuations are the
assistant speaking, so they are `#a`.

- A **user-originated turn** (`origin: user`) renders two attribution rows
  sharing the turn number: `#u{turn}` (the user submission) and `#a{turn}`
  (the assistant's response).
- An **assistant-originated turn** (`origin: assistant`) renders **one**
  attribution row: `#a{turn}`. No `#u` row exists, because no user message
  exists to render.

The address is derived from the turn's **`origin`** and its turn number — it
is **never inferred from `messages[0]`**, and it is appearance derived from
data (rendered, never held in React state).

The turn number is `firstLoadedTurnIndex + localTurnIndex` rendered 1-based —
absolute and session-global. `firstLoadedTurnIndex` is the base of the loaded
window (from tugcode's window dry run); paging older history shifts only the
absolute base, never a turn's attribution.

### The unforgeable-attribution invariant

A code-constructed entity must **never** masquerade as something the user did.
Because the user-message slot exists *iff* `origin === user`, "a non-user turn
presented as a user action" is **structurally impossible** — there is no
fabricated empty `add_user_message` to mint a fake user opener ([P01]). This
is the load-bearing honesty invariant of the metric.

---

## S03 — Count production and consumption (one authority)

The canonical count is `engine(session file)`. The Rust engine is the **only**
writer of the count; every consumer reads it ([P08], [Q01]):

- **Picker / scan.** The disk scan runs the engine; the
  `external_scan_cache` stores its output (count + per-turn origins + frontier
  open-turn state), keyed by `(file_size, file_mtime, rule_epoch)`. The
  `rule_epoch` is bumped so any pre-rule cached count is invalidated.
  Incremental resume carries forward the engine's **frontier open-turn
  state**, not merely an offset+count, so an incremental scan can never
  undercount what a full re-segment would find. Only newline-terminated lines
  advance the frontier; the in-progress final line is left for the next scan.

- **Resume.** `set_turn_count` is fed by the engine — the fingerprint-validated
  cached `engine(file)`, or, when there is **no** cache entry (a resume that
  bypassed a picker scan), the engine run on the resolved file path
  (`project_dir` + `claude_session_id` + `.jsonl`). The old
  `parse_replay_complete_total_turns` is removed as a count source. The picker
  count and the resume count are therefore equal **by construction** — the
  picker count never shifts when a session is opened ([P06]).

- **Live.** `record_turn`'s `turn_count + 1` increment is removed as a count
  authority; only its `last_used_at` touch remains. A live session's ledger
  count is refreshed by the **existing scan-on-`list_sessions`** path (picker
  open), not a per-append trigger. Between scans, the open card's badge
  (tugcode rendering) is the live truth, and **live-row visibility** rides the
  file-bytes / live-state signal (`file_size > 0 || state === "live"`), not
  `turn_count` — so a stale-between-scans count hides no live row.

- **Wire (validate-and-stamp, never a blind stamp).** `resolveWindow` derives
  **both** `totalTurns` and `firstLoadedTurnIndex` from tugcode's window dry
  run, and the highest rendered address is `firstLoadedTurnIndex +
  loadedTurns` — so stamping only `totalTurns` would split the sources. At the
  `replay_complete` rewrite point (where tugcast already rewrites outbound
  frames via the telemetry injection), tugcast **asserts tugcode's wire
  `totalTurns` equals `engine(file)` and stamps the engine value**. When they
  agree (the healthy case) the window indices are coherent by construction; a
  mismatch is logged loudly as a **contract breach**, the engine value wins,
  and the divergent session is surfaced — a runtime signal, never a silent
  split.

- **Migration.** The `rule_epoch` bump invalidates the scan cache **and** the
  next scan re-`set_turn_count`s **every** existing ledger row from the engine
  (not only sparse or absent rows), **live rows included** — `engine(file)` is
  the correct on-disk count (the frontier skips the in-progress final line),
  so a live row is corrected too, not skipped. The bounded
  badge-vs-`engine(file)` difference is the in-flight transient (Risk R05),
  not a clobber.

- **The engine segments the JSONL file directly** — it is the single
  file→turns authority. The tugcode wire opener vocabulary is only how tugcode
  *represents* that segmentation to the reducer for rendering; the real-corpus
  contract ties the two together, per-turn (origin + ordinal), over the real
  local corpus. tugcode's sole independent segmentation is the in-flight live
  turn (rendering, the lone transient; Risk R05).

### The equality invariant

For any session — including one restored through a window:

```
engine(file)  ==  picker subtitle N  ==  ledger turn_count
              ==  resume authority count  ==  highest rendered address (#a/#u)
```

One producer makes this true *by construction*: the picker count and the
authority count are the same `engine(file)`, so a session shows the same
number before and after it is opened. Rendering equality (engine == tugcode
segmentation, per-turn) is then a **verified property** — the real-corpus
contract is its gate — not a second source of truth.

---

## Honest opener vocabulary (the wire)

- `add_user_message` is emitted **only** for a genuine user submission, and
  **never** with empty or synthetic content. The synthesized
  `add_user_message{content:[]}` that the old `handleAssistantEntry` minted on
  replay, and the live empty-opener follow-up in `session.ts`, are both
  **deleted**.
- A **neutral assistant-originated opener** (no wake baggage) opens an
  `origin: assistant` turn with no user message. A **wake** is this same
  opener carrying an optional `wakeTrigger` annotation.
- The reducer opens a turn with a given `origin` and seeds the turn's message
  scratch with `[userMessage]` **iff** `origin === "user"`, else `[]`. A
  no-user-content turn is the natural product of opening with
  `origin: "assistant"` — there is no `user_message` to fabricate. This
  generalizes the existing wake construction (`handleWakeStarted` already
  seeds an empty scratch) into one origin-parameterized primitive; the
  `isWake` boolean and the `messages[0]` user-ness inference are removed.

---

## What reconciles to what

| Touch point | Role | Relationship to the authority |
|---|---|---|
| `engine(file)` (`segment_turns`) | **authority** | the definition itself — the single count producer |
| `external_scan_cache` (count + origins + frontier) | persisted engine output | guarded by `(file_size, file_mtime, rule_epoch)`; epoch-bumped |
| picker subtitle `N turns` | read | reads the persisted `engine(file)` count |
| resume `set_turn_count` | authoritative SET | reads cached `engine(file)`, or runs the engine on the resolved path when no cache entry exists |
| live `record_turn` | `last_used_at` touch only | **no** count increment; live count refreshed by scan-on-`list_sessions` |
| wire `replay_complete.totalTurns` | validate-and-stamp | tugcast asserts `== engine(file)` and stamps the engine value; mismatch is a logged contract breach (engine wins) |
| transcript badge / per-row address | read | rendered from `origin` + turn number; highest equals `engine(file)` |

---

## Rewind carve-out — a deliberately separate concept

`session.ts`'s chop / `priorSubmissions` logic anchors on genuine user
*submissions*, not on the turn metric — it intentionally does **not** anchor
on assistant-originated (wake / continuation / orphan) turns. This is a
related-but-distinct concept and is **out of scope** for the turn metric. If a
shared predicate is ever renamed or relocated, rewind must keep compiling
against its own copy (or an explicitly-shared-but-distinct helper) — do not
silently fold rewind into the turn rule.

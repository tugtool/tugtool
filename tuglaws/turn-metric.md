# The Turn Metric — One Canonical Count

*"How many turns is this session?" has exactly one answer. This document is
the single definition of that answer and the address scheme built on it.
Every counter in the codebase — the Rust disk scanner, the tugcode replay
segmenter, the tugcast ledger, the session picker, the transcript badge —
either **is** the authority or **reconciles to** it. None of them gets to
invent its own rule.*

---

## The authority

A **turn** is one *response cycle* opened by a single opener — a user
submission or a wake. Most turns commit as a tugcode `turn_complete`; a wake
turn commits as a `wake_started`, and a turn interrupted at the EOF/window
edge may never commit at all, yet all three are turns. tugcode's wire/replay
segmenter is the **single authority**
for what opens a turn, because it is the only path that sees the full,
ordered wire stream with the wake / compaction / scaffolding context
applied. It already computes the session's total — even under a replay
window — and reports it as `totalTurns` on `replay_complete`
(`tugcode/src/replay.ts`, `resolveWindow` — `totalTurns` is the length of
the turn list `computeTurnStartIndices` locates, itself a dry run of the
real emit path). That number is canonical.

Every other counter is defined as *an approximation of, or a reconciliation
to,* `totalTurns` — never an independent rule:

- The **tugcast disk scanner** (`external_sessions.rs`) produces a
  spec-faithful **estimate** for sessions that have never been opened in
  Tug, by applying the rule below to the on-disk JSONL without a full
  translate.
- The **tugcast ledger** (`session_ledger.rs`, `turn_count`) is the
  persisted authoritative value. Live `turn_complete`s bump it
  (`record_turn`), and a successful `replay_complete` **reconciles** it —
  SETs it to `totalTurns` — so an opened session converges to canonical and
  stays correct.
- The **client** never recomputes a display count. The picker reads the
  persisted `SessionRow.turn_count`; the transcript derives its turn
  numbering from the same tugcode stream (`firstLoadedTurnIndex` + local
  index).

### The four-way equality invariant

For any session — including one restored through a window:

```
tugcode totalTurns  ==  scanner turn_count  ==  ledger turn_count
                    ==  picker subtitle N   ==  highest transcript turn badge
```

This equality is the load-bearing invariant of the whole metric. The rule
below makes it true *by construction* (one definition, applied everywhere);
reconcile-on-replay makes it true *in fact* (the authority always wins for
an opened session).

---

## S01 — The canonical turn rule

The rule is defined by what tugcode's `handleUserEntry`
(`tugcode/src/replay.ts`) does with a `type:"user"` JSONL record. A turn is
**opened** by exactly one of:

1. **A user submission** — a record whose `message.content` carries genuine
   submitted content (text and/or image), and which is none of the
   exclusions below. Two predicates name the content test (their names are
   the contract; keep all implementations citing them):

   - `isUserSubmissionContent` is **true** — string content, *or* an array
     carrying at least one block whose `type` is not `tool_result`
     (`tugcode/src/session.ts`; mirrored as `is_user_submission_content` in
     `tugcast/src/external_sessions.rs`). This excludes bare `tool_result`
     echoes.
   - `isNonSubmissionUserString` is **false** — for *bare-string* content,
     not an `isCompactSummary` continuation (the "This session is being
     continued…" summary a `/compact` injects), not slash-command
     scaffolding (a bare string starting with one of `<command-name>`,
     `<command-message>`, `<command-args>`, `<local-command-stdout>`,
     `<local-command-caveat>`), and not a `<task-notification>` envelope
     (`tugcode/src/replay.ts`, `COMMAND_SCAFFOLDING_PREFIXES` +
     `isNonSubmissionUserString`).

2. **A wake opener** — a bare-string `<task-notification>` envelope (Cohort A
   wake) that tugcode re-routes to `wake_started`
   (`tugcode/src/replay.ts`, `extractTaskNotificationWake`). A wake opens its
   own turn even though its text is *not* a user submission.

A turn is **not** opened by — and the scanner must mirror **every** one of
these, or it diverges from the authority:

- `tool_result` echoes (array content with no non-`tool_result` block);
- `/compact` summary continuations (bare-string `isCompactSummary === true`
  — the flag is only honoured for bare-string content);
- slash-command scaffolding strings;
- **`isMeta === true` records** — SDK bookkeeping (image-coordinate /
  source-path hints, skill-body loaders, `/loop` content imports). tugcode
  skips these outright (`handleUserEntry`, `entry.isMeta === true → return`)
  *before* the content split, so they never open a turn regardless of
  content shape;
- **the interrupt-marker sentinel** — a record whose combined text is
  `[Request interrupted by user…]` (exact, or the prefix followed by a
  space-led suffix before the closing `]`) **and** which carries **no**
  `permissionMode` field. Both signals must agree (`isInterruptMarkerEntry`):
  the SDK injects this marker without `permissionMode`, whereas every real
  user submission carries one — so a user who literally types the marker
  text still counts (their `permissionMode` is present). tugcode drops the
  marker (`handleUserEntry` returns before `add_user_message`); the open
  turn is closed by orphan synthesis at the next opener or EOF, adding no
  turn;
- any `assistant` / `system` record on its own (an assistant record with no
  open turn synthesizes an opener — that is still one turn).

The canonical count is the number of **opened** turns = the number of turn
boundaries the segmenter locates = tugcode's reported `totalTurns`. It is
**not** the number of `turn_complete` events: a wake turn commits as
`wake_started` (not `turn_complete`), and a turn left open at a window or EOF
edge (an interrupted final turn) is counted by the boundary locator but emits
no terminal. Each opened turn has exactly one opener frame on the wire — an
`add_user_message` (genuine submission) or a `wake_started` (wake) — so the
faithful identity is **`totalTurns == count(add_user_message) +
count(wake_started)`** for a session with no leading orphan-assistant synth
opener. **Wake turns count. Interrupt markers and `isMeta` records do not.**

### The operational rule for a non-translating counter (the disk scanner)

The scanner does not run the translator, so it applies the rule structurally
per `type:"user"` record. `text` is the record's combined text (bare string,
or the concatenated `text` blocks of array content); `hasImage` is true when
array content carries an `image` block; `hasPermissionMode` is true when the
record has a `permissionMode` field:

```
count this user record as a turn  ⇔
      NOT isMeta(record)
  AND isUserSubmissionContent(content)
  AND NOT isInterruptMarker(text, hasImage, hasPermissionMode)
  AND ( isTaskNotificationWake(text)              // wake opener — counts
        OR NOT isNonSubmissionUserString(record, text) )  // genuine submission
```

i.e. `isMeta` records, compact summaries, slash scaffolding, and interrupt
markers do **not** count; genuine submissions and wake envelopes **do**.
`isInterruptMarker` requires the text pattern **and** absent `permissionMode`
**and** no image block, exactly as `isInterruptMarkerEntry`.

---

## S02 — The transcript address

Every transcript entry is addressed `#t{TURN}m{MESSAGE}`:

- **Format:** `#t{TURN:0>4}m{MESSAGE:0>2}` — `TURN` zero-padded to 4 digits,
  `MESSAGE` to 2. Padding is **cosmetic only**: values overflow their width
  gracefully and **no parser or data assumption caps `MESSAGE` at 99 or
  `TURN` at 9999**. `#t10000m100` is valid.
- **`TURN`** = `firstLoadedTurnIndex + localTurnIndex + 1` — absolute,
  session-global, 1-based. `firstLoadedTurnIndex` is the tugcode-reported
  base of the loaded window; `localTurnIndex` spans the loaded window's
  turns *and* live turns committed after replay (so a live turn carries
  `totalTurns + k`, never a window-local reset).
- **`MESSAGE`** = 1-based index into that turn's `messages` array, in wire
  order: `user_message`, `assistant_text`, `assistant_thinking`,
  `tool_use`, `system_note`.

Turn-local `m` is **stable under windowing** — paging older history shifts
only the absolute turn base, never a turn's internal message addresses.

Examples:

| Address | Meaning |
|---|---|
| `#t0007m01` | turn 7, the user submission |
| `#t0007m02` | turn 7, the assistant's text |
| `#t0007m03` | turn 7, a thinking block |
| `#t0007m04` | turn 7, the first tool call |
| `#t0012m01` | wake turn 12's first assistant message (no `m01` user submission) |

---

## What reconciles to what

| Touch point | Role | Relationship to the authority |
|---|---|---|
| tugcode `totalTurns` / `firstLoadedTurnIndex` | **authority** | the definition itself |
| tugcode live `turn_complete` → `record_turn` (+1) | live increment | builds on the reconciled base |
| scanner `ExternalSessionMeta.turn_count` | external estimate | applies S01 without translating; corpus-pinned |
| `external_scan_cache.turn_count` | persisted external estimate | guarded by a cache epoch so a pre-rule count cannot survive |
| ledger reconcile (`set_turn_count` = `totalTurns`) | authoritative SET | success `replay_complete` only; reads `totalTurns`, **never** the windowed sibling `count` |
| `record_spawn` `MAX(turn_count, seed)` | resume seed merge | seed read is epoch-gated; final value corrected by reconcile |
| picker subtitle / transcript badge | read | derived from the persisted count / the same tugcode stream |

Two guards on reconcile are mandatory and easy to get wrong:

1. **Read `totalTurns`, never `count`.** The sibling `count` field on the
   same `replay_complete` frame is the *windowed* committed-cycle tally
   (`ctx.turnsCommitted`) and undercounts a windowed restore. Reconciling to
   it would corrupt the ledger.
2. **Skip error frames.** A `missing` / `unreadable` / timeout
   `replay_complete` carries `count: 0` and **no** window metadata. SETting
   the ledger from such a frame would zero a real count on a transient
   reconnect failure. Reconcile branches on the presence of window metadata
   and only SETs on the success path.

---

## Rewind carve-out — a deliberately separate concept

`session.ts`'s chop / `priorSubmissions` logic counts
`isUserSubmissionContent` **without** the `isNonSubmissionUserString` gate,
because `/rewind` anchors on genuine user *submissions*, not on the turn
metric — it intentionally does **not** anchor on wake turns. This is a
related-but-distinct concept and is **out of scope** for the turn metric.
If the shared predicate is ever renamed or relocated, rewind must keep
compiling against its own copy (or an explicitly-shared-but-distinct
helper) — do not silently fold rewind into the turn rule.

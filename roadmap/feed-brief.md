# The Feed — an app-wide channel with the Herald, the Operator, and You

This brief captures the decided design for the **Feed**: a Tug-wide social-feed-style channel that narrates the work happening across all sessions, renders in a new sidebar card, and hosts a question-answering agent grounded in Tug's ledgers. The decisions below are settled; the items in the **Open questions** section at the end are explicitly *not yet settled* and will be resolved in a follow-up pass before `/devise`. File/symbol references were confirmed against the tree as of 2026-08-06.

## Vision

The Feed is an overarching reader/monitor of all session work going on in Tug. A summarizer (the **Herald**) watches the actual transcript traffic and posts digest-sized write-ups of the work as it happens, coalescing them into a new unified transcript. A question-answering agent (the **Operator** — think old-timey switchboard, or the Matrix) sits behind a prompt-entry box at the bottom of the card and answers questions about what happened — "what was that session where we did *blah blah*?", "what's the CSS file we edited yesterday that changed the border color?", "what was that commit two weeks ago that did *blah blah*?" — by reading the feed, querying the feed's full history, and consulting Tug's ground-truth ledgers.

Another way of seeing it: the Feed is a *social network feed for your project* with exactly three contributors, and one of them answers the phone.

## The channel model

Three authors, one transcript. Every row in the channel is a post by one of:

| Author | Who | Icon |
|--------|-----|------|
| `herald` | The summarizer. Posts digests of session work as it happens. | lucide `newspaper` |
| `operator` | The Sonnet-based question-answering agent. Posts answers (and only answers — it speaks when spoken to). | the `operator` glyph (bot head with headset and boom mic) in `tugdeck/src/components/tugways/tug-icons.tsx` (`operatorIconNode`, ~line 41) |
| `user` | The human. Posts questions/messages via the card's prompt-entry box. | the same user icon the Session card uses |

Row shape (conceptual; exact schema at `/devise`): `author ∈ {herald, operator, user}`, timestamp, body, and a `session_id` link on Herald posts so each digest is clickable provenance back to its source session.

## The Herald

The Herald is a **first-order reader of the real transcript traffic** — not a derivative of Pulse, not a re-teller of anyone's re-telling.

- **Input**: its own independent tap on the `CODE_OUTPUT` broadcast — the same spliced frames every deck receives, with `tug_session_id` riding each frame. This is the identical tap architecture `feeds/pulse.rs` uses (tap → worker → ledger + broadcast), instantiated a second time with its own allowlist. The Herald's allowlist is expected to be wider than Pulse's (user prompts, assistant text, tool activity, session lifecycle) — exact composition settled with the trigger design (Open question 2).
- **Output**: digest posts — larger, coalesced summaries of the work, not play-by-play. Pulse remains what it is (ephemeral color commentary, capped ledger); the Herald is the durable record. Neither consumes the other.
- **Inherited Pulse-bridge machinery**: lazy spawn on first forwardable frame, respawn debounce, replay-bracket muting (everything between `replay_started`/`replay_complete` is muted, so reconnect floods never re-narrate history), lagging-receiver frame drops (narration never backpressures work).
- **Invariant — the feed is not in the Herald's diet**: the Herald's input is the `CODE_OUTPUT` tap; Herald/Operator/user posts travel on the Feed's own FeedId and never enter that tap. No feedback loop is possible by construction, exactly as with Pulse.
- **Invariant — one-way isolation**: inherited from Pulse's law. Nothing in the Feed subsystem writes toward any work session. The Herald's outputs are the feed ledger, the feed broadcast, and tracing; the Operator answers only into the feed channel.
- **Cost is explicitly a non-concern**: the sessions the Herald narrates run Opus/Fable; the Herald is noise in comparison. Posting cadence is an *editorial* question (what makes a good post), not an economic one.

## The Operator

The Operator is a Sonnet-based agent behind the card's prompt-entry box. Architecture:

- **Chassis**: a second `AgentSpec` on the SharedAgent pool (`tugrust/crates/tugcast/src/shared_agent.rs`) — persistent job-constrained `claude` workers, which is exactly what that module's contract anticipates ("standing up a second agent on a different model means constructing a second `AgentSpec`, not writing new machinery").
- **[P01] compliance**: the user's question is not an arbitrary prompt to the model — it is the *input* to a fixed `answer-feed-question` job whose instructions are constant. The job table stays auditable.
- **[P05] compliance — stateless turns**: each question is self-contained; the context (recent feed scrollback plus whatever the query verbs retrieve) rides the call. No conversational worker state. This is honest about what the Operator is: you ask, it looks things up, it answers. (If multi-turn follow-up conversation later proves necessary, that is a redesign away from SharedAgent, not a tweak — deliberately out of scope now.)
- **Feed-ambient, ledger-grounded**: the feed transcript gives the Operator narrative context ("which day, which session"), but summaries lossy-compress exactly the details retrieval questions need. So the Operator also gets a small fixed set of query verbs into Tug's ground truth — feed-history search over the *full* ledger (not just the card's window), plus verbs against `changes.db` attribution, git log/diff, and session prompt history. Feed prose locates; ledgers confirm. Without the grounding verbs it would confabulate; with them it is the one agent in the app that can actually answer "what happened here two weeks ago." The exact verb table is Open question 1 — it is the feature's spine and gets settled first.

## Transport: reclaiming `TUG_FEED` (0x70)

The reserved FeedId is genuinely free — `FeedId::TUG_FEED = 0x70` (`tugrust/crates/tugcast-core/src/protocol.rs:134`, TS mirror `tugdeck/src/protocol.ts:56`) has a name mapping, a byte-value test, and zero consumers. The archived tug-feed plan (`roadmap/archive/tug-feed.md`) that reserved it was never built and its needs were met elsewhere; this feature is closer to the *original* "tugfeed" meaning (a stream in the deck) than that plan was. Reclaim the id: retire the "reserved for Phase T3+" comment, keep the byte, carry the Feed channel on it. Upstream (user → tugcast) traffic for user posts/questions either shares 0x70 bidirectionally or takes a sibling query id — decided at `/devise` following the existing `USAGE`/`USAGE_QUERY` and `SHELL_OUTPUT`/`SHELL_INPUT` precedents.

## Persistence

- **Durable app-scoped ledger**, one per tugcast instance (the Pulse scoping), holding the full channel history — all three authors' posts. Writable opens go through `tugcore::ledger_db` like every ledger (enforced by `no_ad_hoc_ledger_opens`). Whether this is a new database or a table in an existing per-instance ledger is a `/devise` decision; it is **not** the capped rolling log Pulse uses — history is the point.
- **The card renders a window; the ledger keeps everything.** The Feed card ages out rows past a reasonable scrollback — start at **50** rows and tune by feel. Aging out is a *render window*, never a deletion.
- **The Operator queries the full ledger**, unbounded by the card's window — that is what makes "what was that commit two weeks ago" answerable.

## The Feed card

- **`layoutRole: "sidebar"`** under the taxonomy shipping in `roadmap/layouts-rework-plan.md`. That plan explicitly anticipates this card — its non-goals defer "the third sidebar card (a future feature; the registry-driven Layouts controls make it appear for free when it registers)". The Feed card is that third card: on registration it inherits the Layouts section controls, side toggles, bilateral/stacked rails, and the equal-resize allocator for free.
- **Hard sequencing dependency**: the Feed card lands after layouts-rework ships the sidebar taxonomy.
- **Layout**: transcript above, prompt-entry-style box at the bottom for user posts/questions to the Operator. Both must read well at rail width, including stacked on the same side as Lens or Jots with the draggable seam.
- **Iconography**: as in the channel-model table — lucide `newspaper` (Herald), the existing `operator` glyph (Operator), the Session card's user icon (You).

## What this is not

- Not the archived hooks-based tug-feed (`roadmap/archive/tug-feed.md`): no plan-step correlation, no hook capture layer, no `.tugtool/feed/feed.jsonl`. The Herald reads the live `CODE_OUTPUT` broadcast, full stop.
- Not a replacement for Pulse. Pulse stays as-is.
- Not a control surface. Nothing in the Feed writes toward a work session; the Operator cannot drive work.
- Not a conversational chat with memory (for now): Operator turns are stateless by design.

## Open questions — to settle before `/devise`

1. **The Operator's verb table.** Enumerate the fixed job/query set: feed-history search, `changes.db` attribution lookup, git log/diff, session-prompt search — exact verbs, inputs, and outputs. This is the feature's spine.
2. **Herald post triggers.** Which frame events constitute "something happened worth a post" (turn end, commit landed, session opened/closed, test run?), how coalescing works across concurrent sessions, and how much transcript context rides each summarization call. This also fixes the Herald's tap allowlist.
3. **The Herald's model.** The Operator is Sonnet by decree. The Herald is presumably Sonnet too (scribe-class summarization) — decide explicitly, and wire it as a tugbank default following the `scribe_model` pattern (`resolved in main.rs`, falls back by name).

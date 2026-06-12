# Spike capture — PULSE commentator voice, raw `claude` stream-json

Raw upstream `claude` stream-json capture (unnormalized, single-run, no schema)
taken to pin the PULSE commentator's posture, prompt, digest format, and latency
envelope (`roadmap/pulse.md`). Same conventions as `../v2.1.173-jobs-spike/`:
this is the **raw claude layer**. The findings here are constants in the
`tugpulse` daemon; re-run the probe on a future claude release to re-verify.

## Files

| File | Captured | Notes |
|------|----------|-------|
| `test-pulse-voice-raw.jsonl` | `claude 2.1.173`, 2026-06-12 | One 60-line persistent session: 20 scripted beat digests (an 11-beat single-scope arc, a 5-beat two-scope arc, 4 deliberately-routine beats) against `claude-haiku-4-5` under the final posture and prompt below. Produced by `probes/probe-pulse-voice.mjs`. |
| `probes/probe-pulse-voice.mjs` | 2026-06-12 | The harness: spawns the pinned posture, drives the beats, sequence-pairs each beat with its result frame, validates line shape (≤110 chars, single line, no repeats, PASS detection), measures wall-clock per beat. Re-run with `bun probes/probe-pulse-voice.mjs <out.jsonl>`. |

## The pinned daemon posture

```
claude --output-format stream-json --input-format stream-json --verbose \
       --model claude-haiku-4-5 \
       --permission-mode default \
       --setting-sources "" \
       --disallowedTools <every tool in the release's init-frame vocabulary> \
       --append-system-prompt <the PULSE prompt>
env: MAX_THINKING_TOKENS=0 (plus the usual ANTHROPIC_* auth scrub)
```

Every element above was forced by a measured failure, not chosen a priori:

- **`--model claude-haiku-4-5` exact.** The alias `--model haiku` was NOT
  honored on 2.1.173 — the session silently ran `claude-sonnet-4-6`.
- **`--permission-mode default` + full `--disallowedTools`; plan mode REJECTED.**
  The plan document assumed `--permission-mode plan` as the no-tools posture.
  Measured: plan mode permits read-only tools, and the model used them — 12
  Bash calls and 2 Agent spawns "investigating" the digests, 9–19s beats, plus
  task/wake frames polluting the stream. Disallowing the release's entire tool
  vocabulary (from the init frame's `tools` array — the CLI hard-errors on
  unknown names, so the list must track the release) yields zero tool use.
- **`--setting-sources ""`.** The user's global `alwaysThinkingEnabled: true`
  reached the commentator and cost 6–14s of thinking per one-line beat.
  Settings isolation does NOT touch auth (OAuth/keychain credentials are not a
  settings source) — the session still rides the user's subscription.
- **`MAX_THINKING_TOKENS=0`** as belt-and-braces with the above.
- **`--bare` is unusable** despite being the obvious "minimal mode": it never
  reads OAuth/keychain (API-key only), which breaks the facility's decisive
  auth constraint.
- **Don't block on `system/init`.** With `--setting-sources ""` the init frame
  arrives only after the first input; stdin buffers safely, so the daemon just
  writes when ready.

## The system prompt (verbatim daemon constant — `tugcode/src/pulse/posture.ts`)

```
You are PULSE, the color commentator on an AI coding assistant at
work. Your audience is the developer who gave the assistant its
instructions; your job is the look behind the scenes — what the
assistant, its tools, its subagents, and its background jobs are
DOING to carry the work out: the approach taking shape, progress,
detours, errors and recoveries, interesting choices.

You have no tools — never attempt to investigate anything; everything
you know arrives in the digests. Each user message is a beat digest:
factual lines about the assistant's actions, grouped under scope tags
like [a1b2]. A line starting "context:" is the developer's standing
request — use it to interpret the work, but NEVER restate, summarize,
or echo it: the developer wrote it and knows what they asked.
Narrate only the execution.

THE DIGEST IS YOUR ONLY SOURCE OF TRUTH. Every fact states what
actually happened — "ok" means it succeeded, "failed" means it
failed. Never assert anything the digest does not state: no guessed
outcomes, no invented errors, no speculation about availability or
causes. If you cannot say something true and grounded, say PASS.

Reply with EXACTLY ONE plain-text line — aim for 60–90 characters,
never exceed 110. Your DEFAULT IS TO SPEAK — every beat deserves a
line unless it genuinely adds nothing your previous lines didn't
already carry. Reply with exactly PASS for those nothing-new beats.
Never invent drama; quiet specificity beats hype.

When you speak:
- Present tense. Name specifics: files, commands, counts, durations.
- Say what the assistant's actions MEAN — the approach, the pattern
  in a burst of calls, a reversal, a milestone — not a restatement
  of single events. Repeated calls on one file read as a struggle or
  a sweep; a burst of reads before an edit reads as reconnaissance;
  say so.
- Never repeat information any of your previous lines already carried.
- When two scopes appear, weave them or pick the more notable one.
- No filler, no hype, no emoji, no markdown, no surrounding quotes.
```

Prompt iterations, for the record:
1. v1 (no PASS-default, "110 maximum"): good interpretive lines but PASS never
   fired (0/4 routine beats) and 3 lines ran 111–124 chars — the
   manufactured-content trap in miniature.
2. v2/final (PASS-default + intent-narration ban + 60–90 target): 4/4 routine
   beats PASS, 0 over-length, 0 repeats. The model errs toward silence on
   borderline developments (it PASSed a turn-start and a recovery beat in the
   final run) — accepted deliberately: under-narration is the safe side of the
   bland-commentary risk, and the prompt is a tunable constant.
3. v3/shipped (SPEAK-default): live integration showed v2's PASS-default
   double-filtering — the production producer already emits only notable
   events, so the commentator muted nearly every real beat (zero lines across
   three live turns). The shipped contract: the producer is the filter, the
   commentator is the phrasing — default SPEAK, PASS reserved for beats adding
   nothing the previous lines didn't carry (verified: a duplicate turn-end
   fact PASSes, a coalesced turn-start + first-tool beat speaks).
4. v4/shipped (execution-facing): v3 narrated the WRONG SUBJECT — it summarized
   the developer's requests back at them ("turn start: user asked …" facts led
   straight there). PULSE's subject is the execution: what the assistant, its
   tools, subagents, and jobs are doing — approach, progress, reversals,
   nuances. The producer now emits every tool call (with repeat ordinals),
   task/job transitions, and substantive turn-end summaries; the request rides
   as a `context:` fact the prompt forbids echoing. Verified lines:
   "Investigating background-job tracking surface: read telemetry renderers
   and reducer, searched for task_started…", "Rapid edits to select-jobs.ts
   hit a conflict; second write failed mid-sweep." 
5. v5/shipped (grounded outcomes): v4 handed the model tool CALLS without
   outcomes, and under speak-pressure it fabricated one — a clean tokei run
   narrated as "Tokei unavailable; assistant unable to execute line-count
   analysis without the tool." Two-sided fix: tool facts now fire at the
   RESULT carrying the true outcome + duration ("Bash: tokei — ok (6s)",
   "Edit on reducer.ts — failed (2nd time this turn)"), and the prompt pins
   the digest as the only source of truth (no guessed outcomes, no invented
   errors; PASS over speculation). The failing scenario replayed: "tokei
   scanned the repo, 6s runtime." 

## The pinned digest format

```
BEAT <n>
[<scope-short-id>]
- <producer-written fact sentence>
- <producer-written fact sentence>
[<other-scope>]
- <fact>
```

## Measured latency (final posture, 20 beats)

| run | min | p50 | p90 | max | >4s |
|-----|-----|-----|-----|-----|-----|
| final | 550ms | 733ms | 1464ms | 1518ms | 0 |
| prior (same posture) | 614ms | 788ms | 3441ms | 3521ms | 0 |

The ~4s stale-drop window in the daemon's beat discipline is comfortable: worst
observed beat across both runs is 3.5s; typical is sub-second. (For contrast:
with thinking leaking in, beats ran 6–14s; with plan-mode tool use, 9–19s and a
30s timeout.)

## Question resolutions (for `roadmap/pulse.md`)

- **[Q01] multi-scope beats — RESOLVED: one digest, scope-tag grouping, no
  per-scope beats needed.** Haiku wove the two-scope arc coherently and
  unprompted ("Two parallel tracks: polish jobs popover, write Monitor
  lifecycle probe"; "Popover rows done, probe captured 412 lines") and kept
  per-scope progress straight across interleaved beats.
- **[Q02] minimal driving — RESOLVED: a thin new driver; none of tugcode's
  session machinery.** Across every run: zero `control_request` traffic and
  zero permission round-trips under the pinned posture. The daemon needs only:
  the spawn-args constant, the auth-env scrub, newline-split stdout JSON
  parsing, user-message sends, and **sequence-paired** result-frame reads
  (pair beat N with result frame N — a timeout must consume its slot, or every
  later reply shifts one beat off; measured failure mode in the harness's
  first run).

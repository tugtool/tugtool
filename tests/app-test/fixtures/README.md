# Committed session fixtures

Small, **sanitized, real-derived** Claude Code session slices that
app-tests resume through the production picker → spawn → reveal path.

These are **committed** (unlike the gitignored perf `corpus/`), so the
tests that use them run **everywhere** — CI and any machine — and never
depend on, or draw content from, the private live `~/.claude/projects/`
archive.

## Why real-derived, not synthetic

Tests should exercise real-world content and cases. These fixtures are
actual session records (real wire shapes: `message.id`, content-block
kinds, `uuid`/`parentUuid` chains) extracted from a real session and
scrubbed — not made-up records whose behavior nobody can vouch for.

Perf legs are the one exception: they must measure real whale-class
workloads, so they stay on the gitignored local `corpus/` and `skipIf`
when it's absent. Correctness/behavior legs use the committed fixtures
here.

## How a fixture is made

```bash
bun run tests/app-test/fixtures/sanitize.ts \
  --in <a real ~/.claude/projects/.../<id>.jsonl> \
  --out tests/app-test/fixtures/sessions/<name>.jsonl \
  --turns 4 --session-id fixture-dev-0001 --max-block-chars 600
```

`sanitize.ts` keeps the first `--turns` complete turns and scrubs every
record:

- home / abs paths (`/Users/<name>/…`) → `/work/repo`
- `cwd` → `/work/repo`, `gitBranch` → `main`, `sessionId` → the fixed
  fixture id, `requestId` / `userID` → placeholders
- emails → `user@example.com`
- secret patterns (Anthropic / OpenAI / GitHub / AWS / Slack / bearer /
  PEM private keys) → `<REDACTED>`
- content blocks longer than `--max-block-chars` clipped with a
  `… [truncated]` marker (drops giant file dumps / command output; keeps
  the case and its prose)

It prints an audit report (records kept, scrubs by category). **A human
reviews the output before committing** — confirm no residual paths,
identifiers, or secrets, and that the content is acceptable to ship.

## Using a fixture in an app-test

```ts
import { seedFixtureSession } from "./fixtures/resolve";

const seeded = await seedFixtureSession("session-transcript-basic", "my-test");
try {
  // seeded.sessionId / seeded.projectDir are listable in the picker;
  // resume through the real flow, then assert.
} finally {
  seeded.cleanup();
}
```

## Fixtures

| File | Turns | Source | What it exercises |
|------|-------|--------|-------------------|
| `sessions/session-transcript-basic.jsonl` | 4 | a real tugtool dev session | a scrollable multi-turn transcript: user prompts, assistant thinking + text, tool_use/tool_result pairs, attachments — enough to scroll, restore, and verify no-slam |

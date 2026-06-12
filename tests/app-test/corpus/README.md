# Real-session corpus

The resume-performance test legs measure against REAL session JSONLs
harvested from this machine — synthetic fixtures validated machinery,
not workload, and are banned for performance claims.

## What lives here

| Path | Committed? | What |
|------|------------|------|
| `harvest.ts` | yes | the harvester CLI (survey + classify + snapshot) |
| `classify.ts` | yes | pure-logic statistics/classification (streaming) |
| `classify.test.ts` | yes | pure-logic tests (`bun test corpus/classify.test.ts`) |
| `manifest.json` | **no** (gitignored) | full population survey + selected set |
| `snapshots/` | **no** (gitignored) | materialized session snapshots |

Session content never reaches git. The manifest carries paths and
numbers (sizes, turn counts, block histograms), not prompt text.

## Refresh the corpus

```bash
bun run tests/app-test/corpus/harvest.ts
```

- Surveys every `~/.claude/projects/*/*.jsonl`, streaming — the
  whale-class files are never held in memory.
- Skips sessions a terminal currently holds (`~/.claude/sessions/`
  registry) and tolerates torn final lines (live appends).
- Classifies by size (`typical` <1MB ≤ `heavy` <20MB ≤ `whale`) and
  shape (`tool-heavy` / `thinking-heavy` / `image-bearing` / `prose`).
- Selects the newest representative per class × shape plus pinned ids
  (always `763cd1d8…`), then materializes: typical/heavy are copied;
  whale snapshots are hardlinked (or left as in-place references), with
  `{strategy, sourcePath, size, mtime}` recorded so a runner can detect
  a drifted reference.

`--dry-run` writes the manifest without materializing snapshots.
Other flags: `--projects-root`, `--sessions-dir`, `--out`, `--pin
<id-prefix>` (repeatable), `--quiet`.

Corpus-driven app-test legs `skipIf` cleanly when `manifest.json` is
absent — a machine without a harvested corpus still gates on the
real-shape generator legs.

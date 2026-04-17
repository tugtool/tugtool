# capabilities/

Bundled Claude Code capability snapshots consumed by Tug.app + tugdeck at
build time. Each `<version>/` directory holds the normalized `system_metadata`
frame captured from a specific `claude` release — the authoritative source
for what slash commands, skills, agents, and plugins are available to the
graphical UI.

**Canonical version format:** `X.Y.Z` (e.g. `2.1.105`). No `v` prefix in the
directory name, the `LATEST` pointer, or the payload's `version` field.

## Layout

```
capabilities/
  LATEST                       # text file — single version string, e.g. "2.1.105\n"
  2.1.105/
    system-metadata.jsonl      # one-line JSONL; the captured system_metadata event
  2.1.106/                     # future snapshots land here (retained; never deleted)
    system-metadata.jsonl
```

## Consumers

- **Tug.app (Swift).** The `Copy Rust binaries, tugdeck dist, and capabilities`
  build phase resolves `LATEST`, copies `capabilities/<version>/system-metadata.jsonl`
  into `Tug.app/Contents/Resources/capabilities/system-metadata.jsonl`, and
  the Swift host loads it on startup.
- **tugdeck (Vite).** A build-time virtual module (to be added in D6) resolves
  `LATEST` and inlines the payload into the tugdeck bundle so the slash-command
  popup is populated synchronously.

## How snapshots get here (today vs. D6 target)

- **Today (scaffold commit):** the `2.1.105` payload was hand-extracted from
  `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/test-28-system-metadata-deep-dive.jsonl`
  via a single-line `grep`. `LATEST` was set by hand.
- **After D6:** the capture pipeline auto-writes the snapshot as part of the
  stream-json catalog's version-bump runbook (see
  `roadmap/tugplan-golden-stream-json-catalog.md#deep-version-bump-runbook`),
  and the runbook updates `LATEST` accordingly.

## Manual rotation (until D6 automates it)

```sh
# 1. Pick the desired stream-json catalog version.
VER=2.1.105

# 2. Extract the system_metadata event from probe-28.
mkdir -p capabilities/$VER
grep '"type":"system_metadata"' \
  tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v$VER/test-28-system-metadata-deep-dive.jsonl \
  > capabilities/$VER/system-metadata.jsonl

# 3. Update the pointer.
echo "$VER" > capabilities/LATEST
```

## Retention

Never delete an old version directory — each snapshot is a few hundred bytes
and keeps historical UI behavior reproducible. Matches the retention policy
of the stream-json catalog.

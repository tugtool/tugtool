# Tug tests

## Beads fake and integration tests

The deterministic fake `bd` binary (`bin/bd-fake`) is used for integration tests so that `tug beads sync`, `tug beads status`, and `tug beads pull` can be tested in CI without a real Beads installation.

### Running bd-fake integration tests

From the repository root:

```bash
tests/integration/bd-fake-tests.sh
```

Or with an explicit state directory (e.g. for debugging):

```bash
TUG_BD_STATE=/tmp/my-bd-state tests/integration/bd-fake-tests.sh
```

**Requirements:** `jq` must be installed. The script will make no changes outside `TUG_BD_STATE` (defaults to a temporary directory).

### Using the fake in CI or with Tug

When running Tug in CI or when you want to drive the fake from the Tug CLI:

- Set **`bd_path`** in `.tug/config.toml` to the path to the fake, e.g. `bd_path = "tests/bin/bd-fake"`, or
- Set the **`TUG_BD_PATH`** environment variable (if supported) to override the config.

Integration tests currently exercise the fake directly (same commands Tug will use): create root and step beads, add dependency edges, `bd show`, and `bd dep list`, so that sync-like workflow, status readiness, and pull data contract are validated.

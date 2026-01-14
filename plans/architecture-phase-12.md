# Phase 12: Test Data Redesign

**Goal:** Move checked-in test data from `testdata/` to GitHub Releases, providing a HuggingFace-style download workflow.

---

## Overview

The `testdata/` directory currently contains 15MB of test fixtures checked into Git. This adds to clone size and Git history. Phase 12 migrates test data to GitHub Releases, providing:

- **Smaller clones**: Fresh clones don't include large test files
- **Versioned artifacts**: Test data versioned independently of code
- **On-demand download**: Fetch only what you need, when you need it
- **Cache-aware**: Don't re-download unchanged files
- **CI-friendly**: Automatic download in CI workflows

### Current State

```
testdata/                      15 MB total
├── basic-json/                12 KB   (3 files)
├── basic-jsonl/               40 KB   (6 files)
├── basic-schemas/             12 KB   (3 files)
├── benchmarks/                14 MB   (5 files) ← Bulk of size
├── csv/                      192 KB   (3 files)
├── earthquake/                12 KB   (1 file)
├── financial/                 12 KB   (3 files)
├── github/                    16 KB   (2 files)
├── reddit/                    16 KB   (2 files)
└── weather/                  252 KB   (5 files)
```

**Key insight**: `testdata/benchmarks/` alone is 14MB (93% of total). The other directories are ~1MB combined.

### Design Decisions

Based on the chat context and investigation:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage backend | GitHub Releases | Zero infra, zero auth pain, free, CI already has credentials |
| Compression | gzip (`.tar.gz`) | Universal compatibility, no extra tooling needed |
| Manifest format | JSON | Simple, human-readable, easy to parse in both Python and Bash |
| Download tool | `gh release download` | Already available in CI, handles auth automatically |
| Cache location | `~/.cache/arbors/testdata/` | Standard XDG cache location |
| Tiered datasets | Yes (2 tiers) | Size-based: "small" (~1 MB) vs "large" (~14 MB) |
| Release naming | `test-fixtures-v1` | Clear, descriptive convention |
| Python wrapper | Required | `python/arbors/testdata.py` for programmatic access |
| Backward compat | None | Only support current release version |

---

## 12.1 Licensing and Legal Separation

**Purpose:** Ensure MIT-licensed code and CC-BY-SA licensed test data remain legally separate.

### 12.1.1 The Problem

Some test datasets (e.g., [Lahman Baseball Database](https://sabr.org/lahman-database/)) are licensed under [Creative Commons Attribution-ShareAlike 3.0 Unported](http://creativecommons.org/licenses/by-sa/3.0/). The ShareAlike clause requires derivative works to use the same license.

**Key principle:** CC-BY-SA applies to *data*, not *code that processes data*. As long as:
- Data is not checked into the repo
- Data is downloaded separately via explicit user action
- Code and data are distributed as separate works

...the MIT license on the code is not "tainted."

### 12.1.2 Repo Structure (MIT-licensed)

```
arbors/
├── LICENSE                    # MIT License (code only)
├── README.md                  # Includes licensing section
├── data/
│   └── testdata-manifest.json # Manifest only, no actual data
├── src/
├── tests/
└── scripts/
```

**Critical:** No CC-BY-SA content in the repo. Only metadata (manifest).

### 12.1.3 GitHub Release Structure (Separate distribution)

```
test-fixtures-v1/
├── test-fixtures-small.tar.gz
├── test-fixtures-large.tar.gz
├── testdata-manifest.json
├── LICENSE-CC-BY-SA-3.0.txt   # Full CC license text
├── ATTRIBUTION.md             # Source credits and modifications
└── README.md                  # Explains data licensing
```

### 12.1.4 Required Files in Release

**LICENSE-CC-BY-SA-3.0.txt:**
- Verbatim copy of CC BY-SA 3.0 license text
- Source: https://creativecommons.org/licenses/by-sa/3.0/legalcode

**ATTRIBUTION.md:**
```markdown
# Test Data Attribution

This test data includes content from the following sources:

## Lahman Baseball Database

- **Source:** Sean Lahman Baseball Database
- **Copyright:** © 1996-2024 Sean Lahman
- **License:** Creative Commons Attribution-ShareAlike 3.0 Unported
- **URL:** https://sabr.org/lahman-database/

**Modifications made:**
- Converted to JSONL format
- Selected subset of fields for testing
- [List any other transformations]

All modifications to CC-BY-SA licensed content are shared under
the same CC-BY-SA 3.0 license.

---

## [Other datasets as added]

[Attribution for each CC-licensed dataset]
```

**README.md (in release):**
```markdown
# Arbors Test Fixtures

This archive contains test data for the arbors project.

## License

The test data in this archive is licensed under
**Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)**.

This is SEPARATE from the arbors source code, which is MIT-licensed.

See:
- LICENSE-CC-BY-SA-3.0.txt - Full license text
- ATTRIBUTION.md - Source credits and modifications

## Usage

This data is intended for testing arbors functionality.
It is NOT part of the arbors software distribution.
```

### 12.1.5 README.md Section (in main repo)

Add to main README.md:

```markdown
## Licensing

### Source Code

The source code in this repository is licensed under the **MIT License**.
See [LICENSE](LICENSE) for details.

### Test Data

This project optionally uses external test datasets that are licensed
**separately** from the source code.

Test data is downloaded via GitHub Releases and is **not** part of the
source code distribution. The test data is licensed under:

- **Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)**

To download test data:
```bash
./scripts/fetch-testdata
```

See the [test-fixtures release](https://github.com/OWNER/arbors/releases/tag/test-fixtures-v1)
for full attribution and licensing details.

### License Separation

The CC-BY-SA license applies **only** to the test data, not to the arbors
source code. These are separate works with separate licenses:

| Component | License | Location |
|-----------|---------|----------|
| Source code | MIT | This repository |
| Test data | CC-BY-SA 3.0 | GitHub Releases (separate download) |
```

### 12.1.6 In-Repo Fixtures Policy

**If you ever need small fixtures checked into the repo:**
- Use **synthetic or anonymized data only**
- Never embed CC-BY-SA content in the repository
- Create test data programmatically where possible
- Document the synthetic nature in comments

Example synthetic fixture:
```json
{"id": 1, "name": "Test User", "score": 100}
{"id": 2, "name": "Another User", "score": 200}
```

This avoids any CC-BY-SA creep into the MIT-licensed codebase.

### 12.1.7 Sample Release Notes

For the first test-fixtures release:

```markdown
# Test Fixtures v1

Initial release of test data for the arbors project.

## Contents

- `test-fixtures-small.tar.gz` - Small test fixtures (~300KB)
- `test-fixtures-large.tar.gz` - Large test fixtures including Lahman Baseball Database (~4MB)

## Licensing

**This test data is licensed separately from the arbors source code.**

- **Test data license:** Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)
- **arbors source code:** MIT License (see main repository)

The test data includes content from the Lahman Baseball Database (© 1996-2024 Sean Lahman).
See ATTRIBUTION.md in the archives for full credits.

## Usage

Download via the arbors fetch script:
```bash
./scripts/fetch-testdata           # Small tier (default)
./scripts/fetch-testdata --tier large  # Large tier
```

Or via Python:
```python
from arbors.testdata import fetch_testdata
fetch_testdata("small")
```

### 12.1.8 Tasks

- [x] Create LICENSE-CC-BY-SA-3.0.txt (verbatim license text)
- [x] Create ATTRIBUTION.md template
- [x] Create README.md for release archive
- [x] Add licensing section to main README.md
- [x] Add licensing note to Python module docstring
- [x] Draft release notes for test-fixtures-v1
- [ ] Verify no CC-BY-SA content in git history after migration
- [ ] Include license files in **every** release archive

---

## 12.2 Data Tiering Strategy

**Purpose:** Separate test data by size to allow fast downloads when only small files are needed.

### 12.2.1 Tier Definitions

| Tier | Size (uncompressed) | Size (gzip) |
|------|---------------------|-------------|
| **small** | ~1 MB | ~300 KB |
| **large** | ~14 MB | ~4 MB |

**Tier "small" contents:**
- `basic-json/` (12 KB)
- `basic-jsonl/` (40 KB)
- `basic-schemas/` (12 KB)
- `csv/` (192 KB)
- `earthquake/` (12 KB)
- `financial/` (12 KB)
- `github/` (16 KB)
- `reddit/` (16 KB)
- `weather/` (252 KB)

**Tier "large" contents:**
- `benchmarks/mixed_large.jsonl` (10.1 MB)
- `benchmarks/users_1000.jsonl` (274 KB)
- `benchmarks/twitter.json` (631 KB)
- `benchmarks/canada.json` (2.2 MB)
- `benchmarks/citm_catalog.json` (1.7 MB)
- `lahman/` - Lahman Baseball Database (CC-BY-SA 3.0)

### 12.2.2 Tasks

- [x] Document tier assignments in manifest
- [ ] Add tier metadata to download script
- [ ] Test tier-selective downloads

---

## 12.3 Manifest Schema Design

**Purpose:** Define a manifest format that tracks test data versions, checksums, and metadata.

### 12.2.1 Manifest Format

File: `data/testdata-manifest.json`

```json
{
  "version": "1",
  "release_tag": "test-fixtures-v1",
  "generated_at": "2024-12-12T00:00:00Z",
  "tiers": {
    "small": {
      "description": "Small test fixtures (~300KB compressed)",
      "asset": "test-fixtures-small.tar.gz",
      "sha256": "abc123...",
      "size_bytes": 307200,
      "files": [
        "basic-json/api_response.json",
        "basic-json/github_event.json",
        "basic-json/package.json",
        "..."
      ]
    },
    "large": {
      "description": "Large test fixtures (~4MB compressed)",
      "asset": "test-fixtures-large.tar.gz",
      "sha256": "def456...",
      "size_bytes": 4194304,
      "files": [
        "benchmarks/mixed_large.jsonl",
        "benchmarks/twitter.json",
        "..."
      ]
    }
  }
}
```

### 12.2.2 Manifest Location

- **In repo**: `data/testdata-manifest.json` (checked in, small)
- **Cache**: `~/.cache/arbors/testdata-manifest.json` (downloaded version)

### 12.2.3 Tasks

- [x] Create `data/` directory
- [x] Design manifest JSON schema
- [x] Create initial manifest from current testdata
- [ ] Add manifest validation in download script

---

## 12.4 Archive Creation Tooling

**Purpose:** Scripts to package testdata into versioned, compressed archives.

### 12.4.1 Archive Script

File: `scripts/release-testdata.sh`

Functionality:
1. Read manifest to determine tier contents
2. Create compressed tar archives per tier
3. Generate SHA256 checksums
4. Update manifest with checksums and sizes
5. Output files ready for GitHub Release upload

```bash
# Usage:
./scripts/release-testdata.sh v1

# Outputs:
#   dist/test-fixtures-small.tar.gz
#   dist/test-fixtures-large.tar.gz
#   dist/testdata-manifest.json (updated with checksums)
```

### 12.4.2 Compression Choice

**Decision:** Use `gzip` for universal compatibility. Available on all platforms without extra tooling.

Compression estimate (10.1 MB mixed_large.jsonl):
- gzip -9: ~1.8 MB

### 12.4.3 Tasks

- [x] Create `scripts/release-testdata.sh`
- [x] Implement gzip compression
- [x] Generate SHA256 checksums automatically
- [x] Test archive creation locally

---

## 12.5 Download Script (HuggingFace-style)

**Purpose:** Provide a simple, cache-aware download script that mirrors HuggingFace's UX.

### 12.5.1 Script Design

File: `scripts/fetch-testdata`

```bash
# Basic usage - download small tier (default for CI)
./scripts/fetch-testdata

# Download specific tier
./scripts/fetch-testdata --tier small
./scripts/fetch-testdata --tier large
./scripts/fetch-testdata --tier all

# Force re-download (ignore cache)
./scripts/fetch-testdata --force

# Dry run (show what would download)
./scripts/fetch-testdata --dry-run

# Specify cache location
./scripts/fetch-testdata --cache-dir /tmp/testdata
```

### 12.5.2 Download Flow

```
1. Check if manifest exists locally
   └─ No: Download manifest from release

2. For requested tier:
   └─ Check if archive exists in cache
      └─ Yes: Verify checksum
         └─ Match: Skip download, use cached
         └─ Mismatch: Re-download
      └─ No: Download archive

3. Extract archive to testdata/
   └─ Verify extracted file count matches manifest

4. Success message with paths
```

### 12.5.3 Cache Layout

```
~/.cache/arbors/
├── testdata-manifest.json        # Downloaded manifest
├── test-fixtures-small.tar.gz    # Cached small tier archive
├── test-fixtures-large.tar.gz    # Cached large tier archive
└── checksums.json                # Local checksum verification cache
```

### 12.5.4 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ARBORS_CACHE_DIR` | `~/.cache/arbors` | Cache location |
| `ARBORS_TESTDATA_RELEASE` | `test-fixtures-v1` | Release tag to download from |
| `ARBORS_TESTDATA_SKIP` | (unset) | Skip download entirely |

### 12.5.5 Error Handling

| Error | Behavior |
|-------|----------|
| Network failure | Retry 3x with backoff, then fail with clear message |
| Checksum mismatch | Delete corrupted file, retry download once |
| `gh` not installed | Fall back to `curl` with GitHub API |
| Release not found | Clear error message with release URL |

### 12.5.6 Tasks

- [x] Create `scripts/fetch-testdata` (Bash)
- [x] Implement cache checking with SHA256 verification
- [x] Add `gh release download` integration
- [x] Add fallback to `curl` for environments without `gh`
- [x] Implement --dry-run mode
- [x] Add progress output
- [x] Test on Linux and macOS

---

## 12.6 Python Integration

**Purpose:** Python wrapper for programmatic testdata access.

### 12.6.1 Python Helper

File: `python/arbors/testdata.py`

**Module docstring (required for licensing clarity):**
```python
"""
Test data download utilities for arbors.

LICENSING NOTE:
    The arbors source code is MIT-licensed.
    Test data downloaded by this module is licensed under
    Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0).

    Test data is optional and not part of the arbors source distribution.
    See the test-fixtures release for full attribution details.
"""
```

**Usage:**
```python
from arbors.testdata import fetch_testdata, get_testdata_path

# Ensure testdata is available
fetch_testdata(tier="small")

# Get path to specific file
path = get_testdata_path("basic-json/api_response.json")
```

### 12.6.2 API Design

```python
def fetch_testdata(tier: str = "small", force: bool = False) -> Path:
    """
    Download and cache test data from GitHub Releases.

    Args:
        tier: "small" or "large"
        force: Re-download even if cached

    Returns:
        Path to extracted testdata directory

    Raises:
        RuntimeError: If download fails
    """
    ...

def get_testdata_path(relative_path: str) -> Path:
    """
    Get absolute path to a test data file.

    Automatically fetches "small" tier if not present.

    Args:
        relative_path: Path relative to testdata/, e.g. "basic-json/api_response.json"

    Returns:
        Absolute path to the file

    Raises:
        FileNotFoundError: If file doesn't exist after fetch
    """
    ...

def testdata_available(tier: str = "small") -> bool:
    """Check if testdata tier is already downloaded."""
    ...
```

### 12.6.3 Implementation Notes

- **Pure Python implementation** (no subprocess to bash scripts)
- Use `urllib.request` for downloads (stdlib, no external dependencies beyond tqdm)
- Support `GITHUB_TOKEN` env var for authenticated requests (avoids rate limits)
- Use `pathlib` for cross-platform paths
- Cache state tracked via manifest checksum
- Thread-safe file locking for concurrent access
- Works on Windows, macOS, and Linux

**Download strategy:**
- Primary: `urllib.request` with optional `GITHUB_TOKEN` header
- No `gh` CLI dependency—keeps Python helper self-contained and portable
- For users hitting rate limits without a token, document: `export GITHUB_TOKEN=$(gh auth token)`

### 12.6.4 Progress Display

Use `tqdm` for download progress so terminal doesn't appear hung:

```python
from tqdm import tqdm
import urllib.request

def download_with_progress(url: str, dest: Path, desc: str = "Downloading") -> None:
    """Download file with tqdm progress bar."""
    req = urllib.request.Request(url)
    if token := os.environ.get("GITHUB_TOKEN"):
        req.add_header("Authorization", f"token {token}")

    with urllib.request.urlopen(req) as response:
        total_size = int(response.headers.get("Content-Length", 0))

        with open(dest, "wb") as f, tqdm(
            total=total_size,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            desc=desc,
        ) as pbar:
            while chunk := response.read(8192):
                f.write(chunk)
                pbar.update(len(chunk))
```

**Example output:**
```
Downloading test-fixtures-small.tar.gz: 100%|██████████| 307k/307k [00:01<00:00, 245kB/s]
Extracting to testdata/... done
```

**Dependency:** Add `tqdm` to dev dependencies in `pyproject.toml`.

**Example pytest fixture:**
```python
@pytest.fixture
def testdata():
    return fetch_testdata("small")
```

### 12.6.5 Tasks

- [x] Create `python/arbors/testdata.py` with licensing docstring
- [x] Implement `fetch_testdata()` with tqdm progress
- [x] Implement `get_testdata_path()`
- [x] Implement `testdata_available()`
- [x] Add `tqdm` to dev dependencies
- [x] Add to `__init__.py` exports
- [x] Add to API manifest
- [x] Add tests for testdata module
- [x] Update type stubs

---

## 12.7 CI Integration

**Purpose:** Update CI to fetch testdata before running tests.

### 12.7.1 GitHub Actions Updates

File: `.github/workflows/ci.yml`

```yaml
jobs:
  rust:
    steps:
      - uses: actions/checkout@v4

      - name: Fetch test data
        run: ./scripts/fetch-testdata --tier small

      - name: Cache test data
        uses: actions/cache@v4
        with:
          path: ~/.cache/arbors
          key: testdata-${{ hashFiles('data/testdata-manifest.json') }}

      - name: Build
        run: cargo build
      # ...
```

### 12.7.2 Cache Strategy

- Cache key based on manifest hash
- Separate cache for small vs large tiers
- Cache persists across PR runs

### 12.7.3 Tasks

- [x] Update `.github/workflows/ci.yml` with fetch step
- [x] Add testdata cache configuration
- [x] Test CI with cached and uncached scenarios
- [x] Ensure PR builds don't need large tier

---

## 12.8 Git Configuration

**Purpose:** Update Git to ignore downloaded testdata.

### 12.8.1 .gitignore Updates

```gitignore
# Test data (downloaded from releases)
/testdata/
```

### 12.8.2 Migration Strategy

1. Create release with current testdata
2. Update .gitignore to exclude testdata/
3. Remove testdata/ from Git tracking
4. Commit removal
5. Verify CI still works

### 12.8.3 Tasks

- [x] Add `/testdata/` to .gitignore
- [x] Run `git rm -r --cached testdata/`
- [x] Create final commit removing testdata from tracking
- [x] Verify `git status` shows clean after fresh clone + fetch

---

## 12.9 Release Workflow

**Purpose:** Document how to create new testdata releases and add new test files.

### 12.9.1 Adding New Test Data

File: `scripts/add-testdata`

```bash
# Add a new file to the small tier
./scripts/add-testdata mydir/newfile.json

# Add a new file to the large tier
./scripts/add-testdata --tier large benchmarks/big_dataset.jsonl

# Add multiple files
./scripts/add-testdata mydir/file1.json mydir/file2.json
```

**What the script does:**
1. Copies file(s) to local `testdata/` directory
2. Updates `data/testdata-manifest.json` with new file entries
3. Prints instructions for creating a new release

**Script logic:**

```bash
#!/bin/bash
# scripts/add-testdata

TIER="small"
FILES=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --tier) TIER="$2"; shift 2 ;;
        *) FILES+=("$1"); shift ;;
    esac
done

for FILE in "${FILES[@]}"; do
    # Validate file exists
    if [[ ! -f "$FILE" ]]; then
        echo "Error: $FILE not found"
        exit 1
    fi

    # Determine destination path
    DEST="testdata/$(basename "$FILE")"
    if [[ "$FILE" == */* ]]; then
        # Preserve subdirectory structure
        DEST="testdata/$FILE"
    fi

    # Copy file
    mkdir -p "$(dirname "$DEST")"
    cp "$FILE" "$DEST"
    echo "Added: $DEST"

    # Update manifest (add to files list for tier)
    # ... JSON manipulation with jq or python ...
done

echo ""
echo "Files added to '$TIER' tier."
echo "Next steps:"
echo "  1. ./scripts/release-testdata.sh vN"
echo "  2. gh release create test-fixtures-vN dist/*"
echo "  3. git add data/testdata-manifest.json && git commit"
```

### 12.9.2 Creating a Release

File: `scripts/release-testdata.sh`

```bash
# Create archives and update manifest
./scripts/release-testdata.sh v2

# Upload to GitHub
gh release create test-fixtures-v2 \
  --title "Test Fixtures v2" \
  --notes "Added new test files" \
  dist/test-fixtures-small.tar.gz \
  dist/test-fixtures-large.tar.gz

# Commit updated manifest
git add data/testdata-manifest.json
git commit -m "chore: update test-fixtures manifest to v2"
```

### 12.9.3 Full Workflow Example

```bash
# Developer wants to add a new test file

# 1. Create the test file locally
echo '{"test": true}' > mytest.json

# 2. Add to testdata (updates manifest)
./scripts/add-testdata basic-json/mytest.json

# 3. Run tests locally to verify
make test

# 4. Create new release
./scripts/release-testdata.sh v2

# 5. Upload release
gh release create test-fixtures-v2 dist/*

# 6. Commit manifest
git add data/testdata-manifest.json
git commit -m "chore: add mytest.json to test fixtures v2"
git push
```

### 12.9.4 Version Strategy

- Increment version for any changes: `test-fixtures-v1`, `test-fixtures-v2`, etc.
- No backward compatibility—only current version supported

### 12.9.5 Tasks

- [x] Create `scripts/add-testdata` script
- [x] Create `scripts/release-testdata.sh` script
- [x] Document release process in README or CONTRIBUTING.md
- [ ] Create initial release (`test-fixtures-v1`) — archives ready at `/tmp/arbors-testdata-release/`
- [ ] Test full add → release → download cycle — requires GitHub upload first

---

## 12.10 Documentation Updates

**Purpose:** Update documentation to reflect new testdata workflow.

### 12.10.1 README Updates

Add section:

```markdown
## Test Data

Test data is stored in GitHub Releases to keep the repository small.

### For Development

```bash
# Download test data (one-time)
./scripts/fetch-testdata

# Download benchmark data (optional, large)
./scripts/fetch-testdata --tier large
```

### For CI

Test data is automatically downloaded during CI runs.

### 12.10.2 CLAUDE.md Updates

Update build commands section to mention testdata fetching.

### 12.10.3 Tasks

- [ ] Update README.md with testdata instructions
- [ ] Update CLAUDE.md with fetch-testdata command
- [ ] Add troubleshooting section for common issues

---

## 12.11 Makefile Integration

**Purpose:** Add convenient make targets for testdata management.

### 12.11.1 New Targets

```makefile
# Fetch test data (small tier, for development)
fetch-testdata:
	@./scripts/fetch-testdata --tier small

# Fetch all test data including benchmarks
fetch-testdata-all:
	@./scripts/fetch-testdata --tier all

# Create testdata release archives (maintainer use)
release-testdata:
	@./scripts/release-testdata.sh $(VERSION)
```

### 12.11.2 Update Existing Targets

- `make test` should auto-fetch testdata if missing
- `make benchmark` should auto-fetch large tier

### 12.11.3 Tasks

- [x] Add `fetch-testdata` target
- [x] Add `fetch-testdata-all` target
- [x] Update `test` target to check for testdata
- [x] Update `benchmark` target to fetch large tier

---

## Implementation Order

### Phase A: Foundation (do first)
1. **12.1** Licensing setup (LICENSE-CC-BY-SA-3.0.txt, ATTRIBUTION.md, README for release)
2. **12.3** Manifest schema design
3. **12.4** Archive creation script (`scripts/release-testdata.sh`)
4. **12.9** Add-testdata script (`scripts/add-testdata`) + initial release

### Phase B: Download Tooling
5. **12.5** Download script (`scripts/fetch-testdata`)
6. **12.6** Python integration (`python/arbors/testdata.py`)
7. **12.11** Makefile integration

### Phase C: Migration
8. **12.8** Git configuration (remove from tracking)
9. **12.7** CI integration

### Phase D: Polish
10. **12.2** Data tiering (verify tiers work)
11. **12.10** Documentation (including licensing section in main README)

---

## Success Criteria

- [ ] Fresh clone is <5 MB (currently ~20 MB with testdata)
- [ ] `make test` works on fresh clone (auto-fetches small tier)
- [ ] `make benchmark` works (auto-fetches large tier)
- [ ] CI passes with cached testdata
- [ ] CI passes with cold cache (fresh download)
- [ ] Download script handles network failures gracefully
- [ ] Checksum verification catches corrupted downloads
- [ ] Documentation is clear and complete
- [ ] **License separation is correct:**
  - [ ] No CC-BY-SA content in git repo
  - [ ] LICENSE-CC-BY-SA-3.0.txt included in release
  - [ ] ATTRIBUTION.md lists all sources with modifications
  - [ ] Main README has licensing section explaining separation
  - [ ] Python module docstring includes licensing note
- [ ] **Historical support:**
  - [ ] `testdata-legacy` tag created before migration
  - [ ] Bisection workflow documented in README

---

## Risks and Mitigations

Based on plan review, the following gaps and risks need addressing:

### R1: Integrity and Trust

**Risk:** SHA256 checksums verify integrity but not authenticity.

**Mitigation:**
- Phase 12 scope: SHA256 checksums verified after download (sufficient for internal test fixtures)
- Checksums stored in manifest AND verified by download script

**Future (if shipping beyond internal use):**
- Add opt-in signed checksum (detached GPG signature or sigstore)
- Document how to verify GitHub release provenance via `gh release verify`
- Consider requiring releases to be created from signed Git tags

### R2: `gh` vs `curl` Fallback

**Risk:** `gh release download` may be rate-limited or unavailable outside CI.

**Mitigation:**
- Fallback to `curl` with GitHub API
- Support `GITHUB_TOKEN` env var for authenticated requests
- Handle GitHub API pagination for release assets
- Test both paths explicitly

**curl fallback implementation:**
```bash
# If gh not available, use curl with optional auth
if command -v gh &> /dev/null; then
    gh release download "$TAG" --pattern "$ASSET" --dir "$DEST"
else
    ASSET_URL=$(curl -s ${GITHUB_TOKEN:+-H "Authorization: token $GITHUB_TOKEN"} \
        "https://api.github.com/repos/OWNER/REPO/releases/tags/$TAG" \
        | jq -r ".assets[] | select(.name==\"$ASSET\") | .browser_download_url")
    curl -L -o "$DEST/$ASSET" "$ASSET_URL"
fi
```

### R3: Windows Support

**Risk:** Bash scripts don't work on Windows without WSL/Git Bash.

**Mitigation:**
- Primary: Document WSL or Git Bash as requirements for Windows
- Python helper (`python/arbors/testdata.py`) works cross-platform
- Python helper should NOT shell out to bash; implement download logic in pure Python
- Add Windows to CI matrix for Python tests (uses Python helper, not bash)

**Updated Python helper approach:**
```python
# Don't shell out to bash - use requests/urllib directly
def fetch_testdata(tier: str = "small", force: bool = False) -> Path:
    # Pure Python implementation using urllib or requests
    # Works on Windows without bash
    ...
```

### R4: Test Dependencies on Large Tier

**Risk:** Tests may inadvertently depend on files in the large tier.

**Mitigation:**
- Add pytest marker `@pytest.mark.requires_large_testdata`
- Skip marked tests if large tier not present
- CI only fetches small tier by default
- `make benchmark` fetches large tier automatically

**Implementation:**
```python
# conftest.py
import pytest
from arbors.testdata import testdata_available

def pytest_configure(config):
    config.addinivalue_line(
        "markers", "requires_large_testdata: test requires large testdata tier"
    )

def pytest_collection_modifyitems(config, items):
    if not testdata_available("large"):
        skip = pytest.mark.skip(reason="large testdata tier not available")
        for item in items:
            if "requires_large_testdata" in item.keywords:
                item.add_marker(skip)
```

### R5: Migration for Existing Clones

**Risk:** Removing `testdata/` breaks existing clones until they fetch.

**Mitigation:**
- Document migration in release notes and README
- `make test` auto-fetches if testdata missing (already planned)
- Add clear error message if testdata missing:
  ```
  Error: testdata/ not found. Run './scripts/fetch-testdata' first.
  ```

### R6: Cache Key Stability

**Risk:** Cache key must change when assets change.

**Mitigation:**
- Manifest includes SHA256 hashes for each asset
- Cache key: `testdata-${{ hashFiles('data/testdata-manifest.json') }}`
- Any asset change → manifest hash change → cache invalidation

**Manifest structure ensures this:**
```json
{
  "tiers": {
    "small": {
      "sha256": "abc123...",  // Changes when content changes
      "size_bytes": 307200    // Also changes
    }
  }
}
```

### R7: Python Helper Cross-Platform

**Risk:** Python helper using subprocess to call bash fails on Windows.

**Mitigation:**
- Implement download logic in pure Python (urllib/requests)
- No subprocess calls to bash scripts
- Use `pathlib` for cross-platform paths
- Test on Windows in CI

### R8: Release Process Automation

**Risk:** Manual release steps are error-prone.

**Mitigation:**
- Create single script `scripts/publish-testdata-release.sh` that:
  1. Validates testdata directory exists
  2. Creates archives
  3. Updates manifest with checksums
  4. Validates manifest matches archives
  5. Creates GitHub release (with confirmation prompt)
  6. Outputs git commands for manifest commit

```bash
# One command to rule them all
./scripts/publish-testdata-release.sh v2
```

### R9: Historical Bisection

**Risk:** Old commits lack testdata after removal from git.

**Mitigation:**
- Create `testdata-legacy` tag pointing to last commit with testdata in git
- Document in README and CONTRIBUTING.md

**README section to add:**
```markdown
### Historical Commits

Test data was removed from the repository in commit XXXXXX to reduce clone size.
For bisecting or testing commits before this change:

1. Check out the `testdata-legacy` tag to get the last version with embedded test data
2. Or fetch test data from the appropriate release version

```bash
# Option 1: Use legacy tag
git checkout testdata-legacy -- testdata/

# Option 2: Fetch from release (preferred)
./scripts/fetch-testdata
```

### R10: Tasks to Address Risks

- [ ] R2: Implement curl fallback with GITHUB_TOKEN support
- [ ] R3: Implement Python helper in pure Python (no subprocess to bash)
- [ ] R3: Add Windows to CI test matrix
- [ ] R4: Add `@pytest.mark.requires_large_testdata` marker
- [ ] R4: Add pytest plugin to skip tests when large tier missing
- [ ] R5: Add clear error message when testdata missing
- [ ] R8: Create `scripts/publish-testdata-release.sh` unified script
- [ ] R9: Create `testdata-legacy` tag before migration
- [ ] R9: Document bisection workflow in README

---

## Decisions Made

| Question | Decision |
|----------|----------|
| Python wrapper | Required—`python/arbors/testdata.py` |
| Tier granularity | 2 tiers by size (small ~1MB, large ~14MB) |
| Compression format | gzip for universal compatibility |
| Release naming | `test-fixtures-v1`, `test-fixtures-v2`, etc. |
| Backward compatibility | None—only current version supported |

---

## 12.12 Workflow Simplification

**Purpose:** Reduce the testdata release workflow from 9 steps to a single interactive command.

### 12.12.1 Problem

The current workflow requires:
1. Copy file to testdata/
2. Run add-testdata script
3. Run release-testdata.sh
4. Run gh release create with 8 arguments
5. Copy manifest back
6. Git add
7. Git commit
8. Git push
9. Verify

This is error-prone and tedious. The `gh release create` command alone has 8 arguments that must be typed correctly.

### 12.12.2 Solution: Interactive Python Tool

Replace the bash scripts with a single Python tool: `scripts/testdata-release.py`

**User experience:**

```bash
# After placing new file in testdata/
./scripts/testdata-release.py

# Interactive menu guides through:
#   1. Detect new/changed files in testdata/
#   2. Confirm tier assignments
#   3. Create archives
#   4. Upload to GitHub
#   5. Update and commit manifest
```

**Design principles:**
- **Sensible defaults** - Just press Enter to accept
- **Auto-detection** - Find new files automatically by comparing testdata/ to manifest
- **Auto-versioning** - Determine next version from existing releases
- **Single command** - No need to run multiple scripts
- **Dry-run first** - Show what will happen before doing it
- **Rollback guidance** - If something fails, explain how to fix

### 12.12.3 Directory Rename

Rename `data/` to `testmetadata/` for clarity:
- `data/` is ambiguous (could be actual data)
- `testmetadata/` clearly indicates it's metadata *about* test data

Files to move:
- `data/testdata-manifest.json` → `testmetadata/testdata-manifest.json`
- `data/ATTRIBUTION.md` → `testmetadata/ATTRIBUTION.md`
- `data/LICENSE-CC-BY-SA-3.0.txt` → `testmetadata/LICENSE-CC-BY-SA-3.0.txt`
- `data/README-testdata.md` → `testmetadata/README-testdata.md`
- `data/HOW-TO-ADD-TEST-DATA.md` → `testmetadata/HOW-TO-ADD-TEST-DATA.md`
- `data/RELEASE-NOTES-v1.md` → `testmetadata/RELEASE-NOTES-v1.md`
- `data/testdata-manifest.schema.json` → `testmetadata/testdata-manifest.schema.json`

Update references in:
- `scripts/fetch-testdata`
- `scripts/release-testdata.sh`
- `scripts/add-testdata`
- `python/arbors/testdata.py`
- `.github/workflows/ci.yml` (cache key)
- `CLAUDE.md`

### 12.12.4 Interactive Menu Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  Arbors Test Data Release                   │
└─────────────────────────────────────────────────────────────┘

Scanning testdata/ for changes...

Found 2 new files not in manifest:
  • basic-json/newfile.json (1.2 KB)
  • csv/sample.csv (4.5 KB)

Step 1/5: Tier Assignment
─────────────────────────
  basic-json/newfile.json → [small] (Enter to confirm, 'l' for large)
  csv/sample.csv → [small] (Enter to confirm, 'l' for large)

Step 2/5: Version
─────────────────
  Current release: test-fixtures-v3
  Next version: test-fixtures-v4 (Enter to confirm, or type version)

Step 3/5: Create Archives
─────────────────────────
  Creating test-fixtures-small.zip... done (105 KB)
  Creating test-fixtures-large.zip... done (2.8 MB)
  Computing checksums... done

Step 4/5: Upload to GitHub
──────────────────────────
  This will create release: test-fixtures-v4
  With assets:
    • test-fixtures-small.zip
    • test-fixtures-large.zip
    • testdata-manifest.json
    • LICENSE-CC-BY-SA-3.0.txt
    • ATTRIBUTION.md
    • README-testdata.md

  Proceed? [Y/n]

  Uploading... done
  Release URL: https://github.com/arbo-rs/arbors/releases/tag/test-fixtures-v4

Step 5/5: Update Repository
───────────────────────────
  Copying manifest to testmetadata/...
  Creating commit: "chore: update test-fixtures manifest to v4"
  Push to origin? [Y/n]

  Pushed.

✓ Release complete!
```

### 12.12.5 Edge Cases

| Situation | Behavior |
|-----------|----------|
| No new files | "No changes detected. Nothing to release." |
| gh not installed | Error with install instructions |
| Not logged into gh | Prompt to run `gh auth login` |
| Upload fails | Show error, don't commit, explain rollback |
| Dirty git state | Warn but allow proceeding |
| Network error | Retry with backoff, then fail gracefully |

### 12.12.6 Deprecation

Old scripts become thin wrappers or are removed:
- `scripts/add-testdata` → Deprecated (auto-detection replaces it)
- `scripts/release-testdata.sh` → Deprecated (new Python tool replaces it)
- `scripts/fetch-testdata` → Keep (still needed for downloading)

### 12.12.7 Tasks

- [x] Rename `data/` to `testmetadata/`
- [x] Update all file references to new directory
- [x] Create `scripts/testdata-release.py` interactive tool
- [x] Implement auto-detection of new files
- [x] Implement auto-versioning from existing releases
- [x] Implement archive creation (port from bash)
- [x] Implement GitHub release upload via `gh` CLI
- [x] Implement manifest update and git commit
- [x] Add `--dry-run` flag for preview mode
- [x] Update HOW-TO-ADD-TEST-DATA.md with simplified workflow
- [x] Remove old bash scripts (`add-testdata`, `release-testdata.sh`)

---

## References

- [HuggingFace Hub Download Guide](https://huggingface.co/docs/huggingface_hub/guides/download)
- [gh release download documentation](https://cli.github.com/manual/gh_release_download)
- [GitHub Release Verification](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/verifying-the-integrity-of-a-release)

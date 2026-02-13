#!/usr/bin/env bash
#
# Release tugtool
#
# Usage: ./scripts/release.sh <version>
#

set -euo pipefail

VERSION="${1:-}"
VERSION="${VERSION#v}"

# Validate version format first, before printing anything
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Invalid version format. Expected X.Y.Z" >&2
    exit 1
fi

echo "==> Releasing v$VERSION"
echo ""

# Must be on main
if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Error: Must be on main branch" >&2
    exit 1
fi

# Must have clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: Working tree is dirty. Commit or stash changes first." >&2
    exit 1
fi

# Must be up-to-date with origin
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
    echo "Error: Local main is not up-to-date with origin. Run: git pull --rebase" >&2
    exit 1
fi

# Clean up failed release if it exists
if gh release view "v$VERSION" &>/dev/null; then
    echo "==> Found existing release v$VERSION"
    read -p "    Delete and retry? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "==> Deleting failed release v$VERSION..."
        gh release delete "v$VERSION" --yes &>/dev/null || true
    else
        echo "Aborted." >&2
        exit 1
    fi
fi

# Clean up orphaned tag from failed release
if git ls-remote --tags origin 2>/dev/null | grep -q "refs/tags/v$VERSION$"; then
    echo "==> Cleaning up orphaned tag v$VERSION..."
    git push origin ":refs/tags/v$VERSION" &>/dev/null || true
fi
git tag -d "v$VERSION" &>/dev/null || true

# Version check (anchor to line start to avoid matching rust-version, etc.)
CURRENT=$(grep '^version = ' Cargo.toml | head -1 | sed 's/^version = "\(.*\)"/\1/')
if [[ -z "$CURRENT" ]]; then
    echo "Error: Could not read current version from Cargo.toml" >&2
    exit 1
fi

IFS='.' read -r CUR_MAJ CUR_MIN CUR_PAT <<< "$CURRENT"
IFS='.' read -r NEW_MAJ NEW_MIN NEW_PAT <<< "$VERSION"

if [[ $NEW_MAJ -lt $CUR_MAJ ]] || \
   [[ $NEW_MAJ -eq $CUR_MAJ && $NEW_MIN -lt $CUR_MIN ]] || \
   [[ $NEW_MAJ -eq $CUR_MAJ && $NEW_MIN -eq $CUR_MIN && $NEW_PAT -lt $CUR_PAT ]]; then
    echo "Error: $VERSION must be >= current ($CURRENT)" >&2
    exit 1
fi

# Verify code quality (check only — do not auto-fix during a release)
echo "==> Checking formatting..."
if ! cargo fmt --all -- --check; then
    echo "Error: Code is not formatted. Run: cargo fmt --all" >&2
    exit 1
fi

echo "==> Running clippy..."
if ! cargo clippy --workspace --all-targets -- -D warnings; then
    echo "Error: Clippy found warnings. Fix them first." >&2
    exit 1
fi

# Update version
echo "==> Updating version to $VERSION..."
sed -i '' "s/^version = .*/version = \"$VERSION\"/" Cargo.toml

# Verify sed actually changed something
AFTER=$(grep '^version = ' Cargo.toml | head -1 | sed 's/^version = "\(.*\)"/\1/')
if [[ "$AFTER" != "$VERSION" ]]; then
    echo "Error: Failed to update version in Cargo.toml (got '$AFTER', expected '$VERSION')" >&2
    exit 1
fi

# Commit only the version change
git add Cargo.toml
if git diff --cached --quiet; then
    echo "Error: No changes to commit. Version may already be $VERSION." >&2
    exit 1
fi

echo "==> Committing version bump..."
git commit -m "Release $VERSION" --quiet

# Push
echo "==> Pushing to origin..."
git push origin main --quiet

# Tag and push tag
echo "==> Tagging v$VERSION..."
git tag "v$VERSION"
git push origin "v$VERSION" --quiet

echo ""
echo "==> Released v$VERSION"
echo "    CI: https://github.com/tugtool/tugtool/actions"

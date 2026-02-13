#!/usr/bin/env bash
#
# Release tugtool
#
# Usage: ./scripts/release.sh <version>
#

set -euo pipefail

VERSION="${1:-}"
VERSION="${VERSION#v}"

echo "==> Releasing v$VERSION"
echo ""

# Validate
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Invalid version format. Expected X.Y.Z" >&2
    exit 1
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Error: Must be on main branch" >&2
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

# Version check
CURRENT=$(grep 'version = ' Cargo.toml | head -1 | sed 's/.*version = "\(.*\)".*/\1/')
IFS='.' read -r CUR_MAJ CUR_MIN CUR_PAT <<< "$CURRENT"
IFS='.' read -r NEW_MAJ NEW_MIN NEW_PAT <<< "$VERSION"

if [[ $NEW_MAJ -lt $CUR_MAJ ]] || \
   [[ $NEW_MAJ -eq $CUR_MAJ && $NEW_MIN -lt $CUR_MIN ]] || \
   [[ $NEW_MAJ -eq $CUR_MAJ && $NEW_MIN -eq $CUR_MIN && $NEW_PAT -lt $CUR_PAT ]]; then
    echo "Error: $VERSION must be >= current ($CURRENT)" >&2
    exit 1
fi

# Build
echo "==> Formatting code..."
cargo fmt --all --quiet

echo "==> Running clippy (auto-fix)..."
cargo clippy --workspace --fix --allow-dirty --allow-staged -- -D warnings &>/dev/null

echo "==> Verifying clean build..."
cargo clippy --workspace -- -D warnings &>/dev/null

# Update version
echo "==> Updating version to $VERSION..."
sed -i '' "s/^version = .*/version = \"$VERSION\"/" Cargo.toml

# Commit
git add -A
if ! git diff --cached --quiet; then
    echo "==> Committing changes..."
    git commit -m "Release $VERSION" --quiet
fi

# Clean up local tag
git tag -d "v$VERSION" &>/dev/null || true

# Push
echo "==> Syncing with origin..."
git pull --rebase origin main --quiet || true
git push origin main --quiet

echo "==> Tagging v$VERSION..."
git tag "v$VERSION"
git push origin "v$VERSION" --quiet

echo ""
echo "==> Released v$VERSION"
echo "    CI: https://github.com/tugtool/tugtool/actions"

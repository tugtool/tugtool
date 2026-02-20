#!/usr/bin/env bash
#
# Update Homebrew formula with new version and checksums
#
# Usage: ./scripts/update-homebrew-formula.sh <formula_path> <tag> <arm64_sha256> <x86_64_sha256>
#
# Example:
#   ./scripts/update-homebrew-formula.sh /tmp/homebrew-tugtool/Formula/tugcode.rb v0.5.20 abc123... def456...
#
# The script:
# - Strips the 'v' prefix from the tag to get the version number
# - Updates the version string, URLs, and SHA256 checksums in the formula
# - Is idempotent: exits 0 with no changes if formula already has correct values

set -euo pipefail

if [[ $# -ne 4 ]]; then
    echo "Usage: $0 <formula_path> <tag> <arm64_sha256> <x86_64_sha256>" >&2
    echo "Example: $0 /tmp/tap/Formula/tugcode.rb v0.5.20 abc123... def456..." >&2
    exit 1
fi

FORMULA_PATH="$1"
TAG="$2"
ARM64_SHA="$3"
X86_64_SHA="$4"

# Strip 'v' prefix from tag to get version
VERSION="${TAG#v}"

if [[ ! -f "$FORMULA_PATH" ]]; then
    echo "Error: Formula not found at $FORMULA_PATH" >&2
    exit 1
fi

# Read current formula content
FORMULA_CONTENT=$(cat "$FORMULA_PATH")

# Check if already up to date (idempotent)
if echo "$FORMULA_CONTENT" | grep -q "version \"$VERSION\"" && \
   echo "$FORMULA_CONTENT" | grep -q "# SHA256 ARM64: $ARM64_SHA" && \
   echo "$FORMULA_CONTENT" | grep -q "# SHA256 X86_64: $X86_64_SHA"; then
    echo "Formula already up to date at version $VERSION"
    exit 0
fi

# Create a temporary file for the updated formula
TEMP_FILE=$(mktemp)
trap 'rm -f "$TEMP_FILE"' EXIT

# Process the formula line by line
while IFS= read -r line || [[ -n "$line" ]]; do
    # Update version line
    if [[ "$line" =~ ^[[:space:]]*version[[:space:]]+ ]]; then
        echo "  version \"$VERSION\""
    # Update ARM64 sha256 comment
    elif [[ "$line" =~ "# SHA256 ARM64:" ]]; then
        echo "      # SHA256 ARM64: $ARM64_SHA"
    # Update ARM64 sha256 value (line after ARM64 comment)
    elif [[ "$line" =~ ^[[:space:]]*sha256[[:space:]]+ ]] && [[ "$prev_line" =~ "# SHA256 ARM64:" ]]; then
        echo "      sha256 \"$ARM64_SHA\""
    # Update X86_64 sha256 comment
    elif [[ "$line" =~ "# SHA256 X86_64:" ]]; then
        echo "      # SHA256 X86_64: $X86_64_SHA"
    # Update X86_64 sha256 value (line after X86_64 comment)
    elif [[ "$line" =~ ^[[:space:]]*sha256[[:space:]]+ ]] && [[ "$prev_line" =~ "# SHA256 X86_64:" ]]; then
        echo "      sha256 \"$X86_64_SHA\""
    else
        echo "$line"
    fi
    prev_line="$line"
done < "$FORMULA_PATH" > "$TEMP_FILE"

# Replace original with updated content
mv "$TEMP_FILE" "$FORMULA_PATH"
trap - EXIT  # Remove trap since we moved the file

echo "Updated formula to version $VERSION"
echo "  ARM64 SHA256: $ARM64_SHA"
echo "  X86_64 SHA256: $X86_64_SHA"

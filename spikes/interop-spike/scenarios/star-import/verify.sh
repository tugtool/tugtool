#!/bin/bash
# Verify star import scenario
#
# This script tests renaming a symbol that is exported via star import.
# Expected: Renaming process_data in base.py should update all usages
# including those imported via "from .base import *"

set -e

SCENARIO_DIR="$(dirname "$0")"
TUG="../../target/release/tug"

cd "$SCENARIO_DIR"

echo "=== Star Import Scenario ==="
echo "Testing: Rename process_data -> transform_data"
echo ""

# 1. Run Python to verify it works before rename
echo "Before rename:"
python3 main.py
echo ""

# 2. Analyze impact
echo "Analyzing impact..."
$TUG analyze-impact rename-symbol --at pkg/base.py:4:5 --to transform_data
echo ""

# 3. Dry run
echo "Dry run:"
$TUG run rename-symbol --at pkg/base.py:4:5 --to transform_data
echo ""

# 4. Apply changes
echo "Applying changes..."
$TUG run --apply rename-symbol --at pkg/base.py:4:5 --to transform_data
echo ""

# 5. Run Python to verify it works after rename
echo "After rename:"
python3 main.py
echo ""

# 6. Restore files for next run
git checkout -- .
echo "Files restored."

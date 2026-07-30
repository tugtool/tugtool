#!/usr/bin/env bash
# imposer-cadence-run.sh — does the settle's walk cost scale with GESTURES or
# with TIME?
#
# Usage: diag/imposer-cadence-run.sh <port> <webcontent-pid> <rounds> <outdir>
#
# The window is a fixed 4 seconds in every condition; only the number of
# arrangement changes inside it varies. If the walk is per-frame, every
# condition costs the same (the frames keep coming either way). If it is
# per-gesture, the cost tracks the gesture count and nothing else.
#
# This is the falsifiable form of the claim, which a single flip-vs-base
# number is not.
set -euo pipefail

PORT="$1"
PID="$2"
ROUNDS="${3:-3}"
OUT="${4:-/tmp/imposer-cadence}"
SECS=4

mkdir -p "$OUT"

ev() {
  python3 - "$1" <<'PY' | curl -s -X POST "http://127.0.0.1:$PORT/api/eval" \
      -H 'Content-Type: application/json' --data-binary @- >/dev/null
import json, sys
print(json.dumps({"code": sys.argv[1]}))
PY
}

drive() {
  local count="$1" cadence="$2"
  ev "(function () {
    var sides = ['left', 'right'];
    var i = 0;
    (function step() {
      if (i >= ${count}) return;
      window.tugdeck.lab.dispatch('set-imposition-lens', { side: sides[i % 2] });
      i++;
      setTimeout(step, ${cadence});
    })();
    return 'go';
  })()"
}

walks() {
  grep -oE '[0-9]+ +WebCore::RenderLayerCompositor::computeCompositingRequirements' "$1" 2>/dev/null |
    awk '{ s += $1 } END { print s + 0 }'
}

median() {
  sort -n | awk '{ a[NR] = $1 } END {
    if (NR % 2) print a[(NR + 1) / 2];
    else print int((a[NR / 2] + a[NR / 2 + 1]) / 2)
  }'
}

# condition:gestures:cadence-ms — each fills the same 4s window.
CONDS="idle:0:0 g4:4:1000 g8:8:500 g16:16:250"

for r in $(seq 1 "$ROUNDS"); do
  for c in $CONDS; do
    name="${c%%:*}"
    rest="${c#*:}"
    count="${rest%%:*}"
    cadence="${rest#*:}"
    f="$OUT/r${r}-${name}.txt"
    [ "$count" -gt 0 ] && drive "$count" "$cadence"
    sample "$PID" "$SECS" -mayDie -f "$f" >/dev/null 2>&1 || true
    echo "round $r  ${name}  gestures=${count}  walk=$(walks "$f")"
    sleep 3
  done
done

echo
echo "=== medians (walk samples per 4s window) ==="
for c in $CONDS; do
  name="${c%%:*}"
  rest="${c#*:}"
  count="${rest%%:*}"
  vals=""
  for r in $(seq 1 "$ROUNDS"); do vals="$vals$(walks "$OUT/r${r}-${name}.txt")
"; done
  med=$(printf '%s' "$vals" | median)
  if [ "$count" -gt 0 ]; then
    per=$(awk -v m="$med" -v c="$count" 'BEGIN { printf "%.1f", m / c }')
    echo "${name}: gestures=${count} samples=[$(printf '%s' "$vals" | tr '\n' ' ')] median=${med} per-gesture=${per}"
  else
    echo "${name}: gestures=0  samples=[$(printf '%s' "$vals" | tr '\n' ' ')] median=${med}"
  fi
done

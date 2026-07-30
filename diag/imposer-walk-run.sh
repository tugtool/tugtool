#!/usr/bin/env bash
# imposer-walk-run.sh — interleaved walk-cost run for the imposer settle.
#
# Usage: diag/imposer-walk-run.sh <port> <webcontent-pid> <rounds> <outdir>
#
# Three conditions, interleaved within each round so drift in machine state
# lands on all three equally:
#
#   base    the deck sitting still — what the page costs with nobody moving
#   flip    repeated arrangement changes, the settle under test
#   force   the same frames driven by per-frame rAF transform mutation — the
#           disqualifying form. This condition is not a comparison, it is the
#           PROOF THE INSTRUMENT IS ALIVE: without it, "flip measured zero" and
#           "the probe is broken" are the same reading.
#
# The statistic is samples landing in RenderLayerCompositor::
# computeCompositingRequirements — the whole-page walk. Counted from the
# leading integers of `sample`'s call tree, summed across branches.
set -euo pipefail

PORT="$1"
PID="$2"
ROUNDS="${3:-3}"
OUT="${4:-/tmp/imposer-walk}"
SECS=4

mkdir -p "$OUT"
LAB="$(dirname "$0")/imposer-lab.sh"

walks() {
  grep -oE '[0-9]+ +WebCore::RenderLayerCompositor::computeCompositingRequirements' "$1" 2>/dev/null |
    awk '{ s += $1 } END { print s + 0 }'
}

total() {
  grep -oE 'Call graph:' "$1" >/dev/null 2>&1 || true
  grep -oE '^ +[0-9]+ Thread_' "$1" 2>/dev/null | awk '{ s += $1 } END { print s + 0 }'
}

for r in $(seq 1 "$ROUNDS"); do
  for cond in base flip force; do
    f="$OUT/r${r}-${cond}.txt"
    case "$cond" in
      base) : ;;
      flip)  "$LAB" "$PORT" settle 12 >/dev/null ;;
      force) "$LAB" "$PORT" force 12 >/dev/null ;;
    esac
    sample "$PID" "$SECS" -mayDie -f "$f" >/dev/null 2>&1 || true
    echo "round $r  $cond  walk=$(walks "$f")  total=$(total "$f")"
    # Let the page fall quiet again before the next condition.
    sleep 3
  done
done

echo
echo "=== medians ==="
for cond in base flip force; do
  vals=$(for r in $(seq 1 "$ROUNDS"); do walks "$OUT/r${r}-${cond}.txt"; done | sort -n)
  med=$(echo "$vals" | awk '{ a[NR] = $1 } END { print (NR % 2) ? a[(NR+1)/2] : int((a[NR/2]+a[NR/2+1])/2) }')
  echo "$cond: [$(echo "$vals" | tr '\n' ' ')] median=$med"
done

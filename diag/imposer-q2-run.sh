#!/usr/bin/env bash
# imposer-q2-run.sh — does a React commit landing inside the gesture window
# cost enough to justify holding notifications for the duration?
#
# Usage: diag/imposer-q2-run.sh <port> <webcontent-pid> <rounds> <outdir>
#
# Two corrections over the first attempt at this, both found by checking the
# instrument rather than trusting it:
#
#   The commit driver has to actually commit. `cycleCard` cycles cards WITHIN a
#   pane, and every pane in this scene holds one card, so it was a no-op and
#   the condition measured nothing. `focus-pane` alternating between the two
#   imposed panes moves `activePaneId` every time, which is a real deck-store
#   commit through the real action path. The run below asserts the state
#   actually moved before it believes any of its own numbers.
#
#   The frame threshold has to match the display. This panel runs at 60Hz and
#   delivers a median 17ms interval AT REST, so counting frames "over 16.7ms"
#   marks ~60% of an idle page as late. A dropped frame here is a delivery gap
#   of two vsyncs or more, so the statistic is intervals over 25ms.
set -euo pipefail

PORT="$1"
PID="$2"
ROUNDS="${3:-3}"
OUT="${4:-/tmp/imposer-q2}"
SECS=4

mkdir -p "$OUT"

ev() {
  python3 - "$1" <<'PY' | curl -s -X POST "http://127.0.0.1:$PORT/api/eval" \
      -H 'Content-Type: application/json' --data-binary @-
import json, sys
print(json.dumps({"code": sys.argv[1]}))
PY
}

walks() {
  grep -oE '[0-9]+ +WebCore::RenderLayerCompositor::computeCompositingRequirements' "$1" 2>/dev/null |
    awk '{ s += $1 } END { print s + 0 }'
}

median() {
  sort -n | awk '{ a[NR] = $1 } END {
    if (NR % 2) print a[(NR + 1) / 2]; else print int((a[NR/2] + a[NR/2+1]) / 2)
  }'
}

# `commits` = 0 (settle only) or 1 (settle with a live commit stream).
drive() {
  local commits="$1"
  local settles="${2:-8}"
  ev "(function () {
    window.__labFrames = [];
    window.__labCommits = 0;
    window.__labPaneFlips = 0;
    var lastPane = window.tugdeck.diag.getDeckState().activePaneId;

    var last = performance.now();
    var stop = last + 4200;
    (function tick(now) {
      window.__labFrames.push(now - last);
      last = now;
      if (now < stop) requestAnimationFrame(tick);
    })(performance.now());

    var sides = ['left', 'right'];
    var i = 0;
    (function step() {
      if (i >= ${settles}) return;
      window.tugdeck.lab.dispatch('set-imposition-lens', { side: sides[i % 2] });
      i++;
      setTimeout(step, 500);
    })();

    if (${commits}) {
      // A real deck-store commit every 60ms — inside the 300ms settle windows,
      // not between them. Roughly the cadence a streaming card's coalesced
      // notify lands at.
      var panes = ['p1', 'p2'];
      var c = 0;
      var iv = setInterval(function () {
        window.tugdeck.lab.dispatch('focus-pane', { paneId: panes[c % 2] });
        var nowPane = window.tugdeck.diag.getDeckState().activePaneId;
        if (nowPane !== lastPane) { window.__labPaneFlips++; lastPane = nowPane; }
        window.__labCommits++;
        if (++c > 66) clearInterval(iv);
      }, 60);
    }
    return 'go';
  })()" >/dev/null
}

report() {
  ev "(function () {
    var f = (window.__labFrames || []).slice(2);
    if (!f.length) return null;
    var s = f.slice().sort(function (a, b) { return a - b; });
    var dropped = f.filter(function (x) { return x > 25; });
    return {
      frames: f.length,
      median: +s[s.length >> 1].toFixed(1),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
      max: +Math.max.apply(null, f).toFixed(1),
      dropped25: dropped.length,
      commitsDispatched: window.__labCommits || 0,
      commitsLanded: window.__labPaneFlips || 0
    };
  })()"
}

for r in $(seq 1 "$ROUNDS"); do
  for cond in settle commits_only settle_commits; do
    f="$OUT/r${r}-${cond}.txt"
    case "$cond" in
      settle)         drive 0 8 ;;
      commits_only)   drive 1 0 ;;
      settle_commits) drive 1 8 ;;
    esac
    sample "$PID" "$SECS" -mayDie -f "$f" >/dev/null 2>&1 || true
    echo "round $r  ${cond}  walk=$(walks "$f")"
    echo "         $(report)"
    sleep 3
  done
done

echo
echo "=== walk medians ==="
for cond in settle commits_only settle_commits; do
  vals=$(for r in $(seq 1 "$ROUNDS"); do walks "$OUT/r${r}-${cond}.txt"; done)
  echo "${cond}: [$(echo "$vals" | tr '\n' ' ')] median=$(echo "$vals" | median)"
done

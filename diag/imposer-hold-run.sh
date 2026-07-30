#!/usr/bin/env bash
# imposer-hold-run.sh — what does holding notifications through the gesture
# window actually buy?
#
# Usage: diag/imposer-hold-run.sh <port> <webcontent-pid> <rounds> <outdir>
#
# Read the conditions carefully, because what this measures is the MECHANISM,
# not the plumbing:
#
#   settle           8 arrangement changes, no competing commits
#   commits          the commit stream alone, no settle
#   settle_commits   both, commits landing freely inside the windows
#   settle_held      both, but the commit driver DEFERS while the container
#                    wears `data-imposer-settling` and flushes once the
#                    window closes — deferred, never dropped, exactly the
#                    semantics CodeSessionStore.holdNotifications implements
#
# Why the driver defers rather than the store: the store's hold covers
# WIRE-origin session-store notifications — a streaming card's token traffic,
# which is the real-world source and which needs a live Claude turn to
# produce. The driver here is a LOCAL deck-store action, which the hold
# deliberately never defers (a user's own gesture must not look ignored). So
# pointing the store's hold at this traffic would measure nothing, and a
# condition that cannot move is not a control. Deferring at the driver
# measures the thing actually in question — what suppressing mid-window
# commits is worth — and the store's hold is that suppression applied to the
# path that carries it in production.
set -euo pipefail

PORT="$1"
PID="$2"
ROUNDS="${3:-3}"
OUT="${4:-/tmp/imposer-hold}"
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

# settles, commits, hold (0/1)
drive() {
  local settles="$1" commits="$2" hold="$3"
  ev "(function () {
    window.__labFrames = [];
    window.__labSent = 0;
    window.__labDeferred = 0;
    window.__labLanded = 0;
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
      var panes = ['p1', 'p2'];
      var queued = 0;
      var c = 0;
      var send = function () {
        window.tugdeck.lab.dispatch('focus-pane', { paneId: panes[c % 2] });
        var nowPane = window.tugdeck.diag.getDeckState().activePaneId;
        if (nowPane !== lastPane) { window.__labLanded++; lastPane = nowPane; }
        window.__labSent++;
        c++;
      };
      var iv = setInterval(function () {
        var settling =
          ${hold} && document.querySelector('[data-imposer-settling]') !== null;
        if (settling) {
          // Deferred, not dropped: the work is still owed and is paid
          // the moment the window closes.
          queued++;
          window.__labDeferred++;
        } else {
          while (queued > 0) { send(); queued--; }
          send();
        }
        if (c + queued > 66) { while (queued > 0) { send(); queued--; } clearInterval(iv); }
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
    return {
      median: +s[s.length >> 1].toFixed(1),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
      dropped25: f.filter(function (x) { return x > 25; }).length,
      sent: window.__labSent || 0,
      deferred: window.__labDeferred || 0,
      landed: window.__labLanded || 0
    };
  })()"
}

for r in $(seq 1 "$ROUNDS"); do
  for cond in settle commits settle_commits settle_held; do
    f="$OUT/r${r}-${cond}.txt"
    case "$cond" in
      settle)         drive 8 0 0 ;;
      commits)        drive 0 1 0 ;;
      settle_commits) drive 8 1 0 ;;
      settle_held)    drive 8 1 1 ;;
    esac
    sample "$PID" "$SECS" -mayDie -f "$f" >/dev/null 2>&1 || true
    printf 'round %s  %-15s walk=%-6s %s\n' "$r" "$cond" "$(walks "$f")" "$(report)"
    sleep 3
  done
done

echo
echo "=== walk medians ==="
for cond in settle commits settle_commits settle_held; do
  vals=$(for r in $(seq 1 "$ROUNDS"); do walks "$OUT/r${r}-${cond}.txt"; done)
  printf '%-15s [%s] median=%s\n' "$cond" "$(echo "$vals" | tr '\n' ' ')" "$(echo "$vals" | median)"
done

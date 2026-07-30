#!/usr/bin/env bash
# imposer-q-run.sh — the two open questions the settle plan defers to
# measurement.
#
# Usage: diag/imposer-q-run.sh <port> <webcontent-pid> <rounds> <outdir>
#
# Q01 — nested transform animations. WebKit gives up on overlap testing for the
# rest of a stacking context when a layer and an ancestor both run transform
# animations. A breathing dot inside a FLIP-moving pane is exactly that shape.
# Condition `nested` plants accelerated scale loops inside the moving panes and
# re-runs the same 8-gesture window; `plain` is the same window without them.
#
# Q02 — React commits landing inside the gesture window. Condition `commits`
# drives real card activations at roughly the streaming-coalesce cadence while
# the settle runs. The statistic that matters here is not the walk but the
# FRAME: a commit that costs more than a frame's budget is what a hold would
# have been bought to prevent.
set -euo pipefail

PORT="$1"
PID="$2"
ROUNDS="${3:-3}"
OUT="${4:-/tmp/imposer-q}"
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

# ---- scene helpers -------------------------------------------------------

dots_on() {
  ev "(function () {
    var n = 0;
    ['p1', 'p2'].forEach(function (id) {
      var host = document.querySelector('.tug-pane[data-pane-id=\"' + id + '\"] .tug-pane-chrome');
      if (!host) return;
      var wrap = document.createElement('div');
      wrap.setAttribute('data-lab-dots', '');
      wrap.style.cssText = 'position:absolute;left:8px;top:8px;pointer-events:none';
      for (var i = 0; i < 24; i++) {
        var d = document.createElement('div');
        d.style.cssText =
          'width:8px;height:8px;margin:2px;border-radius:50%;background:#8ac;' +
          'display:inline-block';
        wrap.appendChild(d);
        d.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.6)' }, { transform: 'scale(1)' }],
          { duration: 1200, iterations: Infinity, easing: 'linear' }
        );
        n++;
      }
      host.appendChild(wrap);
    });
    return n;
  })()" >/dev/null
}

dots_off() {
  ev "(function () {
    document.querySelectorAll('[data-lab-dots]').forEach(function (e) { e.remove(); });
    return 'cleared';
  })()" >/dev/null
}

layers() {
  ev "(function () {
    return document.getAnimations().length;
  })()"
}

# Drive `count` arrangement changes, and record every frame interval the main
# thread actually delivered while they ran.
drive_and_time() {
  local count="$1" cadence="$2" commits="$3"
  ev "(function () {
    window.__labFrames = [];
    var last = performance.now();
    var stop = last + ${count} * ${cadence} + 600;
    (function tick(now) {
      window.__labFrames.push(now - last);
      last = now;
      if (now < stop) requestAnimationFrame(tick);
    })(performance.now());

    var sides = ['left', 'right'];
    var i = 0;
    (function step() {
      if (i >= ${count}) return;
      window.tugdeck.lab.dispatch('set-imposition-lens', { side: sides[i % 2] });
      i++;
      setTimeout(step, ${cadence});
    })();

    if (${commits}) {
      // Real React commits at roughly the streaming-coalesce cadence,
      // landing inside the gesture windows rather than between them.
      var c = 0;
      var iv = setInterval(function () {
        window.tugdeck.lab.dispatch('cycleCard');
        if (++c > ${count} * ${cadence} / 60) clearInterval(iv);
      }, 60);
    }
    return 'go';
  })()" >/dev/null
}

frame_stats() {
  ev "(function () {
    var f = (window.__labFrames || []).slice(2);
    if (!f.length) return null;
    var sorted = f.slice().sort(function (a, b) { return a - b; });
    var over = f.filter(function (x) { return x > 16.7; }).length;
    return {
      frames: f.length,
      median: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      max: +Math.max.apply(null, f).toFixed(2),
      over16_7: over,
      overPct: +(100 * over / f.length).toFixed(1)
    };
  })()"
}

# ---- the run -------------------------------------------------------------

for r in $(seq 1 "$ROUNDS"); do
  for cond in plain nested commits; do
    f="$OUT/r${r}-${cond}.txt"
    case "$cond" in
      plain)   dots_off; drive_and_time 8 500 0 ;;
      nested)  dots_on;  drive_and_time 8 500 0 ;;
      commits) dots_off; drive_and_time 8 500 1 ;;
    esac
    sample "$PID" "$SECS" -mayDie -f "$f" >/dev/null 2>&1 || true
    echo "round $r  ${cond}  walk=$(walks "$f")  frames=$(frame_stats)"
    dots_off
    sleep 3
  done
done

echo
echo "=== walk medians (8 gestures per 4s window) ==="
for cond in plain nested commits; do
  vals=$(for r in $(seq 1 "$ROUNDS"); do walks "$OUT/r${r}-${cond}.txt"; done)
  echo "${cond}: [$(echo "$vals" | tr '\n' ' ')] median=$(echo "$vals" | median)"
done

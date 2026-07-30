#!/usr/bin/env bash
# imposer-lab.sh — drive and measure the imposer settle on a release build.
#
# Usage: diag/imposer-lab.sh <port> <command> [args]
#
# Commands:
#   seed [boxes]   stand up a two-up deck + pinned Lens, and populate each
#                  imposed pane with `boxes` composited boxes (default 2000)
#   settle N       run N arrangement changes, one every 500ms
#   force N        run N *forced* moves: per-frame rAF transform mutation on
#                  the same frames — the known-bad form, as a live-instrument
#                  proof that a zero reading means zero and not a dead probe
#   census         report pane/animation/box counts
set -euo pipefail

PORT="$1"
CMD="$2"

ev() {
  python3 - "$1" <<'PY' | curl -s -X POST "http://127.0.0.1:$PORT/api/eval" \
      -H 'Content-Type: application/json' --data-binary @-
import json, sys
print(json.dumps({"code": sys.argv[1]}))
PY
  echo
}

case "$CMD" in
seed)
  BOXES="${3:-2000}"
  ev "(function () {
    var card = function (id, componentId, title) {
      return { id: id, componentId: componentId, title: title, closable: true };
    };
    var pane = function (id, slot, cardId) {
      return {
        id: id, position: { x: 40, y: 40 }, size: { width: 520, height: 500 },
        cardIds: [cardId], activeCardId: cardId, title: '',
        acceptsFamilies: ['maker'], slot: slot,
      };
    };
    window.tugdeck.lab.seedDeck({
      cards: [
        card('A', 'gallery-accordion', 'Card A'),
        card('B', 'gallery-accordion', 'Card B'),
        card('L', 'lens', 'Lens'),
      ],
      panes: [
        pane('p1', 0, 'A'),
        pane('p2', 1, 'B'),
        {
          id: 'pLens', position: { x: 0, y: 0 }, size: { width: 360, height: 900 },
          cardIds: ['L'], activeCardId: 'L', title: 'Lens', acceptsFamilies: [],
        },
      ],
      activePaneId: 'p1',
      imposition: { kind: 'two-up', lens: 'right' },
      hasFocus: true,
    }, 'A');
    return 'seeded';
  })()"
  sleep 2
  # Populate the two imposed panes with composited boxes. Each box is
  # promoted by its own transform, which is what puts it in the overlap map
  # the compositing walk traverses — the same instrument shape the I1 bench
  # used, planted inside the subtrees that actually move.
  ev "(function () {
    var total = 0;
    ['p1', 'p2'].forEach(function (id) {
      var host = document.querySelector('.tug-pane[data-pane-id=\"' + id + '\"] .tug-pane-chrome');
      if (!host) return;
      var field = document.createElement('div');
      field.setAttribute('data-lab-field', '');
      field.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
      for (var i = 0; i < ${BOXES}; i++) {
        var b = document.createElement('div');
        b.style.cssText =
          'position:absolute;width:6px;height:6px;background:#345;' +
          'left:' + ((i * 7) % 480) + 'px;top:' + ((i * 13) % 440) + 'px;' +
          'transform:translateZ(0)';
        field.appendChild(b);
        total++;
      }
      host.appendChild(field);
    });
    return total;
  })()"
  ;;

settle)
  N="${3:-20}"
  ev "(function () {
    var sides = ['left', 'right'];
    var i = 0;
    var n = ${N};
    (function step() {
      if (i >= n) return;
      window.tugdeck.lab.dispatch('set-imposition-lens', { side: sides[i % 2] });
      i++;
      setTimeout(step, 500);
    })();
    return 'driving ' + n;
  })()"
  ;;

force)
  N="${3:-20}"
  ev "(function () {
    // The disqualifying form, on purpose: per-frame main-thread style
    // commits of a transform. If the instrument is alive this reads high.
    var frames = Array.from(document.querySelectorAll('.tug-pane[data-pane-id]'));
    var t0 = performance.now();
    var dur = ${N} * 500;
    (function tick(now) {
      var e = (now - t0);
      if (e > dur) {
        frames.forEach(function (f) { f.style.removeProperty('transform'); });
        return;
      }
      var d = Math.sin(e / 200) * 300;
      frames.forEach(function (f) {
        f.style.transform = 'translate(' + d.toFixed(2) + 'px, 0px)';
      });
      requestAnimationFrame(tick);
    })(performance.now());
    return 'forcing ' + ${N};
  })()"
  ;;

census)
  ev "({
    panes: document.querySelectorAll('.tug-pane[data-pane-id]').length,
    boxes: document.querySelectorAll('[data-lab-field] > div').length,
    anims: document.getAnimations().length,
    frameAnims: document.getAnimations().filter(function (a) {
      var t = a.effect && a.effect.target;
      return t && t.classList && t.classList.contains('tug-pane');
    }).length,
    inlineTransforms: Array.from(
      document.querySelectorAll('.tug-pane[data-pane-id]')
    ).filter(function (e) { return e.style.transform !== ''; }).length,
    settling: document.querySelector('[data-imposer-settling]') !== null
  })"
  ;;

*)
  echo "unknown command: $CMD" >&2
  exit 2
  ;;
esac

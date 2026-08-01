// Keystroke ledger: q (handler entry - event.timeStamp) per keydown, long-frame ring, 2s activity snapshots. Read with kb-read.js; disarm with window.__kb.disarm().
// Arm: jq -Rs '{code: .}' kb-arm.js | curl -s -X POST http://127.0.0.1:<tugcast-port>/api/eval -H 'Content-Type: application/json' -d @-

(() => {
  if (window.__kb) return "already-armed";
  const S = {
    epoch0: Date.now(),
    perf0: performance.now(),
    keys: [],
    longFrames: [],
    snaps: [],
    rafId: 0,
    snapTimer: 0,
    lastRaf: 0,
  };
  window.__kb = S;
  // Continuous rAF monitor: long-gap ring, epoch-joinable with the sampler.
  const beat = (ts) => {
    if (S.lastRaf > 0) {
      const gap = ts - S.lastRaf;
      if (gap > 25) {
        S.longFrames.push({ ms: Math.round(ts - S.perf0), gap: Math.round(gap) });
        if (S.longFrames.length > 2000) S.longFrames.splice(0, 500);
      }
    }
    S.lastRaf = ts;
    S.rafId = requestAnimationFrame(beat);
  };
  S.rafId = requestAnimationFrame(beat);
  // Per-keystroke timing: queue delay (handler entry minus event stamp),
  // then next-frame and frame-after-commit deltas. No key identity, no
  // DOM reads on the key path.
  S.onKey = (e) => {
    const entry = performance.now();
    const rec = {
      ms: Math.round(entry - S.perf0),
      q: Math.round((entry - e.timeStamp) * 10) / 10,
      r1: -1,
      r2: -1,
    };
    S.keys.push(rec);
    if (S.keys.length > 3000) S.keys.splice(0, 500);
    requestAnimationFrame((t1) => {
      rec.r1 = Math.round(t1 - entry);
      requestAnimationFrame((t2) => {
        rec.r2 = Math.round(t2 - entry);
      });
    });
  };
  document.addEventListener("keydown", S.onKey, true);
  // Deck-activity snapshot every 2s — the expensive reads live here, off
  // the key path.
  S.snap = () => {
    S.snaps.push({
      ms: Math.round(performance.now() - S.perf0),
      nodes: document.getElementsByTagName("*").length,
      streamingDots: document.querySelectorAll(
        ".tug-progress-pulsing-dot[data-state='running']:not([data-static])",
      ).length,
      anims: document.getAnimations().length,
      typingAttr: !!document.querySelector("[data-tug-text-editor-typing]"),
    });
    if (S.snaps.length > 600) S.snaps.splice(0, 100);
  };
  S.snapTimer = setInterval(S.snap, 2000);
  S.snap();
  S.disarm = () => {
    document.removeEventListener("keydown", S.onKey, true);
    cancelAnimationFrame(S.rafId);
    clearInterval(S.snapTimer);
    delete window.__kb;
    return "disarmed";
  };
  return JSON.stringify({ armed: true, epoch0: S.epoch0 });
})()

// S9 wake-stall instrument: parallel rAF and 8ms setTimeout gap ledgers with wall clocks; a gap in BOTH = main-thread wake stall. Read window.__dual.{rafLongs,tmrLongs}; disarm().
// Arm: jq -Rs '{code: .}' dual-arm.js | curl -s -X POST http://127.0.0.1:<tugcast-port>/api/eval -H 'Content-Type: application/json' -d @-

(() => {
  if (window.__dual) return "already-armed";
  const S = { t0: performance.now(), rafLongs: [], tmrLongs: [], stopped: false };
  window.__dual = S;
  let lastRaf = performance.now();
  function loop(ts) {
    if (S.stopped) return;
    const gap = ts - lastRaf;
    if (gap > 50) S.rafLongs.push({ ms: Math.round(ts - S.t0), gap: Math.round(gap), wall: Date.now() });
    lastRaf = ts;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  let lastTmr = performance.now();
  function tick() {
    if (S.stopped) return;
    const now = performance.now();
    const gap = now - lastTmr;
    if (gap > 50) S.tmrLongs.push({ ms: Math.round(now - S.t0), gap: Math.round(gap), wall: Date.now() });
    lastTmr = now;
    setTimeout(tick, 8);
  }
  setTimeout(tick, 8);
  S.disarm = () => { S.stopped = true; delete window.__dual; };
  return "armed";
})()

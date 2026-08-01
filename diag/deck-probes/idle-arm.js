// Idle watch: >50ms rAF gaps + keydown q + mousemove count + cumulative mutation count in 2s snapshots. Read window.__idle; disarm().
// Arm: jq -Rs '{code: .}' idle-arm.js | curl -s -X POST http://127.0.0.1:<tugcast-port>/api/eval -H 'Content-Type: application/json' -d @-

(() => {
  if (window.__idle) return "already-armed";
  const S = { t0: performance.now(), longs: [], snaps: [], mm: 0, keys: [], stopped: false };
  window.__idle = S;
  let last = performance.now();
  function loop(ts) {
    if (S.stopped) return;
    const gap = ts - last;
    if (gap > 50) S.longs.push({ ms: Math.round(ts - S.t0), gap: Math.round(gap) });
    last = ts;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  S.onMM = () => { S.mm++; };
  window.addEventListener("mousemove", S.onMM, { capture: true, passive: true });
  S.onKey = (e) => {
    S.keys.push({ ms: Math.round(performance.now() - S.t0), q: Math.round(performance.now() - e.timeStamp) });
  };
  window.addEventListener("keydown", S.onKey, { capture: true, passive: true });
  S.obs = new MutationObserver((recs) => { S.mut = (S.mut || 0) + recs.length; });
  S.obs.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
  S.iv = setInterval(() => {
    S.snaps.push({
      ms: Math.round(performance.now() - S.t0),
      nodes: document.querySelectorAll("*").length,
      anims: document.getAnimations().length,
      mm: S.mm,
      mut: S.mut || 0,
    });
  }, 2000);
  S.disarm = () => {
    S.stopped = true;
    clearInterval(S.iv);
    S.obs.disconnect();
    window.removeEventListener("mousemove", S.onMM, { capture: true });
    window.removeEventListener("keydown", S.onKey, { capture: true });
    delete window.__idle;
  };
  return "armed";
})()

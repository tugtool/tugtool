// Reader for kb-arm.js: splits keystrokes idle/streaming by nearest snapshot, reports percentiles, outliers, long-frame tail.
// Arm: jq -Rs '{code: .}' kb-read.js | curl -s -X POST http://127.0.0.1:<tugcast-port>/api/eval -H 'Content-Type: application/json' -d @-

(() => {
  const S = window.__kb;
  if (!S) return "not-armed";
  const pct = (arr, p) => {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
  };
  // Split keystroke populations by streaming state at the nearest snapshot.
  const snapAt = (ms) => {
    let best = null;
    for (const s of S.snaps) {
      if (best === null || Math.abs(s.ms - ms) < Math.abs(best.ms - ms)) best = s;
    }
    return best;
  };
  const pops = { idle: [], streaming: [] };
  for (const k of S.keys) {
    const s = snapAt(k.ms);
    (s && s.streamingDots > 0 ? pops.streaming : pops.idle).push(k);
  }
  const stats = (keys) => ({
    n: keys.length,
    q50: pct(keys.map((k) => k.q), 50),
    q90: pct(keys.map((k) => k.q), 90),
    q99: pct(keys.map((k) => k.q), 99),
    qMax: pct(keys.map((k) => k.q), 100),
    r1_50: pct(keys.map((k) => k.r1).filter((v) => v >= 0), 50),
    r1_90: pct(keys.map((k) => k.r1).filter((v) => v >= 0), 90),
    r1Max: pct(keys.map((k) => k.r1).filter((v) => v >= 0), 100),
    over8q: keys.filter((k) => k.q > 8).length,
    over25q: keys.filter((k) => k.q > 25).length,
    over50r1: keys.filter((k) => k.r1 > 50).length,
  });
  const outliers = S.keys
    .filter((k) => k.q > 8 || k.r1 > 50)
    .slice(-60)
    .map((k) => ({ ...k, epoch: S.epoch0 + Math.round(k.ms) }));
  const lf = S.longFrames.slice(-80).map((f) => ({
    ...f,
    epoch: S.epoch0 + Math.round(f.ms),
  }));
  return JSON.stringify({
    epoch0: S.epoch0,
    spanMs: Math.round(performance.now() - S.perf0),
    idle: stats(pops.idle),
    streaming: stats(pops.streaming),
    longFrames: S.longFrames.length,
    lfWorst: pct(S.longFrames.map((f) => f.gap), 100),
    lfTail: lf,
    outliers,
    snaps: S.snaps.slice(-40),
  });
})()

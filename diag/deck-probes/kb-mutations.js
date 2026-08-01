// 5s mutation census: writes bucketed by type:attribute @ 3-deep class path; auto-disconnects; read window.__kbMut.
// Arm: jq -Rs '{code: .}' kb-mutations.js | curl -s -X POST http://127.0.0.1:<tugcast-port>/api/eval -H 'Content-Type: application/json' -d @-

(() => {
  window.__kbMut = { done: false, out: null };
  const byKey = {};
  const path = (el) => {
    const out = [];
    let n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < 8) {
      const c = n.className && String(n.className).split(" ")[0];
      if (c) out.unshift(c);
      n = n.parentElement;
    }
    return out.slice(-3).join(">");
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
      if (!t) continue;
      const key =
        m.type +
        (m.attributeName ? ":" + m.attributeName : "") +
        " @ " +
        path(t);
      byKey[key] = (byKey[key] || 0) + 1;
    }
  });
  mo.observe(document.documentElement, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  setTimeout(() => {
    mo.disconnect();
    const top = Object.entries(byKey)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    window.__kbMut = { done: true, out: { total: Object.values(byKey).reduce((a, b) => a + b, 0), top } };
  }, 5000);
  return "observing";
})()

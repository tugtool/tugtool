// Attribute tracer: patches set/removeAttribute for the focus/responder stamps, records op+same-value+stack; disarm restores prototypes (window.__kbAttr.disarm()).
// Arm: jq -Rs '{code: .}' kb-attr-trace.js | curl -s -X POST http://127.0.0.1:<tugcast-port>/api/eval -H 'Content-Type: application/json' -d @-

(() => {
  if (window.__kbAttr) return "already-armed";
  const ATTRS = new Set([
    "data-tug-focusable",
    "data-tug-focus-key",
    "data-responder-id",
  ]);
  const S = (window.__kbAttr = {
    t0: performance.now(),
    events: [],
    origSet: Element.prototype.setAttribute,
    origRemove: Element.prototype.removeAttribute,
  });
  const brief = (el) => {
    const tag = el.tagName ? el.tagName.toLowerCase() : "?";
    const c = el.className ? String(el.className).split(" ")[0] : "";
    return tag + (c ? "." + c : "");
  };
  const trim = (stack) =>
    (stack || "")
      .split("\n")
      .slice(1, 7)
      .map((l) => l.trim().replace(/@.*\/(assets|src)\//, "@"))
      .join(" | ");
  Element.prototype.setAttribute = function (name, value) {
    if (ATTRS.has(name)) {
      const prev = this.getAttribute(name);
      S.events.push({
        ms: Math.round(performance.now() - S.t0),
        op: "set",
        attr: name,
        el: brief(this),
        same: prev === String(value),
        stack: trim(new Error().stack),
      });
    }
    return S.origSet.call(this, name, value);
  };
  Element.prototype.removeAttribute = function (name) {
    if (ATTRS.has(name) && this.hasAttribute(name)) {
      S.events.push({
        ms: Math.round(performance.now() - S.t0),
        op: "remove",
        attr: name,
        el: brief(this),
        stack: trim(new Error().stack),
      });
    }
    return S.origRemove.call(this, name);
  };
  S.disarm = () => {
    Element.prototype.setAttribute = S.origSet;
    Element.prototype.removeAttribute = S.origRemove;
    const n = S.events.length;
    delete window.__kbAttr;
    return "disarmed:" + n;
  };
  return "armed";
})()

/**
 * Fast Refresh full-reload analysis (one-off).
 *
 * Models @vitejs/plugin-react's refresh-boundary propagation to find which
 * modules, when edited, trigger a FULL PAGE RELOAD (the HMR-never-reloads
 * invariant forbids this).
 *
 * Rule modelled:
 *   - A module is an ACCEPTING boundary iff it is component-only (>=1 React
 *     component export, zero runtime non-component exports) OR it self-accepts
 *     via a manual `import.meta.hot.accept()`.
 *   - MIXED (component + value) and PURE-VALUE/util modules are NON-accepting:
 *     an edit propagates to their importers.
 *   - Editing module M full-reloads iff propagation from M can reach the entry
 *     (a module with no importers) along a path of non-accepting modules —
 *     i.e. no component-only boundary sits above it on that path.
 *
 * Heuristic export classifier (not a type-checker) — eyeball flagged files.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const SRC = resolve(import.meta.dir, "..", "src");
const ENTRY = resolve(SRC, "main.tsx");
const FOCUS = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(SRC, "components/tugways/cards/dev-card-transcript.tsx");

const EXTS = [".tsx", ".ts", ".jsx", ".js"];
type Kind = "component" | "value" | "type";

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const c of [
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => resolve(base, "index" + e)),
    base,
  ]) {
    try { if (statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

const isComp = (n: string) => /^[A-Z]/.test(n);

function importsOf(src: string): string[] {
  const out: string[] = [];
  let m;
  const re = /(?:^|[\s;])(?:import|export)\b[^;'"]*?from\s*['"]([^'"]+)['"]/g;
  while ((m = re.exec(src))) out.push(m[1]);
  const re2 = /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;
  while ((m = re2.exec(src))) out.push(m[1]);
  return out;
}

function exportsOf(src: string): { name: string; kind: Kind }[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const out: { name: string; kind: Kind }[] = [];
  if (/export\s+default\b/.test(code)) out.push({ name: "default", kind: "component" });

  let m;
  const braceRe = /export\s*(type\s+)?\{([^}]*)\}/g;
  while ((m = braceRe.exec(code))) {
    const blockType = !!m[1];
    for (let part of m[2].split(",")) {
      part = part.trim();
      if (!part) continue;
      const typed = /^type\s+/.test(part);
      const name = part.replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.trim();
      if (!name) continue;
      out.push({ name, kind: blockType || typed ? "type" : isComp(name) ? "component" : "value" });
    }
  }
  const varRe = /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g;
  while ((m = varRe.exec(code))) out.push({ name: m[1], kind: isComp(m[1]) ? "component" : "value" });
  const fnRe = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;
  while ((m = fnRe.exec(code))) out.push({ name: m[1], kind: isComp(m[1]) ? "component" : "value" });
  const clRe = /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g;
  while ((m = clRe.exec(code))) out.push({ name: m[1], kind: "value" });
  const tyRe = /export\s+(?:type|interface)\s+([A-Za-z0-9_$]+)/g;
  while ((m = tyRe.exec(code))) out.push({ name: m[1], kind: "type" });
  const enRe = /export\s+(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/g;
  while ((m = enRe.exec(code))) out.push({ name: m[1], kind: "value" });
  return out;
}

/** Refine PascalCase const/fn exports: value if assigned a context/object/primitive. */
function refine(src: string, exps: { name: string; kind: Kind }[]) {
  return exps.map((e) => {
    if (e.kind !== "component") return e;
    if (e.name === "default") return e;
    const n = e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dm = new RegExp(`(?:const|let|var)\\s+${n}\\s*(?::[^=]+)?=\\s*([\\s\\S]{0,90})`).exec(src);
    const rhs = dm?.[1] ?? "";
    if (/\b(forwardRef|memo)\s*[(<]/.test(rhs)) return { ...e, kind: "component" as Kind };
    if (/createContext\s*[<(]/.test(rhs)) return { ...e, kind: "value" as Kind };
    if (/=>\s*\(?\s*</.test(rhs) || /=>\s*\{/.test(rhs)) return { ...e, kind: "component" as Kind };
    if (dm && /^\s*[{[`'"\d]/.test(rhs)) return { ...e, kind: "value" as Kind };
    return e; // function/arrow PascalCase -> component
  });
}

// ---- Build the graph from the real entry ----
type Mod = {
  file: string;
  comps: string[];
  values: string[];
  manualAccept: boolean;
  imports: string[];
  importers: Set<string>;
};
const mods = new Map<string, Mod>();
const queue = [ENTRY];
while (queue.length) {
  const file = queue.shift()!;
  if (mods.has(file)) continue;
  if (!file.startsWith(SRC)) continue;
  let src: string;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  const exps = refine(src, exportsOf(src));
  const comps = exps.filter((e) => e.kind === "component").map((e) => e.name);
  const values = exps.filter((e) => e.kind === "value").map((e) => e.name);
  const manualAccept = /import\.meta\.hot[\s\S]{0,40}\.accept\s*\(\s*\)/.test(src)
    || /\bhot\.accept\s*\(\s*\)/.test(src)
    || /\bhot\.accept\s*\(\s*\(\s*\)\s*=>/.test(src);
  const deps = importsOf(src)
    .map((s) => resolveImport(file, s))
    .filter((d): d is string => !!d);
  mods.set(file, { file, comps, values, manualAccept, imports: deps, importers: new Set() });
  for (const d of deps) if (!mods.has(d)) queue.push(d);
}
for (const m of mods.values())
  for (const d of m.imports) mods.get(d)?.importers.add(m.file);

// ---- Classify ----
function accepting(m: Mod): boolean {
  if (m.manualAccept) return true;
  return m.comps.length > 0 && m.values.length === 0; // component-only boundary
}

// ---- escapes(M): does a propagation from M reach a no-importer entry
//      along non-accepting modules? (true => full page reload on edit) ----
const memo = new Map<string, boolean>();
const stack = new Set<string>();
function escapes(file: string): boolean {
  const m = mods.get(file);
  if (!m) return false;
  if (accepting(m)) return false; // self-accepts -> absorbed
  if (memo.has(file)) return memo.get(file)!;
  if (stack.has(file)) return false; // cycle guard
  stack.add(file);
  let result: boolean;
  if (m.importers.size === 0) {
    result = true; // reached entry / orphan with no boundary above
  } else {
    result = false;
    for (const imp of m.importers) {
      const im = mods.get(imp)!;
      if (accepting(im)) continue; // this branch absorbed by a boundary
      if (escapes(imp)) { result = true; break; }
    }
  }
  stack.delete(file);
  memo.set(file, result);
  return result;
}

// ---- Restrict to the transcript import graph (reachable from FOCUS) ----
const focusGraph = new Set<string>();
(function walk(f: string) {
  if (focusGraph.has(f)) return;
  const m = mods.get(f);
  if (!m) return;
  focusGraph.add(f);
  for (const d of m.imports) walk(d);
})(FOCUS);

const cat = (m: Mod) =>
  accepting(m) ? "boundary" : m.comps.length ? "mixed" : "transparent";

const reloaders = [...focusGraph]
  .map((f) => mods.get(f)!)
  .filter((m) => !m.file.includes("__tests__") && escapes(m.file))
  .sort((a, b) => a.file.localeCompare(b.file));

const mixedReloaders = reloaders.filter((m) => m.comps.length > 0);
const transparentReloaders = reloaders.filter((m) => m.comps.length === 0);

console.log(`Entry: ${relative(SRC, ENTRY)}`);
console.log(`Focus root: ${relative(SRC, FOCUS)}`);
console.log(`Modules in app graph: ${mods.size} | in transcript graph: ${focusGraph.size}`);
console.log(`Full-reload triggers in transcript graph: ${reloaders.length}`);
console.log(`  mixed (component + value): ${mixedReloaders.length}`);
console.log(`  transparent (value/util only): ${transparentReloaders.length}\n`);

console.log("=== MIXED full-reload triggers (split these) ===");
for (const m of mixedReloaders) {
  console.log("• " + relative(SRC, m.file) + "   [" + cat(m) + "]");
  console.log("    components: " + m.comps.join(", "));
  console.log("    values:     " + m.values.join(", "));
}

console.log("\n=== TRANSPARENT full-reload triggers (value/util/type only) ===");
console.log("(edit also reloads — they reach root with no boundary above)\n");
for (const m of transparentReloaders)
  console.log("• " + relative(SRC, m.file) + "  values: " + (m.values.join(", ") || "—"));

// Show the boundary-free spine from FOCUS up to the entry (why these escape).
console.log("\n=== Spine: a boundary-free path FOCUS -> entry ===");
let cur: string | null = FOCUS;
const seen = new Set<string>();
while (cur && !seen.has(cur)) {
  seen.add(cur);
  const m = mods.get(cur)!;
  console.log(`  ${relative(SRC, cur)}  [${cat(m)}]`);
  if (m.importers.size === 0) break;
  // pick an importer that still escapes (boundary-free continuation)
  let next: string | null = null;
  for (const imp of m.importers) {
    const im = mods.get(imp)!;
    if (!accepting(im) && (escapes(imp) || im.importers.size === 0)) { next = imp; break; }
  }
  cur = next;
}

// ---- Census ----
let bN = 0, mN = 0, tN = 0;
for (const f of focusGraph) {
  const m = mods.get(f)!;
  if (m.file.includes("__tests__")) continue;
  const c = cat(m);
  if (c === "boundary") bN++; else if (c === "mixed") mN++; else tN++;
}
console.log(`\n=== Census of transcript graph ===`);
console.log(`  boundaries (component-only, self-accepting): ${bN}`);
console.log(`  mixed (component + value):                    ${mN}`);
console.log(`  transparent (value/util/type/css only):       ${tN}`);

// directory rollup of transparent reloaders
const byDir = new Map<string, number>();
for (const m of transparentReloaders) {
  const d = relative(SRC, dirname(m.file));
  byDir.set(d, (byDir.get(d) ?? 0) + 1);
}
console.log(`\n=== Transparent reloaders by directory ===`);
[...byDir.entries()].sort((a,b)=>b[1]-a[1]).forEach(([d,n])=>console.log(`  ${n}\t${d}`));

// mixed files that are SHIELDED (every importer is a boundary) -> safe today
const mixedShielded = [...focusGraph]
  .map((f)=>mods.get(f)!)
  .filter((m)=>!m.file.includes("__tests__") && m.comps.length>0 && m.values.length>0 && !escapes(m.file))
  .sort((a,b)=>a.file.localeCompare(b.file));
console.log(`\n=== MIXED but SHIELDED today (safe — every importer is a boundary): ${mixedShielded.length} ===`);
for (const m of mixedShielded) console.log("  • "+relative(SRC,m.file));

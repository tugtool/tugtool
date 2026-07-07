/**
 * Shared utilities for Shiki-based code highlighting.
 *
 * Owns the singleton highlighter and language-normalisation logic shared by
 * the diff renderer (`body-kinds/diff-block.tsx`) and markdown code blocks
 * (`lib/markdown.ts`).
 *
 * Theme: a CSS-variables theme (Spec S01). Instead of baking a fixed
 * palette's hex colors into inline styles, every token is emitted as
 * `color:var(--syntax-token-*)`. The bridge tokens are defined in
 * `styles/tug.css` and alias the theme-aware `--tug-syntax-*` family
 * (`tug-code.css`), so highlighted code resolves through the active theme's
 * cascade — correct in light and dark themes, and recolored live on theme
 * switch with no re-tokenizing.
 */

import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type ThemeRegistration,
} from "shiki";

/**
 * Name of the registered CSS-variables theme. Pass as the `theme` option to
 * `codeToHtml` / `codeToTokens` on the shared highlighter.
 */
export const SYNTAX_THEME_NAME = "tug-syntax-variables";

/** `var(--syntax-token-<name>)` — one bridge token per semantic bucket. */
const t = (name: string): string => `var(--syntax-token-${name})`;

/**
 * Hand-authored CSS-variables theme. Shiki's stock
 * `createCssVariablesTheme` collapses everything into 9 buckets — too
 * coarse to render real code well (CSS property names, custom properties,
 * numbers, types, and tags all fall into two or three colors). This theme
 * keeps the same emit-a-variable strategy but maps TextMate scopes onto a
 * wider bridge vocabulary. Every emitted variable is defined in
 * `styles/tug.css` (Spec S01) and aliases the theme-aware `--tug-syntax-*`
 * palette in `tug-code.css`, so highlighted code follows the active theme's
 * cascade and recolors live on theme switch.
 *
 * Scope-matching note: VS Code / Shiki pick the rule whose selector matches
 * the token's scope most specifically (longest match wins; ties go to the
 * later rule), so broad buckets come first and refinements after.
 */
const syntaxVariablesTheme: ThemeRegistration = {
  name: SYNTAX_THEME_NAME,
  type: "dark",
  colors: {
    "editor.foreground": "var(--syntax-foreground)",
    "editor.background": "var(--syntax-background)",
  },
  tokenColors: [
    {
      settings: {
        foreground: "var(--syntax-foreground)",
        background: "var(--syntax-background)",
      },
    },
    // -- Structure: quiet by default ------------------------------------
    {
      scope: ["punctuation", "meta.brace", "keyword.operator.accessor"],
      settings: { foreground: t("punctuation") },
    },
    {
      scope: ["keyword.operator"],
      settings: { foreground: t("operator") },
    },
    {
      scope: ["variable"],
      settings: { foreground: t("variable") },
    },
    // Template-literal / embedded-code interiors render as plain code, not
    // as one long string-colored run.
    {
      scope: [
        "meta.template.expression",
        "meta.embedded",
        "markup.fenced_code meta.embedded.block",
        "meta.group.braces.round.function.arguments",
      ],
      settings: { foreground: "var(--syntax-foreground)" },
    },
    // -- Comments ---------------------------------------------------------
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: t("comment"), fontStyle: "italic" },
    },
    // -- Keywords / storage ------------------------------------------------
    {
      scope: [
        "keyword",
        "storage",
        "keyword.control",
        "keyword.operator.expression",
        "keyword.operator.new",
        "keyword.operator.logical.python",
        "keyword.other.important",
      ],
      settings: { foreground: t("keyword") },
    },
    // -- Strings ------------------------------------------------------------
    {
      scope: [
        "string",
        "punctuation.definition.string",
        "markup.inline.raw",
        "storage.type.string",
      ],
      settings: { foreground: t("string") },
    },
    {
      scope: [
        "constant.character.escape",
        "constant.character.format",
        "punctuation.definition.template-expression",
        "punctuation.section.embedded",
        "string.regexp",
        "punctuation.definition.interpolation",
        "storage.type.format",
      ],
      settings: { foreground: t("string-expression") },
    },
    // -- Literals -------------------------------------------------------------
    {
      scope: ["constant.numeric", "keyword.other.unit", "constant.other.color"],
      settings: { foreground: t("number") },
    },
    // `variable.other.constant` is deliberately absent: TS scopes every
    // `const` binding with it, and const-heavy code turns to confetti.
    {
      scope: [
        "constant.language",
        "support.constant",
        "variable.language",
        "constant.other.option",
      ],
      settings: { foreground: t("constant") },
    },
    // -- Callables / types ------------------------------------------------------
    {
      scope: [
        "entity.name.function",
        "support.function",
        "entity.name.function.macro",
        "meta.function-call.generic",
      ],
      settings: { foreground: t("function") },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: t("type") },
    },
    // -- Identifier refinements ----------------------------------------------
    {
      scope: ["variable.parameter"],
      settings: { foreground: t("parameter"), fontStyle: "italic" },
    },
    {
      scope: [
        "variable.other.property",
        "variable.other.object.property",
        "support.type.property-name",
        "support.type.vendored.property-name",
        "meta.object-literal.key",
        "variable.css",
        "variable.argument.css",
        "variable.other.normal",
        "variable.other.special",
        "variable.other.positional",
        "punctuation.definition.variable",
      ],
      settings: { foreground: t("property") },
    },
    // -- Markup / tags -----------------------------------------------------------
    {
      scope: ["entity.name.tag", "punctuation.definition.tag"],
      settings: { foreground: t("tag") },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: t("attribute") },
    },
    {
      scope: [
        "meta.decorator",
        "punctuation.decorator",
        "entity.name.function.decorator",
        "meta.attribute.rust",
        // TS decorator names re-tokenize as plain identifiers inside
        // meta.decorator; these compound selectors out-specify the broad
        // identifier rules above.
        "meta.decorator variable.other.readwrite",
        "meta.decorator entity.name.function",
      ],
      settings: { foreground: t("decorator") },
    },
    {
      scope: ["markup.underline.link", "string.other.link"],
      settings: { foreground: t("link") },
    },
    // -- Prose / markdown ---------------------------------------------------------
    {
      scope: ["emphasis", "markup.italic"],
      settings: { fontStyle: "italic" },
    },
    {
      scope: ["strong", "markup.bold", "markup.heading"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["markup.quote"],
      settings: { foreground: t("comment"), fontStyle: "italic" },
    },
    // The `diff` language: match the surrounding diff-band vocabulary.
    {
      scope: ["markup.inserted"],
      settings: { foreground: t("string") },
    },
    {
      scope: ["markup.deleted"],
      settings: { foreground: t("tag") },
    },
  ],
};

// 17 initial languages per D06
export const INITIAL_LANGUAGES: BundledLanguage[] = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "shellscript",
  "json",
  "css",
  "html",
  "markdown",
  "go",
  "java",
  "c",
  "cpp",
  "sql",
  "yaml",
  "toml",
  "dockerfile",
];

// Singleton highlighter promise shared across all consumers
let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Get (or lazily initialise) the Shiki highlighter singleton.
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [syntaxVariablesTheme],
      langs: INITIAL_LANGUAGES,
    });
  }
  return highlighterPromise;
}

/**
 * Normalise a language identifier to a Shiki-compatible form.
 */
export function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();

  if (normalized === "bash" || normalized === "sh" || normalized === "shell") {
    return "shellscript";
  }
  if (normalized === "c++" || normalized === "cxx") {
    return "cpp";
  }
  if (normalized === "js") {
    return "javascript";
  }
  if (normalized === "ts") {
    return "typescript";
  }
  if (normalized === "py") {
    return "python";
  }
  if (normalized === "rs") {
    return "rust";
  }

  return normalized;
}

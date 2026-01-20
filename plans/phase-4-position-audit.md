# Phase 4 Position Data Availability Audit

**Date:** 2026-01-20
**Status:** Complete

## Summary

This audit documents the availability of token position data in `tugtool-python-cst` and identifies which nodes need `node_id` fields for Phase 4 implementation.

## Token Position Infrastructure

### TextPositionSnapshot

**Location:** `crates/tugtool-python-cst/src/tokenizer/text_position/mod.rs`

```rust
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TextPositionSnapshot {
    pub inner_byte_idx: usize,        // Byte offset in UTF-8 source
    pub inner_char_column_number: usize, // Column (character count)
    pub inner_line_number: usize,     // Line number (1-indexed)
}
```

Methods available:
- `byte_idx()` - Returns byte offset (what we need for spans)
- `char_column_number()` - Character column (for display)
- `line_number()` - Line number (for display)

### Token

**Location:** `crates/tugtool-python-cst/src/tokenizer/core/mod.rs`

```rust
pub struct Token<'a> {
    pub r#type: TokType,
    pub string: &'a str,
    pub start_pos: TextPositionSnapshot,  // <-- Position data
    pub end_pos: TextPositionSnapshot,    // <-- Position data
    pub whitespace_before: Rc<RefCell<WhitespaceState<'a>>>,
    pub whitespace_after: Rc<RefCell<WhitespaceState<'a>>>,
    pub relative_indent: Option<&'a str>,
}
```

**Finding:** `Token.start_pos` and `Token.end_pos` contain accurate byte positions computed during tokenization. This is exactly what we need for Phase 4.

## Deflated Nodes with TokenRef Fields

The following deflated node types have `TokenRef` fields that provide direct access to token positions:

### Statement Nodes

| Deflated Node | TokenRef Fields | Position Data Available |
|---------------|-----------------|-------------------------|
| `DeflatedFunctionDef` | `async_tok?`, `def_tok`, `open_paren_tok`, `close_paren_tok`, `colon_tok` | Function keyword, parens, body start |
| `DeflatedClassDef` | `class_tok`, `lpar_tok?`, `rpar_tok?`, `colon_tok` | Class keyword, body start |
| `DeflatedDecorator` | `at_tok`, `newline_tok` | Decorator start |
| `DeflatedIndentedBlock` | `newline_tok`, `indent_tok`, `dedent_tok` | Block boundaries (critical for scope end) |
| `DeflatedSimpleStatementSuite` | `first_tok`, `newline_tok` | Single-line suite boundaries |
| `DeflatedIf` | `if_tok`, `colon_tok` | Control flow |
| `DeflatedElse` | `else_tok`, `colon_tok` | Control flow |
| `DeflatedFor` | `async_tok?`, `for_tok`, `in_tok`, `colon_tok` | Loop boundaries |
| `DeflatedWhile` | `while_tok`, `colon_tok` | Loop boundaries |
| `DeflatedWith` | `async_tok?`, `with_tok`, `colon_tok` | Context manager |
| `DeflatedTry` | `try_tok` | Exception handling |
| `DeflatedExcept` / `DeflatedExceptStar` | `except_tok`, `star_tok?`, `colon_tok` | Exception handling |
| `DeflatedFinally` | `finally_tok`, `colon_tok` | Exception handling |
| `DeflatedMatch` | `match_tok`, `colon_tok`, `indent_tok`, `dedent_tok` | Pattern matching |
| `DeflatedMatchCase` | `case_tok`, `if_tok?`, `colon_tok` | Pattern matching |
| `DeflatedImport` | `import_tok` | Import statement |
| `DeflatedImportFrom` | `from_tok`, `import_tok` | Import statement |
| `DeflatedReturn` | `return_tok` | Return statement |
| `DeflatedAssert` | `assert_tok` | Assert statement |
| `DeflatedRaise` | `raise_tok` | Raise statement |
| `DeflatedGlobal` | `tok` | Global declaration |
| `DeflatedNonlocal` | `tok` | Nonlocal declaration |
| `DeflatedTypeAlias` | `type_tok`, `equals_tok` | Type alias |
| `DeflatedAsName` | `as_tok` | As binding |
| `DeflatedAnnAssign` | `equal_tok` | Annotated assignment |

### Expression Nodes

| Deflated Node | TokenRef Fields | Position Data Available |
|---------------|-----------------|-------------------------|
| `DeflatedName` | (none currently - needs `tok` added per D05) | **MISSING - must add** |
| `DeflatedParam` | `star_tok?` | Parameter star prefix |
| `DeflatedLeftParen` | `lpar_tok` | Parenthesis |
| `DeflatedRightParen` | `rpar_tok` | Parenthesis |
| `DeflatedInteger` | `tok` | Literal position |
| `DeflatedFloat` | `tok` | Literal position |
| `DeflatedImaginary` | `tok` | Literal position |
| `DeflatedSimpleString` | `tok` | String literal position |
| `DeflatedCall` | `lpar_tok`, `rpar_tok` | Call site |
| `DeflatedAttribute` | (via nested Name/Dot) | Via nested nodes |
| `DeflatedSubscript` | (via nested nodes) | Via nested nodes |
| `DeflatedSlice` | `colon_tok` | Slice syntax |
| `DeflatedLambda` | `lambda_tok`, `colon_tok` | Lambda boundaries |
| `DeflatedYield` | `yield_tok` | Yield expression |
| `DeflatedAwait` | `await_tok` | Await expression |
| `DeflatedCompFor` | `async_tok?`, `for_tok`, `in_tok` | Comprehension |
| `DeflatedCompIf` | `if_tok` | Comprehension |
| `DeflatedIfExp` | `if_tok`, `else_tok` | Ternary expression |
| `DeflatedNamedExpr` | `walrus_tok` | Walrus operator |
| `DeflatedFormattedStringExpression` | `lbrace_tok`, `after_expr_tok?` | F-string |
| `DeflatedFormattedStringText` | (via string content) | F-string text |
| `DeflatedArg` | `star_tok?` | Function argument |
| `DeflatedStarredElement` | `star_tok` | Starred unpacking |

### Operator Nodes

| Deflated Node | TokenRef Fields | Position Data Available |
|---------------|-----------------|-------------------------|
| `DeflatedSemicolon` | `tok` | Semicolon position |
| `DeflatedComma` | `tok` | Comma position |
| `DeflatedAssignEqual` | `tok` | Equal sign |
| `DeflatedDot` | `tok` | Dot position |
| `DeflatedColon` | `tok` | Colon position |
| `DeflatedBitOr` | `tok` | Bitwise or |
| `DeflatedImportStar` | `tok` | Import star |
| `DeflatedUnaryOp` | `tok` | Unary operator |
| `DeflatedBooleanOp` | `tok` | Boolean operator |
| `DeflatedBinaryOp` | `tok` | Binary operator |
| `DeflatedCompOp` | `tok` (or `not_tok`+`in_tok` / `is_tok`+`not_tok`) | Comparison |
| `DeflatedAugOp` | `tok` | Augmented assignment |

### Module Node

| Deflated Node | TokenRef Fields | Position Data Available |
|---------------|-----------------|-------------------------|
| `DeflatedModule` | `eof_tok` | Module end position |

## Nodes Requiring node_id Field (Per D04)

Based on the plan and audit, these inflated nodes need `node_id: Option<NodeId>`:

### Primary Tracked Nodes (for position/span recording)

1. **`Name`** - Identifiers (records `ident_span`)
2. **`FunctionDef`** - Function definitions (records `lexical_span`, `def_span`)
3. **`ClassDef`** - Class definitions (records `lexical_span`, `def_span`)
4. **`Param`** - Function parameters (for param name spans via `param.name.node_id`)
5. **`Decorator`** - For def_span start tracking
6. **`Integer`** - Literals (node_id only initially; span recording is follow-on)
7. **`Float`** - Literals (node_id only initially; span recording is follow-on)
8. **`SimpleString`** - Literals (node_id only initially; span recording is follow-on)

### NOT Tracked (per D12)

- Most expression nodes (`BinaryOperation`, `Call`, etc.)
- Most statement nodes (`If`, `For`, `While`, etc.)
- Whitespace/formatting nodes
- Structural nodes (`Parameters`, `Arguments`, etc.)

## Critical Finding: Name Node Lacks tok Field

**Current State:**

```rust
// crates/tugtool-python-cst/src/nodes/expression.rs
#[cst_node(ParenthesizedNode, Default)]
pub struct Name<'a> {
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,
}
```

The `Name` struct has **no** `tok` field. The parser's `make_name` function discards the token:

```rust
// crates/tugtool-python-cst/src/parser/grammar.rs
fn make_name<'input, 'a>(tok: TokenRef<'input, 'a>) -> Name<'input, 'a> {
    Name {
        value: tok.string,
        ..Default::default()  // <-- tok is discarded!
    }
}
```

**Impact:** This is the most critical gap. Without `tok` on `Name`, we cannot get identifier positions directly from the CST. Step 1 of the plan (D05) addresses this by adding `tok: Option<TokenRef<'a>>` to `Name`.

## #[cst_node] Macro Extensibility Analysis

**Location:** `crates/tugtool-python-cst-derive/src/cstnode.rs`

The `#[cst_node]` macro:
1. Takes a struct and generates both inflated and deflated versions
2. Strips `TokenRef` fields from inflated nodes (they only exist on deflated)
3. Strips whitespace-related fields from deflated nodes
4. Can derive `ParenthesizedNode`, `Codegen`, `Inflate`, `Default`

**Extensibility for node_id:**

Two approaches are viable:

### Option A: Modify #[cst_node] macro (Preferred)

Add a new attribute like `#[cst_node(tracked)]` that:
- Adds `pub(crate) node_id: Option<NodeId>` to the inflated struct
- The field is NOT stripped from inflated (unlike TokenRef)
- The Default derive would set `node_id: None`

### Option B: Manually add node_id field

Add the field directly to specific structs without macro changes:
```rust
#[cst_node(ParenthesizedNode, Default)]
pub struct Name<'a> {
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,
    pub(crate) node_id: Option<NodeId>,  // Manually added
}
```

**Recommendation:** Start with Option B (manual addition) for the 8 tracked nodes, then consider macro changes for broader rollout.

## InflateCtx Threading Feasibility

**Current Inflate Signature:**
```rust
pub trait Inflate<'a> {
    type Inflated;
    fn inflate(self, config: &Config<'a>) -> Result<Self::Inflated>;
}
```

**Proposed Signature:**
```rust
pub trait Inflate<'a> {
    type Inflated;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated>;
}
```

**Analysis:**

1. **Blanket impls in traits.rs** need updating:
   - `Option<T>`, `Vec<T>`, `Box<T>` all have blanket impls that call `inflate(config)`
   - These must change to `inflate(ctx)`

2. **Derive macro for enums** (`inflate.rs`) generates:
   ```rust
   fn inflate(mut self, config: &Config<'a>) -> Result<Self::Inflated> {
       match self {
           Self::Variant(x) => Ok(Self::Inflated::Variant(x.inflate(config)?)),
       }
   }
   ```
   Must update to use `ctx` instead of `config`.

3. **Manual inflate impls** (60+ in expression.rs, statement.rs, op.rs):
   - Each must be updated to take `&mut InflateCtx<'a>`
   - Access `config` via `ctx.ws` instead of directly

4. **Callers of inflate**:
   - `parse_module_with_options` and similar entry points
   - Must construct `InflateCtx` instead of just `Config`

**Feasibility:** Yes, but high blast radius. The change touches:
- The trait definition
- 3 blanket impls
- 1 derive macro
- ~60+ manual inflate impls
- ~5 entry points

**Mitigation:** Make changes incrementally per the plan's step structure.

## Scope End Position Availability

**Critical finding for D10 (direct scope computation):**

`DeflatedIndentedBlock` has:
```rust
pub(crate) newline_tok: TokenRef<'a>,
pub(crate) indent_tok: TokenRef<'a>,
pub(crate) dedent_tok: TokenRef<'a>,
```

`DeflatedSimpleStatementSuite` has:
```rust
pub(crate) first_tok: TokenRef<'a>,
pub(crate) newline_tok: TokenRef<'a>,
```

**Implication:** `FunctionDef::inflate()` can access `self.body` (which is `DeflatedSuite`) and extract:
- For `IndentedBlock`: `block.dedent_tok.start_pos.byte_idx()` as scope end
- For `SimpleStatementSuite`: `suite.newline_tok.end_pos.byte_idx()` as scope end

This validates the D10 approach: compute scope end directly from the deflated body suite, no SpanFrame stack needed.

## Conclusion

The InflateCtx approach is **validated** as viable:

1. **Token positions exist** - `Token.start_pos` and `Token.end_pos` provide accurate byte positions
2. **Most nodes have TokenRef fields** - Direct position access is available for critical nodes
3. **Name needs tok field** - The one gap (Step 1 addresses this)
4. **Scope end is accessible** - `dedent_tok` and `newline_tok` provide precise boundaries
5. **Inflate trait can be changed** - High blast radius but feasible with incremental approach
6. **node_id can be added** - Either via macro or manually to tracked nodes

The plan's design decisions (D01-D12) are sound and implementable.

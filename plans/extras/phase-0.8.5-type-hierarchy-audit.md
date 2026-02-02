# Phase 0.8.5: Type Hierarchy & Name Cleanup Proposal

## Executive Summary

This document presents a comprehensive audit of the type hierarchies across the CST, Core, and Python adapter subsystems in tugtool. The audit identifies naming inconsistencies, documents conversion chains, and proposes a consistent naming scheme.

**Key Finding**: The current type naming is NOT a complete mess. The architecture follows a clear pattern:
1. **CST types** (`*Info`) are raw data collected during parsing
2. **Adapter types** (`*Data`) are intermediate representations for language adapters
3. **Core/Facts types** (no suffix) are the canonical FactsStore representations

The main issues are:
1. **Inconsistent enum variant naming** (e.g., `ReceiverStep::Attr` vs `ReceiverPathStep::Attribute`)
2. **Duplicate type definitions** for shared concepts (Modifier, ParamKind)
3. **Some naming inconsistencies** that reduce predictability

---

## 1. Current Type Inventory

### 1.1 CST Types (`tugtool-python-cst`)

Located in `crates/tugtool-python-cst/src/visitor/`:

| Type | Location | Purpose |
|------|----------|---------|
| `SignatureInfo` | `signature.rs` | Function/method signature data |
| `ParamInfo` | `signature.rs` | Parameter data |
| `ParamKind` | `signature.rs` | Parameter classification |
| `Modifier` | `signature.rs` | Function modifiers (async, static, etc.) |
| `TypeParamInfo` | `signature.rs` | Generic type parameter data |
| `AttributeAccessInfo` | `attribute_access.rs` | Attribute access data |
| `AttributeAccessKind` | `attribute_access.rs` | Attribute access classification |
| `ReceiverPath` | `attribute_access.rs` | Structured receiver path |
| `ReceiverStep` | `attribute_access.rs` | Single step in receiver path |
| `CallSiteInfo` | `call_site.rs` | Call site data |
| `CallArgInfo` | `call_site.rs` | Call argument data |
| `BindingInfo` | `binding.rs` | Binding/definition data |
| `BindingKind` | `binding.rs` | Binding classification |
| `ScopeInfo` | `scope.rs` | Scope data |
| `ScopeKind` | `scope.rs` | Scope classification |
| `ReferenceKind` | `reference.rs` | Reference classification |
| `ImportInfo` | `import.rs` | Import statement data |
| `ImportKind` | `import.rs` | Import classification |
| `ImportedName` | `import.rs` | Single imported name |
| `AnnotationInfo` | `annotation.rs` | Type annotation data |
| `AnnotationKind` | `annotation.rs` | Annotation classification |
| `AnnotationSourceKind` | `annotation.rs` | Where annotation came from |
| `AssignmentInfo` | `type_inference.rs` | Assignment pattern data |
| `TypeSource` | `type_inference.rs` | How type was determined |
| `ExportInfo` | `exports.rs` | Export data (__all__) |
| `ExportKind` | `exports.rs` | Export classification |
| `ClassInheritanceInfo` | `inheritance.rs` | Class inheritance data |
| `DynamicPatternInfo` | `dynamic.rs` | Dynamic pattern data |
| `DynamicPatternKind` | `dynamic.rs` | Dynamic pattern classification |
| `IsInstanceCheck` | `isinstance.rs` | isinstance check data |
| `TypeCommentKind` | `type_comment.rs` | Type comment classification |

### 1.2 Adapter Types (`tugtool-core/src/adapter.rs`)

| Type | Purpose |
|------|---------|
| `ScopeData` | Scope information for adapters |
| `SymbolData` | Symbol information for adapters |
| `ReferenceData` | Reference information for adapters |
| `ReferenceKind` | Reference classification (adapter-specific) |
| `AttributeAccessData` | Attribute access for adapters |
| `CallSiteData` | Call site for adapters |
| `CallArgData` | Call argument for adapters |
| `AliasEdgeData` | Alias relationship for adapters |
| `QualifiedNameData` | Qualified name for adapters |
| `ParameterData` | Parameter for adapters |
| `SignatureData` | Signature for adapters |
| `TypeParamData` | Type parameter for adapters |
| `ModifierData` | Modifier association for adapters |
| `ImportData` | Import for adapters |
| `ExportData` | Export for adapters |

**Note**: Adapter types import and re-use Core enums like `ParamKind`, `Modifier`, `AttributeAccessKind` from `tugtool_core::facts`.

### 1.3 Core/Facts Types (`tugtool-core/src/facts/mod.rs`)

| Type | Purpose |
|------|---------|
| `Symbol` | Canonical symbol representation |
| `SymbolKind` | Symbol classification |
| `Reference` | Canonical reference representation |
| `ReferenceKind` | Reference classification |
| `ScopeInfo` | Canonical scope representation |
| `ScopeKind` | Scope classification |
| `Import` | Canonical import representation |
| `ImportKind` | Import classification |
| `PublicExport` | Canonical export representation |
| `ExportKind` | Export classification |
| `ExportTarget` | Export target type |
| `ExportIntent` | Declared vs effective export |
| `ExportOrigin` | Local vs re-export |
| `Signature` | Canonical signature representation |
| `Parameter` | Canonical parameter representation |
| `ParamKind` | Parameter classification |
| `Modifier` | Semantic modifier classification |
| `Visibility` | Access level classification |
| `AttributeAccess` | Canonical attribute access representation |
| `AttributeAccessKind` | Attribute access classification |
| `CallSite` | Canonical call site representation |
| `CallArg` | Canonical call argument representation |
| `ReceiverPath` | Canonical receiver path |
| `ReceiverPathStep` | Canonical receiver step |
| `TypeNode` | Structured type representation |
| `TypeSource` | How type was determined |
| `IsInstanceCheck` | isinstance check representation |
| `DynamicPattern` | Dynamic pattern representation |
| `DynamicPatternKind` | Dynamic pattern classification |
| `TypeCommentKind` | Type comment classification |

### 1.4 Python Adapter Types (`tugtool-python/src/types.rs`)

Additional types specific to Python analysis:

| Type | Purpose |
|------|---------|
| `SpanInfo` | Byte range in source |
| `ScopeSpanInfo` | Scope span with line/col |
| `BindingInfo` | Binding data (local to Python) |
| `ParsedReferenceInfo` | Reference data (local to Python) |
| `ScopeInfo` | Scope data (local to Python) |
| `ImportInfo` | Import data (local to Python) |
| `ImportedName` | Imported name (local to Python) |
| `AssignmentInfo` | Assignment data (local to Python) |
| `ClassInheritanceInfo` | Class inheritance (local to Python) |
| `AnnotationInfo` | Annotation data (local to Python) |
| `AttributeTypeInfo` | Attribute type info for TypeTracker |
| `PropertyTypeInfo` | Property type info for TypeTracker |
| `DynamicPatternInfo` | Dynamic pattern (local to Python) |
| `AnalysisResult` | Combined analysis result |

---

## 2. Conversion Chains

### 2.1 CST -> Adapter -> Core Flow

```
CST Layer                 Adapter Layer              Core/Facts Layer
-----------               -------------              -----------------
SignatureInfo      --->   SignatureData       --->   Signature
  ParamInfo        --->   ParameterData       --->   Parameter
  ParamKind        ~      ParamKind (shared)  ~      ParamKind
  Modifier         ~      Modifier (shared)   ~      Modifier
  TypeParamInfo    --->   TypeParamData       --->   (nested in Signature)

AttributeAccessInfo --->  AttributeAccessData  --->  AttributeAccess
  AttributeAccessKind ~   AttributeAccessKind  ~     AttributeAccessKind
  ReceiverPath      --->  ReceiverPath (Core)  ~     ReceiverPath
  ReceiverStep      --->  ReceiverPathStep     ~     ReceiverPathStep

CallSiteInfo        --->  CallSiteData         --->  CallSite
  CallArgInfo       --->  CallArgData          --->  CallArg
  ReceiverPath      --->  ReceiverPath (Core)  ~     ReceiverPath
```

### 2.2 Conversion Functions

| Function | Location | From | To |
|----------|----------|------|-----|
| `convert_cst_signature` | `analyzer.rs:1993` | `SignatureInfo` | `SignatureData` |
| `convert_cst_attribute_access` | `analyzer.rs:2053` | `AttributeAccessInfo` | `AttributeAccessData` |
| `convert_cst_call_site_to_adapter` | `analyzer.rs:2070` | `CallSiteInfo` | `CallSiteData` |
| `convert_cst_param_kind` | `analyzer.rs` | CST `ParamKind` | Core `ParamKind` |
| `convert_cst_modifier` | `analyzer.rs` | CST `Modifier` | Core `Modifier` |
| `convert_cst_attribute_access_kind` | `analyzer.rs:6023` | CST `AttributeAccessKind` | Core `AttributeAccessKind` |
| `convert_receiver_path` | `analyzer.rs` | CST `ReceiverPath` | Core `ReceiverPath` |
| `convert_cst_assignments` | `analyzer.rs:610` | CST `AssignmentInfo[]` | types `AssignmentInfo[]` |
| `convert_cst_annotations` | `analyzer.rs:648` | CST `AnnotationInfo[]` | types `AnnotationInfo[]` |
| `convert_call_site_data_to_core` | `analyzer.rs:2101` | `CallSiteData` | `CallSite` |

**CST to Core conversions via `From` trait**:

| From | To | Location |
|------|-----|----------|
| `ReceiverStep` | `ReceiverPathStep` | `attribute_access.rs:150-168` |
| `ReceiverPath` | `ReceiverPath (Core)` | `attribute_access.rs:171-180` |
| `CstScopeInfo` | `ScopeInfo` | `cst_bridge.rs:178-212` |
| `CstBindingInfo` | `BindingInfo` | `cst_bridge.rs:214-225` |
| `CstReferenceRecord` | `ParsedReferenceInfo` | `cst_bridge.rs:227-237` |

---

## 3. Naming Inconsistencies

### 3.1 Critical: Enum Variant Name Mismatch

**ReceiverStep vs ReceiverPathStep**:

| CST (`ReceiverStep`) | Core (`ReceiverPathStep`) |
|----------------------|---------------------------|
| `Name { value }` | `Name { value }` |
| `Attr { value }` | `Attribute { value }` |
| `Call` | `Call` |
| `Subscript` | `Subscript` |

**Issue**: `Attr` vs `Attribute` - the CST uses abbreviated name, Core uses full name. This requires explicit conversion in the `From` impl.

### 3.2 Moderate: Type Duplication

**Duplicate ParamKind definitions**:
- `tugtool-python-cst/src/visitor/signature.rs:57` - CST version (no serde)
- `tugtool-core/src/facts/mod.rs:569` - Core version (with serde, non_exhaustive)

**Duplicate Modifier definitions**:
- `tugtool-python-cst/src/visitor/signature.rs:93` - CST version (no serde)
- `tugtool-core/src/facts/mod.rs:711` - Core version (with serde, non_exhaustive)

**Duplicate AttributeAccessKind definitions**:
- `tugtool-python-cst/src/visitor/attribute_access.rs:263` - CST version
- `tugtool-core/src/facts/mod.rs:684` - Core version (with serde, Default)

These require conversion functions despite being semantically identical.

### 3.3 Minor: Inconsistent Field Names

| CST Field | Adapter/Core Field |
|-----------|-------------------|
| `attr_name` (AttributeAccessInfo) | `name` (AttributeAccessData) |
| `attr_span` (AttributeAccessInfo) | `span` (AttributeAccessData) |

### 3.4 Minor: Inconsistent Type Naming Patterns

| Pattern | Examples |
|---------|----------|
| CST uses `*Info` | `SignatureInfo`, `CallSiteInfo`, `AttributeAccessInfo` |
| Adapter uses `*Data` | `SignatureData`, `CallSiteData`, `AttributeAccessData` |
| Core uses no suffix | `Signature`, `CallSite`, `AttributeAccess` |
| Exception in Python types | `types.rs` has `*Info` types that duplicate CST types |

---

## 4. Proposed Naming Scheme

### 4.1 Design Principles

1. **Suffix Convention**:
   - CST types: `Cst*` prefix OR `*Info` suffix (current: `*Info`)
   - Adapter types: `*Data` suffix (current: correct)
   - Core types: No suffix (current: correct)

2. **Enum Variant Consistency**: Use full words, never abbreviations
   - `Attribute` not `Attr`
   - `Keyword` not `Kw`

3. **Single Source of Truth for Enums**: Shared enums should live in Core and be imported by CST

4. **Field Name Consistency**: Use the same field name for the same concept across layers

### 4.2 Proposed Changes

#### A. ReceiverStep Variant Rename (HIGH PRIORITY)

**Current** (CST):
```rust
pub enum ReceiverStep {
    Name { value: String },
    Attr { value: String },  // <-- INCONSISTENT
    Call,
    Subscript,
}
```

**Proposed** (CST):
```rust
pub enum ReceiverStep {
    Name { value: String },
    Attribute { value: String },  // <-- MATCHES CORE
    Call,
    Subscript,
}
```

**Impact**: Simplifies `From` impl, improves readability, removes cognitive mismatch.

#### B. Eliminate Duplicate Enum Definitions (MEDIUM PRIORITY)

**Option 1: CST imports from Core** (RECOMMENDED)

The CST crate already depends on `tugtool_core` (for `TypeNode`, `Span`). We can:
1. Remove `ParamKind`, `Modifier`, `AttributeAccessKind` from CST
2. Import from `tugtool_core::facts`
3. Remove conversion functions

**Pros**: Single source of truth, no conversion overhead
**Cons**: Tighter coupling (but already exists)

**Option 2: Keep duplicates, improve conversion**

If we want to keep CST fully independent:
1. Keep duplicate definitions
2. Add `#[derive(Copy)]` to CST enums
3. Make conversion functions simple match expressions

#### C. Field Name Alignment (LOW PRIORITY)

Rename in CST to match adapter/core:
- `AttributeAccessInfo.attr_name` -> `AttributeAccessInfo.name`
- `AttributeAccessInfo.attr_span` -> `AttributeAccessInfo.span`

**Alternative**: Keep as-is since conversion functions handle the mapping. This is a cosmetic change.

#### D. Python types.rs Cleanup (LOW PRIORITY)

The `types.rs` module has types like `BindingInfo`, `ScopeInfo`, `ImportInfo` that duplicate CST types but with slight differences. These are used as intermediate representations in Python-specific analysis.

**Options**:
1. **Keep as-is**: They serve as a Python-specific layer between CST and Core
2. **Rename with prefix**: `Py*Info` to distinguish from CST types
3. **Merge with adapter types**: If they're functionally equivalent to `*Data` types

**Recommendation**: Keep as-is. These serve a clear purpose as the Python adapter's internal representation.

---

## 5. Implementation Plan

### Phase 1: High-Priority Consistency Fixes

1. **Rename `ReceiverStep::Attr` to `ReceiverStep::Attribute`** in CST
   - File: `crates/tugtool-python-cst/src/visitor/attribute_access.rs`
   - Update all usages in CST
   - Simplify `From` impl (can now use direct mapping)

### Phase 2: Enum Consolidation (Optional)

2. **Remove CST enum duplicates if desired**
   - Remove `ParamKind` from `signature.rs`, import from Core
   - Remove `Modifier` from `signature.rs`, import from Core
   - Remove `AttributeAccessKind` from `attribute_access.rs`, import from Core
   - Remove corresponding conversion functions

### Phase 3: Field Name Alignment (Optional)

3. **Align field names** (only if pursuing full consistency)
   - Rename `attr_name` to `name` in `AttributeAccessInfo`
   - Rename `attr_span` to `span` in `AttributeAccessInfo`
   - Update all usages

---

## 6. Detailed Rename Operations

### 6.1 ReceiverStep::Attr to ReceiverStep::Attribute

**Files to modify**:
```
crates/tugtool-python-cst/src/visitor/attribute_access.rs
  - Line 69: enum variant definition
  - Line 115: with_attr method (builder)
  - Line 156: From impl for CoreReceiverPathStep
  - Tests in the same file

crates/tugtool-python-cst/src/visitor/call_site.rs
  - Any usage of ReceiverStep::Attr
```

**Estimated impact**: ~20-30 lines changed

### 6.2 Enum Consolidation (if pursued)

**Files to modify**:
```
crates/tugtool-python-cst/src/visitor/signature.rs
  - Remove ParamKind enum (lines 57-80)
  - Remove Modifier enum (lines 93-132)
  - Add: use tugtool_core::facts::{ParamKind, Modifier};

crates/tugtool-python-cst/src/visitor/attribute_access.rs
  - Remove AttributeAccessKind enum (lines 263-278)
  - Add: use tugtool_core::facts::AttributeAccessKind;

crates/tugtool-python-cst/src/visitor/mod.rs
  - Update re-exports

crates/tugtool-python-cst/src/lib.rs
  - Update re-exports

crates/tugtool-python/src/analyzer.rs
  - Remove convert_cst_param_kind function
  - Remove convert_cst_modifier function
  - Remove convert_cst_attribute_access_kind function
```

**Estimated impact**: ~150-200 lines removed, cleaner architecture

---

## 7. Summary

The type hierarchy is **well-designed** with clear separation of concerns:
- **CST**: Raw data from parsing (`*Info`)
- **Adapter**: Intermediate representation for language adapters (`*Data`)
- **Core/Facts**: Canonical FactsStore representation (no suffix)

**Recommended changes** (in priority order):

1. **Rename `ReceiverStep::Attr` to `ReceiverStep::Attribute`** - eliminates inconsistency with Core
2. **Consider consolidating shared enums** - reduces duplication and conversion overhead
3. **Field name alignment is optional** - current conversion functions handle this correctly

The architecture does NOT need a major overhaul. The "mess" perception likely stems from the multiple layers, which is actually a good design pattern for separating concerns between parsing, language-specific analysis, and language-agnostic storage.

---

## Appendix A: Type Location Quick Reference

### Where to find types by crate:

```
tugtool-python-cst/src/visitor/
  signature.rs:     SignatureInfo, ParamInfo, ParamKind, Modifier, TypeParamInfo
  attribute_access.rs: AttributeAccessInfo, AttributeAccessKind, ReceiverPath, ReceiverStep
  call_site.rs:     CallSiteInfo, CallArgInfo
  binding.rs:       BindingInfo, BindingKind
  scope.rs:         ScopeInfo, ScopeKind
  reference.rs:     ReferenceKind, CstReferenceRecord
  import.rs:        ImportInfo, ImportKind, ImportedName
  annotation.rs:    AnnotationInfo, AnnotationKind, AnnotationSourceKind
  type_inference.rs: AssignmentInfo, TypeSource
  exports.rs:       ExportInfo, ExportKind
  inheritance.rs:   ClassInheritanceInfo
  dynamic.rs:       DynamicPatternInfo, DynamicPatternKind
  isinstance.rs:    IsInstanceCheck
  type_comment.rs:  TypeCommentKind

tugtool-core/src/adapter.rs:
  ScopeData, SymbolData, ReferenceData, ReferenceKind
  AttributeAccessData, CallSiteData, CallArgData
  AliasEdgeData, QualifiedNameData
  ParameterData, SignatureData, TypeParamData, ModifierData
  ImportData, ExportData

tugtool-core/src/facts/mod.rs:
  Symbol, SymbolKind, Reference, ReferenceKind
  ScopeInfo, ScopeKind, Import, ImportKind
  PublicExport, ExportKind, ExportTarget, ExportIntent, ExportOrigin
  Signature, Parameter, ParamKind, Modifier, Visibility
  AttributeAccess, AttributeAccessKind
  CallSite, CallArg
  ReceiverPath, ReceiverPathStep
  TypeNode, TypeSource
  IsInstanceCheck, DynamicPattern, DynamicPatternKind

tugtool-python/src/types.rs:
  SpanInfo, ScopeSpanInfo, BindingInfo, ParsedReferenceInfo
  ScopeInfo, ImportInfo, ImportedName, AssignmentInfo
  ClassInheritanceInfo, AnnotationInfo
  AttributeTypeInfo, PropertyTypeInfo
  DynamicPatternInfo, AnalysisResult
```

### Conversion function locations:

```
tugtool-python/src/analyzer.rs:
  convert_cst_signature()          - line 1993
  convert_cst_attribute_access()   - line 2053
  convert_cst_call_site_to_adapter() - line 2070
  convert_cst_param_kind()         - line ~5900
  convert_cst_modifier()           - line ~5920
  convert_cst_attribute_access_kind() - line 6023
  convert_receiver_path()          - line ~1970
  convert_cst_assignments()        - line 610
  convert_cst_annotations()        - line 648

tugtool-python-cst/src/visitor/attribute_access.rs:
  From<ReceiverStep> for CoreReceiverPathStep - line 150
  From<ReceiverPath> for CoreReceiverPath     - line 171

tugtool-python/src/cst_bridge.rs:
  From<CstScopeInfo> for ScopeInfo         - line 178
  From<CstBindingInfo> for BindingInfo     - line 214
  From<CstReferenceRecord> for ParsedReferenceInfo - line 227
```

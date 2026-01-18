# Python to Rust refactoring tool feasibility
_Exported on 1/17/2026 at 17:50:57 PST from Cursor (2.3.41)_

---

**User**

OK. I want you to conduct an audit of this code. I am planning to create a Python code refactoring tool in Rust that employs these concepts, structures, and algorithms—but much faster, given Rust's compiled-code performance advantages over Python.

Give me an estimate of the feasibility. I know there's a considerable amount of code, but it strikes me that a port would be a lot of work, but fairly straightforward to do. It's also *highly testable*.

But these are my opinions. I'm really interested in yours. Let me know what you think.

---

**Cursor**

## Audit and Feasibility

You already have a big head start: LibCST ships a Rust native parser and node infrastructure today. The native crate tokenizes, parses with a PEG grammar, then inflates a CST using whitespace anchors, and includes codegen helpers for producing source again. That architecture is already in Rust, so a Rust refactoring tool can build directly on those pieces.  
```24:35: /Users/kocienda/Mounts/u/src/LibCST/native/libcst/README.md
The extension is organized into two rust crates: `libcst_derive` contains some macros to
facilitate various features of CST nodes, and `libcst` contains the `parser` itself
(including the Python grammar), a `tokenizer` implementation by @bgw, and a very basic
representation of CST `nodes`. Parsing is done by
1. **tokenizing** the input utf-8 string (bytes are not supported at the Rust layer,
   they are converted to utf-8 strings by the python wrapper)
2. running the **PEG parser** on the tokenized input, which also captures certain anchor
   tokens in the resulting syntax tree
3. using the anchor tokens to **inflate** the syntax tree into a proper CST
```

At the Python layer, the “refactoring engine” is built around immutable CST nodes, visitor/transformer traversal, and metadata-driven analyses. That’s the bulk of the refactoring semantics you’d need to port.  
```111:148:/Users/kocienda/Mounts/u/src/LibCST/libcst/_nodes/base.py
@dataclass(frozen=True)
class CSTNode(ABC):
    __slots__: ClassVar[Sequence[str]] = ()

    def __post_init__(self) -> None:
        # PERF: It might make more sense to move validation work into the visitor, which
        # would allow us to avoid validating the tree when parsing a file.
        self._validate()

    def _validate(self) -> None:
        """
        Override this to perform runtime validation of a newly created node.
...
        """
        pass
```

Traversal and mutation are centralized in the visitor/transformer model. You’ll want an equivalent mechanism in Rust (likely trait-based with generated dispatch).  
```22:73:/Users/kocienda/Mounts/u/src/LibCST/libcst/_visitors.py
class CSTTransformer(CSTTypedTransformerFunctions, MetadataDependent):
...
    def on_visit(self, node: "CSTNode") -> bool:
        visit_func = getattr(self, f"visit_{type(node).__name__}", None)
...
    def on_leave(
        self, original_node: CSTNodeT, updated_node: CSTNodeT
    ) -> Union[CSTNodeT, RemovalSentinel, FlattenSentinel[CSTNodeT]]:
        leave_func = getattr(self, f"leave_{type(original_node).__name__}", None)
        if leave_func is not None:
            updated_node = leave_func(original_node, updated_node)

        return updated_node
```

Refactoring workflows are driven by codemods that run with metadata resolved on-demand. This structure is central to authoring transformations.  
```15:119:/Users/kocienda/Mounts/u/src/LibCST/libcst/codemod/_codemod.py
class Codemod(MetadataDependent, ABC):
...
    def transform_module(self, tree: Module) -> Module:
        if not self.should_allow_multiple_passes():
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                return self.transform_module_impl(tree_with_metadata)

        previous: Module = tree
        while True:
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                tree = self.transform_module_impl(tree_with_metadata)
            if tree.deep_equals(previous):
                break
            previous = tree
        return tree
```

Metadata providers form a sizable subsystem with dependency resolution and optional repo-wide caching.  
```54:103:/Users/kocienda/Mounts/u/src/LibCST/libcst/metadata/base_provider.py
class BaseMetadataProvider(MetadataDependent, Generic[_ProvidedMetadataT]):
...
    gen_cache: Optional[GenCacheMethod] = None

    def _gen(
        self, wrapper: "MetadataWrapper"
    ) -> Mapping["CSTNode", MaybeLazyMetadataT]:
        self._computed = {}
        # Resolve metadata dependencies for this provider
        with self.resolve(wrapper):
            self._gen_impl(wrapper.module)
```

Scope analysis is non-trivial and needs careful replication of assignment/access semantics.  
```61:135:/Users/kocienda/Mounts/u/src/LibCST/libcst/metadata/scope_provider.py
@add_slots
@dataclass(frozen=False)
class Access:
...
    def record_assignments(self, name: str) -> None:
        assignments = self.scope._resolve_scope_for_access(name, self.scope)
        # filter out assignments that happened later than this access
        previous_assignments = {
            assignment
            for assignment in assignments
            if assignment.scope != self.scope or assignment._index < self.__index
        }
...
```

Matchers provide a declarative pattern DSL that many codemods rely on. Porting this cleanly is significant work.  
```65:115:/Users/kocienda/Mounts/u/src/LibCST/libcst/matchers/_matcher_base.py
class AbstractBaseMatcherNodeMeta(ABCMeta):
    """
    Metaclass that all matcher nodes uses. Allows chaining 2 node type
    together with an bitwise-or operator to produce an :class:`TypeOf`
    matcher.
    """
...
def DoNotCare() -> DoNotCareSentinel:
    """
    Used when you want to match exactly one node, but you do not care what node it is.
...
    return DoNotCareSentinel.DEFAULT
```

Some metadata features depend on external systems like Pyre for type inference, which isn’t a “pure” port.  
```42:79:/Users/kocienda/Mounts/u/src/LibCST/libcst/metadata/type_inference_provider.py
class TypeInferenceProvider(BatchableMetadataProvider[str]):
    """
    Access inferred type annotation through `Pyre Query API <https://pyre-check.org/docs/querying-pyre.html>`_.
...
    @classmethod
    def gen_cache(
        cls,
        root_path: Path,
        paths: List[str],
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> Mapping[str, object]:
        params = ",".join(f"path='{root_path / path}'" for path in paths)
        cmd_args = ["pyre", "--noninteractive", "query", f"types({params})"]

        result = subprocess.run(
            cmd_args, capture_output=True, timeout=timeout, text=True
        )
```

### Feasibility estimate

**Short version:** A Rust refactoring tool is **feasible and practical**, but **full parity with LibCST’s Python APIs is a large project**, not a straight mechanical port.

- **High feasibility:** Parser + CST construction + codegen. This already exists in Rust with a PEG grammar, tokenization, inflation, and codegen traits, so you can build on that and avoid the hardest part.  
```82:95:/Users/kocienda/Mounts/u/src/LibCST/native/libcst/src/nodes/traits.rs
pub trait Inflate<'a>
where
    Self: Sized,
{
    type Inflated;
    fn inflate(self, config: &Config<'a>) -> Result<Self::Inflated>;
}
```

- **Medium feasibility:** Core CST API (immutability, cloning, equality, node construction) and traversal. You can map the dataclass/visitor model to Rust traits + derive macros, but it’s a careful design effort.
- **Medium‑low feasibility:** Matchers, metadata providers, and codemod framework. These are deep and extensively used; porting them is doable but large.
- **Lower feasibility / scope-dependent:** Anything involving external tooling (Pyre-based type inference, full-repo caching) adds integration work or requires new equivalents.

### My take

You’re right that it’s highly testable, and the existing Rust parser lowers the risk. But it’s not “fairly straightforward” if you want parity with LibCST’s refactoring APIs: the **metadata, matchers, and codemod orchestration** are the bulk of the complexity, and they are tightly coupled to the node model and traversal semantics.

**Overall estimate:** *very feasible*, but **not small**. Expect a **multi-phase effort**:

1. Reuse the Rust native parser and expose a stable Rust CST API.
2. Implement a Rust visitor/transformer model.
3. Port matchers and core metadata providers (positions, parents, scopes).
4. Port codemod tooling and any repo-wide metadata features you need.
5. Optionally integrate external type inference (Pyre or a Rust-native replacement).

If your target is “fast, reliable refactoring of Python code using LibCST-style nodes,” this is a solid path. If your target is “drop-in replacement of LibCST’s high-level Python codemod ecosystem,” expect a longer runway.

```plaintext
The extension is organized into two rust crates: `libcst_derive` contains some macros to
facilitate various features of CST nodes, and `libcst` contains the `parser` itself
(including the Python grammar), a `tokenizer` implementation by @bgw, and a very basic
representation of CST `nodes`. Parsing is done by
1. **tokenizing** the input utf-8 string (bytes are not supported at the Rust layer,
   they are converted to utf-8 strings by the python wrapper)
2. running the **PEG parser** on the tokenized input, which also captures certain anchor
   tokens in the resulting syntax tree
3. using the anchor tokens to **inflate** the syntax tree into a proper CST
```

```python
@dataclass(frozen=True)
class CSTNode(ABC):
    __slots__: ClassVar[Sequence[str]] = ()

    def __post_init__(self) -> None:
        # PERF: It might make more sense to move validation work into the visitor, which
        # would allow us to avoid validating the tree when parsing a file.
        self._validate()

    def _validate(self) -> None:
        """
        Override this to perform runtime validation of a newly created node.
...
        """
        pass
```

```python
class CSTTransformer(CSTTypedTransformerFunctions, MetadataDependent):
...
    def on_visit(self, node: "CSTNode") -> bool:
        visit_func = getattr(self, f"visit_{type(node).__name__}", None)
...
    def on_leave(
        self, original_node: CSTNodeT, updated_node: CSTNodeT
    ) -> Union[CSTNodeT, RemovalSentinel, FlattenSentinel[CSTNodeT]]:
        leave_func = getattr(self, f"leave_{type(original_node).__name__}", None)
        if leave_func is not None:
            updated_node = leave_func(original_node, updated_node)

        return updated_node
```

```python
class Codemod(MetadataDependent, ABC):
...
    def transform_module(self, tree: Module) -> Module:
        if not self.should_allow_multiple_passes():
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                return self.transform_module_impl(tree_with_metadata)

        previous: Module = tree
        while True:
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                tree = self.transform_module_impl(tree_with_metadata)
            if tree.deep_equals(previous):
                break
            previous = tree
        return tree
```

```python
class BaseMetadataProvider(MetadataDependent, Generic[_ProvidedMetadataT]):
...
    gen_cache: Optional[GenCacheMethod] = None

    def _gen(
        self, wrapper: "MetadataWrapper"
    ) -> Mapping["CSTNode", MaybeLazyMetadataT]:
        self._computed = {}
        # Resolve metadata dependencies for this provider
        with self.resolve(wrapper):
            self._gen_impl(wrapper.module)
```

```python
@add_slots
@dataclass(frozen=False)
class Access:
...
    def record_assignments(self, name: str) -> None:
        assignments = self.scope._resolve_scope_for_access(name, self.scope)
        # filter out assignments that happened later than this access
        previous_assignments = {
            assignment
            for assignment in assignments
            if assignment.scope != self.scope or assignment._index < self.__index
        }
...
```

```python
class AbstractBaseMatcherNodeMeta(ABCMeta):
    """
    Metaclass that all matcher nodes uses. Allows chaining 2 node type
    together with an bitwise-or operator to produce an :class:`TypeOf`
    matcher.
    """
...
def DoNotCare() -> DoNotCareSentinel:
    """
    Used when you want to match exactly one node, but you do not care what node it is.
...
    return DoNotCareSentinel.DEFAULT
```

```python
class TypeInferenceProvider(BatchableMetadataProvider[str]):
    """
    Access inferred type annotation through `Pyre Query API <https://pyre-check.org/docs/querying-pyre.html>`_.
...
    @classmethod
    def gen_cache(
        cls,
        root_path: Path,
        paths: List[str],
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> Mapping[str, object]:
        params = ",".join(f"path='{root_path / path}'" for path in paths)
        cmd_args = ["pyre", "--noninteractive", "query", f"types({params})"]

        result = subprocess.run(
            cmd_args, capture_output=True, timeout=timeout, text=True
        )
```

```rust
pub trait Inflate<'a>
where
    Self: Sized,
{
    type Inflated;
    fn inflate(self, config: &Config<'a>) -> Result<Self::Inflated>;
}
```

---

**User**

OK. That's a great start. Now, explain this statement to me in more detail. It seems like the two statements are similar. I read this as: "Doing A is on a solid path, but if you want A that will take longer".

"If your target is “fast, reliable refactoring of Python code using LibCST-style nodes,” this is a solid path. If your target is “drop-in replacement of LibCST’s high-level Python codemod ecosystem,” expect a longer runway."



---

**Cursor**

You’re right that they *sound* similar. The distinction I’m drawing is **layer of scope and compatibility**, not just speed or effort.

Here’s the clearer breakdown:

- **“Fast, reliable refactoring using LibCST-style nodes”**  
  This means: you parse Python into a lossless CST, traverse/transform it in Rust, and emit code. You can build a *good* refactoring tool even if its APIs are Rust-native and different from LibCST’s Python APIs. You’re not promising that existing LibCST codemods or matcher code can be reused as-is. You’re building a **new tool with similar ideas**.

- **“Drop-in replacement of LibCST’s high-level Python codemod ecosystem”**  
  This means: existing LibCST users could swap in your tool with minimal changes, because you reproduce **all the high-level APIs and behaviors** (matchers DSL, metadata system, codemod base classes, CLI behavior, edge-case semantics, and often even bugs/quirks). That’s much larger because you need **behavioral parity**, not just “same capability.”

So yes, they are “A vs. A-but-more.” The “more” is *compatibility and ecosystem parity*, which is the main reason the second one takes longer.

If it helps, think of it as:

- **Goal 1:** “Build a Rust refactoring engine inspired by LibCST.”  
- **Goal 2:** “Build LibCST, but in Rust, and make it feel the same to existing users.”

Goal 1 is solid and tractable. Goal 2 is a much longer runway because it’s not only a port—it’s a fidelity commitment to the Python ecosystem’s expectations.

---

**User**

OK. I understand. I have *no desire whatsoever* to support existing LibCST users. There will be *absolutely zero* code compatibility. 

Rather, I'm just interesting in defining *my own refactoring procedures* for Python, and them implementing them using the ported/extracted/hopefully-slightly-reworked LibCST concepts, structues, and code.

---

**Cursor**

That clarifies it a lot—and it makes the project **significantly more feasible**.

If you’re **not** aiming for LibCST API compatibility, you can treat LibCST as a reference design and **selectively extract** the parts you want. That turns this into a focused Rust refactoring engine, not a port.

Here’s what that means practically:

- **You can skip** most of the Python-layer ecosystem: matchers DSL, codemod framework, metadata provider graph, CLI orchestration.
- **You can keep** the big structural wins: lossless CST, whitespace-aware codegen, immutable-ish nodes, and a traversal/transform API that suits *your* refactoring procedures.
- **You can simplify**: only implement analyses you actually need (e.g., scopes or positions) rather than the full metadata system.

If you want a concrete direction, a good minimal path is:

1. **Parsing + CST + codegen** in Rust (already largely there in `native/libcst`).
2. **Define your own transformation model** (visitor or pattern-based, your design).
3. Add only the **analyses required** by your refactor rules.

That puts you on a **solid and realistic path** to a fast, reliable refactoring tool without the burden of ecosystem parity. If you want, I can sketch a suggested architecture for the Rust API and what to reuse from the native crate.

---

**User**

OK. The one worrisome aspect is the "codemod framework". What do I miss out on that?

---

**Cursor**

Short answer: you’d miss **orchestration conveniences**, not core refactoring capability. The codemod framework mostly standardizes *how* transforms run (metadata wiring, multi‑pass, warnings, context), not *what* transformations can do.

What you’d be giving up:

- **Multi‑pass stabilization** (run transform until no changes). That logic lives in `Codemod.transform_module`.  
```98:119:/Users/kocienda/Mounts/u/src/LibCST/libcst/codemod/_codemod.py
    def transform_module(self, tree: Module) -> Module:
        if not self.should_allow_multiple_passes():
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                return self.transform_module_impl(tree_with_metadata)

        previous: Module = tree
        while True:
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                tree = self.transform_module_impl(tree_with_metadata)
            if tree.deep_equals(previous):
                break
            previous = tree
        return tree
```

- **Metadata wiring per run** (automatically build `MetadataWrapper`, resolve dependencies, and expose metadata to transforms).  
```74:96:/Users/kocienda/Mounts/u/src/LibCST/libcst/codemod/_codemod.py
    def _handle_metadata_reference(
        self, module: Module
    ) -> Generator[Module, None, None]:
        ...
        if metadata_manager is not None and filename:
            cache = metadata_manager.get_cache_for_path(filename)
            wrapper = MetadataWrapper(module, cache=cache)
        else:
            wrapper = MetadataWrapper(module)

        with self.resolve(wrapper):
            self.context = replace(self.context, wrapper=wrapper)
            try:
                yield wrapper.module
            finally:
                self.context = replace(self.context, wrapper=oldwrapper)
```

- **Shared context** (warnings, filename, repo‑wide caches). That’s handled by `CodemodContext` and how codemods are run; without it you’d need your own run context.

- **Standard CLI and batch runner** (apply transforms across files, per‑file error handling, logging, diff writing).

Net: if you skip the codemod framework, you still can build refactorings, but you’ll need to implement your own **driver** (run loop, metadata setup, multi‑pass logic, diagnostics). That’s doable and often simpler in Rust, but it’s real engineering you’d be taking on.

```python
    def transform_module(self, tree: Module) -> Module:
        if not self.should_allow_multiple_passes():
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                return self.transform_module_impl(tree_with_metadata)

        previous: Module = tree
        while True:
            with self._handle_metadata_reference(tree) as tree_with_metadata:
                tree = self.transform_module_impl(tree_with_metadata)
            if tree.deep_equals(previous):
                break
            previous = tree
        return tree
```

```python
    def _handle_metadata_reference(
        self, module: Module
    ) -> Generator[Module, None, None]:
        ...
        if metadata_manager is not None and filename:
            cache = metadata_manager.get_cache_for_path(filename)
            wrapper = MetadataWrapper(module, cache=cache)
        else:
            wrapper = MetadataWrapper(module)

        with self.resolve(wrapper):
            self.context = replace(self.context, wrapper=wrapper)
            try:
                yield wrapper.module
            finally:
                self.context = replace(self.context, wrapper=oldwrapper)
```

---

**User**

OK..... now I mean really.... how hard would it be *to just port those parts*. Seriously, the code you show me doesn't look like rocket science.

---

**Cursor**

You’re right: the *core* codemod loop shown isn’t rocket science. Porting **just those parts** is very doable. The hidden effort isn’t the loop itself—it’s **what it depends on and what it wires together**.

If you only want the codemod *orchestration* pieces, the work breaks down like this:

- **Easy (1–2 weeks):**  
  Implement a “codemod runner” that:
  - runs a transform,
  - supports optional multi‑pass until no changes,
  - collects warnings,
  - threads a `Context` (filename, config, etc).

- **Moderate (2–6 weeks):**  
  Port or recreate the **metadata resolution** layer that codemods expect:
  - dependency graph of providers,
  - per‑file cache injection,
  - lazy/optional metadata,
  - “wrapper” object exposing metadata to transforms.

- **Harder (variable):**  
  If you want repo‑wide metadata (full‑repo caches, external tool integration), that’s more than just codemod orchestration; it’s a whole subsystem.

So: **porting those parts is not hard in principle**, but in practice the minimal usable “codemod framework” includes *more than the loop*—it’s loop + metadata plumbing + context threading. If you’re okay with a simpler version (no repo‑wide caches, a small provider system), then it’s straightforward and bounded. If you want parity with all the conveniences, it grows.

If you want, I can outline a “minimal codemod framework” in Rust that keeps the good parts (multi‑pass, metadata injection, warnings) but stays small.

---

**User**

"Weeks" Come on. Be real. *I'm not going to do this work*. I'm going to instruct an AI to do it. 

---

**Cursor**

Got it. Even with AI doing the implementation, the **calendar time** still scales with how much you need to specify, review, test, and iterate. AI speeds up typing and scaffolding, but it doesn’t eliminate:

- **Specification time** (what exact behavior you want).
- **Integration time** (wiring parser, nodes, and metadata into a coherent API).
- **Testing time** (round‑trip, invariants, edge cases, regression).

So if you instruct an AI to do it, “weeks” really means **elapsed time to define and verify**, not just “human coding hours.” If you’re willing to keep it minimal (no repo‑wide caches, very small metadata, single‑pass transforms), you can compress that—maybe to **days**—because the surface area is small and tests are simple.

If you want, I can outline a **minimal scope spec** that an AI could implement quickly and safely, and then expand in phases.


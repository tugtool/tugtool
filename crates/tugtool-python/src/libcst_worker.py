#!/usr/bin/env python3
"""LibCST Worker: JSON-lines protocol for parsing and rewriting Python code.

This worker implements the LibCST Worker Protocol per 26.0.4:
- JSON-lines protocol over stdin/stdout
- CST parsing with LRU cache
- Name binding and reference extraction
- Scope structure analysis
- CST rewriting with minimal diffs

Protocol:
  Request:  {"id": <int>, "op": "<operation>", ...params...}
  Response: {"id": <int>, "status": "ok"|"error", ...result OR error...}
"""

import sys
import json
from collections import OrderedDict
from typing import Any, Optional
from dataclasses import dataclass, field

try:
    import libcst as cst
    from libcst.metadata import MetadataWrapper, PositionProvider
except ImportError:
    # This error will be reported via the protocol
    print(json.dumps({
        "status": "error",
        "error_code": "InternalError",
        "message": "libcst is not installed"
    }), flush=True)
    sys.exit(1)


# =============================================================================
# Configuration
# =============================================================================

# Maximum number of CSTs to keep in cache
CST_CACHE_SIZE = 100

# Worker version
WORKER_VERSION = "0.1.0"


# =============================================================================
# LRU Cache for CSTs
# =============================================================================

class LRUCache:
    """Simple LRU cache using OrderedDict."""

    def __init__(self, maxsize: int):
        self.maxsize = maxsize
        self.cache: OrderedDict[str, Any] = OrderedDict()

    def get(self, key: str) -> Optional[Any]:
        if key in self.cache:
            # Move to end (most recently used)
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def put(self, key: str, value: Any) -> None:
        if key in self.cache:
            self.cache.move_to_end(key)
        else:
            if len(self.cache) >= self.maxsize:
                # Remove oldest item
                self.cache.popitem(last=False)
        self.cache[key] = value

    def remove(self, key: str) -> bool:
        if key in self.cache:
            del self.cache[key]
            return True
        return False

    def clear(self) -> None:
        self.cache.clear()


# =============================================================================
# CST Entry (parsed module with metadata)
# =============================================================================

@dataclass
class CSTEntry:
    """Entry in the CST cache."""
    cst_id: str
    path: str
    content: str
    module: cst.Module
    wrapper: Optional[MetadataWrapper] = None

    def get_wrapper(self) -> MetadataWrapper:
        """Get or create the metadata wrapper."""
        if self.wrapper is None:
            self.wrapper = MetadataWrapper(self.module)
        return self.wrapper


# =============================================================================
# Worker State
# =============================================================================

@dataclass
class WorkerState:
    """Global worker state."""
    cst_cache: LRUCache = field(default_factory=lambda: LRUCache(CST_CACHE_SIZE))
    next_cst_id: int = 1

    def generate_cst_id(self) -> str:
        cst_id = f"cst_{self.next_cst_id:06d}"
        self.next_cst_id += 1
        return cst_id


# =============================================================================
# Position Utilities Mixin
# =============================================================================

class PositionMixin:
    """Mixin providing line/column to byte offset conversion utilities.

    Classes using this mixin should:
    1. Set self.content before calling _init_position_tracking()
    2. Call _init_position_tracking() in their __init__
    """

    def _init_position_tracking(self, content: str = ""):
        """Initialize position tracking with file content."""
        self.content = content
        self._lines: list[int] = []
        if content:
            self._compute_line_offsets()

    def _compute_line_offsets(self):
        """Compute byte offset for the start of each line."""
        self._lines = [0]
        for i, ch in enumerate(self.content):
            if ch == '\n':
                self._lines.append(i + 1)

    def _line_col_to_byte(self, line: int, col: int) -> int:
        """Convert 1-indexed line:col to byte offset."""
        if not self._lines or line < 1 or line > len(self._lines):
            return 0
        return self._lines[line - 1] + col - 1


# =============================================================================
# Scope Analysis Visitor
# =============================================================================

class ScopeVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts scope structure from a module with position and global/nonlocal tracking.

    Per 26.0.4 get_scopes, each scope includes:
    - id: unique scope identifier
    - kind: module/class/function/lambda/comprehension
    - name: function/class name (if applicable)
    - parent: parent scope id
    - span: byte offsets for start/end
    - globals: names declared as global in this scope
    - nonlocals: names declared as nonlocal in this scope
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.scopes: list[dict] = []
        self.scope_stack: list[str] = []
        self.next_scope_id: int = 0
        # Track global/nonlocal per scope_id
        self._scope_globals: dict[str, list[str]] = {}
        self._scope_nonlocals: dict[str, list[str]] = {}

    def _get_scope_id(self) -> str:
        scope_id = f"scope_{self.next_scope_id}"
        self.next_scope_id += 1
        return scope_id

    def _current_parent(self) -> Optional[str]:
        return self.scope_stack[-1] if self.scope_stack else None

    def _current_scope(self) -> Optional[str]:
        return self.scope_stack[-1] if self.scope_stack else None

    def _enter_scope(self, kind: str, name: Optional[str], node: cst.CSTNode):
        scope_id = self._get_scope_id()
        parent = self._current_parent()

        scope_info = {
            "id": scope_id,
            "kind": kind,
            "parent": parent,
        }
        if name:
            scope_info["name"] = name

        # Get position info from metadata
        # The Rust side expects span with start_line, start_col, end_line, end_col
        try:
            pos = self.get_metadata(PositionProvider, node)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1  # Convert to 1-indexed
                end_line = pos.end.line
                end_col = pos.end.column + 1

                scope_info["span"] = {
                    "start_line": line,
                    "start_col": col,
                    "end_line": end_line,
                    "end_col": end_col,
                }
        except (KeyError, AttributeError):
            pass

        # Initialize global/nonlocal tracking for this scope
        self._scope_globals[scope_id] = []
        self._scope_nonlocals[scope_id] = []

        self.scopes.append(scope_info)
        self.scope_stack.append(scope_id)
        return scope_id

    def _exit_scope(self):
        if self.scope_stack:
            scope_id = self.scope_stack.pop()
            # Attach globals/nonlocals to the scope info
            for scope in self.scopes:
                if scope["id"] == scope_id:
                    if self._scope_globals.get(scope_id):
                        scope["globals"] = self._scope_globals[scope_id]
                    if self._scope_nonlocals.get(scope_id):
                        scope["nonlocals"] = self._scope_nonlocals[scope_id]
                    break

    def visit_Module(self, node: cst.Module) -> bool:
        self._enter_scope("module", None, node)
        return True

    def leave_Module(self, node: cst.Module) -> None:
        self._exit_scope()

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self._enter_scope("class", node.name.value, node)
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self._exit_scope()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self._enter_scope("function", node.name.value, node)
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self._exit_scope()

    def visit_Lambda(self, node: cst.Lambda) -> bool:
        self._enter_scope("lambda", None, node)
        return True

    def leave_Lambda(self, node: cst.Lambda) -> None:
        self._exit_scope()

    def visit_ListComp(self, node: cst.ListComp) -> bool:
        self._enter_scope("comprehension", None, node)
        return True

    def leave_ListComp(self, node: cst.ListComp) -> None:
        self._exit_scope()

    def visit_SetComp(self, node: cst.SetComp) -> bool:
        self._enter_scope("comprehension", None, node)
        return True

    def leave_SetComp(self, node: cst.SetComp) -> None:
        self._exit_scope()

    def visit_DictComp(self, node: cst.DictComp) -> bool:
        self._enter_scope("comprehension", None, node)
        return True

    def leave_DictComp(self, node: cst.DictComp) -> None:
        self._exit_scope()

    def visit_GeneratorExp(self, node: cst.GeneratorExp) -> bool:
        self._enter_scope("comprehension", None, node)
        return True

    def leave_GeneratorExp(self, node: cst.GeneratorExp) -> None:
        self._exit_scope()

    # Track global declarations
    def visit_Global(self, node: cst.Global) -> bool:
        scope_id = self._current_scope()
        if scope_id:
            for name_item in node.names:
                self._scope_globals[scope_id].append(name_item.name.value)
        return False

    # Track nonlocal declarations
    def visit_Nonlocal(self, node: cst.Nonlocal) -> bool:
        scope_id = self._current_scope()
        if scope_id:
            for name_item in node.names:
                self._scope_nonlocals[scope_id].append(name_item.name.value)
        return False


# =============================================================================
# Binding Visitor
# =============================================================================

class BindingVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts all name bindings (definitions) from a module."""

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.bindings: list[dict] = []
        self.scope_path: list[str] = ["<module>"]

    def _add_binding(self, name: str, kind: str, node: cst.CSTNode, name_node: Optional[cst.CSTNode] = None):
        """Add a binding with position information if available."""
        binding = {
            "name": name,
            "kind": kind,
            "scope_path": list(self.scope_path),
        }

        # Try to get position from metadata using get_metadata()
        target = name_node or node
        try:
            pos = self.get_metadata(PositionProvider, target)
            if pos:
                # LibCST positions: line is 1-indexed, column is 0-indexed
                line = pos.start.line
                col = pos.start.column + 1  # Convert to 1-indexed
                end_line = pos.end.line
                end_col = pos.end.column + 1

                binding["line"] = line
                binding["col"] = col

                # Compute byte spans
                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                binding["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        self.bindings.append(binding)

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self._add_binding(node.name.value, "function", node, node.name)
        self.scope_path.append(node.name.value)
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.scope_path.pop()

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self._add_binding(node.name.value, "class", node, node.name)
        self.scope_path.append(node.name.value)
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.scope_path.pop()

    def visit_Param(self, node: cst.Param) -> bool:
        if node.name:
            self._add_binding(node.name.value, "parameter", node, node.name)
        return True

    def visit_Assign(self, node: cst.Assign) -> bool:
        for target in node.targets:
            self._extract_assign_targets(target.target, "variable")
        return True

    def visit_AnnAssign(self, node: cst.AnnAssign) -> bool:
        if node.target:
            self._extract_assign_targets(node.target, "variable")
        return True

    def visit_NamedExpr(self, node: cst.NamedExpr) -> bool:
        self._extract_assign_targets(node.target, "variable")
        return True

    def visit_Import(self, node: cst.Import) -> bool:
        for name in node.names if isinstance(node.names, (list, tuple)) else [node.names]:
            if isinstance(name, cst.ImportAlias):
                if name.asname:
                    self._add_binding(
                        name.asname.name.value if isinstance(name.asname.name, cst.Name) else str(name.asname.name),
                        "import_alias", node
                    )
                elif isinstance(name.name, cst.Name):
                    self._add_binding(name.name.value, "import", node)
                elif isinstance(name.name, cst.Attribute):
                    # For `import a.b.c`, we bind `a`
                    root = name.name
                    while isinstance(root, cst.Attribute):
                        root = root.value
                    if isinstance(root, cst.Name):
                        self._add_binding(root.value, "import", node)
        return False

    def visit_ImportFrom(self, node: cst.ImportFrom) -> bool:
        if isinstance(node.names, cst.ImportStar):
            self._add_binding("*", "import", node)
        elif node.names:
            for name in node.names:
                if isinstance(name, cst.ImportAlias):
                    if name.asname:
                        self._add_binding(
                            name.asname.name.value if isinstance(name.asname.name, cst.Name) else str(name.asname.name),
                            "import_alias", node
                        )
                    elif isinstance(name.name, cst.Name):
                        self._add_binding(name.name.value, "import", node)
        return False

    def visit_For(self, node: cst.For) -> bool:
        self._extract_assign_targets(node.target, "variable")
        return True

    def visit_With(self, node: cst.With) -> bool:
        for item in node.items:
            if item.asname:
                self._extract_assign_targets(item.asname.name, "variable")
        return True

    def visit_ExceptHandler(self, node: cst.ExceptHandler) -> bool:
        if node.name:
            # node.name is an AsName, access .name.value
            name_node = node.name.name
            if isinstance(name_node, cst.Name):
                self._add_binding(name_node.value, "variable", node)
        return True

    def _extract_assign_targets(self, target: cst.BaseExpression, kind: str):
        """Extract names from assignment targets (handles tuple unpacking)."""
        if isinstance(target, cst.Name):
            self._add_binding(target.value, kind, target)
        elif isinstance(target, (cst.Tuple, cst.List)):
            for element in target.elements:
                if isinstance(element, cst.Element):
                    self._extract_assign_targets(element.value, kind)
                elif isinstance(element, cst.StarredElement):
                    self._extract_assign_targets(element.value, kind)
        elif isinstance(target, cst.StarredElement):
            self._extract_assign_targets(target.value, kind)


# =============================================================================
# Assignment Type Visitor (Level 1 Type Inference)
# =============================================================================

class AssignmentTypeVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts type information from assignments.

    Level 1 type inference: detects constructor calls and variable propagation.
    Level 3 type inference: extracts callee name for return type propagation.

    Examples:
        x = MyClass()        # x has type MyClass (constructor)
        y = x                # y has type from x (propagated)
        a = b = MyClass()    # chained assignment: both have type MyClass
        z = get_handler()    # z gets callee_name="get_handler" for return type lookup
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.assignments: list[dict] = []
        self.scope_path: list[str] = ["<module>"]
        # Track known class names defined in this module
        self._class_names: set[str] = set()

    def _add_assignment(
        self,
        target_name: str,
        inferred_type: Optional[str],
        type_source: str,
        node: cst.CSTNode,
        target_node: Optional[cst.CSTNode] = None,
        rhs_name: Optional[str] = None,
        callee_name: Optional[str] = None,
    ):
        """Add an assignment with optional type information."""
        assignment = {
            "target": target_name,
            "scope_path": list(self.scope_path),
            "type_source": type_source,  # "constructor", "variable", "function_call", "unknown"
        }

        if inferred_type:
            assignment["inferred_type"] = inferred_type
        if rhs_name:
            assignment["rhs_name"] = rhs_name
        if callee_name:
            assignment["callee_name"] = callee_name

        # Get position from target node
        target = target_node or node
        try:
            pos = self.get_metadata(PositionProvider, target)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1
                end_line = pos.end.line
                end_col = pos.end.column + 1

                assignment["line"] = line
                assignment["col"] = col

                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                assignment["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        self.assignments.append(assignment)

    def _get_call_type(self, node: cst.Call) -> Optional[str]:
        """Extract the type name from a constructor call.

        Returns the class name if the callee is a simple Name that looks like
        a class (starts with uppercase or is a known class in this module).
        """
        if isinstance(node.func, cst.Name):
            name = node.func.value
            # Heuristic: class names typically start with uppercase
            # Also check if it's a known class defined in this module
            if name[0].isupper() or name in self._class_names:
                return name
        elif isinstance(node.func, cst.Attribute):
            # For module.ClassName() - extract just the attribute name
            if isinstance(node.func.attr, cst.Name):
                name = node.func.attr.value
                if name[0].isupper():
                    return name
        return None

    def _get_callee_name(self, node: cst.Call) -> Optional[str]:
        """Extract the callee name from a function call.

        Returns the function name for simple calls like `get_handler()`.
        For qualified calls like `module.func()`, returns the attribute name.
        """
        if isinstance(node.func, cst.Name):
            return node.func.value
        elif isinstance(node.func, cst.Attribute):
            # For module.func() - return the attribute name
            if isinstance(node.func.attr, cst.Name):
                return node.func.attr.value
        return None

    def _analyze_rhs(self, value: cst.BaseExpression) -> tuple[Optional[str], str, Optional[str], Optional[str]]:
        """Analyze the RHS of an assignment to determine type information.

        Returns: (inferred_type, type_source, rhs_name, callee_name)
        - inferred_type: The type name if known (e.g., "MyClass")
        - type_source: How we determined the type ("constructor", "variable", "function_call", "unknown")
        - rhs_name: If RHS is a variable reference, the variable name
        - callee_name: If RHS is a function call, the function name
        """
        if isinstance(value, cst.Call):
            type_name = self._get_call_type(value)
            if type_name:
                # Constructor call - we know the type directly
                return (type_name, "constructor", None, None)
            # Non-constructor function call - extract callee for return type propagation
            callee = self._get_callee_name(value)
            if callee:
                return (None, "function_call", None, callee)
            return (None, "unknown", None, None)
        elif isinstance(value, cst.Name):
            # Variable reference - type will be propagated
            return (None, "variable", value.value, None)
        else:
            return (None, "unknown", None, None)

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        """Track class definitions for type inference."""
        self._class_names.add(node.name.value)
        self.scope_path.append(node.name.value)
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.scope_path.pop()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self.scope_path.append(node.name.value)
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.scope_path.pop()

    def visit_Assign(self, node: cst.Assign) -> bool:
        """Handle regular assignments: x = value, x = y = value."""
        inferred_type, type_source, rhs_name, callee_name = self._analyze_rhs(node.value)

        # Handle all targets (chained assignment)
        for assign_target in node.targets:
            self._extract_typed_targets(
                assign_target.target, inferred_type, type_source, rhs_name, callee_name, node
            )
        return True

    def visit_AnnAssign(self, node: cst.AnnAssign) -> bool:
        """Handle annotated assignments: x: Type = value."""
        # For annotated assignments, we still track the inferred type from RHS
        # The annotation is handled separately in Level 2
        if node.value:
            inferred_type, type_source, rhs_name, callee_name = self._analyze_rhs(node.value)
        else:
            inferred_type, type_source, rhs_name, callee_name = None, "unknown", None, None

        self._extract_typed_targets(
            node.target, inferred_type, type_source, rhs_name, callee_name, node
        )
        return True

    def visit_NamedExpr(self, node: cst.NamedExpr) -> bool:
        """Handle walrus operator: (x := value)."""
        inferred_type, type_source, rhs_name, callee_name = self._analyze_rhs(node.value)
        self._extract_typed_targets(
            node.target, inferred_type, type_source, rhs_name, callee_name, node
        )
        return True

    def _extract_typed_targets(
        self,
        target: cst.BaseExpression,
        inferred_type: Optional[str],
        type_source: str,
        rhs_name: Optional[str],
        callee_name: Optional[str],
        node: cst.CSTNode,
    ):
        """Extract target names and record their type information."""
        if isinstance(target, cst.Name):
            self._add_assignment(
                target.value, inferred_type, type_source, node, target, rhs_name, callee_name
            )
        elif isinstance(target, (cst.Tuple, cst.List)):
            # Tuple/list unpacking loses type information
            for element in target.elements:
                if isinstance(element, cst.Element):
                    self._extract_typed_targets(
                        element.value, None, "unknown", None, None, node
                    )
                elif isinstance(element, cst.StarredElement):
                    self._extract_typed_targets(
                        element.value, None, "unknown", None, None, node
                    )
        elif isinstance(target, cst.StarredElement):
            self._extract_typed_targets(
                target.value, None, "unknown", None, None, node
            )


# =============================================================================
# Method Call Visitor (for type-based method resolution)
# =============================================================================

class MethodCallVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts method calls on variables.

    Used for Level 1 type-based method resolution. Tracks patterns like:
        obj.method()      # obj is a variable, method is an attribute
        self.method()     # self is implicit class instance
        handler.process() # handler could be typed

    This allows us to resolve method calls to class methods when the
    receiver's type is known.
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.method_calls: list[dict] = []
        self.scope_path: list[str] = ["<module>"]

    def _add_method_call(
        self,
        receiver_name: str,
        method_name: str,
        node: cst.CSTNode,
        method_node: cst.CSTNode,
    ):
        """Add a method call record."""
        call = {
            "receiver": receiver_name,
            "method": method_name,
            "scope_path": list(self.scope_path),
        }

        # Get position of the method name (for renaming)
        try:
            pos = self.get_metadata(PositionProvider, method_node)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1
                end_line = pos.end.line
                end_col = pos.end.column + 1

                call["line"] = line
                call["col"] = col

                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                call["method_span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        self.method_calls.append(call)

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self.scope_path.append(node.name.value)
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.scope_path.pop()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self.scope_path.append(node.name.value)
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.scope_path.pop()

    def visit_Call(self, node: cst.Call) -> bool:
        """Detect method calls: obj.method()."""
        if isinstance(node.func, cst.Attribute):
            attr = node.func
            # Check if the value is a simple Name (variable)
            if isinstance(attr.value, cst.Name):
                receiver_name = attr.value.value
                method_name = attr.attr.value
                self._add_method_call(receiver_name, method_name, node, attr.attr)
        return True


# =============================================================================
# Annotation Visitor (Level 2 Type Inference)
# =============================================================================

class AnnotationVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts type annotations for Level 2 type inference.

    Parses type annotations from:
    - Function parameters: `def foo(x: int, y: str)`
    - Return types: `def foo() -> int`
    - Variable annotations: `x: int = 5` (AnnAssign)
    - Class attributes: `class Foo: x: int`

    Handles annotation AST variants:
    - Simple names: `int`, `str`, `MyClass`
    - Subscripts: `List[int]`, `Dict[str, int]`, `Optional[str]`
    - Union types: `int | str` (Python 3.10+)
    - String annotations: `"ForwardRef"` (forward references)
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.annotations: list[dict] = []
        self.scope_path: list[str] = ["<module>"]
        # Track current class for self/cls handling
        self._current_class: Optional[str] = None

    def _annotation_to_str(self, ann: cst.BaseExpression) -> tuple[str, str]:
        """Convert an annotation AST node to its string representation.

        Returns: (type_str, annotation_kind)
        - type_str: The type as a string (e.g., "int", "List[str]", "MyClass")
        - annotation_kind: "simple", "subscript", "union", "string", "attribute"
        """
        if isinstance(ann, cst.Name):
            return (ann.value, "simple")
        elif isinstance(ann, cst.SimpleString):
            # String annotation: "ForwardRef"
            # Strip quotes
            value = ann.value
            if value.startswith(('"""', "'''")):
                inner = value[3:-3]
            elif value.startswith(('"', "'")):
                inner = value[1:-1]
            else:
                inner = value
            return (inner, "string")
        elif isinstance(ann, cst.Subscript):
            # Subscript: List[int], Dict[str, int], Optional[str]
            return (self._subscript_to_str(ann), "subscript")
        elif isinstance(ann, cst.BinaryOperation):
            # Union type: int | str (Python 3.10+)
            if isinstance(ann.operator, cst.BitOr):
                left, _ = self._annotation_to_str(ann.left)
                right, _ = self._annotation_to_str(ann.right)
                return (f"{left} | {right}", "union")
            else:
                return (str(ann), "unknown")
        elif isinstance(ann, cst.Attribute):
            # Qualified name: module.ClassName
            return (self._attribute_to_str(ann), "attribute")
        elif isinstance(ann, cst.ConcatenatedString):
            # Concatenated string annotation (rare)
            parts = []
            for part in ann.left, ann.right:
                if isinstance(part, cst.SimpleString):
                    val = part.value
                    if val.startswith(('"""', "'''")):
                        parts.append(val[3:-3])
                    elif val.startswith(('"', "'")):
                        parts.append(val[1:-1])
            return ("".join(parts), "string")
        else:
            return (str(ann), "unknown")

    def _subscript_to_str(self, node: cst.Subscript) -> str:
        """Convert a subscript annotation to string."""
        base_name = self._annotation_to_str(node.value)[0]
        slices = []
        for slice_item in node.slice:
            if isinstance(slice_item, cst.SubscriptElement):
                slice_val = slice_item.slice
                if isinstance(slice_val, cst.Index):
                    slices.append(self._annotation_to_str(slice_val.value)[0])
                else:
                    slices.append(str(slice_val))
            else:
                slices.append(str(slice_item))
        return f"{base_name}[{', '.join(slices)}]"

    def _attribute_to_str(self, node: cst.Attribute) -> str:
        """Convert an attribute access to dotted string."""
        parts = []
        current: cst.BaseExpression = node
        while isinstance(current, cst.Attribute):
            parts.append(current.attr.value)
            current = current.value
        if isinstance(current, cst.Name):
            parts.append(current.value)
        parts.reverse()
        return ".".join(parts)

    def _add_annotation(
        self,
        name: str,
        type_str: str,
        annotation_kind: str,
        source_kind: str,  # "parameter", "return", "variable", "attribute"
        node: cst.CSTNode,
        name_node: Optional[cst.CSTNode] = None,
    ):
        """Add an annotation entry."""
        ann = {
            "name": name,
            "type_str": type_str,
            "annotation_kind": annotation_kind,
            "source_kind": source_kind,
            "scope_path": list(self.scope_path),
        }

        # Get position from name node
        target = name_node or node
        try:
            pos = self.get_metadata(PositionProvider, target)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1
                end_line = pos.end.line
                end_col = pos.end.column + 1

                ann["line"] = line
                ann["col"] = col

                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                ann["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        self.annotations.append(ann)

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self.scope_path.append(node.name.value)
        self._current_class = node.name.value
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.scope_path.pop()
        self._current_class = None

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self.scope_path.append(node.name.value)

        # Handle return type annotation
        if node.returns:
            type_str, ann_kind = self._annotation_to_str(node.returns.annotation)
            self._add_annotation(
                "__return__",  # Special name for return type
                type_str,
                ann_kind,
                "return",
                node.returns,
                node.name,
            )

        # Handle parameter annotations
        params = node.params
        all_params = []

        # Collect all parameter types
        if params.params:
            all_params.extend(params.params)
        if params.star_arg and isinstance(params.star_arg, cst.Param):
            all_params.append(params.star_arg)
        if params.kwonly_params:
            all_params.extend(params.kwonly_params)
        if params.star_kwarg:
            all_params.append(params.star_kwarg)

        for i, param in enumerate(all_params):
            if param.annotation:
                param_name = param.name.value
                type_str, ann_kind = self._annotation_to_str(param.annotation.annotation)

                # Handle self/cls - infer type from current class
                if i == 0 and self._current_class:
                    if param_name in ("self", "cls"):
                        type_str = self._current_class
                        ann_kind = "implicit"

                self._add_annotation(
                    param_name,
                    type_str,
                    ann_kind,
                    "parameter",
                    param,
                    param.name,
                )
            elif i == 0 and self._current_class:
                # Handle untyped self/cls - still infer type
                param_name = param.name.value
                if param_name in ("self", "cls"):
                    self._add_annotation(
                        param_name,
                        self._current_class,
                        "implicit",
                        "parameter",
                        param,
                        param.name,
                    )

        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.scope_path.pop()

    def visit_AnnAssign(self, node: cst.AnnAssign) -> bool:
        """Handle annotated assignments: x: int = 5 or class attr x: int."""
        if isinstance(node.target, cst.Name):
            type_str, ann_kind = self._annotation_to_str(node.annotation.annotation)
            # Determine if this is a class attribute or variable
            source_kind = "attribute" if self._current_class and len(self.scope_path) == 2 else "variable"
            self._add_annotation(
                node.target.value,
                type_str,
                ann_kind,
                source_kind,
                node,
                node.target,
            )
        return True


# =============================================================================
# Dynamic Pattern Visitor
# =============================================================================

class DynamicPatternVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that detects dynamic patterns that cannot be statically analyzed.

    Detects patterns per List L11 (Dynamic Pattern Detection):
    - getattr(obj, "name") or getattr(obj, var) - dynamic attribute access
    - setattr(obj, "name", value) - dynamic attribute set
    - globals()["name"] or globals()[var] - dynamic global access
    - locals()["name"] or locals()[var] - dynamic local access
    - eval(...) - dynamic code execution
    - exec(...) - dynamic code execution
    - __getattr__ / __setattr__ method definitions
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.patterns: list[dict] = []
        self.scope_path: list[str] = ["<module>"]

    def _add_pattern(
        self,
        pattern_kind: str,  # "getattr", "setattr", "globals", "locals", "eval", "exec", "__getattr__", "__setattr__"
        node: cst.CSTNode,
        literal_name: Optional[str] = None,
        pattern_text: Optional[str] = None,
    ):
        """Add a dynamic pattern record."""
        pattern = {
            "kind": pattern_kind,
            "scope_path": list(self.scope_path),
        }

        if literal_name is not None:
            pattern["literal_name"] = literal_name
        if pattern_text:
            pattern["pattern_text"] = pattern_text

        # Get position information
        try:
            pos = self.get_metadata(PositionProvider, node)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1
                end_line = pos.end.line
                end_col = pos.end.column + 1

                pattern["line"] = line
                pattern["col"] = col

                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                pattern["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        self.patterns.append(pattern)

    def _extract_string_literal(self, node: cst.BaseExpression) -> Optional[str]:
        """Extract string literal value if the node is a string constant."""
        if isinstance(node, cst.SimpleString):
            value = node.value
            # Strip quotes
            if value.startswith(('"""', "'''")):
                return value[3:-3]
            elif value.startswith(('"', "'")):
                return value[1:-1]
        elif isinstance(node, cst.ConcatenatedString):
            # Handle concatenated strings like "foo" "bar"
            parts = []
            for part in [node.left, node.right]:
                extracted = self._extract_string_literal(part)
                if extracted is not None:
                    parts.append(extracted)
            if parts:
                return "".join(parts)
        return None

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self.scope_path.append(node.name.value)
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.scope_path.pop()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        func_name = node.name.value
        self.scope_path.append(func_name)

        # Check for __getattr__ or __setattr__ definitions
        if func_name in ("__getattr__", "__setattr__"):
            self._add_pattern(
                func_name,
                node,
                pattern_text=f"def {func_name}(...)",
            )

        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.scope_path.pop()

    def visit_Call(self, node: cst.Call) -> bool:
        """Detect dynamic pattern calls: getattr, setattr, globals, locals, eval, exec."""
        # Check if the call is to one of the dynamic functions
        func = node.func
        func_name = None

        if isinstance(func, cst.Name):
            func_name = func.value
        elif isinstance(func, cst.Attribute):
            # Could be builtins.getattr etc.
            if isinstance(func.attr, cst.Name):
                func_name = func.attr.value

        if func_name in ("getattr", "setattr"):
            self._handle_attr_call(node, func_name)
        elif func_name in ("eval", "exec"):
            self._handle_eval_exec_call(node, func_name)

        return True

    def _handle_attr_call(self, node: cst.Call, func_name: str):
        """Handle getattr(obj, "name") or setattr(obj, "name", value) calls."""
        # Need at least 2 args for getattr, 3 for setattr
        min_args = 2 if func_name == "getattr" else 3
        if len(node.args) < min_args:
            return

        # The second argument is the attribute name
        name_arg = node.args[1].value
        literal_name = self._extract_string_literal(name_arg)

        # Build pattern text for display
        try:
            obj_code = cst.Module([]).code_for_node(node.args[0].value)
            if literal_name:
                pattern_text = f'{func_name}({obj_code}, "{literal_name}")'
            else:
                name_code = cst.Module([]).code_for_node(name_arg)
                pattern_text = f'{func_name}({obj_code}, {name_code})'
        except Exception:
            pattern_text = f'{func_name}(...)'

        self._add_pattern(func_name, node, literal_name=literal_name, pattern_text=pattern_text)

    def _handle_eval_exec_call(self, node: cst.Call, func_name: str):
        """Handle eval(...) or exec(...) calls."""
        pattern_text = f'{func_name}(...)'
        if node.args:
            code_arg = node.args[0].value
            literal = self._extract_string_literal(code_arg)
            if literal:
                # Truncate long strings
                if len(literal) > 30:
                    literal = literal[:27] + "..."
                pattern_text = f'{func_name}("{literal}")'

        self._add_pattern(func_name, node, pattern_text=pattern_text)

    def visit_Subscript(self, node: cst.Subscript) -> bool:
        """Detect globals()["name"] or locals()["name"] patterns."""
        # Check if subscript base is globals() or locals() call
        if isinstance(node.value, cst.Call):
            call = node.value
            func = call.func
            func_name = None

            if isinstance(func, cst.Name):
                func_name = func.value

            if func_name in ("globals", "locals"):
                # Check the subscript key
                if node.slice and len(node.slice) == 1:
                    slice_elem = node.slice[0]
                    if isinstance(slice_elem, cst.SubscriptElement):
                        slice_val = slice_elem.slice
                        if isinstance(slice_val, cst.Index):
                            key_node = slice_val.value
                            literal_name = self._extract_string_literal(key_node)

                            # Build pattern text
                            if literal_name:
                                pattern_text = f'{func_name}()["{literal_name}"]'
                            else:
                                try:
                                    key_code = cst.Module([]).code_for_node(key_node)
                                    pattern_text = f'{func_name}()[{key_code}]'
                                except Exception:
                                    pattern_text = f'{func_name}()[...]'

                            self._add_pattern(func_name, node, literal_name=literal_name, pattern_text=pattern_text)

        return True


# =============================================================================
# Class Inheritance Visitor
# =============================================================================

class ClassInheritanceVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts class inheritance relationships.

    For each class definition, extracts:
    - name: The class name
    - bases: List of base class names
    - scope_path: The scope path where the class is defined
    - span/line/col: Position information

    This enables building the inheritance hierarchy for method override tracking.
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.classes: list[dict] = []
        self.scope_path: list[str] = ["<module>"]

    def _extract_base_name(self, node: cst.BaseExpression) -> Optional[str]:
        """Extract the class name from a base expression.

        Handles:
        - Simple names: BaseClass
        - Attribute access: module.BaseClass
        - Generic subscripts: Generic[T] -> Generic
        """
        if isinstance(node, cst.Name):
            return node.value
        elif isinstance(node, cst.Attribute):
            # For module.ClassName, return just ClassName
            if isinstance(node.attr, cst.Name):
                return node.attr.value
        elif isinstance(node, cst.Subscript):
            # For Generic[T], extract the base name
            return self._extract_base_name(node.value)
        return None

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        """Extract class definition with base classes."""
        # Extract base class names
        bases = []
        for base_arg in node.bases:
            base_name = self._extract_base_name(base_arg.value)
            if base_name:
                bases.append(base_name)

        class_info = {
            "name": node.name.value,
            "bases": bases,
            "scope_path": list(self.scope_path),
        }

        # Add position information
        try:
            pos = self.get_metadata(PositionProvider, node.name)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1  # Convert to 1-indexed
                end_line = pos.end.line
                end_col = pos.end.column + 1

                class_info["line"] = line
                class_info["col"] = col

                # Compute byte spans
                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                class_info["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        self.classes.append(class_info)
        self.scope_path.append(node.name.value)
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.scope_path.pop()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        """Track function scope for nested classes."""
        self.scope_path.append(node.name.value)
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.scope_path.pop()


# =============================================================================
# Reference Visitor
# =============================================================================

class ReferenceVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that collects ALL name references in a single CST pass.

    This is O(n) in AST nodes, not O(n*m) where m is number of unique names.
    Returns a dict mapping name -> list of references.
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        # name -> list of {kind, span, line, col}
        self.references: dict[str, list[dict]] = {}
        self._context_stack: list[tuple[str, str]] = []  # (context_type, name)

    def _add_reference(self, name: str, kind: str, node: cst.CSTNode):
        """Add a reference for a name."""
        ref = {"kind": kind}

        try:
            pos = self.get_metadata(PositionProvider, node)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1  # Convert to 1-indexed
                end_line = pos.end.line
                end_col = pos.end.column + 1

                ref["line"] = line
                ref["col"] = col

                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                ref["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

        if name not in self.references:
            self.references[name] = []
        self.references[name].append(ref)

    def _get_current_kind(self, name: str) -> str:
        """Get reference kind for the current context."""
        for ctx_type, ctx_name in reversed(self._context_stack):
            if ctx_type == "import":
                return "import"
            if ctx_type == "call_func" and ctx_name == name:
                return "call"
            if ctx_type == "attribute_attr" and ctx_name == name:
                return "attribute"
        return "reference"

    # Context tracking for Call nodes
    def visit_Call(self, node: cst.Call) -> bool:
        if isinstance(node.func, cst.Name):
            self._context_stack.append(("call_func", node.func.value))
        return True

    def leave_Call(self, node: cst.Call) -> None:
        if self._context_stack and self._context_stack[-1][0] == "call_func":
            self._context_stack.pop()

    # Context tracking for Attribute access
    def visit_Attribute(self, node: cst.Attribute) -> bool:
        self._context_stack.append(("attribute_attr", node.attr.value))
        return True

    def leave_Attribute(self, node: cst.Attribute) -> None:
        if self._context_stack and self._context_stack[-1][0] == "attribute_attr":
            self._context_stack.pop()

    # Context tracking for Import statements
    def visit_Import(self, node: cst.Import) -> bool:
        self._context_stack.append(("import", ""))
        return True

    def leave_Import(self, node: cst.Import) -> None:
        if self._context_stack and self._context_stack[-1][0] == "import":
            self._context_stack.pop()

    def visit_ImportFrom(self, node: cst.ImportFrom) -> bool:
        self._context_stack.append(("import", ""))
        return True

    def leave_ImportFrom(self, node: cst.ImportFrom) -> None:
        if self._context_stack and self._context_stack[-1][0] == "import":
            self._context_stack.pop()

    # Visit ALL Name nodes and classify them
    def visit_Name(self, node: cst.Name) -> bool:
        name = node.value
        kind = self._get_current_kind(name)
        self._add_reference(name, kind, node)
        return False

    # Definition tracking - capture definitions explicitly
    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self._add_reference(node.name.value, "definition", node.name)
        return True

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self._add_reference(node.name.value, "definition", node.name)
        return True

    def visit_Param(self, node: cst.Param) -> bool:
        if node.name:
            self._add_reference(node.name.value, "definition", node.name)
        return True

    def visit_Assign(self, node: cst.Assign) -> bool:
        for target in node.targets:
            self._mark_assign_definitions(target.target)
        return True

    def visit_AnnAssign(self, node: cst.AnnAssign) -> bool:
        if node.target:
            self._mark_assign_definitions(node.target)
        return True

    def _mark_assign_definitions(self, target):
        """Mark assignment targets as definitions."""
        if isinstance(target, cst.Name):
            self._add_reference(target.value, "definition", target)
        elif isinstance(target, (cst.Tuple, cst.List)):
            for element in target.elements:
                if isinstance(element, cst.Element):
                    self._mark_assign_definitions(element.value)
                elif isinstance(element, cst.StarredElement):
                    self._mark_assign_definitions(element.value)


# =============================================================================
# Import Visitor
# =============================================================================

class ImportVisitor(PositionMixin, cst.CSTVisitor):
    """Visitor that extracts all import statements from a module with position information.

    Per 26.0.4 get_imports, each import includes:
    - kind: "import" or "from"
    - module: module path
    - span: byte offsets for the import statement
    - line: line number
    - names: list of imported names (for 'from' imports)
    - alias: alias name if present
    """

    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, content: str = ""):
        self._init_position_tracking(content)
        self.imports: list[dict] = []

    def _add_position(self, import_info: dict, node: cst.CSTNode):
        """Add position information to an import dict."""
        try:
            pos = self.get_metadata(PositionProvider, node)
            if pos:
                line = pos.start.line
                col = pos.start.column + 1
                end_line = pos.end.line
                end_col = pos.end.column + 1

                import_info["line"] = line
                import_info["col"] = col

                start_byte = self._line_col_to_byte(line, col)
                end_byte = self._line_col_to_byte(end_line, end_col)
                import_info["span"] = {"start": start_byte, "end": end_byte}
        except (KeyError, AttributeError):
            pass

    def visit_Import(self, node: cst.Import) -> bool:
        if isinstance(node.names, cst.ImportStar):
            pass
        else:
            for name in node.names if isinstance(node.names, (list, tuple)) else [node.names]:
                if isinstance(name, cst.ImportAlias):
                    module_name = self._get_dotted_name(name.name)
                    alias = None
                    if name.asname:
                        alias = name.asname.name.value if isinstance(name.asname.name, cst.Name) else str(name.asname.name)
                    import_info = {
                        "kind": "import",
                        "module": module_name,
                        "alias": alias,
                    }
                    self._add_position(import_info, node)
                    self.imports.append(import_info)
        return False

    def visit_ImportFrom(self, node: cst.ImportFrom) -> bool:
        # Get the module path
        module_parts = []
        if node.relative:
            for dot in node.relative:
                module_parts.append(".")
        if node.module:
            module_parts.append(self._get_dotted_name(node.module))
        module_path = "".join(module_parts)

        if isinstance(node.names, cst.ImportStar):
            import_info = {
                "kind": "from",
                "module": module_path,
                "names": [{"name": "*", "alias": None}],
                "is_star": True,
            }
            self._add_position(import_info, node)
            self.imports.append(import_info)
        elif node.names:
            names = []
            for name in node.names:
                if isinstance(name, cst.ImportAlias):
                    imported_name = name.name.value if isinstance(name.name, cst.Name) else str(name.name)
                    alias = None
                    if name.asname:
                        alias = name.asname.name.value if isinstance(name.asname.name, cst.Name) else str(name.asname.name)
                    names.append({"name": imported_name, "alias": alias})
            import_info = {
                "kind": "from",
                "module": module_path,
                "names": names,
                "is_star": False,
            }
            self._add_position(import_info, node)
            self.imports.append(import_info)
        return False

    def _get_dotted_name(self, node) -> str:
        """Extract dotted name from an Attribute or Name node."""
        if isinstance(node, cst.Name):
            return node.value
        elif isinstance(node, cst.Attribute):
            return f"{self._get_dotted_name(node.value)}.{node.attr.value}"
        else:
            return str(node)


# =============================================================================
# Operation Handlers
# =============================================================================

def handle_parse(state: WorkerState, request: dict) -> dict:
    """Handle 'parse' operation."""
    path = request.get("path", "")
    content = request.get("content", "")

    if not content:
        return {
            "status": "error",
            "error_code": "InvalidArgument",
            "message": "content is required",
        }

    try:
        module = cst.parse_module(content)
    except cst.ParserSyntaxError as e:
        return {
            "status": "error",
            "error_code": "ParseError",
            "message": str(e),
            "details": {
                "file": path,
                "line": e.raw_line if hasattr(e, 'raw_line') else None,
                "col": e.raw_column if hasattr(e, 'raw_column') else None,
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "error_code": "ParseError",
            "message": str(e),
            "details": {"file": path}
        }

    # Generate CST ID and store
    cst_id = state.generate_cst_id()
    entry = CSTEntry(cst_id=cst_id, path=path, content=content, module=module)
    state.cst_cache.put(cst_id, entry)

    # Derive module name from path
    module_name = path.replace("/", ".").replace("\\", ".").removesuffix(".py")

    return {
        "status": "ok",
        "cst_id": cst_id,
        "module_name": module_name,
    }


def handle_get_bindings(state: WorkerState, request: dict) -> dict:
    """Handle 'get_bindings' operation."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = BindingVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = BindingVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "bindings": visitor.bindings,
        "position_available": position_available,
    }


def handle_get_references(state: WorkerState, request: dict) -> dict:
    """Handle 'get_references' operation - collect all references in one pass."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = ReferenceVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = ReferenceVisitor(entry.content)
        entry.module.visit(visitor)

    # De-duplicate references by span within each name
    all_refs = {}
    for name, refs in visitor.references.items():
        seen_spans = set()
        unique_refs = []
        for ref in refs:
            span = ref.get("span")
            if span:
                span_key = (span["start"], span["end"])
                if span_key not in seen_spans:
                    seen_spans.add(span_key)
                    unique_refs.append(ref)
            else:
                unique_refs.append(ref)
        all_refs[name] = unique_refs

    return {
        "status": "ok",
        "references": all_refs,
        "position_available": position_available,
    }


def handle_get_imports(state: WorkerState, request: dict) -> dict:
    """Handle 'get_imports' operation."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = ImportVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = ImportVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "imports": visitor.imports,
        "position_available": position_available,
    }


def handle_get_scopes(state: WorkerState, request: dict) -> dict:
    """Handle 'get_scopes' operation."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = ScopeVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = ScopeVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "scopes": visitor.scopes,
        "position_available": position_available,
    }


def handle_get_assignments(state: WorkerState, request: dict) -> dict:
    """Handle 'get_assignments' operation for Level 1 type inference."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = AssignmentTypeVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = AssignmentTypeVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "assignments": visitor.assignments,
        "position_available": position_available,
    }


def handle_get_method_calls(state: WorkerState, request: dict) -> dict:
    """Handle 'get_method_calls' operation for type-based method resolution."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = MethodCallVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = MethodCallVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "method_calls": visitor.method_calls,
        "position_available": position_available,
    }


def handle_get_annotations(state: WorkerState, request: dict) -> dict:
    """Handle 'get_annotations' operation for Level 2 type inference."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = AnnotationVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = AnnotationVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "annotations": visitor.annotations,
        "position_available": position_available,
    }


def handle_get_class_inheritance(state: WorkerState, request: dict) -> dict:
    """Handle 'get_class_inheritance' operation for class inheritance extraction.

    Returns class definitions with their base classes for building the
    inheritance hierarchy, enabling method override tracking during rename.
    """
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = ClassInheritanceVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = ClassInheritanceVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "classes": visitor.classes,
        "position_available": position_available,
    }


def handle_get_dynamic_patterns(state: WorkerState, request: dict) -> dict:
    """Handle 'get_dynamic_patterns' operation for dynamic pattern detection."""
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Use MetadataWrapper to get position information
    visitor = DynamicPatternVisitor(entry.content)
    wrapper = entry.get_wrapper()
    position_available = True
    try:
        wrapper.visit(visitor)
    except Exception:
        # Fallback to simple visit without metadata
        position_available = False
        visitor = DynamicPatternVisitor(entry.content)
        entry.module.visit(visitor)

    return {
        "status": "ok",
        "dynamic_patterns": visitor.patterns,
        "position_available": position_available,
    }


def handle_get_analysis(state: WorkerState, request: dict) -> dict:
    """Handle 'get_analysis' operation - combined analysis in one call.

    Returns all analysis data (bindings, references, imports, scopes,
    assignments, method_calls, annotations) in a single IPC round-trip.
    """
    cst_id = request.get("cst_id", "")

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    wrapper = entry.get_wrapper()
    content = entry.content

    # Run all visitors
    results = {}
    position_available = True

    # Bindings
    try:
        visitor = BindingVisitor(content)
        wrapper.visit(visitor)
        results["bindings"] = visitor.bindings
    except Exception:
        visitor = BindingVisitor(content)
        entry.module.visit(visitor)
        results["bindings"] = visitor.bindings
        position_available = False

    # References
    try:
        visitor = ReferenceVisitor(content)
        wrapper.visit(visitor)
        # De-duplicate references
        all_refs = {}
        for name, refs in visitor.references.items():
            seen_spans = set()
            unique_refs = []
            for ref in refs:
                span = ref.get("span")
                if span:
                    span_key = (span["start"], span["end"])
                    if span_key not in seen_spans:
                        seen_spans.add(span_key)
                        unique_refs.append(ref)
                else:
                    unique_refs.append(ref)
            all_refs[name] = unique_refs
        results["references"] = all_refs
    except Exception:
        visitor = ReferenceVisitor(content)
        entry.module.visit(visitor)
        results["references"] = visitor.references
        position_available = False

    # Imports
    try:
        visitor = ImportVisitor(content)
        wrapper.visit(visitor)
        results["imports"] = visitor.imports
    except Exception:
        visitor = ImportVisitor(content)
        entry.module.visit(visitor)
        results["imports"] = visitor.imports
        position_available = False

    # Scopes
    try:
        visitor = ScopeVisitor(content)
        wrapper.visit(visitor)
        results["scopes"] = visitor.scopes
    except Exception:
        visitor = ScopeVisitor(content)
        entry.module.visit(visitor)
        results["scopes"] = visitor.scopes
        position_available = False

    # Assignments (type inference)
    try:
        visitor = AssignmentTypeVisitor(content)
        wrapper.visit(visitor)
        results["assignments"] = visitor.assignments
    except Exception:
        visitor = AssignmentTypeVisitor(content)
        entry.module.visit(visitor)
        results["assignments"] = visitor.assignments
        position_available = False

    # Method calls
    try:
        visitor = MethodCallVisitor(content)
        wrapper.visit(visitor)
        results["method_calls"] = visitor.method_calls
    except Exception:
        visitor = MethodCallVisitor(content)
        entry.module.visit(visitor)
        results["method_calls"] = visitor.method_calls
        position_available = False

    # Annotations (Level 2 type inference)
    try:
        visitor = AnnotationVisitor(content)
        wrapper.visit(visitor)
        results["annotations"] = visitor.annotations
    except Exception:
        visitor = AnnotationVisitor(content)
        entry.module.visit(visitor)
        results["annotations"] = visitor.annotations
        position_available = False

    # Dynamic patterns (getattr, eval, etc.)
    try:
        visitor = DynamicPatternVisitor(content)
        wrapper.visit(visitor)
        results["dynamic_patterns"] = visitor.patterns
    except Exception:
        visitor = DynamicPatternVisitor(content)
        entry.module.visit(visitor)
        results["dynamic_patterns"] = visitor.patterns
        position_available = False

    # Class inheritance
    try:
        visitor = ClassInheritanceVisitor(content)
        wrapper.visit(visitor)
        results["class_inheritance"] = visitor.classes
    except Exception:
        visitor = ClassInheritanceVisitor(content)
        entry.module.visit(visitor)
        results["class_inheritance"] = visitor.classes
        position_available = False

    return {
        "status": "ok",
        **results,
        "position_available": position_available,
    }


def handle_rewrite_name(state: WorkerState, request: dict) -> dict:
    """Handle 'rewrite_name' operation (single span rewrite)."""
    cst_id = request.get("cst_id", "")
    span = request.get("span", {})
    new_name = request.get("new_name", "")

    if not span or "start" not in span or "end" not in span:
        return {
            "status": "error",
            "error_code": "InvalidArgument",
            "message": "span with start and end is required",
        }

    if not new_name:
        return {
            "status": "error",
            "error_code": "InvalidArgument",
            "message": "new_name is required",
        }

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    # Get the old text at the span
    content = entry.content
    old_text = content[span["start"]:span["end"]]

    # Simple string replacement at the exact span
    new_content = content[:span["start"]] + new_name + content[span["end"]:]

    return {
        "status": "ok",
        "new_content": new_content,
        "old_text": old_text,
    }


def handle_rewrite_batch(state: WorkerState, request: dict) -> dict:
    """Handle 'rewrite_batch' operation (multiple rewrites)."""
    cst_id = request.get("cst_id", "")
    rewrites = request.get("rewrites", [])

    if not rewrites:
        return {
            "status": "error",
            "error_code": "InvalidArgument",
            "message": "rewrites array is required",
        }

    entry = state.cst_cache.get(cst_id)
    if entry is None:
        return {
            "status": "error",
            "error_code": "InvalidCstId",
            "message": f"CST not found: {cst_id}",
        }

    content = entry.content

    # Validate all spans
    for rewrite in rewrites:
        span = rewrite.get("span", {})
        if "start" not in span or "end" not in span:
            return {
                "status": "error",
                "error_code": "InvalidArgument",
                "message": "each rewrite must have span with start and end",
            }
        if span["start"] < 0 or span["end"] > len(content):
            return {
                "status": "error",
                "error_code": "SpanOutOfBounds",
                "message": f"span {span} is out of bounds for content of length {len(content)}",
            }

    # Sort rewrites by span start in REVERSE order (end to start)
    # This preserves span validity as we apply edits
    sorted_rewrites = sorted(rewrites, key=lambda r: r["span"]["start"], reverse=True)

    # Apply rewrites in reverse order
    new_content = content
    for rewrite in sorted_rewrites:
        span = rewrite["span"]
        new_name = rewrite["new_name"]
        new_content = new_content[:span["start"]] + new_name + new_content[span["end"]:]

    return {
        "status": "ok",
        "new_content": new_content,
    }


def handle_release(state: WorkerState, request: dict) -> dict:
    """Handle 'release' operation."""
    cst_id = request.get("cst_id", "")

    removed = state.cst_cache.remove(cst_id)

    return {
        "status": "ok",
        "released": removed,
    }


def handle_shutdown(state: WorkerState, request: dict) -> dict:
    """Handle 'shutdown' operation."""
    return {
        "status": "ok",
    }


# =============================================================================
# Main Loop
# =============================================================================

def main():
    """Main worker loop."""
    state = WorkerState()

    # Send ready message
    ready_msg = {
        "status": "ready",
        "version": WORKER_VERSION,
        "libcst_version": cst.__version__ if hasattr(cst, '__version__') else "unknown",
    }
    print(json.dumps(ready_msg), flush=True)

    # Operation dispatch table
    handlers = {
        "parse": handle_parse,
        "get_bindings": handle_get_bindings,
        "get_references": handle_get_references,
        "get_imports": handle_get_imports,
        "get_scopes": handle_get_scopes,
        "get_assignments": handle_get_assignments,
        "get_method_calls": handle_get_method_calls,
        "get_annotations": handle_get_annotations,
        "get_class_inheritance": handle_get_class_inheritance,
        "get_dynamic_patterns": handle_get_dynamic_patterns,
        "get_analysis": handle_get_analysis,
        "rewrite_name": handle_rewrite_name,
        "rewrite_batch": handle_rewrite_batch,
        "release": handle_release,
        "shutdown": handle_shutdown,
    }

    # Read requests from stdin, one JSON per line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            response = {
                "id": None,
                "status": "error",
                "error_code": "InvalidRequest",
                "message": f"Invalid JSON: {e}",
            }
            print(json.dumps(response), flush=True)
            continue

        request_id = request.get("id")
        op = request.get("op", "")

        if op in handlers:
            try:
                result = handlers[op](state, request)
                result["id"] = request_id
            except Exception as e:
                result = {
                    "id": request_id,
                    "status": "error",
                    "error_code": "InternalError",
                    "message": str(e),
                }
        else:
            result = {
                "id": request_id,
                "status": "error",
                "error_code": "UnknownOperation",
                "message": f"Unknown operation: {op}",
            }

        print(json.dumps(result), flush=True)

        # Exit after shutdown
        if op == "shutdown":
            break


if __name__ == "__main__":
    main()

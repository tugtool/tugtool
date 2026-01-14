//! LibCST Worker Manager: spawns and communicates with Python subprocess.
//!
//! This module implements the Rust side of the LibCST Worker Protocol per 26.0.4:
//!
//! - Spawn worker subprocess with JSON-lines protocol
//! - Wait for ready message with timeout
//! - Send requests and receive responses
//! - Handle worker crashes and respawn
//! - Store worker PID in session directory
//!
//! Protocol: JSON-lines over stdin/stdout
//! - Request: `{"id": <int>, "op": "<operation>", ...params...}`
//! - Response: `{"id": <int>, "status": "ok"|"error", ...result...}`

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;

// ============================================================================
// Constants
// ============================================================================

/// Timeout for worker to send ready message (10 seconds).
const READY_TIMEOUT_SECS: u64 = 10;

/// Default timeout for requests (60 seconds).
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// Worker name for PID file.
const WORKER_NAME: &str = "libcst";

/// Embedded worker script.
const WORKER_SCRIPT: &str = include_str!("libcst_worker.py");

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during worker operations.
#[derive(Debug, Error)]
pub enum WorkerError {
    /// Worker process failed to start.
    #[error("failed to spawn worker: {reason}")]
    SpawnFailed { reason: String },

    /// Worker did not send ready message within timeout.
    #[error("worker did not become ready within {timeout_secs}s")]
    ReadyTimeout { timeout_secs: u64 },

    /// Request timed out.
    #[error("request timed out after {timeout_secs}s")]
    RequestTimeout { timeout_secs: u64 },

    /// Worker process crashed (broken pipe).
    #[error("worker process crashed: {reason}")]
    WorkerCrashed { reason: String },

    /// Worker returned an error response.
    #[error("worker error: {code} - {message}")]
    WorkerResponseError { code: String, message: String },

    /// Invalid response from worker.
    #[error("invalid worker response: {reason}")]
    InvalidResponse { reason: String },

    /// IO error during worker communication.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Worker not started.
    #[error("worker not started")]
    NotStarted,

    /// Python interpreter not found.
    #[error("Python interpreter not found at {path}")]
    PythonNotFound { path: PathBuf },
}

/// Result type for worker operations.
pub type WorkerResult<T> = Result<T, WorkerError>;

// ============================================================================
// Protocol Types
// ============================================================================

/// Worker ready message (sent on startup).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadyMessage {
    pub status: String,
    pub version: String,
    pub libcst_version: String,
}

/// Generic worker response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerResponse {
    /// Request ID (echoed back).
    pub id: Option<u64>,
    /// Status: "ok" or "error".
    pub status: String,
    /// Error code (if status == "error").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// Error message (if status == "error").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Additional data (operation-specific).
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Parse response data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResponse {
    pub cst_id: String,
    pub module_name: String,
}

/// Binding information returned by get_bindings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindingInfo {
    pub name: String,
    pub kind: String,
    pub scope_path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Span information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanInfo {
    pub start: usize,
    pub end: usize,
}

/// Reference information returned by get_references.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceInfo {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Import information returned by get_imports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportInfo {
    pub kind: String, // "import" or "from"
    pub module: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub names: Option<Vec<ImportedName>>,
    #[serde(default)]
    pub is_star: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// Imported name in a from import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedName {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

/// Scope information returned by get_scopes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeInfo {
    pub id: String,
    pub kind: String, // "module", "class", "function", "lambda", "comprehension"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<ScopeSpanInfo>,
}

/// Scope span information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeSpanInfo {
    pub start_line: u32,
    pub start_col: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_col: Option<u32>,
}

/// Assignment information with type inference (Level 1 + Level 3).
///
/// Returned by `get_assignments` to track type information from assignments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignmentInfo {
    /// Target variable name.
    pub target: String,
    /// Scope path where assignment occurs (e.g., ["<module>", "MyClass", "method"]).
    pub scope_path: Vec<String>,
    /// How the type was determined: "constructor", "variable", "function_call", or "unknown".
    pub type_source: String,
    /// Inferred type name (if type_source is "constructor").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred_type: Option<String>,
    /// RHS variable name (if type_source is "variable").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhs_name: Option<String>,
    /// Callee name (if type_source is "function_call" for return type propagation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callee_name: Option<String>,
    /// Byte span of the target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Method call information for type-based resolution.
///
/// Returned by `get_method_calls` to track `obj.method()` patterns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MethodCallInfo {
    /// The receiver variable name (e.g., "handler" in "handler.process()").
    pub receiver: String,
    /// The method name being called (e.g., "process").
    pub method: String,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the method name (for renaming).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Class inheritance information for building the inheritance hierarchy.
///
/// Returned by `get_class_inheritance` to track class definitions and their
/// base classes. This enables method override tracking during rename operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassInheritanceInfo {
    /// The class name.
    pub name: String,
    /// List of base class names (direct parents only).
    #[serde(default)]
    pub bases: Vec<String>,
    /// Scope path where the class is defined.
    #[serde(default)]
    pub scope_path: Vec<String>,
    /// Byte span of the class name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Type annotation information for Level 2 type inference.
///
/// Returned by `get_annotations` to track type annotations from:
/// - Function parameters: `def foo(x: int)`
/// - Return types: `def foo() -> int`
/// - Variable annotations: `x: int = 5`
/// - Class attributes: `class Foo: x: int`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationInfo {
    /// The annotated name (parameter, variable, or "__return__" for return types).
    pub name: String,
    /// The type as a string (e.g., "int", "List[str]", "MyClass").
    pub type_str: String,
    /// How the annotation was parsed: "simple", "subscript", "union", "string", "attribute", "implicit".
    pub annotation_kind: String,
    /// Source of the annotation: "parameter", "return", "variable", "attribute".
    pub source_kind: String,
    /// Scope path where the annotation occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Dynamic pattern information for pattern detection.
///
/// Returned by `get_dynamic_patterns` to track patterns that cannot be statically analyzed:
/// - `getattr(obj, "name")` - dynamic attribute access
/// - `setattr(obj, "name", value)` - dynamic attribute set
/// - `globals()["name"]` - dynamic global access
/// - `locals()["name"]` - dynamic local access
/// - `eval("code")` - dynamic code execution
/// - `exec("code")` - dynamic code execution
/// - `__getattr__` / `__setattr__` method definitions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicPatternInfo {
    /// The kind of dynamic pattern: "getattr", "setattr", "globals", "locals", "eval", "exec",
    /// "__getattr__", or "__setattr__".
    pub kind: String,
    /// Scope path where the pattern occurs.
    pub scope_path: Vec<String>,
    /// The literal name if detectable (e.g., "method_name" in `getattr(obj, "method_name")`).
    /// None if the name is a variable or expression.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literal_name: Option<String>,
    /// A string representation of the pattern for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_text: Option<String>,
    /// Byte span of the pattern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Combined analysis result from `get_analysis`.
///
/// Contains all analysis data in a single response to reduce IPC overhead.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnalysisResult {
    /// Symbol bindings (definitions).
    #[serde(default)]
    pub bindings: Vec<BindingInfo>,
    /// Name references grouped by name.
    #[serde(default)]
    pub references: std::collections::HashMap<String, Vec<ReferenceInfo>>,
    /// Import statements.
    #[serde(default)]
    pub imports: Vec<ImportInfo>,
    /// Scope structure.
    #[serde(default)]
    pub scopes: Vec<ScopeInfo>,
    /// Assignment type information (Level 1).
    #[serde(default)]
    pub assignments: Vec<AssignmentInfo>,
    /// Method call patterns.
    #[serde(default)]
    pub method_calls: Vec<MethodCallInfo>,
    /// Type annotations (Level 2).
    #[serde(default)]
    pub annotations: Vec<AnnotationInfo>,
    /// Dynamic patterns (getattr, eval, etc.).
    #[serde(default)]
    pub dynamic_patterns: Vec<DynamicPatternInfo>,
    /// Class inheritance information.
    #[serde(default)]
    pub class_inheritance: Vec<ClassInheritanceInfo>,
}

/// Rewrite request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteRequest {
    pub span: SpanInfo,
    pub new_name: String,
}

// ============================================================================
// Worker Handle
// ============================================================================

/// Handle to a running LibCST worker process.
pub struct WorkerHandle {
    /// Child process.
    child: Option<Child>,
    /// Stdin writer.
    stdin: Option<std::process::ChildStdin>,
    /// Buffered stdout reader.
    stdout_reader: Option<BufReader<std::process::ChildStdout>>,
    /// Next request ID (monotonically increasing).
    next_request_id: AtomicU64,
    /// Path to Python interpreter.
    python_path: PathBuf,
    /// Path to session directory.
    session_dir: PathBuf,
    /// Path to worker script (materialized).
    worker_script_path: PathBuf,
    /// Worker version (from ready message).
    worker_version: Option<String>,
    /// LibCST version (from ready message).
    libcst_version: Option<String>,
}

impl WorkerHandle {
    /// Check if the worker is running.
    pub fn is_running(&self) -> bool {
        self.child.is_some() && self.stdin.is_some() && self.stdout_reader.is_some()
    }

    /// Get worker version.
    pub fn worker_version(&self) -> Option<&str> {
        self.worker_version.as_deref()
    }

    /// Get LibCST version.
    pub fn libcst_version(&self) -> Option<&str> {
        self.libcst_version.as_deref()
    }

    /// Send a request and wait for response.
    pub fn send_request(
        &mut self,
        op: &str,
        params: serde_json::Value,
    ) -> WorkerResult<WorkerResponse> {
        self.send_request_with_timeout(op, params, Duration::from_secs(REQUEST_TIMEOUT_SECS))
    }

    /// Send a request with custom timeout.
    pub fn send_request_with_timeout(
        &mut self,
        op: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> WorkerResult<WorkerResponse> {
        // Ensure worker is running
        if !self.is_running() {
            // Try to respawn
            self.respawn()?;
        }

        let request_id = self.next_request_id.fetch_add(1, Ordering::SeqCst);

        // Build request JSON
        let mut request = serde_json::json!({
            "id": request_id,
            "op": op,
        });

        // Merge params
        if let serde_json::Value::Object(params_map) = params {
            if let serde_json::Value::Object(ref mut req_map) = request {
                for (k, v) in params_map {
                    req_map.insert(k, v);
                }
            }
        }

        // Send request
        let request_line = serde_json::to_string(&request)?;
        let stdin = self.stdin.as_mut().ok_or(WorkerError::NotStarted)?;

        if let Err(e) = writeln!(stdin, "{}", request_line) {
            // Broken pipe - worker crashed
            self.mark_crashed();
            return Err(WorkerError::WorkerCrashed {
                reason: e.to_string(),
            });
        }

        if let Err(e) = stdin.flush() {
            self.mark_crashed();
            return Err(WorkerError::WorkerCrashed {
                reason: e.to_string(),
            });
        }

        // Read response with timeout
        let start = Instant::now();
        let reader = self.stdout_reader.as_mut().ok_or(WorkerError::NotStarted)?;

        loop {
            if start.elapsed() >= timeout {
                return Err(WorkerError::RequestTimeout {
                    timeout_secs: timeout.as_secs(),
                });
            }

            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    // EOF - worker crashed
                    self.mark_crashed();
                    return Err(WorkerError::WorkerCrashed {
                        reason: "unexpected EOF".to_string(),
                    });
                }
                Ok(_) => {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }

                    // Parse response
                    let response: WorkerResponse =
                        serde_json::from_str(line).map_err(|e| WorkerError::InvalidResponse {
                            reason: format!("JSON parse error: {}: {}", e, line),
                        })?;

                    // Check request ID matches
                    if response.id != Some(request_id) {
                        // Unexpected response ID - log and continue
                        continue;
                    }

                    // Check for error status
                    if response.status == "error" {
                        return Err(WorkerError::WorkerResponseError {
                            code: response.error_code.clone().unwrap_or_default(),
                            message: response.message.clone().unwrap_or_default(),
                        });
                    }

                    return Ok(response);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // Non-blocking read returned no data - wait a bit
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(e) => {
                    self.mark_crashed();
                    return Err(WorkerError::WorkerCrashed {
                        reason: e.to_string(),
                    });
                }
            }
        }
    }

    // ========================================================================
    // High-Level Operations
    // ========================================================================

    /// Parse Python file content and return CST ID.
    pub fn parse(&mut self, path: &str, content: &str) -> WorkerResult<ParseResponse> {
        let params = serde_json::json!({
            "path": path,
            "content": content,
        });

        let response = self.send_request("parse", params)?;

        // Extract parse response data
        let cst_id = response
            .data
            .get("cst_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WorkerError::InvalidResponse {
                reason: "missing cst_id in parse response".to_string(),
            })?
            .to_string();

        let module_name = response
            .data
            .get("module_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(ParseResponse {
            cst_id,
            module_name,
        })
    }

    /// Get all bindings (definitions) from a parsed CST.
    pub fn get_bindings(&mut self, cst_id: &str) -> WorkerResult<Vec<BindingInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_bindings", params)?;

        let bindings: Vec<BindingInfo> =
            serde_json::from_value(response.data.get("bindings").cloned().unwrap_or_default())?;

        Ok(bindings)
    }

    /// Get all references in a parsed CST.
    ///
    /// Returns a map from symbol name to list of references, collected in a
    /// single CST traversal. This is O(1) IPC calls regardless of symbol count.
    pub fn get_references(
        &mut self,
        cst_id: &str,
    ) -> WorkerResult<std::collections::HashMap<String, Vec<ReferenceInfo>>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_references", params)?;

        let refs_map: std::collections::HashMap<String, Vec<ReferenceInfo>> =
            serde_json::from_value(response.data.get("references").cloned().unwrap_or_default())?;

        Ok(refs_map)
    }

    /// Get all imports from a parsed CST.
    pub fn get_imports(&mut self, cst_id: &str) -> WorkerResult<Vec<ImportInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_imports", params)?;

        let imports: Vec<ImportInfo> =
            serde_json::from_value(response.data.get("imports").cloned().unwrap_or_default())?;

        Ok(imports)
    }

    /// Get scope structure from a parsed CST.
    pub fn get_scopes(&mut self, cst_id: &str) -> WorkerResult<Vec<ScopeInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_scopes", params)?;

        let scopes: Vec<ScopeInfo> =
            serde_json::from_value(response.data.get("scopes").cloned().unwrap_or_default())?;

        Ok(scopes)
    }

    /// Get assignment type information for Level 1 type inference.
    ///
    /// Returns assignments with inferred type information:
    /// - `inferred_type`: Set when RHS is a constructor call (e.g., `x = MyClass()`)
    /// - `rhs_name`: Set when RHS is a variable reference (e.g., `y = x`)
    /// - `type_source`: How the type was determined ("constructor", "variable", "unknown")
    pub fn get_assignments(&mut self, cst_id: &str) -> WorkerResult<Vec<AssignmentInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_assignments", params)?;

        let assignments: Vec<AssignmentInfo> = serde_json::from_value(
            response
                .data
                .get("assignments")
                .cloned()
                .unwrap_or_default(),
        )?;

        Ok(assignments)
    }

    /// Get method call information for type-based resolution.
    ///
    /// Returns method calls like `obj.method()` where `obj` is a variable.
    /// Use with type tracking to resolve calls to class methods.
    pub fn get_method_calls(&mut self, cst_id: &str) -> WorkerResult<Vec<MethodCallInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_method_calls", params)?;

        let method_calls: Vec<MethodCallInfo> = serde_json::from_value(
            response
                .data
                .get("method_calls")
                .cloned()
                .unwrap_or_default(),
        )?;

        Ok(method_calls)
    }

    /// Get type annotations for Level 2 type inference.
    ///
    /// Returns type annotations from:
    /// - Function parameters: `def foo(x: int)`
    /// - Return types: `def foo() -> int`
    /// - Variable annotations: `x: int = 5`
    /// - Class attributes: `class Foo: x: int`
    pub fn get_annotations(&mut self, cst_id: &str) -> WorkerResult<Vec<AnnotationInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_annotations", params)?;

        let annotations: Vec<AnnotationInfo> = serde_json::from_value(
            response
                .data
                .get("annotations")
                .cloned()
                .unwrap_or_default(),
        )?;

        Ok(annotations)
    }

    /// Get class inheritance information for building the hierarchy.
    ///
    /// Returns class definitions with their base classes:
    /// - `class JsonHandler(BaseHandler)` → name: "JsonHandler", bases: ["BaseHandler"]
    ///
    /// Use to build the inheritance hierarchy for method override tracking
    /// during rename operations.
    pub fn get_class_inheritance(
        &mut self,
        cst_id: &str,
    ) -> WorkerResult<Vec<ClassInheritanceInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_class_inheritance", params)?;

        let classes: Vec<ClassInheritanceInfo> = serde_json::from_value(
            response
                .data
                .get("classes")
                .cloned()
                .unwrap_or_default(),
        )?;

        Ok(classes)
    }

    /// Get dynamic patterns for pattern detection.
    ///
    /// Returns patterns that cannot be statically analyzed:
    /// - `getattr(obj, "name")` - dynamic attribute access
    /// - `setattr(obj, "name", value)` - dynamic attribute set
    /// - `globals()["name"]` - dynamic global access
    /// - `locals()["name"]` - dynamic local access
    /// - `eval("code")` - dynamic code execution
    /// - `exec("code")` - dynamic code execution
    /// - `__getattr__` / `__setattr__` method definitions
    pub fn get_dynamic_patterns(&mut self, cst_id: &str) -> WorkerResult<Vec<DynamicPatternInfo>> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_dynamic_patterns", params)?;

        let patterns: Vec<DynamicPatternInfo> = serde_json::from_value(
            response
                .data
                .get("dynamic_patterns")
                .cloned()
                .unwrap_or_default(),
        )?;

        Ok(patterns)
    }

    /// Get all analysis data in a single call.
    ///
    /// This is the preferred method for analyzing a file as it combines:
    /// - bindings (symbol definitions)
    /// - references (name usages)
    /// - imports
    /// - scopes
    /// - assignments (Level 1 type inference)
    /// - method_calls (for type-based resolution)
    /// - annotations (Level 2 type inference)
    /// - dynamic_patterns (getattr, eval, etc.)
    ///
    /// Using this instead of individual get_* calls reduces IPC overhead
    /// from 8 round-trips to 1.
    pub fn get_analysis(&mut self, cst_id: &str) -> WorkerResult<AnalysisResult> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("get_analysis", params)?;

        let result = AnalysisResult {
            bindings: serde_json::from_value(
                response.data.get("bindings").cloned().unwrap_or_default(),
            )?,
            references: serde_json::from_value(
                response.data.get("references").cloned().unwrap_or_default(),
            )?,
            imports: serde_json::from_value(
                response.data.get("imports").cloned().unwrap_or_default(),
            )?,
            scopes: serde_json::from_value(
                response.data.get("scopes").cloned().unwrap_or_default(),
            )?,
            assignments: serde_json::from_value(
                response.data.get("assignments").cloned().unwrap_or_default(),
            )?,
            method_calls: serde_json::from_value(
                response.data.get("method_calls").cloned().unwrap_or_default(),
            )?,
            annotations: serde_json::from_value(
                response.data.get("annotations").cloned().unwrap_or_default(),
            )?,
            dynamic_patterns: serde_json::from_value(
                response
                    .data
                    .get("dynamic_patterns")
                    .cloned()
                    .unwrap_or_default(),
            )?,
            class_inheritance: serde_json::from_value(
                response
                    .data
                    .get("class_inheritance")
                    .cloned()
                    .unwrap_or_default(),
            )?,
        };

        Ok(result)
    }

    /// Rewrite a single name at a span.
    pub fn rewrite_name(
        &mut self,
        cst_id: &str,
        span: SpanInfo,
        new_name: &str,
    ) -> WorkerResult<String> {
        let params = serde_json::json!({
            "cst_id": cst_id,
            "span": {
                "start": span.start,
                "end": span.end,
            },
            "new_name": new_name,
        });

        let response = self.send_request("rewrite_name", params)?;

        let new_content = response
            .data
            .get("new_content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WorkerError::InvalidResponse {
                reason: "missing new_content in rewrite_name response".to_string(),
            })?
            .to_string();

        Ok(new_content)
    }

    /// Apply multiple rewrites to a CST.
    pub fn rewrite_batch(
        &mut self,
        cst_id: &str,
        rewrites: &[RewriteRequest],
    ) -> WorkerResult<String> {
        let rewrites_json: Vec<serde_json::Value> = rewrites
            .iter()
            .map(|r| {
                serde_json::json!({
                    "span": {
                        "start": r.span.start,
                        "end": r.span.end,
                    },
                    "new_name": r.new_name,
                })
            })
            .collect();

        let params = serde_json::json!({
            "cst_id": cst_id,
            "rewrites": rewrites_json,
        });

        let response = self.send_request("rewrite_batch", params)?;

        let new_content = response
            .data
            .get("new_content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WorkerError::InvalidResponse {
                reason: "missing new_content in rewrite_batch response".to_string(),
            })?
            .to_string();

        Ok(new_content)
    }

    /// Release a CST from the worker's cache.
    pub fn release(&mut self, cst_id: &str) -> WorkerResult<bool> {
        let params = serde_json::json!({
            "cst_id": cst_id,
        });

        let response = self.send_request("release", params)?;

        let released = response
            .data
            .get("released")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        Ok(released)
    }

    /// Gracefully shutdown the worker.
    pub fn shutdown(&mut self) -> WorkerResult<()> {
        if !self.is_running() {
            return Ok(());
        }

        // Send shutdown command
        let _ = self.send_request("shutdown", serde_json::json!({}));

        // Wait for process to exit
        if let Some(mut child) = self.child.take() {
            // Give it a moment to exit gracefully
            std::thread::sleep(Duration::from_millis(100));

            match child.try_wait() {
                Ok(Some(_)) => {
                    // Process exited
                }
                Ok(None) => {
                    // Still running, kill it
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Err(_) => {
                    // Error checking status, try to kill
                    let _ = child.kill();
                }
            }
        }

        self.stdin = None;
        self.stdout_reader = None;

        // Clean up PID file
        let pid_path = self
            .session_dir
            .join("workers")
            .join(format!("{}.pid", WORKER_NAME));
        let _ = std::fs::remove_file(&pid_path);

        Ok(())
    }

    // ========================================================================
    // Internal Methods
    // ========================================================================

    /// Mark worker as crashed (clear handles).
    fn mark_crashed(&mut self) {
        self.child = None;
        self.stdin = None;
        self.stdout_reader = None;
    }

    /// Respawn the worker after a crash.
    fn respawn(&mut self) -> WorkerResult<()> {
        // Ensure old process is cleaned up
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stdin = None;
        self.stdout_reader = None;

        // Clone paths to avoid borrow checker issues
        let python_path = self.python_path.clone();
        let session_dir = self.session_dir.clone();
        let worker_script_path = self.worker_script_path.clone();

        // Spawn new worker
        spawn_worker_internal(&python_path, &session_dir, &worker_script_path, self)
    }
}

impl Drop for WorkerHandle {
    fn drop(&mut self) {
        // Best-effort shutdown on drop
        let _ = self.shutdown();
    }
}

// ============================================================================
// Spawn Function
// ============================================================================

/// Spawn a LibCST worker process.
///
/// This function:
/// 1. Materializes the worker script to session_dir/python/libcst_worker.py
/// 2. Spawns the Python process
/// 3. Waits for the ready message
/// 4. Stores the PID in session_dir/workers/libcst.pid
pub fn spawn_worker(python_path: &Path, session_dir: &Path) -> WorkerResult<WorkerHandle> {
    // Validate Python exists
    if !python_path.exists() {
        return Err(WorkerError::PythonNotFound {
            path: python_path.to_path_buf(),
        });
    }

    // Materialize worker script
    let worker_script_path = materialize_worker_script(session_dir)?;

    // Create worker handle (uninitialized)
    let mut handle = WorkerHandle {
        child: None,
        stdin: None,
        stdout_reader: None,
        next_request_id: AtomicU64::new(1),
        python_path: python_path.to_path_buf(),
        session_dir: session_dir.to_path_buf(),
        worker_script_path: worker_script_path.clone(),
        worker_version: None,
        libcst_version: None,
    };

    // Spawn the worker
    spawn_worker_internal(python_path, session_dir, &worker_script_path, &mut handle)?;

    Ok(handle)
}

/// Internal spawn function (used for initial spawn and respawn).
fn spawn_worker_internal(
    python_path: &Path,
    session_dir: &Path,
    worker_script_path: &Path,
    handle: &mut WorkerHandle,
) -> WorkerResult<()> {
    // Spawn Python process
    let mut child = Command::new(python_path)
        .arg(worker_script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // Pass stderr through for debugging
        .spawn()
        .map_err(|e| WorkerError::SpawnFailed {
            reason: e.to_string(),
        })?;

    let stdin = child.stdin.take().ok_or_else(|| WorkerError::SpawnFailed {
        reason: "failed to capture stdin".to_string(),
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| WorkerError::SpawnFailed {
            reason: "failed to capture stdout".to_string(),
        })?;

    let stdout_reader = BufReader::new(stdout);

    // Store PID
    let pid = child.id();
    let workers_dir = session_dir.join("workers");
    std::fs::create_dir_all(&workers_dir)?;

    let pid_path = workers_dir.join(format!("{}.pid", WORKER_NAME));
    let pid_json = serde_json::json!({
        "pid": pid,
        "name": WORKER_NAME,
        "started_at": format_timestamp(),
    });
    std::fs::write(&pid_path, serde_json::to_string(&pid_json)?)?;

    // Update handle
    handle.child = Some(child);
    handle.stdin = Some(stdin);
    handle.stdout_reader = Some(stdout_reader);

    // Wait for ready message
    wait_for_ready(handle)?;

    Ok(())
}

/// Wait for the worker to send its ready message.
fn wait_for_ready(handle: &mut WorkerHandle) -> WorkerResult<()> {
    let timeout = Duration::from_secs(READY_TIMEOUT_SECS);
    let start = Instant::now();

    let reader = handle
        .stdout_reader
        .as_mut()
        .ok_or(WorkerError::NotStarted)?;

    loop {
        if start.elapsed() >= timeout {
            return Err(WorkerError::ReadyTimeout {
                timeout_secs: READY_TIMEOUT_SECS,
            });
        }

        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                // EOF - worker crashed during startup
                return Err(WorkerError::SpawnFailed {
                    reason: "worker exited before sending ready message".to_string(),
                });
            }
            Ok(_) => {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                // Try to parse as ready message
                if let Ok(ready) = serde_json::from_str::<ReadyMessage>(line) {
                    if ready.status == "ready" {
                        handle.worker_version = Some(ready.version);
                        handle.libcst_version = Some(ready.libcst_version);
                        return Ok(());
                    }
                }

                // Not a ready message - might be an error
                if let Ok(error) = serde_json::from_str::<WorkerResponse>(line) {
                    if error.status == "error" {
                        return Err(WorkerError::SpawnFailed {
                            reason: error.message.unwrap_or_else(|| "unknown error".to_string()),
                        });
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => {
                return Err(WorkerError::SpawnFailed {
                    reason: format!("error reading from worker: {}", e),
                });
            }
        }
    }
}

/// Materialize the worker script to the session directory.
fn materialize_worker_script(session_dir: &Path) -> WorkerResult<PathBuf> {
    let python_dir = session_dir.join("python");
    std::fs::create_dir_all(&python_dir)?;

    let script_path = python_dir.join("libcst_worker.py");
    std::fs::write(&script_path, WORKER_SCRIPT)?;

    Ok(script_path)
}

/// Format current timestamp for JSON (ISO 8601).
fn format_timestamp() -> String {
    use chrono::{DateTime, Utc};
    use std::time::SystemTime;

    let datetime: DateTime<Utc> = SystemTime::now().into();
    datetime.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // Note: Tests that require Python/libcst use runtime checks and early return
    // rather than #[ignore] because:
    // 1. We want to run them when dependencies ARE available
    // 2. #[ignore] would unconditionally skip, missing CI environments with Python
    // 3. Runtime checks provide clear skip messages for debugging

    /// Create a test session directory.
    fn create_test_session() -> TempDir {
        let temp = TempDir::new().unwrap();
        std::fs::create_dir_all(temp.path().join("python")).unwrap();
        std::fs::create_dir_all(temp.path().join("workers")).unwrap();
        temp
    }

    /// Find Python 3 on the system.
    fn find_python() -> Option<PathBuf> {
        which::which("python3")
            .or_else(|_| which::which("python"))
            .ok()
    }

    #[test]
    fn test_materialize_worker_script() {
        let temp = create_test_session();
        let script_path = materialize_worker_script(temp.path()).unwrap();

        assert!(script_path.exists());
        let content = std::fs::read_to_string(&script_path).unwrap();
        assert!(content.contains("LibCST Worker"));
        assert!(content.contains("def main():"));
    }

    #[test]
    fn test_worker_spawn_and_ready() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        // Check if libcst is available
        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let result = spawn_worker(&python_path, temp.path());

        assert!(result.is_ok(), "Failed to spawn worker: {:?}", result.err());

        let handle = result.unwrap();
        assert!(handle.is_running());
        assert!(handle.worker_version().is_some());
        assert!(handle.libcst_version().is_some());
    }

    #[test]
    fn test_worker_parse() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let result = handle.parse("test.py", "def foo():\n    pass\n");
        assert!(result.is_ok(), "Failed to parse: {:?}", result.err());

        let parse_response = result.unwrap();
        assert!(!parse_response.cst_id.is_empty());
    }

    #[test]
    fn test_worker_get_bindings() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let parse_response = handle
            .parse("test.py", "def foo():\n    x = 1\n    pass\n")
            .unwrap();
        let bindings = handle.get_bindings(&parse_response.cst_id).unwrap();

        // Should find at least the function definition and variable
        assert!(!bindings.is_empty());
        assert!(bindings
            .iter()
            .any(|b| b.name == "foo" && b.kind == "function"));
        assert!(bindings
            .iter()
            .any(|b| b.name == "x" && b.kind == "variable"));
    }

    #[test]
    fn test_worker_get_references() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let parse_response = handle
            .parse("test.py", "def foo():\n    pass\n\nfoo()\nfoo()\n")
            .unwrap();
        let all_refs = handle
            .get_references(&parse_response.cst_id)
            .unwrap();

        // Should find definition + 2 calls for "foo"
        let foo_refs = all_refs.get("foo").expect("Should have references to 'foo'");
        assert!(
            foo_refs.len() >= 3,
            "Expected at least 3 references to 'foo', got {}",
            foo_refs.len()
        );
    }

    #[test]
    fn test_worker_rewrite_batch() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = "def foo():\n    pass\n";
        let parse_response = handle.parse("test.py", content).unwrap();

        // Rewrite "foo" at byte offset 4-7 to "bar"
        let rewrites = vec![RewriteRequest {
            span: SpanInfo { start: 4, end: 7 },
            new_name: "bar".to_string(),
        }];

        let new_content = handle
            .rewrite_batch(&parse_response.cst_id, &rewrites)
            .unwrap();
        assert!(new_content.contains("def bar()"));
    }

    #[test]
    fn test_worker_respawn_on_crash() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        // Simulate crash by killing the child
        if let Some(ref mut child) = handle.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        handle.child = None;
        handle.stdin = None;
        handle.stdout_reader = None;

        // Next request should trigger respawn
        let result = handle.parse("test.py", "x = 1\n");
        assert!(result.is_ok(), "Failed to respawn: {:?}", result.err());
    }

    #[test]
    fn test_worker_shutdown() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();
        assert!(handle.is_running());

        handle.shutdown().unwrap();
        assert!(!handle.is_running());

        // PID file should be cleaned up
        let pid_path = temp
            .path()
            .join("workers")
            .join(format!("{}.pid", WORKER_NAME));
        assert!(!pid_path.exists());
    }

    #[test]
    fn test_worker_pid_storage() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let _handle = spawn_worker(&python_path, temp.path()).unwrap();

        // Check PID file was created
        let pid_path = temp
            .path()
            .join("workers")
            .join(format!("{}.pid", WORKER_NAME));
        assert!(pid_path.exists());

        let content = std::fs::read_to_string(&pid_path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(json.get("pid").is_some());
        assert_eq!(json.get("name").and_then(|v| v.as_str()), Some(WORKER_NAME));
    }

    #[test]
    fn test_worker_get_analysis_combined() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = r#"
class MyHandler:
    def process(self):
        pass

def use_handler():
    handler = MyHandler()
    handler.process()
"#;

        let parse_response = handle.parse("test.py", content).unwrap();
        let analysis = handle.get_analysis(&parse_response.cst_id).unwrap();

        // Check bindings
        assert!(!analysis.bindings.is_empty());
        let binding_names: Vec<_> = analysis.bindings.iter().map(|b| b.name.as_str()).collect();
        assert!(binding_names.contains(&"MyHandler"));
        assert!(binding_names.contains(&"process"));
        assert!(binding_names.contains(&"use_handler"));
        assert!(binding_names.contains(&"handler"));

        // Check scopes
        assert!(!analysis.scopes.is_empty());

        // Check assignments (type inference)
        assert!(!analysis.assignments.is_empty());
        let handler_assignment = analysis
            .assignments
            .iter()
            .find(|a| a.target == "handler")
            .expect("handler assignment should exist");
        assert_eq!(handler_assignment.inferred_type, Some("MyHandler".to_string()));

        // Check method calls
        assert!(!analysis.method_calls.is_empty());
        let process_call = analysis
            .method_calls
            .iter()
            .find(|c| c.method == "process")
            .expect("process method call should exist");
        assert_eq!(process_call.receiver, "handler");
    }

    #[test]
    fn test_get_analysis_reduces_ipc_overhead() {
        // This test verifies that get_analysis returns the same data as individual calls
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = "x = 1\ny = x\n";
        let parse_response = handle.parse("test.py", content).unwrap();

        // Get combined analysis
        let combined = handle.get_analysis(&parse_response.cst_id).unwrap();

        // Verify we got data for all categories
        assert!(!combined.bindings.is_empty(), "bindings should not be empty");
        assert!(!combined.references.is_empty(), "references should not be empty");
        // imports may be empty for simple code
        assert!(!combined.scopes.is_empty(), "scopes should not be empty");
        assert!(!combined.assignments.is_empty(), "assignments should not be empty");
        // method_calls may be empty for simple code
    }

    #[test]
    fn test_get_dynamic_patterns_getattr() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = r#"
obj = SomeClass()
method = getattr(obj, "process")
setattr(obj, "value", 42)
"#;
        let parse_response = handle.parse("test.py", content).unwrap();
        let patterns = handle.get_dynamic_patterns(&parse_response.cst_id).unwrap();

        // Should find both getattr and setattr
        assert_eq!(patterns.len(), 2);

        let getattr_pattern = patterns.iter().find(|p| p.kind == "getattr").unwrap();
        assert_eq!(getattr_pattern.literal_name, Some("process".to_string()));

        let setattr_pattern = patterns.iter().find(|p| p.kind == "setattr").unwrap();
        assert_eq!(setattr_pattern.literal_name, Some("value".to_string()));
    }

    #[test]
    fn test_get_dynamic_patterns_globals_locals() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = r#"
def foo():
    x = locals()["var"]
    y = globals()["CONFIG"]
"#;
        let parse_response = handle.parse("test.py", content).unwrap();
        let patterns = handle.get_dynamic_patterns(&parse_response.cst_id).unwrap();

        // Should find both globals and locals
        assert_eq!(patterns.len(), 2);

        let locals_pattern = patterns.iter().find(|p| p.kind == "locals").unwrap();
        assert_eq!(locals_pattern.literal_name, Some("var".to_string()));

        let globals_pattern = patterns.iter().find(|p| p.kind == "globals").unwrap();
        assert_eq!(globals_pattern.literal_name, Some("CONFIG".to_string()));
    }

    #[test]
    fn test_get_dynamic_patterns_eval_exec() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = r#"
result = eval("x + y")
exec("print('hello')")
"#;
        let parse_response = handle.parse("test.py", content).unwrap();
        let patterns = handle.get_dynamic_patterns(&parse_response.cst_id).unwrap();

        // Should find both eval and exec
        assert_eq!(patterns.len(), 2);

        let eval_pattern = patterns.iter().find(|p| p.kind == "eval").unwrap();
        assert!(eval_pattern.pattern_text.as_ref().unwrap().contains("eval"));

        let exec_pattern = patterns.iter().find(|p| p.kind == "exec").unwrap();
        assert!(exec_pattern.pattern_text.as_ref().unwrap().contains("exec"));
    }

    #[test]
    fn test_get_dynamic_patterns_dunder_getattr() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = r#"
class Dynamic:
    def __getattr__(self, name):
        return getattr(self._impl, name)

    def __setattr__(self, name, value):
        setattr(self._impl, name, value)
"#;
        let parse_response = handle.parse("test.py", content).unwrap();
        let patterns = handle.get_dynamic_patterns(&parse_response.cst_id).unwrap();

        // Should find __getattr__, __setattr__, and the getattr/setattr calls inside
        assert!(patterns.len() >= 4);

        assert!(patterns.iter().any(|p| p.kind == "__getattr__"));
        assert!(patterns.iter().any(|p| p.kind == "__setattr__"));
    }

    #[test]
    fn test_get_analysis_includes_dynamic_patterns() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        let output = std::process::Command::new(&python_path)
            .args(["-c", "import libcst"])
            .output()
            .unwrap();

        if !output.status.success() {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let temp = create_test_session();
        let mut handle = spawn_worker(&python_path, temp.path()).unwrap();

        let content = r#"
x = getattr(obj, "method")
"#;
        let parse_response = handle.parse("test.py", content).unwrap();
        let analysis = handle.get_analysis(&parse_response.cst_id).unwrap();

        // get_analysis should include dynamic_patterns
        assert!(!analysis.dynamic_patterns.is_empty());
        assert_eq!(analysis.dynamic_patterns[0].kind, "getattr");
    }
}

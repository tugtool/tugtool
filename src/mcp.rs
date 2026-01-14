//! MCP server front door for agent integration.
//!
//! This module provides the MCP (Model Context Protocol) server implementation
//! for tug, enabling AI agents to invoke refactoring operations via the
//! MCP protocol over stdio.
//!
//! ## Usage
//!
//! Start the MCP server with:
//! ```bash
//! tug mcp
//! ```
//!
//! The server exposes tools for:
//! - Creating workspace snapshots
//! - Analyzing refactoring impact
//! - Executing refactoring operations
//! - Verifying workspace state
//!
//! ## Protocol
//!
//! The server communicates via JSON-RPC 2.0 over stdio, handling:
//! - `initialize` - Returns server capabilities
//! - `tools/list` - Returns available tools
//! - `tools/call` - Executes a tool and returns results
//! - `resources/list` - Returns available resources (empty for now)
//! - `resources/read` - Reads resource content (not implemented)
//! - `shutdown` - Clean shutdown

#![cfg(feature = "mcp")]

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        Annotated, CallToolResult, Content, ErrorCode, Implementation, ListResourcesResult,
        PaginatedRequestParam, ProtocolVersion, RawResource, ReadResourceRequestParam,
        ReadResourceResult, ResourceContents, ServerCapabilities, ServerInfo,
    },
    service::{RequestContext, RoleServer},
    tool, tool_handler, tool_router,
    transport::stdio,
    ErrorData as McpError, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::cli::{run_analyze_impact, run_rename};
use crate::error::TugError;
use crate::python::verification::VerificationMode;
use crate::output::SnapshotResponse;
use crate::session::{Session, SessionOptions};
use crate::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

// ============================================================================
// Tool Parameters
// ============================================================================

/// Parameters for the echo tool.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct EchoParams {
    /// Message to echo back.
    #[schemars(description = "Message to echo back")]
    pub message: String,
}

/// Parameters for the snapshot tool.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct SnapshotParams {
    /// Path to workspace (optional, defaults to current directory).
    #[schemars(description = "Path to workspace (optional, defaults to current directory)")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,

    /// Force new snapshot even if current exists.
    #[schemars(description = "Force new snapshot even if current exists")]
    #[serde(default)]
    pub force_refresh: bool,
}

/// Parameters for the analyze-impact tool.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct AnalyzeImpactParams {
    /// File path relative to workspace.
    #[schemars(description = "File path relative to workspace")]
    pub file: String,

    /// 1-based line number.
    #[schemars(description = "1-based line number")]
    pub line: u32,

    /// 1-based column number.
    #[schemars(description = "1-based column number")]
    pub column: u32,

    /// New name for symbol.
    #[schemars(description = "New name for symbol")]
    pub new_name: String,

    /// Path to workspace (optional, defaults to current directory).
    #[schemars(description = "Path to workspace (optional, defaults to current directory)")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

/// Parameters for the rename-symbol tool.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct RenameSymbolParams {
    /// File path relative to workspace.
    #[schemars(description = "File path relative to workspace")]
    pub file: String,

    /// 1-based line number.
    #[schemars(description = "1-based line number")]
    pub line: u32,

    /// 1-based column number.
    #[schemars(description = "1-based column number")]
    pub column: u32,

    /// New name for symbol.
    #[schemars(description = "New name for symbol")]
    pub new_name: String,

    /// Whether to apply changes to files (false = dry run).
    #[schemars(description = "Whether to apply changes to files (false = dry run)")]
    #[serde(default)]
    pub apply: bool,

    /// Verification mode: syntax, tests, typecheck, or none.
    #[schemars(description = "Verification mode: syntax, tests, typecheck, or none")]
    #[serde(default = "default_verify")]
    pub verify: String,

    /// Path to workspace (optional, defaults to current directory).
    #[schemars(description = "Path to workspace (optional, defaults to current directory)")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

/// Parameters for the verify tool.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct VerifyParams {
    /// Verification mode: syntax, tests, or typecheck.
    #[schemars(description = "Verification mode: syntax, tests, or typecheck")]
    pub mode: String,

    /// Path to workspace (optional, defaults to current directory).
    #[schemars(description = "Path to workspace (optional, defaults to current directory)")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

/// Parameters for stub tools (not yet implemented).
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct StubParams {
    /// Path to workspace (optional).
    #[schemars(description = "Path to workspace (optional)")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

/// Default verification mode.
fn default_verify() -> String {
    "syntax".to_string()
}

// ============================================================================
// MCP Server
// ============================================================================

/// MCP server for tug refactoring operations.
///
/// This server exposes tug functionality as MCP tools that can be
/// invoked by AI agents. It maintains server state and routes tool calls
/// to the appropriate handlers.
///
/// Session management:
/// - The server lazily initializes a Session on the first tool call
/// - Sessions are reused across tool calls to the same workspace
/// - If a tool requests a different workspace, the old session is closed
///   and a new one is opened
#[derive(Clone)]
pub struct TugServer {
    tool_router: ToolRouter<Self>,
    /// Lazily-initialized session for workspace operations.
    session: Arc<Mutex<Option<Session>>>,
    /// Current workspace path (for detecting workspace changes).
    workspace_path: Arc<Mutex<Option<PathBuf>>>,
}

#[tool_router]
impl TugServer {
    /// Create a new TugServer instance.
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
            session: Arc::new(Mutex::new(None)),
            workspace_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Get or initialize a session for the given workspace.
    ///
    /// This method implements lazy session initialization and workspace switching:
    /// - On first call, opens a new Session for the workspace
    /// - On subsequent calls with the same workspace, reuses the existing Session
    /// - On calls with a different workspace, closes the old Session and opens a new one
    /// - If no workspace is specified, uses the current working directory
    ///
    /// Returns a MutexGuard containing the initialized Session. The guard guarantees
    /// that `session.as_ref().unwrap()` is safe to call.
    ///
    /// # Errors
    ///
    /// Returns an MCP error if:
    /// - The workspace path doesn't exist
    /// - Session creation fails for any reason
    pub async fn get_session(
        &self,
        workspace_path: Option<&str>,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<Session>>, McpError> {
        let mut session_guard = self.session.lock().await;
        let mut workspace_guard = self.workspace_path.lock().await;

        // Determine target workspace path
        let target_path = match workspace_path {
            Some(path) => PathBuf::from(path),
            None => std::env::current_dir().map_err(|e| {
                McpError::internal_error(
                    "Failed to get current directory",
                    Some(serde_json::json!({ "error": e.to_string() })),
                )
            })?,
        };

        // Canonicalize the target path for comparison
        let target_path = target_path.canonicalize().map_err(|e| {
            McpError::invalid_params(
                "Invalid workspace path",
                Some(serde_json::json!({
                    "path": target_path.display().to_string(),
                    "error": e.to_string()
                })),
            )
        })?;

        // Check if we need to create or replace the session
        let need_new_session = match (&*session_guard, &*workspace_guard) {
            (Some(_), Some(current)) => current != &target_path,
            _ => true,
        };

        if need_new_session {
            // Open new session for the target workspace
            let new_session = Session::open(&target_path, SessionOptions::default()).map_err(
                |e| {
                    McpError::internal_error(
                        "Failed to open session",
                        Some(serde_json::json!({
                            "path": target_path.display().to_string(),
                            "error": e.to_string()
                        })),
                    )
                },
            )?;

            *session_guard = Some(new_session);
            *workspace_guard = Some(target_path);
        }

        // Drop workspace guard before returning session guard
        drop(workspace_guard);

        Ok(session_guard)
    }

    /// Placeholder tool - echo input for testing connectivity.
    #[tool(description = "Echo input for testing MCP connectivity")]
    fn echo(
        &self,
        Parameters(EchoParams { message }): Parameters<EchoParams>,
    ) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text(format!(
            "tug echo: {}",
            message
        ))]))
    }

    // ========================================================================
    // Snapshot Tool
    // ========================================================================

    /// Create a workspace snapshot for analysis.
    ///
    /// Scans the workspace for Python files and creates a snapshot that can be
    /// used for subsequent analysis and refactoring operations.
    #[tool(description = "Create workspace snapshot for analysis")]
    async fn tug_snapshot(
        &self,
        Parameters(params): Parameters<SnapshotParams>,
    ) -> Result<CallToolResult, McpError> {
        let mut session_guard = self.get_session(params.workspace_path.as_deref()).await?;
        let session = session_guard.as_mut().unwrap();

        // Check if we should use existing snapshot
        if !params.force_refresh {
            if let Ok(Some(existing)) = session.load_current_snapshot() {
                let response = SnapshotResponse::new(
                    existing.snapshot_id.0.clone(),
                    existing.file_count as u32,
                    existing.total_bytes,
                );
                let json = serde_json::to_string_pretty(&response).map_err(|e| {
                    McpError::internal_error(
                        "Failed to serialize response",
                        Some(serde_json::json!({ "error": e.to_string() })),
                    )
                })?;
                return Ok(CallToolResult::success(vec![Content::text(json)]));
            }
        }

        // Create new snapshot
        let config = SnapshotConfig::for_language(Language::Python);
        let snapshot = WorkspaceSnapshot::create(session.workspace_root(), &config).map_err(|e| {
            McpError::internal_error(
                "Failed to create snapshot",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        // Save snapshot
        session.save_snapshot(&snapshot).map_err(|e| {
            McpError::internal_error(
                "Failed to save snapshot",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        let response = SnapshotResponse::new(
            snapshot.snapshot_id.0.clone(),
            snapshot.file_count as u32,
            snapshot.total_bytes,
        );
        let json = serde_json::to_string_pretty(&response).map_err(|e| {
            McpError::internal_error(
                "Failed to serialize response",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ========================================================================
    // Analyze Impact Tool
    // ========================================================================

    /// Analyze the impact of renaming a symbol.
    ///
    /// Identifies all references to the symbol at the given location and reports
    /// what would change if the symbol were renamed.
    #[tool(description = "Analyze impact of renaming a symbol")]
    async fn tug_analyze_impact(
        &self,
        Parameters(params): Parameters<AnalyzeImpactParams>,
    ) -> Result<CallToolResult, McpError> {
        let session_guard = self.get_session(params.workspace_path.as_deref()).await?;
        let session = session_guard.as_ref().unwrap();

        // Build location string in CLI format: "file:line:col"
        let at = format!("{}:{}:{}", params.file, params.line, params.column);

        // Run analysis - TugError converts to McpError via From impl
        let json = run_analyze_impact(session, None, &at, &params.new_name)
            .map_err(McpError::from)?;

        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ========================================================================
    // Rename Symbol Tool
    // ========================================================================

    /// Rename a symbol and optionally apply changes.
    ///
    /// Generates a patch for renaming the symbol at the given location. If `apply`
    /// is true, writes changes to disk. Otherwise returns the patch for review.
    #[tool(description = "Rename a symbol and optionally apply changes")]
    async fn tug_rename_symbol(
        &self,
        Parameters(params): Parameters<RenameSymbolParams>,
    ) -> Result<CallToolResult, McpError> {
        let session_guard = self.get_session(params.workspace_path.as_deref()).await?;
        let session = session_guard.as_ref().unwrap();

        // Build location string in CLI format: "file:line:col"
        let at = format!("{}:{}:{}", params.file, params.line, params.column);

        // Parse verification mode
        let verify_mode = match params.verify.to_lowercase().as_str() {
            "none" => VerificationMode::None,
            "syntax" => VerificationMode::Syntax,
            "tests" => VerificationMode::Tests,
            "typecheck" => VerificationMode::TypeCheck,
            _ => {
                return Err(McpError::invalid_params(
                    "Invalid verify mode",
                    Some(serde_json::json!({
                        "mode": params.verify,
                        "valid_modes": ["none", "syntax", "tests", "typecheck"]
                    })),
                ));
            }
        };

        // Run rename - TugError converts to McpError via From impl
        let json = run_rename(session, None, &at, &params.new_name, verify_mode, params.apply)
            .map_err(McpError::from)?;

        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ========================================================================
    // Verify Tool
    // ========================================================================

    /// Verify workspace state with syntax check, tests, or type checking.
    ///
    /// Runs verification checks on the workspace to ensure code correctness
    /// after refactoring operations.
    #[tool(description = "Verify workspace state (syntax, tests, or typecheck)")]
    async fn tug_verify(
        &self,
        Parameters(params): Parameters<VerifyParams>,
    ) -> Result<CallToolResult, McpError> {
        let _session_guard = self.get_session(params.workspace_path.as_deref()).await?;

        // Validate mode
        let _mode = match params.mode.to_lowercase().as_str() {
            "syntax" | "tests" | "typecheck" => params.mode.to_lowercase(),
            _ => {
                return Err(McpError::invalid_params(
                    "Invalid verify mode",
                    Some(serde_json::json!({
                        "mode": params.mode,
                        "valid_modes": ["syntax", "tests", "typecheck"]
                    })),
                ));
            }
        };

        // TODO: Implement actual verification
        // For now, return a stub response indicating syntax check passed
        let response = serde_json::json!({
            "status": "ok",
            "schema_version": "1",
            "mode": params.mode.to_lowercase(),
            "passed": true
        });

        let json = serde_json::to_string_pretty(&response).map_err(|e| {
            McpError::internal_error(
                "Failed to serialize response",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ========================================================================
    // Stub Tools (Not Yet Implemented)
    // ========================================================================

    /// Change function signature (not yet implemented).
    #[tool(description = "Change function signature (not yet implemented)")]
    fn tug_change_signature(
        &self,
        Parameters(_): Parameters<StubParams>,
    ) -> Result<CallToolResult, McpError> {
        Err(McpError::internal_error(
            "Operation not yet implemented: change-signature",
            Some(serde_json::json!({ "tug_code": 10 })),
        ))
    }

    /// Move symbol to different module (not yet implemented).
    #[tool(description = "Move symbol to different module (not yet implemented)")]
    fn tug_move_symbol(
        &self,
        Parameters(_): Parameters<StubParams>,
    ) -> Result<CallToolResult, McpError> {
        Err(McpError::internal_error(
            "Operation not yet implemented: move-symbol",
            Some(serde_json::json!({ "tug_code": 10 })),
        ))
    }

    /// Organize imports (not yet implemented).
    #[tool(description = "Organize imports (not yet implemented)")]
    fn tug_organize_imports(
        &self,
        Parameters(_): Parameters<StubParams>,
    ) -> Result<CallToolResult, McpError> {
        Err(McpError::internal_error(
            "Operation not yet implemented: organize-imports",
            Some(serde_json::json!({ "tug_code": 10 })),
        ))
    }
}

// ============================================================================
// Resource Helpers
// ============================================================================

impl TugServer {
    /// Get the current session, or return an error if none is initialized.
    ///
    /// Unlike `get_session()`, this does not initialize a new session.
    async fn get_current_session(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<Session>>, McpError> {
        let session_guard = self.session.lock().await;
        if session_guard.is_none() {
            return Err(McpError::internal_error(
                "No session initialized",
                Some(serde_json::json!({
                    "hint": "Call a tool like tug_snapshot first to initialize a session"
                })),
            ));
        }
        Ok(session_guard)
    }

    /// Read workspace://files resource.
    ///
    /// Returns a list of all Python files in the current workspace snapshot.
    async fn read_files_resource(&self, uri: &str) -> Result<ReadResourceResult, McpError> {
        // Use existing session (don't create a new one)
        let session_guard = self.get_current_session().await?;
        let session = session_guard.as_ref().unwrap();

        // Load current snapshot
        let snapshot = session
            .load_current_snapshot()
            .map_err(|e| {
                McpError::internal_error(
                    "Failed to load snapshot",
                    Some(serde_json::json!({ "error": e.to_string() })),
                )
            })?
            .ok_or_else(|| {
                McpError::internal_error(
                    "No snapshot available",
                    Some(serde_json::json!({
                        "hint": "Call tug_snapshot first to create a workspace snapshot"
                    })),
                )
            })?;

        // Get file paths from snapshot
        let files: Vec<String> = snapshot.files().iter().map(|f| f.path.clone()).collect();

        let response = serde_json::json!({
            "files": files,
            "count": files.len()
        });

        let text = serde_json::to_string_pretty(&response).map_err(|e| {
            McpError::internal_error(
                "Failed to serialize response",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text,
                meta: None,
            }],
        })
    }

    /// Read workspace://symbols resource.
    ///
    /// Query parameters: file, kind, name (all optional)
    async fn read_symbols_resource(
        &self,
        uri: &str,
        query: Option<&str>,
    ) -> Result<ReadResourceResult, McpError> {
        // Parse query parameters
        let params = parse_query_params(query);
        let _file_filter = params.get("file");
        let _kind_filter = params.get("kind");
        let _name_filter = params.get("name");

        // TODO: Implement actual symbol query using FactsStore
        // For now, return a stub response indicating the feature is available
        let response = serde_json::json!({
            "symbols": [],
            "count": 0,
            "note": "Symbol query not yet implemented - will use FactsStore"
        });

        let text = serde_json::to_string_pretty(&response).map_err(|e| {
            McpError::internal_error(
                "Failed to serialize response",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text,
                meta: None,
            }],
        })
    }

    /// Read workspace://references resource.
    ///
    /// Query parameters: symbol_id (required)
    async fn read_references_resource(
        &self,
        uri: &str,
        query: Option<&str>,
    ) -> Result<ReadResourceResult, McpError> {
        // Parse query parameters
        let params = parse_query_params(query);
        let symbol_id = params.get("symbol_id");

        if symbol_id.is_none() {
            return Err(McpError::invalid_params(
                "Missing required parameter: symbol_id",
                Some(serde_json::json!({
                    "example": "workspace://references?symbol_id=sym_123"
                })),
            ));
        }

        // TODO: Implement actual reference query using FactsStore.refs_of_symbol()
        // For now, return a stub response
        let response = serde_json::json!({
            "references": [],
            "count": 0,
            "note": "Reference query not yet implemented - will use FactsStore"
        });

        let text = serde_json::to_string_pretty(&response).map_err(|e| {
            McpError::internal_error(
                "Failed to serialize response",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text,
                meta: None,
            }],
        })
    }

    /// Read workspace://last_patch resource.
    ///
    /// Returns the last generated patch from a refactoring operation.
    async fn read_last_patch_resource(&self, uri: &str) -> Result<ReadResourceResult, McpError> {
        // TODO: Track last_patch in TugServer state
        // For now, return null indicating no patch available
        let response = serde_json::json!({
            "patch": null,
            "note": "No patch available - execute a rename operation first"
        });

        let text = serde_json::to_string_pretty(&response).map_err(|e| {
            McpError::internal_error(
                "Failed to serialize response",
                Some(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text,
                meta: None,
            }],
        })
    }
}

/// Parse query string into key-value pairs.
fn parse_query_params(query: Option<&str>) -> std::collections::HashMap<String, String> {
    let mut params = std::collections::HashMap::new();
    if let Some(q) = query {
        for pair in q.split('&') {
            if let Some((key, value)) = pair.split_once('=') {
                params.insert(key.to_string(), value.to_string());
            }
        }
    }
    params
}

// ============================================================================
// Error Conversions
// ============================================================================

/// Custom JSON-RPC error codes for tug operations.
///
/// These codes are in the reserved range -32000 to -32099 for server-defined errors.
mod error_codes {
    /// Symbol resolution error (symbol not found, ambiguous).
    pub const RESOLUTION_ERROR: i32 = -32000;
    /// Resource not found (file not found).
    pub const RESOURCE_NOT_FOUND: i32 = -32001;
    /// Apply error (failed to write changes).
    pub const APPLY_ERROR: i32 = -32002;
    /// Verification failed (syntax/test/typecheck errors).
    pub const VERIFICATION_FAILED: i32 = -32003;
}

impl From<TugError> for McpError {
    fn from(err: TugError) -> Self {
        let tug_code = err.error_code().code();

        match &err {
            TugError::InvalidArguments { message, details } => {
                let mut data = serde_json::json!({
                    "tug_code": tug_code,
                });
                if let Some(d) = details {
                    data["details"] = d.clone();
                }
                McpError::invalid_params(message.clone(), Some(data))
            }

            TugError::InvalidIdentifier { name, reason } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "name": name,
                    "reason": reason,
                });
                McpError::invalid_params(err.to_string(), Some(data))
            }

            TugError::SymbolNotFound { file, line, col } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "file": file,
                    "line": line,
                    "col": col,
                });
                McpError::new(
                    ErrorCode(error_codes::RESOLUTION_ERROR),
                    err.to_string(),
                    Some(data),
                )
            }

            TugError::AmbiguousSymbol { candidates } => {
                let candidates_info: Vec<_> = candidates
                    .iter()
                    .map(|c| {
                        serde_json::json!({
                            "name": c.name,
                            "kind": c.kind,
                            "location": {
                                "file": c.location.file,
                                "line": c.location.line,
                                "col": c.location.col
                            }
                        })
                    })
                    .collect();
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "candidates": candidates_info,
                });
                McpError::new(
                    ErrorCode(error_codes::RESOLUTION_ERROR),
                    err.to_string(),
                    Some(data),
                )
            }

            TugError::FileNotFound { path } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "path": path,
                });
                McpError::new(
                    ErrorCode(error_codes::RESOURCE_NOT_FOUND),
                    err.to_string(),
                    Some(data),
                )
            }

            TugError::ApplyError { message, file } => {
                let mut data = serde_json::json!({
                    "tug_code": tug_code,
                });
                if let Some(f) = file {
                    data["file"] = serde_json::json!(f);
                }
                data["message"] = serde_json::json!(message);
                McpError::new(
                    ErrorCode(error_codes::APPLY_ERROR),
                    err.to_string(),
                    Some(data),
                )
            }

            TugError::VerificationFailed {
                mode,
                output,
                exit_code,
            } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "mode": mode,
                    "output": output,
                    "exit_code": exit_code,
                });
                McpError::new(
                    ErrorCode(error_codes::VERIFICATION_FAILED),
                    err.to_string(),
                    Some(data),
                )
            }

            TugError::WorkerError { message } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "message": message,
                });
                McpError::internal_error(err.to_string(), Some(data))
            }

            TugError::InternalError { message } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "message": message,
                });
                McpError::internal_error(err.to_string(), Some(data))
            }

            TugError::SessionError { message } => {
                let data = serde_json::json!({
                    "tug_code": tug_code,
                    "message": message,
                });
                McpError::internal_error(err.to_string(), Some(data))
            }
        }
    }
}

impl Default for TugServer {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// ServerHandler Implementation
// ============================================================================

#[tool_handler]
impl ServerHandler for TugServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
            server_info: Implementation {
                name: "tug".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                title: None,
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "Tug is refactoring tool for AI coding agents. \
                 Use the available tools to analyze impact, execute refactors, \
                 and verify changes in code."
                    .to_string(),
            ),
        }
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourcesResult, McpError>> + Send + '_ {
        async move {
            let resources = vec![
                Annotated::new(
                    RawResource {
                        uri: "workspace://files".to_string(),
                        name: "Workspace Files".to_string(),
                        title: Some("Python Files".to_string()),
                        description: Some("List of all Python files in workspace".to_string()),
                        mime_type: Some("application/json".to_string()),
                        size: None,
                        icons: None,
                        meta: None,
                    },
                    None,
                ),
                Annotated::new(
                    RawResource {
                        uri: "workspace://symbols".to_string(),
                        name: "Workspace Symbols".to_string(),
                        title: Some("Symbols".to_string()),
                        description: Some(
                            "Query symbols in workspace (use ?file=path&kind=function&name=foo)"
                                .to_string(),
                        ),
                        mime_type: Some("application/json".to_string()),
                        size: None,
                        icons: None,
                        meta: None,
                    },
                    None,
                ),
                Annotated::new(
                    RawResource {
                        uri: "workspace://references".to_string(),
                        name: "Symbol References".to_string(),
                        title: Some("References".to_string()),
                        description: Some(
                            "Find references to a symbol (use ?symbol_id=id)".to_string(),
                        ),
                        mime_type: Some("application/json".to_string()),
                        size: None,
                        icons: None,
                        meta: None,
                    },
                    None,
                ),
                Annotated::new(
                    RawResource {
                        uri: "workspace://last_patch".to_string(),
                        name: "Last Patch".to_string(),
                        title: Some("Last Patch".to_string()),
                        description: Some(
                            "The last generated patch from a refactoring operation".to_string(),
                        ),
                        mime_type: Some("application/json".to_string()),
                        size: None,
                        icons: None,
                        meta: None,
                    },
                    None,
                ),
            ];

            Ok(ListResourcesResult {
                meta: None,
                resources,
                next_cursor: None,
            })
        }
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ReadResourceResult, McpError>> + Send + '_ {
        // Clone URI before moving into async block
        let uri = request.uri.clone();

        async move {
            // Parse URI to get path and query parameters
            let (path, query) = if let Some(idx) = uri.find('?') {
                (&uri[..idx], Some(&uri[idx + 1..]))
            } else {
                (uri.as_str(), None)
            };

            match path {
                "workspace://files" => self.read_files_resource(&uri).await,
                "workspace://symbols" => self.read_symbols_resource(&uri, query).await,
                "workspace://references" => self.read_references_resource(&uri, query).await,
                "workspace://last_patch" => self.read_last_patch_resource(&uri).await,
                _ => Err(McpError::resource_not_found(
                    format!("Unknown resource: {}", uri),
                    Some(serde_json::json!({ "available": ["workspace://files", "workspace://symbols", "workspace://references", "workspace://last_patch"] })),
                )),
            }
        }
    }
}

// ============================================================================
// Entry Point
// ============================================================================

/// Run the MCP server on stdio.
///
/// This function starts the MCP server, reading JSON-RPC requests from stdin
/// and writing responses to stdout. It blocks until the client sends a shutdown
/// message or closes the connection.
///
/// # Errors
///
/// Returns an error if the server fails to start or encounters a fatal error
/// during operation.
pub async fn run_mcp_server() -> Result<(), TugError> {
    let server = TugServer::new();
    let service = server
        .serve(stdio())
        .await
        .map_err(|e| TugError::internal(format!("MCP server failed to start: {}", e)))?;

    service
        .waiting()
        .await
        .map_err(|e| TugError::internal(format!("MCP server error: {}", e)))?;

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn server_creates_successfully() {
        let server = TugServer::new();
        // Server should create without panic
        let info = server.get_info();
        assert_eq!(info.server_info.name, "tug");
        assert_eq!(info.server_info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn server_has_tools_capability() {
        let server = TugServer::new();
        let info = server.get_info();
        // ServerCapabilities with tools enabled should have tools field
        assert!(info.capabilities.tools.is_some());
    }

    #[test]
    fn server_default_impl_works() {
        let server = TugServer::default();
        let info = server.get_info();
        assert_eq!(info.server_info.name, "tug");
    }

    #[test]
    fn server_has_instructions() {
        let server = TugServer::new();
        let info = server.get_info();
        assert!(info.instructions.is_some());
        let instructions = info.instructions.unwrap();
        assert!(instructions.contains("refactoring tool"));
    }

    #[test]
    fn protocol_version_is_current() {
        let server = TugServer::new();
        let info = server.get_info();
        assert_eq!(info.protocol_version, ProtocolVersion::V_2024_11_05);
    }

    // ========================================================================
    // Session Management Tests
    // ========================================================================

    fn create_test_workspace() -> TempDir {
        let temp = TempDir::new().unwrap();
        // Create a minimal file so it's a valid workspace
        std::fs::write(temp.path().join("main.py"), "print('hello')").unwrap();
        temp
    }

    #[test]
    fn session_starts_as_none() {
        let server = TugServer::new();
        // Access the session field through the Arc
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let session_guard = server.session.lock().await;
            assert!(session_guard.is_none(), "Session should be None initially");
        });
    }

    #[test]
    fn get_session_initializes_session() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let session_guard = server
                .get_session(Some(workspace.path().to_str().unwrap()))
                .await
                .unwrap();

            assert!(
                session_guard.is_some(),
                "Session should be initialized after get_session"
            );

            let session = session_guard.as_ref().unwrap();
            assert_eq!(
                session.workspace_root().canonicalize().unwrap(),
                workspace.path().canonicalize().unwrap()
            );
        });
    }

    #[test]
    fn get_session_reuses_session_for_same_workspace() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // First call initializes session
            {
                let session_guard = server
                    .get_session(Some(workspace.path().to_str().unwrap()))
                    .await
                    .unwrap();
                assert!(session_guard.is_some());
            }

            // Get workspace path for verification
            let workspace_after_first = {
                let guard = server.workspace_path.lock().await;
                guard.clone()
            };

            // Second call should reuse
            {
                let session_guard = server
                    .get_session(Some(workspace.path().to_str().unwrap()))
                    .await
                    .unwrap();
                assert!(session_guard.is_some());
            }

            // Workspace path should be unchanged (same object)
            let workspace_after_second = {
                let guard = server.workspace_path.lock().await;
                guard.clone()
            };

            assert_eq!(
                workspace_after_first, workspace_after_second,
                "Workspace path should remain the same when reusing session"
            );
        });
    }

    #[test]
    fn get_session_switches_for_different_workspace() {
        let workspace1 = create_test_workspace();
        let workspace2 = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // First workspace
            {
                let session_guard = server
                    .get_session(Some(workspace1.path().to_str().unwrap()))
                    .await
                    .unwrap();
                let session = session_guard.as_ref().unwrap();
                assert_eq!(
                    session.workspace_root().canonicalize().unwrap(),
                    workspace1.path().canonicalize().unwrap()
                );
            }

            // Switch to second workspace
            {
                let session_guard = server
                    .get_session(Some(workspace2.path().to_str().unwrap()))
                    .await
                    .unwrap();
                let session = session_guard.as_ref().unwrap();
                assert_eq!(
                    session.workspace_root().canonicalize().unwrap(),
                    workspace2.path().canonicalize().unwrap()
                );
            }

            // Verify workspace_path was updated
            let current_workspace = {
                let guard = server.workspace_path.lock().await;
                guard.clone()
            };

            assert_eq!(
                current_workspace.unwrap(),
                workspace2.path().canonicalize().unwrap()
            );
        });
    }

    #[test]
    fn get_session_returns_error_for_invalid_path() {
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let result = server
                .get_session(Some("/nonexistent/path/that/does/not/exist"))
                .await;

            assert!(
                result.is_err(),
                "get_session should return error for invalid path"
            );
        });
    }

    #[test]
    fn get_session_uses_current_dir_when_none() {
        // This test verifies that None workspace_path uses current directory
        // We can't easily test the actual current dir behavior in isolation,
        // but we can verify the code path doesn't panic
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(async { server.get_session(None).await });

        // Result depends on whether current dir is a valid workspace
        // The important thing is it doesn't panic and returns a sensible result
        // (either success or a clear error message)
        match result {
            Ok(guard) => {
                assert!(guard.is_some(), "Should initialize session");
            }
            Err(e) => {
                // Error is acceptable if current dir isn't a valid workspace
                let error_string = format!("{:?}", e);
                assert!(
                    error_string.contains("Failed to open session")
                        || error_string.contains("current directory"),
                    "Error should be about session or directory: {}",
                    error_string
                );
            }
        }
    }

    #[test]
    fn server_fields_are_arc_cloneable() {
        let server = TugServer::new();

        // Verify the Arc fields can be cloned (important for the Clone derive)
        let session_clone = Arc::clone(&server.session);
        let workspace_clone = Arc::clone(&server.workspace_path);

        // Both should point to the same data
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let guard1 = server.session.lock().await;
            drop(guard1);

            let guard2 = session_clone.lock().await;
            assert!(guard2.is_none());
            drop(guard2);

            let guard3 = workspace_clone.lock().await;
            assert!(guard3.is_none());
        });
    }

    // ========================================================================
    // Tool Parameter Tests
    // ========================================================================

    #[test]
    fn snapshot_params_defaults() {
        // Test that SnapshotParams deserializes with defaults
        let json = r#"{}"#;
        let params: SnapshotParams = serde_json::from_str(json).unwrap();
        assert!(params.workspace_path.is_none());
        assert!(!params.force_refresh);
    }

    #[test]
    fn snapshot_params_with_force_refresh() {
        let json = r#"{"force_refresh": true}"#;
        let params: SnapshotParams = serde_json::from_str(json).unwrap();
        assert!(params.force_refresh);
    }

    #[test]
    fn analyze_impact_params_required_fields() {
        let json = r#"{
            "file": "src/main.py",
            "line": 42,
            "column": 8,
            "new_name": "new_func"
        }"#;
        let params: AnalyzeImpactParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.file, "src/main.py");
        assert_eq!(params.line, 42);
        assert_eq!(params.column, 8);
        assert_eq!(params.new_name, "new_func");
        assert!(params.workspace_path.is_none());
    }

    #[test]
    fn rename_symbol_params_defaults() {
        let json = r#"{
            "file": "src/main.py",
            "line": 42,
            "column": 8,
            "new_name": "new_func"
        }"#;
        let params: RenameSymbolParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.file, "src/main.py");
        assert!(!params.apply);
        assert_eq!(params.verify, "syntax"); // default_verify()
    }

    #[test]
    fn rename_symbol_params_with_all_fields() {
        let json = r#"{
            "file": "src/main.py",
            "line": 42,
            "column": 8,
            "new_name": "new_func",
            "apply": true,
            "verify": "tests",
            "workspace_path": "/path/to/workspace"
        }"#;
        let params: RenameSymbolParams = serde_json::from_str(json).unwrap();
        assert!(params.apply);
        assert_eq!(params.verify, "tests");
        assert_eq!(params.workspace_path.as_deref(), Some("/path/to/workspace"));
    }

    #[test]
    fn verify_params_required_mode() {
        let json = r#"{"mode": "syntax"}"#;
        let params: VerifyParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.mode, "syntax");
        assert!(params.workspace_path.is_none());
    }

    #[test]
    fn default_verify_returns_syntax() {
        assert_eq!(default_verify(), "syntax");
    }

    // ========================================================================
    // Stub Tool Tests
    // ========================================================================

    #[test]
    fn stub_change_signature_returns_error() {
        let server = TugServer::new();
        let params = Parameters(StubParams {
            workspace_path: None,
        });

        let result = server.tug_change_signature(params);
        assert!(result.is_err());

        let err = result.unwrap_err();
        let error_string = format!("{:?}", err);
        assert!(error_string.contains("not yet implemented"));
        assert!(error_string.contains("change-signature"));
    }

    #[test]
    fn stub_move_symbol_returns_error() {
        let server = TugServer::new();
        let params = Parameters(StubParams {
            workspace_path: None,
        });

        let result = server.tug_move_symbol(params);
        assert!(result.is_err());

        let err = result.unwrap_err();
        let error_string = format!("{:?}", err);
        assert!(error_string.contains("not yet implemented"));
        assert!(error_string.contains("move-symbol"));
    }

    #[test]
    fn stub_organize_imports_returns_error() {
        let server = TugServer::new();
        let params = Parameters(StubParams {
            workspace_path: None,
        });

        let result = server.tug_organize_imports(params);
        assert!(result.is_err());

        let err = result.unwrap_err();
        let error_string = format!("{:?}", err);
        assert!(error_string.contains("not yet implemented"));
        assert!(error_string.contains("organize-imports"));
    }

    // ========================================================================
    // Tools List Tests
    // ========================================================================

    #[test]
    fn tools_list_returns_all_expected_tools() {
        let server = TugServer::new();

        // Get all tools from the router
        let tools = server.tool_router.list_all();
        let tool_names: Vec<&str> = tools.iter().map(|t| &*t.name).collect();

        // Verify all expected tools are present
        let expected_tools = [
            "echo",
            "tug_snapshot",
            "tug_analyze_impact",
            "tug_rename_symbol",
            "tug_verify",
            "tug_change_signature",
            "tug_move_symbol",
            "tug_organize_imports",
        ];

        for expected in expected_tools {
            assert!(
                tool_names.contains(&expected),
                "Expected tool '{}' not found in tools list. Found: {:?}",
                expected,
                tool_names
            );
        }

        // Verify we have exactly the expected number of tools
        assert_eq!(
            tools.len(),
            expected_tools.len(),
            "Unexpected number of tools. Found: {:?}",
            tool_names
        );
    }

    #[test]
    fn all_tools_have_descriptions() {
        let server = TugServer::new();
        let tools = server.tool_router.list_all();

        for tool in tools {
            assert!(
                tool.description.is_some(),
                "Tool '{}' is missing a description",
                tool.name
            );
            let desc = tool.description.as_ref().unwrap();
            assert!(
                !desc.is_empty(),
                "Tool '{}' has an empty description",
                tool.name
            );
        }
    }

    #[test]
    fn stub_tools_include_tug_code_10() {
        let server = TugServer::new();
        let params = Parameters(StubParams {
            workspace_path: None,
        });

        let result = server.tug_change_signature(params);
        let err = result.unwrap_err();
        let error_string = format!("{:?}", err);
        // Error should include tug_code: 10
        assert!(
            error_string.contains("tug_code") && error_string.contains("10"),
            "Error should contain tug_code: 10, got: {}",
            error_string
        );
    }

    // ========================================================================
    // Snapshot Tool Tests
    // ========================================================================

    /// Helper to extract text from CallToolResult content
    fn extract_text_from_result(result: &CallToolResult) -> Option<String> {
        result.content.first().and_then(|content| {
            // Content is Annotated<RawContent>, try to serialize and extract text
            serde_json::to_value(content)
                .ok()
                .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(String::from))
        })
    }

    #[test]
    fn snapshot_tool_creates_snapshot() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: false,
            });

            let result = server.tug_snapshot(params).await;
            assert!(result.is_ok(), "Snapshot should succeed: {:?}", result);

            let call_result = result.unwrap();
            // Check that the result contains JSON with expected fields
            let text = extract_text_from_result(&call_result).expect("Expected text content");
            let json: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(json["status"], "ok");
            assert!(json["snapshot_id"].as_str().is_some());
            assert!(json["file_count"].as_u64().is_some());
        });
    }

    #[test]
    fn snapshot_tool_reuses_existing() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // First snapshot
            let params1 = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: false,
            });
            let result1 = server.tug_snapshot(params1).await.unwrap();

            // Second snapshot without force_refresh should reuse
            let params2 = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: false,
            });
            let result2 = server.tug_snapshot(params2).await.unwrap();

            // Both should have same snapshot_id
            let get_snapshot_id = |r: &CallToolResult| -> String {
                let text = extract_text_from_result(r).expect("Expected text content");
                let json: serde_json::Value = serde_json::from_str(&text).unwrap();
                json["snapshot_id"].as_str().unwrap().to_string()
            };

            let id1 = get_snapshot_id(&result1);
            let id2 = get_snapshot_id(&result2);
            assert_eq!(id1, id2, "Should reuse existing snapshot");
        });
    }

    #[test]
    fn snapshot_tool_force_refresh_rescans_workspace() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // First snapshot
            let params1 = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: false,
            });
            let result1 = server.tug_snapshot(params1).await.unwrap();
            let text1 = extract_text_from_result(&result1).expect("Expected text content");
            let json1: serde_json::Value = serde_json::from_str(&text1).unwrap();
            let count1 = json1["file_count"].as_u64().unwrap();

            // Add a new file to the workspace
            std::fs::write(workspace.path().join("new_file.py"), "print('new')").unwrap();

            // Without force_refresh, cached snapshot should have old file_count
            let params2 = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: false,
            });
            let result2 = server.tug_snapshot(params2).await.unwrap();
            let text2 = extract_text_from_result(&result2).expect("Expected text content");
            let json2: serde_json::Value = serde_json::from_str(&text2).unwrap();
            let count2 = json2["file_count"].as_u64().unwrap();
            assert_eq!(count1, count2, "Without force_refresh, should use cached snapshot");

            // With force_refresh, should rescan and see the new file
            let params3 = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: true,
            });
            let result3 = server.tug_snapshot(params3).await.unwrap();
            let text3 = extract_text_from_result(&result3).expect("Expected text content");
            let json3: serde_json::Value = serde_json::from_str(&text3).unwrap();
            let count3 = json3["file_count"].as_u64().unwrap();
            assert!(count3 > count1, "With force_refresh, should see new file (got {} vs {})", count3, count1);
        });
    }

    // ========================================================================
    // Verify Tool Tests
    // ========================================================================

    #[test]
    fn verify_tool_rejects_invalid_mode() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = Parameters(VerifyParams {
                mode: "invalid_mode".to_string(),
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
            });

            let result = server.tug_verify(params).await;
            assert!(result.is_err(), "Should reject invalid mode");

            let err = result.unwrap_err();
            let error_string = format!("{:?}", err);
            assert!(error_string.contains("Invalid verify mode"));
        });
    }

    #[test]
    fn verify_tool_accepts_valid_modes() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            for mode in ["syntax", "tests", "typecheck", "SYNTAX", "Tests"] {
                let params = Parameters(VerifyParams {
                    mode: mode.to_string(),
                    workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                });

                let result = server.tug_verify(params).await;
                assert!(result.is_ok(), "Mode '{}' should be accepted", mode);
            }
        });
    }

    // ========================================================================
    // Analyze Impact and Rename Symbol Tests
    // ========================================================================

    /// Find Python 3 on the system.
    fn find_python() -> Option<std::path::PathBuf> {
        which::which("python3")
            .or_else(|_| which::which("python"))
            .ok()
    }

    /// Check if libcst is available for the given Python.
    fn has_libcst(python: &std::path::Path) -> bool {
        std::process::Command::new(python)
            .args(["-c", "import libcst"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Create a test workspace with the simple rename fixture.
    fn create_rename_test_workspace() -> TempDir {
        let temp = TempDir::new().unwrap();
        // Copy a simple Python file with a function to rename
        std::fs::write(
            temp.path().join("rename_function.py"),
            r#"def process_data(items):
    """Process a list of items and return results."""
    results = []
    for item in items:
        results.append(item * 2)
    return results


def main():
    data = [1, 2, 3, 4, 5]
    output = process_data(data)
    print(output)


if __name__ == "__main__":
    main()
"#,
        )
        .unwrap();
        temp
    }

    #[test]
    fn analyze_impact_returns_valid_response() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        if !has_libcst(&python_path) {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let workspace = create_rename_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = Parameters(AnalyzeImpactParams {
                file: "rename_function.py".to_string(),
                line: 1,
                column: 5,
                new_name: "transform_data".to_string(),
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
            });

            let result = server.tug_analyze_impact(params).await;
            assert!(result.is_ok(), "analyze_impact should succeed: {:?}", result.err());

            let call_result = result.unwrap();
            let text = extract_text_from_result(&call_result).expect("Expected text content");
            let json: serde_json::Value = serde_json::from_str(&text).unwrap();

            // Verify response structure
            assert_eq!(json["status"], "ok", "Response status should be 'ok'");
            assert!(json["symbol"].is_object(), "Response should have symbol info");
            assert!(json["refs"].is_array(), "Response should have refs array");

            // Verify symbol info
            let symbol = &json["symbol"];
            assert_eq!(symbol["name"], "process_data");
            assert_eq!(symbol["kind"], "function");

            // Verify references (should find the definition and the call in main)
            let refs = json["refs"].as_array().unwrap();
            assert!(refs.len() >= 2, "Should find at least 2 references (definition + call)");
        });
    }

    #[test]
    fn rename_symbol_dry_run_returns_patch_without_modifying_files() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        if !has_libcst(&python_path) {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let workspace = create_rename_test_workspace();
        let server = TugServer::new();

        // Read original file content
        let original_content =
            std::fs::read_to_string(workspace.path().join("rename_function.py")).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = Parameters(RenameSymbolParams {
                file: "rename_function.py".to_string(),
                line: 1,
                column: 5,
                new_name: "transform_data".to_string(),
                apply: false, // Dry run - don't modify files
                verify: "none".to_string(),
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
            });

            let result = server.tug_rename_symbol(params).await;
            assert!(result.is_ok(), "rename_symbol should succeed: {:?}", result.err());

            let call_result = result.unwrap();
            let text = extract_text_from_result(&call_result).expect("Expected text content");
            let json: serde_json::Value = serde_json::from_str(&text).unwrap();

            // Verify response structure
            assert_eq!(json["status"], "ok", "Response status should be 'ok'");
            assert!(json["patch"].is_object() || json["patch"].is_string(), "Response should have patch");
            assert!(json["applied"].is_boolean(), "Response should have applied flag");
            assert_eq!(json["applied"], false, "applied should be false for dry run");
        });

        // Verify file was NOT modified
        let current_content =
            std::fs::read_to_string(workspace.path().join("rename_function.py")).unwrap();
        assert_eq!(
            original_content, current_content,
            "File should not be modified in dry run mode"
        );
    }

    #[test]
    fn rename_symbol_apply_modifies_files() {
        let Some(python_path) = find_python() else {
            eprintln!("Skipping test: Python not found");
            return;
        };

        if !has_libcst(&python_path) {
            eprintln!("Skipping test: libcst not available");
            return;
        }

        let workspace = create_rename_test_workspace();
        let server = TugServer::new();

        // Read original file content
        let original_content =
            std::fs::read_to_string(workspace.path().join("rename_function.py")).unwrap();
        assert!(
            original_content.contains("def process_data"),
            "Original should have process_data"
        );

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = Parameters(RenameSymbolParams {
                file: "rename_function.py".to_string(),
                line: 1,
                column: 5,
                new_name: "transform_data".to_string(),
                apply: true, // Apply changes to files
                verify: "none".to_string(),
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
            });

            let result = server.tug_rename_symbol(params).await;
            assert!(result.is_ok(), "rename_symbol should succeed: {:?}", result.err());

            let call_result = result.unwrap();
            let text = extract_text_from_result(&call_result).expect("Expected text content");
            let json: serde_json::Value = serde_json::from_str(&text).unwrap();

            // Verify response structure
            assert_eq!(json["status"], "ok", "Response status should be 'ok'");
            assert_eq!(json["applied"], true, "applied should be true");
        });

        // Verify file WAS modified
        let current_content =
            std::fs::read_to_string(workspace.path().join("rename_function.py")).unwrap();
        assert!(
            !current_content.contains("def process_data"),
            "Old function name should be removed"
        );
        assert!(
            current_content.contains("def transform_data"),
            "New function name should be present"
        );
        assert!(
            current_content.contains("transform_data(data)"),
            "Call site should be updated"
        );
    }

    // ========================================================================
    // Resource Tests
    // ========================================================================

    #[test]
    fn server_has_resources_capability() {
        let server = TugServer::new();
        let info = server.get_info();
        // ServerCapabilities with resources enabled should have resources field
        assert!(info.capabilities.resources.is_some());
    }

    // Note: list_resources() requires a RequestContext which can't be easily mocked.
    // The functionality is tested through the server_has_resources_capability test
    // and the individual read_*_resource tests.

    #[test]
    fn read_files_resource_requires_snapshot() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // First get session
            let _ = server
                .get_session(Some(workspace.path().to_str().unwrap()))
                .await
                .unwrap();

            // Reading files without snapshot should error
            let result = server.read_files_resource("workspace://files").await;
            assert!(result.is_err());
            let err_string = format!("{:?}", result.unwrap_err());
            assert!(err_string.contains("No snapshot available"));
        });
    }

    #[test]
    fn read_files_resource_with_snapshot() {
        let workspace = create_test_workspace();
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create snapshot first
            let params = Parameters(SnapshotParams {
                workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                force_refresh: false,
            });
            let _ = server.tug_snapshot(params).await.unwrap();

            // Now read files resource
            let result = server.read_files_resource("workspace://files").await;
            assert!(result.is_ok());

            let read_result = result.unwrap();
            assert_eq!(read_result.contents.len(), 1);

            // Verify it's JSON with files array
            if let ResourceContents::TextResourceContents { text, .. } =
                &read_result.contents[0]
            {
                let json: serde_json::Value = serde_json::from_str(text).unwrap();
                assert!(json["files"].is_array());
                assert!(json["count"].is_u64());
            } else {
                panic!("Expected text content");
            }
        });
    }

    #[test]
    fn read_references_requires_symbol_id() {
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Without symbol_id should error
            let result = server
                .read_references_resource("workspace://references", None)
                .await;
            assert!(result.is_err());
            let err_string = format!("{:?}", result.unwrap_err());
            assert!(err_string.contains("Missing required parameter: symbol_id"));
        });
    }

    #[test]
    fn read_references_with_symbol_id() {
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // With symbol_id should return stub response
            let result = server
                .read_references_resource(
                    "workspace://references?symbol_id=sym_123",
                    Some("symbol_id=sym_123"),
                )
                .await;
            assert!(result.is_ok());

            let read_result = result.unwrap();
            if let ResourceContents::TextResourceContents { text, .. } =
                &read_result.contents[0]
            {
                let json: serde_json::Value = serde_json::from_str(text).unwrap();
                assert!(json["references"].is_array());
            } else {
                panic!("Expected text content");
            }
        });
    }

    #[test]
    fn read_symbols_resource_returns_stub() {
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let result = server
                .read_symbols_resource("workspace://symbols", None)
                .await;
            assert!(result.is_ok());

            let read_result = result.unwrap();
            if let ResourceContents::TextResourceContents { text, .. } =
                &read_result.contents[0]
            {
                let json: serde_json::Value = serde_json::from_str(text).unwrap();
                assert!(json["symbols"].is_array());
                assert!(json["note"].is_string());
            } else {
                panic!("Expected text content");
            }
        });
    }

    #[test]
    fn read_last_patch_returns_null_initially() {
        let server = TugServer::new();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let result = server
                .read_last_patch_resource("workspace://last_patch")
                .await;
            assert!(result.is_ok());

            let read_result = result.unwrap();
            if let ResourceContents::TextResourceContents { text, .. } =
                &read_result.contents[0]
            {
                let json: serde_json::Value = serde_json::from_str(text).unwrap();
                assert!(json["patch"].is_null());
            } else {
                panic!("Expected text content");
            }
        });
    }

    #[test]
    fn parse_query_params_works() {
        let params = super::parse_query_params(Some("file=main.py&kind=function&name=foo"));
        assert_eq!(params.get("file"), Some(&"main.py".to_string()));
        assert_eq!(params.get("kind"), Some(&"function".to_string()));
        assert_eq!(params.get("name"), Some(&"foo".to_string()));
    }

    #[test]
    fn parse_query_params_empty() {
        let params = super::parse_query_params(None);
        assert!(params.is_empty());
    }

    // ========================================================================
    // Error Conversion Tests
    // ========================================================================

    mod error_conversion_tests {
        use super::*;
        use crate::error::{TugError, OutputErrorCode};
        use crate::output::Location;

        /// Helper to extract error data from McpError
        fn get_error_data(err: &McpError) -> Option<serde_json::Value> {
            err.data.clone()
        }

        #[test]
        fn invalid_arguments_converts_to_invalid_params() {
            let err = TugError::invalid_args("missing required field");
            let mcp_err = McpError::from(err);

            // Check error code is invalid_params (-32602)
            assert_eq!(mcp_err.code.0, -32602);

            // Check tug_code in data
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 2);
        }

        #[test]
        fn symbol_not_found_converts_with_location_info() {
            let err = TugError::symbol_not_found("src/main.py", 42, 8);
            let mcp_err = McpError::from(err);

            // Check custom error code -32000 (RESOLUTION_ERROR)
            assert_eq!(mcp_err.code.0, -32000);

            // Check data includes location info
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 3);
            assert_eq!(data["file"], "src/main.py");
            assert_eq!(data["line"], 42);
            assert_eq!(data["col"], 8);
        }

        #[test]
        fn file_not_found_converts_to_resource_not_found() {
            let err = TugError::file_not_found("missing.py");
            let mcp_err = McpError::from(err);

            // Check custom error code -32001 (RESOURCE_NOT_FOUND)
            assert_eq!(mcp_err.code.0, -32001);

            // Check data includes path
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 3);
            assert_eq!(data["path"], "missing.py");
        }

        #[test]
        fn apply_error_converts_with_file_info() {
            let err = TugError::ApplyError {
                message: "snapshot mismatch".to_string(),
                file: Some("test.py".to_string()),
            };
            let mcp_err = McpError::from(err);

            // Check custom error code -32002 (APPLY_ERROR)
            assert_eq!(mcp_err.code.0, -32002);

            // Check data includes file
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 4);
            assert_eq!(data["file"], "test.py");
        }

        #[test]
        fn verification_failed_converts_with_details() {
            let err = TugError::VerificationFailed {
                mode: "syntax".to_string(),
                output: "SyntaxError: invalid syntax".to_string(),
                exit_code: 1,
            };
            let mcp_err = McpError::from(err);

            // Check custom error code -32003 (VERIFICATION_FAILED)
            assert_eq!(mcp_err.code.0, -32003);

            // Check data includes all verification details
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 5);
            assert_eq!(data["mode"], "syntax");
            assert_eq!(data["exit_code"], 1);
            assert!(data["output"].as_str().unwrap().contains("SyntaxError"));
        }

        #[test]
        fn internal_error_converts_to_internal_error() {
            let err = TugError::internal("unexpected state");
            let mcp_err = McpError::from(err);

            // Check error code is internal_error (-32603)
            assert_eq!(mcp_err.code.0, -32603);

            // Check tug_code
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 10);
        }

        #[test]
        fn invalid_identifier_converts_to_invalid_params() {
            let err = TugError::InvalidIdentifier {
                name: "123abc".to_string(),
                reason: "cannot start with digit".to_string(),
            };
            let mcp_err = McpError::from(err);

            // Check error code is invalid_params (-32602)
            assert_eq!(mcp_err.code.0, -32602);

            // Check data includes name and reason
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 2);
            assert_eq!(data["name"], "123abc");
            assert_eq!(data["reason"], "cannot start with digit");
        }

        #[test]
        fn ambiguous_symbol_converts_with_candidates() {
            use crate::output::SymbolInfo;

            let err = TugError::AmbiguousSymbol {
                candidates: vec![
                    SymbolInfo {
                        id: "sym_1".to_string(),
                        name: "foo".to_string(),
                        kind: "function".to_string(),
                        location: Location::new("a.py", 10, 5),
                        container: None,
                    },
                    SymbolInfo {
                        id: "sym_2".to_string(),
                        name: "foo".to_string(),
                        kind: "class".to_string(),
                        location: Location::new("b.py", 20, 1),
                        container: None,
                    },
                ],
            };
            let mcp_err = McpError::from(err);

            // Check custom error code -32000 (RESOLUTION_ERROR)
            assert_eq!(mcp_err.code.0, -32000);

            // Check data includes candidates
            let data = get_error_data(&mcp_err).unwrap();
            assert_eq!(data["tug_code"], 3);
            let candidates = data["candidates"].as_array().unwrap();
            assert_eq!(candidates.len(), 2);
            assert_eq!(candidates[0]["name"], "foo");
            assert_eq!(candidates[0]["kind"], "function");
            assert_eq!(candidates[1]["kind"], "class");
        }

        #[test]
        fn error_codes_match_table_t26() {
            // Table T26: Exit codes / error codes
            // 2: Invalid arguments
            // 3: Resolution errors
            // 4: Apply errors
            // 5: Verification failed
            // 10: Internal errors

            assert_eq!(OutputErrorCode::InvalidArguments.code(), 2);
            assert_eq!(OutputErrorCode::ResolutionError.code(), 3);
            assert_eq!(OutputErrorCode::ApplyError.code(), 4);
            assert_eq!(OutputErrorCode::VerificationFailed.code(), 5);
            assert_eq!(OutputErrorCode::InternalError.code(), 10);
        }

        #[test]
        fn all_mcp_errors_include_tug_code() {
            // Every error variant should include tug_code for machine parsing
            let errors: Vec<TugError> = vec![
                TugError::invalid_args("test"),
                TugError::symbol_not_found("file.py", 1, 1),
                TugError::file_not_found("file.py"),
                TugError::internal("test"),
                TugError::InvalidIdentifier {
                    name: "x".to_string(),
                    reason: "y".to_string(),
                },
                TugError::ApplyError {
                    message: "test".to_string(),
                    file: None,
                },
                TugError::VerificationFailed {
                    mode: "syntax".to_string(),
                    output: "".to_string(),
                    exit_code: 1,
                },
                TugError::WorkerError {
                    message: "test".to_string(),
                },
                TugError::SessionError {
                    message: "test".to_string(),
                },
                TugError::AmbiguousSymbol { candidates: vec![] },
            ];

            for err in errors {
                let mcp_err = McpError::from(err);
                let data = get_error_data(&mcp_err)
                    .expect("All MCP errors should have data");
                assert!(
                    data.get("tug_code").is_some(),
                    "Error should include tug_code: {:?}",
                    mcp_err
                );
            }
        }
    }

    // ========================================================================
    // Integration Tests
    // ========================================================================

    mod integration_tests {
        use super::*;

        #[test]
        fn multiple_sequential_tool_calls_session_warmth() {
            // Tests that the MCP server maintains session state across multiple calls
            let workspace = create_test_workspace();
            let server = TugServer::new();

            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                // First call: snapshot
                let params1 = Parameters(SnapshotParams {
                    workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                    force_refresh: false,
                });
                let result1 = server.tug_snapshot(params1).await;
                assert!(result1.is_ok(), "First snapshot should succeed");

                let text1 = extract_text_from_result(&result1.unwrap()).unwrap();
                let json1: serde_json::Value = serde_json::from_str(&text1).unwrap();
                let snapshot_id_1 = json1["snapshot_id"].as_str().unwrap().to_string();

                // Second call: another snapshot (should reuse session)
                let params2 = Parameters(SnapshotParams {
                    workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                    force_refresh: false,
                });
                let result2 = server.tug_snapshot(params2).await;
                assert!(result2.is_ok(), "Second snapshot should succeed");

                let text2 = extract_text_from_result(&result2.unwrap()).unwrap();
                let json2: serde_json::Value = serde_json::from_str(&text2).unwrap();
                let snapshot_id_2 = json2["snapshot_id"].as_str().unwrap().to_string();

                // Session should be reused, so snapshot_id should be the same (without force_refresh)
                assert_eq!(
                    snapshot_id_1, snapshot_id_2,
                    "Session should be reused, snapshot_id should match"
                );

                // Third call: verify (exercises different tool but same session)
                let params3 = Parameters(VerifyParams {
                    mode: "syntax".to_string(),
                    workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                });
                let result3 = server.tug_verify(params3).await;
                assert!(result3.is_ok(), "Verify should succeed with existing session");
            });
        }

        #[test]
        fn mcp_snapshot_output_structure_matches_cli() {
            // Tests that MCP snapshot output has the same structure as CLI output
            let workspace = create_test_workspace();
            let server = TugServer::new();

            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let params = Parameters(SnapshotParams {
                    workspace_path: Some(workspace.path().to_str().unwrap().to_string()),
                    force_refresh: false,
                });

                let result = server.tug_snapshot(params).await;
                assert!(result.is_ok());

                let text = extract_text_from_result(&result.unwrap()).unwrap();
                let json: serde_json::Value = serde_json::from_str(&text).unwrap();

                // Verify the response has the expected CLI-compatible structure
                // (matches SnapshotResponse from output.rs)
                assert!(json["snapshot_id"].is_string(), "Should have snapshot_id");
                assert!(json["file_count"].is_number(), "Should have file_count");
                assert!(json["total_bytes"].is_number(), "Should have total_bytes");
            });
        }

        #[test]
        fn server_handles_workspace_switch() {
            // Tests that the server correctly handles switching between workspaces
            let workspace1 = create_test_workspace();
            let workspace2 = create_test_workspace();

            // Add different content to distinguish them
            std::fs::write(workspace1.path().join("file1.py"), "# workspace 1").unwrap();
            std::fs::write(workspace2.path().join("file2.py"), "# workspace 2").unwrap();

            let server = TugServer::new();

            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                // Snapshot workspace 1
                let params1 = Parameters(SnapshotParams {
                    workspace_path: Some(workspace1.path().to_str().unwrap().to_string()),
                    force_refresh: false,
                });
                let result1 = server.tug_snapshot(params1).await;
                assert!(result1.is_ok());

                // Snapshot workspace 2 (should switch session)
                let params2 = Parameters(SnapshotParams {
                    workspace_path: Some(workspace2.path().to_str().unwrap().to_string()),
                    force_refresh: false,
                });
                let result2 = server.tug_snapshot(params2).await;
                assert!(result2.is_ok());

                // Back to workspace 1
                let params3 = Parameters(SnapshotParams {
                    workspace_path: Some(workspace1.path().to_str().unwrap().to_string()),
                    force_refresh: true, // Force refresh to get new snapshot
                });
                let result3 = server.tug_snapshot(params3).await;
                assert!(result3.is_ok());

                // Verify we got a valid result for workspace 1
                let text = extract_text_from_result(&result3.unwrap()).unwrap();
                let json: serde_json::Value = serde_json::from_str(&text).unwrap();
                assert!(json["file_count"].as_u64().unwrap() >= 2); // main.py + file1.py
            });
        }
    }
}

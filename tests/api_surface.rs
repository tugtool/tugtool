//! Compile-only test to verify public API surface.
//!
//! This file serves as a compile-time contract for the public API.
//! If this file fails to compile, the public API has regressed.
//!
//! The test imports all public types from tugtool and verifies they compile.
//! This catches accidental API breakage during refactoring (especially during
//! the workspace migration in Phase 2).
//!
//! Run with: cargo test -- api_surface
//!
//! After workspace migration, run with: cargo test -p tugtool --features full -- api_surface

// Allow unused imports - this test is about compile-time verification, not runtime usage
#![allow(unused_imports)]

// ============================================================================
// Core Infrastructure Types
// ============================================================================

// patch module - foundation types for edit/diff operations
use tugtool::patch::{
    Anchor, AnchorResolution, ApplyContext, ApplyResult, Conflict, ContentHash, Edit, EditKind,
    EditLabels, FileId, MaterializedPatch, OutputEdit, PatchSet, Precondition, Span,
    WorkspaceSnapshotId,
};

// facts module - symbol and reference tracking
use tugtool::facts::{
    FactsStore, File as FactsFile, Import, ImportId, InheritanceInfo, Language as FactsLanguage,
    Module, ModuleId, ModuleKind, Reference, ReferenceId, ReferenceKind, ScopeId, ScopeInfo,
    ScopeKind, Symbol, SymbolId, SymbolKind, TypeInfo, TypeSource,
};

// error module - error types and codes
use tugtool::error::{OutputErrorCode, TugError};

// output module - JSON output types
use tugtool::output::{
    AnalyzeImpactResponse, CacheStats, Edit as OutputEditAlias, ErrorInfo, ErrorResponse, Impact,
    Location, Patch, ReferenceInfo, RunResponse, SessionStatusResponse, SnapshotResponse,
    Span as OutputSpan, Summary, SymbolInfo, Verification, VerificationCheck, VerifyResponse,
    Warning, WorkerStatus, SCHEMA_VERSION,
};

// session module - session management
use tugtool::session::{
    CliOverrides, ConfigSource, ConfigValue, ResolvedConfig, Session, SessionConfig, SessionError,
    SessionMetadata, SessionOptions, SessionResult, SessionStatus, SessionVersion, WorkerInfo,
    DEFAULT_SNAPSHOT_RETENTION,
};

// workspace module - workspace snapshots
use tugtool::workspace::{
    FileInfo, Language as WorkspaceLanguage, MismatchKind, SnapshotConfig, SnapshotMismatch,
    SnapshotMode, WorkspaceSnapshot,
};

// sandbox module - sandboxed file operations
use tugtool::sandbox::{
    PreviewResult, RefactorError, RefactorReport, RefactorWarning, ResolvedEdit, SandboxConfig,
    SandboxHandle, SymlinkCheck, VerificationResult, WarningLocation,
};

// text module - text position utilities
use tugtool::text;

// diff module - unified diff generation
use tugtool::diff;

// util module - general utilities
use tugtool::util;

// ============================================================================
// Language Adapters
// ============================================================================

// Python language support (currently always available)
use tugtool::python;

// Rust language support (currently placeholder)
use tugtool::rust;

// ============================================================================
// Front Doors (CLI, MCP)
// ============================================================================

// CLI module
use tugtool::cli;

// MCP server (feature-gated)
#[cfg(feature = "mcp")]
use tugtool::mcp;

// testcmd module - test command resolution
use tugtool::testcmd;

// ============================================================================
// Test
// ============================================================================

#[test]
fn api_surface_compiles() {
    // This test exists only to verify imports compile.
    // If you're here because this test broke, you may have
    // accidentally removed a public re-export.
    //
    // The imports above form the public API contract.
    // Any change that breaks these imports is a breaking change.

    // Use some types to avoid unused import warnings
    let _ = std::any::type_name::<Span>();
    let _ = std::any::type_name::<FileId>();
    let _ = std::any::type_name::<FactsStore>();
    let _ = std::any::type_name::<TugError>();
    let _ = std::any::type_name::<Location>();
    let _ = std::any::type_name::<Session>();
    let _ = std::any::type_name::<WorkspaceSnapshot>();
    let _ = std::any::type_name::<SandboxConfig>();
}

#[test]
fn schema_version_is_stable() {
    // The schema version is part of the public API contract
    assert_eq!(SCHEMA_VERSION, "1");
}

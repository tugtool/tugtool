//! Method Resolution Order (MRO) computation using C3 linearization.
//!
//! This module provides Python's MRO computation algorithm for resolving
//! attribute and method lookups through inheritance hierarchies.
//!
//! # Algorithm
//!
//! Python uses C3 linearization (also known as C3 superclass linearization)
//! to compute the Method Resolution Order. The algorithm ensures:
//!
//! - Children precede their parents
//! - If a class inherits from multiple classes, they are kept in the order specified
//! - A consistent ordering exists across the hierarchy
//!
//! # Example
//!
//! ```ignore
//! use tugtool_python::mro::compute_mro;
//! use std::collections::HashMap;
//!
//! let mut hierarchy = HashMap::new();
//! hierarchy.insert("D".to_string(), vec!["B".to_string(), "C".to_string()]);
//! hierarchy.insert("B".to_string(), vec!["A".to_string()]);
//! hierarchy.insert("C".to_string(), vec!["A".to_string()]);
//! hierarchy.insert("A".to_string(), vec![]);
//!
//! let mro = compute_mro("D", &hierarchy).unwrap();
//! assert_eq!(mro, vec!["D", "B", "C", "A"]);
//! ```
//!
//! # Cross-File Resolution
//!
//! For base classes defined in other files, use [`compute_mro_cross_file`]
//! which leverages the [`CrossFileTypeCache`] for on-demand analysis.
//!
//! # Limitations
//!
//! - Generic type parameters are expected to be pre-stripped by CST's InheritanceCollector
//! - External packages (outside workspace) are not resolved
//! - Maximum cross-file depth is bounded by `MAX_CROSS_FILE_DEPTH`

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::cross_file_types::{
    lookup_import_target, CrossFileTypeCache, FileTypeContext, ImportTargetKind,
    TypeResolutionError, MAX_CROSS_FILE_DEPTH,
};
use crate::types::AttributeTypeInfo;

// ============================================================================
// MRO Entry (Origin Tracking)
// ============================================================================

/// An entry in the Method Resolution Order with its origin file.
///
/// Each class in the MRO carries its origin file path, enabling correct
/// attribute lookup across file boundaries. Two classes with the same name
/// from different files are considered distinct in the MRO.
///
/// # Path Contract
///
/// The `file_path` must be a **workspace-relative path** (e.g., `"base.py"`),
/// not an absolute path. This matches the cache key format used by
/// `CrossFileTypeCache` and `ImportTarget.file_path`.
#[derive(Debug, Clone)]
pub struct MROEntry {
    /// The class name (simple name, not qualified).
    pub class_name: String,
    /// The file where this class is defined (workspace-relative path).
    pub file_path: PathBuf,
}

impl MROEntry {
    /// Create a new MRO entry with the given class name and file path.
    ///
    /// # Panics (debug builds only)
    ///
    /// Panics if `file_path` is an absolute path. This is a programming error
    /// indicating the caller failed to normalize the path to workspace-relative form.
    pub fn new(class_name: impl Into<String>, file_path: impl Into<PathBuf>) -> Self {
        let file_path = file_path.into();
        debug_assert!(
            !file_path.is_absolute(),
            "MROEntry file_path must be workspace-relative, got: {:?}",
            file_path
        );
        Self {
            class_name: class_name.into(),
            file_path,
        }
    }
}

impl PartialEq for MROEntry {
    /// Two MRO entries are equal if they have the same class name AND file path.
    ///
    /// This ensures that classes with the same name from different files are
    /// treated as distinct, which is correct Python semantics.
    fn eq(&self, other: &Self) -> bool {
        self.class_name == other.class_name && self.file_path == other.file_path
    }
}

impl Eq for MROEntry {}

impl std::hash::Hash for MROEntry {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.class_name.hash(state);
        self.file_path.hash(state);
    }
}

/// The MRO with origin tracking - each class carries its defining file.
pub type MROWithOrigin = Vec<MROEntry>;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during MRO computation.
#[derive(Debug, Error)]
pub enum MROError {
    /// The inheritance hierarchy is inconsistent (no valid C3 linearization).
    #[error("inconsistent hierarchy for class '{class_name}': cannot compute MRO")]
    InconsistentHierarchy { class_name: String },

    /// Base class not found in the hierarchy.
    #[error("base class '{base_name}' not found for class '{class_name}'")]
    BaseClassNotFound {
        class_name: String,
        base_name: String,
    },

    /// Cross-file resolution error.
    #[error("cross-file resolution error: {0}")]
    CrossFileError(#[from] TypeResolutionError),

    /// Maximum cross-file depth exceeded.
    #[error("maximum cross-file MRO depth ({depth}) exceeded for class '{class_name}'")]
    DepthExceeded { class_name: String, depth: usize },
}

/// Result type for MRO operations.
pub type MROResult<T> = Result<T, MROError>;

// ============================================================================
// Single-File MRO Computation
// ============================================================================

/// Compute the Method Resolution Order for a class using C3 linearization.
///
/// This is the single-file version that operates on a local hierarchy map.
///
/// # Arguments
///
/// * `class_name` - The class to compute MRO for
/// * `hierarchy` - Map from class name to list of base class names
///
/// # Returns
///
/// * `Ok(mro)` - The MRO as a list of class names (starting with `class_name`)
/// * `Err(MROError)` - If MRO cannot be computed (e.g., inconsistent hierarchy)
///
/// # Example
///
/// ```ignore
/// let mut hierarchy = HashMap::new();
/// hierarchy.insert("Child".to_string(), vec!["Parent".to_string()]);
/// hierarchy.insert("Parent".to_string(), vec![]);
///
/// let mro = compute_mro("Child", &hierarchy)?;
/// assert_eq!(mro, vec!["Child", "Parent"]);
/// ```
pub fn compute_mro(
    class_name: &str,
    hierarchy: &HashMap<String, Vec<String>>,
) -> MROResult<Vec<String>> {
    // Use a visited set to detect cycles
    let mut visited = HashSet::new();
    compute_mro_internal(class_name, hierarchy, &mut visited)
}

/// Internal MRO computation with cycle detection.
fn compute_mro_internal(
    class_name: &str,
    hierarchy: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
) -> MROResult<Vec<String>> {
    // Check for cycles
    if visited.contains(class_name) {
        return Err(MROError::InconsistentHierarchy {
            class_name: class_name.to_string(),
        });
    }
    visited.insert(class_name.to_string());

    // Base case: class not in hierarchy means no bases (implicit object)
    let bases = match hierarchy.get(class_name) {
        Some(b) => b,
        None => {
            visited.remove(class_name);
            return Ok(vec![class_name.to_string()]);
        }
    };

    // No bases means MRO is just the class itself
    if bases.is_empty() {
        visited.remove(class_name);
        return Ok(vec![class_name.to_string()]);
    }

    // Compute MRO for each base class
    // Note: CST's InheritanceCollector already strips generic parameters
    // (e.g., "Generic[T]" -> "Generic") so bases are already clean.
    let mut seqs: Vec<Vec<String>> = Vec::new();
    for base in bases {
        // Check if base exists in hierarchy before computing MRO
        if hierarchy.contains_key(base) {
            // Base exists - propagate errors from MRO computation
            let base_mro = compute_mro_internal(base, hierarchy, visited)?;
            seqs.push(base_mro);
        }
        // Base not in hierarchy - skip it (external base we can't resolve)
    }

    // Add the list of direct bases
    let direct_bases: Vec<String> = bases.to_vec();
    seqs.push(direct_bases);

    // Merge and prepend the class itself
    let mut mro = vec![class_name.to_string()];

    match merge(&mut seqs) {
        Some(merged) => mro.extend(merged),
        None => {
            visited.remove(class_name);
            return Err(MROError::InconsistentHierarchy {
                class_name: class_name.to_string(),
            });
        }
    }

    visited.remove(class_name);
    Ok(mro)
}

/// C3 merge algorithm for combining linearizations.
///
/// Takes a list of sequences and merges them according to C3 linearization rules:
/// - Find a candidate that doesn't appear in the tail of any sequence
/// - Add it to the result and remove from heads
/// - Repeat until all sequences are empty or no candidate is found
fn merge(seqs: &mut Vec<Vec<String>>) -> Option<Vec<String>> {
    let mut result = Vec::new();

    loop {
        // Remove empty sequences
        seqs.retain(|seq| !seq.is_empty());

        if seqs.is_empty() {
            return Some(result);
        }

        // Find a candidate that doesn't appear in the tail of any sequence
        let mut candidate = None;
        for seq in seqs.iter() {
            let head = &seq[0];
            let in_tail = seqs.iter().any(|s| s.len() > 1 && s[1..].contains(head));
            if !in_tail {
                candidate = Some(head.clone());
                break;
            }
        }

        // If no candidate found, hierarchy is inconsistent
        let cand = candidate?;

        // Add candidate to result and remove from heads
        result.push(cand.clone());
        for seq in seqs.iter_mut() {
            if seq.first() == Some(&cand) {
                seq.remove(0);
            }
        }
    }
}
// ============================================================================
// Origin-Aware MRO Computation
// ============================================================================

/// Merge MRO sequences with origin tracking using C3 linearization.
///
/// This is the origin-aware version of `merge()` that operates on `MROEntry`
/// sequences, preserving the file path where each class is defined.
///
/// # Identity
///
/// Two MRO entries are considered equal if they have the same class name AND
/// file path. This correctly handles the case where different modules define
/// classes with the same name.
fn merge_entries(seqs: &mut Vec<Vec<MROEntry>>) -> Option<Vec<MROEntry>> {
    let mut result = Vec::new();

    loop {
        // Remove empty sequences
        seqs.retain(|seq| !seq.is_empty());

        if seqs.is_empty() {
            return Some(result);
        }

        // Find a candidate that doesn't appear in the tail of any sequence
        let mut candidate = None;
        for seq in seqs.iter() {
            let head = &seq[0];
            // Use MROEntry equality (both class_name and file_path)
            let in_tail = seqs.iter().any(|s| s.len() > 1 && s[1..].contains(head));
            if !in_tail {
                candidate = Some(head.clone());
                break;
            }
        }

        // If no candidate found, hierarchy is inconsistent
        let cand = candidate?;

        // Add candidate to result and remove from heads
        result.push(cand.clone());
        for seq in seqs.iter_mut() {
            if seq.first() == Some(&cand) {
                seq.remove(0);
            }
        }
    }
}

/// Compute MRO with origin tracking for cross-file base class resolution.
///
/// This is the primary MRO computation function that returns full origin
/// information for each class in the MRO. Each entry includes both the class
/// name and the file path where it's defined, enabling correct attribute
/// lookup across file boundaries.
///
/// # Arguments
///
/// * `class_name` - The class to compute MRO for
/// * `ctx` - The current file's type context (includes `file_path`)
/// * `cache` - Cross-file type cache for on-demand analysis
/// * `workspace_root` - Root directory of the workspace
///
/// # Returns
///
/// * `Ok(mro)` - The MRO as a list of (class_name, file_path) entries
/// * `Err(MROError)` - If MRO cannot be computed
pub fn compute_mro_cross_file_with_origins(
    class_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> MROResult<Vec<MROEntry>> {
    compute_mro_in_file_with_origins(class_name, &ctx.file_path, cache, workspace_root, 0)
}

/// Internal: Compute MRO with origins for a class in a specific file.
fn compute_mro_in_file_with_origins(
    class_name: &str,
    file_path: &Path,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
    depth: usize,
) -> MROResult<Vec<MROEntry>> {
    // Check depth limit
    if depth > MAX_CROSS_FILE_DEPTH {
        return Err(MROError::DepthExceeded {
            class_name: class_name.to_string(),
            depth,
        });
    }

    // Check for cached MRO first
    if let Some(cached_mro) = cache.get_cached_mro(file_path, class_name) {
        return Ok(cached_mro.clone());
    }

    // Get the context and extract the class info we need
    let (class_bases, has_class) = {
        let remote_ctx = cache
            .get_or_analyze(file_path, workspace_root)
            .map_err(MROError::from)?;

        match remote_ctx.class_hierarchies.get(class_name) {
            Some(info) => (info.bases.clone(), true),
            None => (vec![], false),
        }
    };

    // If class not found, return just the class itself with its file
    if !has_class {
        return Ok(vec![MROEntry::new(class_name, file_path)]);
    }

    // No bases means MRO is just the class itself
    if class_bases.is_empty() {
        return Ok(vec![MROEntry::new(class_name, file_path)]);
    }

    // Compute MRO for each base class
    let mut seqs: Vec<Vec<MROEntry>> = Vec::new();
    let mut base_entries: Vec<MROEntry> = Vec::new();

    for base_name in &class_bases {
        // Note: CST's InheritanceCollector already strips generic parameters

        // Try to resolve the base class
        let resolution = {
            let remote_ctx = cache
                .get_or_analyze(file_path, workspace_root)
                .map_err(MROError::from)?;
            resolve_base_class(base_name, remote_ctx)
        };

        match resolution {
            Some((resolved_name, resolved_file)) => {
                // Record the base entry with its origin
                base_entries.push(MROEntry::new(&resolved_name, &resolved_file));

                // Recursively compute MRO in the resolved file
                if let Ok(base_mro) = compute_mro_in_file_with_origins(
                    &resolved_name,
                    &resolved_file,
                    cache,
                    workspace_root,
                    depth + 1,
                ) {
                    seqs.push(base_mro);
                }
            }
            None => {
                // Check if it's a local class in this file
                let is_local = {
                    let remote_ctx = cache
                        .get_or_analyze(file_path, workspace_root)
                        .map_err(MROError::from)?;
                    remote_ctx.class_hierarchies.contains_key(base_name)
                };

                if is_local {
                    // Local base - record with current file path
                    base_entries.push(MROEntry::new(base_name, file_path));

                    if let Ok(base_mro) = compute_mro_in_file_with_origins(
                        base_name,
                        file_path,
                        cache,
                        workspace_root,
                        depth + 1,
                    ) {
                        seqs.push(base_mro);
                    }
                }
                // Otherwise skip unknown base (conservative)
            }
        }
    }

    // Add the list of direct bases (with origins)
    seqs.push(base_entries);

    // Merge and prepend the class itself
    let mut mro = vec![MROEntry::new(class_name, file_path)];

    match merge_entries(&mut seqs) {
        Some(merged) => mro.extend(merged),
        None => {
            return Err(MROError::InconsistentHierarchy {
                class_name: class_name.to_string(),
            });
        }
    }

    // Cache the computed MRO for future lookups
    cache.cache_mro(file_path, class_name, mro.clone());

    Ok(mro)
}

// ============================================================================
// Cross-File MRO Computation (Name-Only Wrappers)
// ============================================================================

/// Compute MRO with cross-file base class resolution (name-only version).
///
/// This is a convenience wrapper around [`compute_mro_cross_file_with_origins`]
/// that strips the origin file paths from the result, returning just class names.
///
/// For attribute lookup across file boundaries, use the origin-aware version
/// [`compute_mro_cross_file_with_origins`] instead.
///
/// # Arguments
///
/// * `class_name` - The class to compute MRO for
/// * `ctx` - The current file's type context
/// * `cache` - Cross-file type cache for on-demand analysis
/// * `workspace_root` - Root directory of the workspace
///
/// # Returns
///
/// * `Ok(mro)` - The MRO as a list of class names
/// * `Err(MROError)` - If MRO cannot be computed
pub fn compute_mro_cross_file(
    class_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> MROResult<Vec<String>> {
    compute_mro_cross_file_with_origins(class_name, ctx, cache, workspace_root)
        .map(|mro| mro.into_iter().map(|entry| entry.class_name).collect())
}

/// Resolve a base class name to (class_name, file_path).
///
/// Handles:
/// - Simple names: "Base" -> look up in import_targets
/// - Dotted names: "mod.Base" -> look up module alias, then find class
///
/// # Arguments
///
/// * `base_name` - The base class name (possibly dotted)
/// * `ctx` - Current file's type context
///
/// # Returns
///
/// * `Some((class_name, file_path))` - The resolved class name and its file
/// * `None` - If the base cannot be resolved (local class or unknown)
pub fn resolve_base_class(
    base_name: &str,
    ctx: &FileTypeContext,
) -> Option<(String, std::path::PathBuf)> {
    let scope_path = vec!["<module>".to_string()];
    // Note: CST's InheritanceCollector already strips generic parameters

    // Check if dotted (e.g., "mod.Base")
    if let Some((module_alias, class_name)) = base_name.rsplit_once('.') {
        // Look up module alias via scope-chain walk
        let target = lookup_import_target(&scope_path, module_alias, &ctx.import_targets)?;

        match &target.kind {
            ImportTargetKind::ModuleImport => {
                // `import mod.sub [as Alias]` - target.file_path is the module file
                Some((class_name.to_string(), target.file_path.clone()))
            }
            ImportTargetKind::FromImport {
                imported_module, ..
            } => {
                if *imported_module {
                    // `from pkg import mod` where mod is a submodule
                    Some((class_name.to_string(), target.file_path.clone()))
                } else {
                    // `from mod import SomeClass` - the alias is a class, not a module
                    // This doesn't match "alias.ClassName" pattern
                    None
                }
            }
        }
    } else {
        // Step 3: Not dotted - check local hierarchy first
        if ctx.class_hierarchies.contains_key(base_name) {
            // Local class - but we need to return None to signal "use current context"
            // The caller should handle this case
            return None;
        }

        // Step 4: Look up in import_targets via scope-chain walk
        let target = lookup_import_target(&scope_path, base_name, &ctx.import_targets)?;

        match &target.kind {
            ImportTargetKind::FromImport {
                imported_name,
                imported_module,
            } => {
                if *imported_module {
                    // This is a submodule import, not a class
                    None
                } else {
                    // "from mod import Base [as Alias]" -> use imported_name
                    Some((imported_name.clone(), target.file_path.clone()))
                }
            }
            ImportTargetKind::ModuleImport => {
                // "import mod" used as base -> not a valid class
                None
            }
        }
    }
}

// ============================================================================
// Attribute Lookup Through MRO
// ============================================================================

/// Look up an attribute through the MRO chain with origin tracking.
///
/// This function searches for an attribute starting with the class itself
/// and walking through its MRO until the attribute is found. It uses the
/// origin-aware MRO computation to correctly look up attributes in files
/// that may be transitively imported through the inheritance chain.
///
/// # Arguments
///
/// * `class_name` - The class to start the search from
/// * `attr_name` - The attribute to look up
/// * `ctx` - Current file's type context (includes `file_path`)
/// * `cache` - Cross-file type cache
/// * `workspace_root` - Workspace root for path resolution
///
/// # Returns
///
/// * `Some(AttributeTypeInfo)` - If the attribute is found
/// * `None` - If the attribute is not found in the MRO
pub fn lookup_attr_in_mro(
    class_name: &str,
    attr_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> Option<AttributeTypeInfo> {
    // First, compute the MRO with origin tracking
    let mro = match compute_mro_cross_file_with_origins(class_name, ctx, cache, workspace_root) {
        Ok(mro) => mro,
        Err(_) => return None,
    };

    // Walk through MRO looking for the attribute
    // Each MRO entry carries its origin file, so we can look up directly
    for entry in &mro {
        if let Some(attr_type) = lookup_attr_in_file(
            &entry.class_name,
            attr_name,
            &entry.file_path,
            cache,
            workspace_root,
        ) {
            return Some(attr_type);
        }
    }

    None
}

/// Look up an attribute in a specific class in a specific file.
///
/// This is the core lookup helper that looks up an attribute directly
/// in the specified file's context. It doesn't use import resolution -
/// it expects the caller to know which file the class is in.
///
/// # Arguments
///
/// * `class_name` - The class to look up the attribute in
/// * `attr_name` - The attribute name
/// * `file_path` - The file containing the class (workspace-relative)
/// * `cache` - Cross-file type cache
/// * `workspace_root` - Workspace root
///
/// # Returns
///
/// * `Some(AttributeTypeInfo)` - If found
/// * `None` - If not found
pub fn lookup_attr_in_file(
    class_name: &str,
    attr_name: &str,
    file_path: &Path,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> Option<AttributeTypeInfo> {
    // Get the file's context
    let ctx = cache.get_or_analyze(file_path, workspace_root).ok()?;

    // Look up in the tracker - check attribute types (includes property fallback)
    if let Some(attr_type) = ctx.tracker.attribute_type_of(class_name, attr_name) {
        return Some(attr_type);
    }

    // Also check method return types - convert to AttributeTypeInfo
    // Now includes TypeNode from CST, so callable_return_type_of will work
    if let Some(return_info) = ctx.tracker.method_return_type_of(class_name, attr_name) {
        return Some(AttributeTypeInfo {
            type_str: return_info.type_str.clone(),
            type_node: return_info.type_node.clone(),
        });
    }

    None
}

/// Look up an attribute in a specific MRO class (legacy API).
///
/// This is a helper that looks up an attribute in a single class,
/// potentially crossing file boundaries using import resolution.
///
/// **Note**: For MRO-based lookups, prefer using [`lookup_attr_in_mro`]
/// which uses origin tracking for correct cross-file resolution.
///
/// # Arguments
///
/// * `class_name` - The class to look up the attribute in
/// * `attr_name` - The attribute name
/// * `ctx` - Current file's type context
/// * `cache` - Cross-file type cache
/// * `workspace_root` - Workspace root
///
/// # Returns
///
/// * `Some(AttributeTypeInfo)` - If found
/// * `None` - If not found
pub fn lookup_attr_in_mro_class(
    class_name: &str,
    attr_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> Option<AttributeTypeInfo> {
    let scope_path = vec!["<module>".to_string()];

    // First try to find in local context
    if ctx.class_hierarchies.contains_key(class_name) {
        // Class is local - use local tracker (includes property fallback)
        if let Some(attr_type) = ctx.tracker.attribute_type_of(class_name, attr_name) {
            return Some(attr_type);
        }
        // Also check method return types - convert to AttributeTypeInfo
        // Now includes TypeNode from CST, so callable_return_type_of will work
        if let Some(return_info) = ctx.tracker.method_return_type_of(class_name, attr_name) {
            return Some(AttributeTypeInfo {
                type_str: return_info.type_str.clone(),
                type_node: return_info.type_node.clone(),
            });
        }
        return None;
    }

    // Try to resolve as an import
    let target = lookup_import_target(&scope_path, class_name, &ctx.import_targets)?;

    // Extract data needed to avoid borrow issues
    let file_path = target.file_path.clone();
    let remote_class_name = match &target.kind {
        ImportTargetKind::FromImport {
            imported_name,
            imported_module,
        } => {
            if *imported_module {
                // Submodule import - class_name isn't valid here
                return None;
            }
            imported_name.clone()
        }
        ImportTargetKind::ModuleImport => {
            // Module import - need dotted name handling
            return None;
        }
    };

    // Get the remote context
    let remote_ctx = cache.get_or_analyze(&file_path, workspace_root).ok()?;

    // Look up in remote tracker (includes property fallback)
    if let Some(attr_type) = remote_ctx
        .tracker
        .attribute_type_of(&remote_class_name, attr_name)
    {
        return Some(attr_type);
    }
    // Check method return types - now includes TypeNode from CST
    if let Some(return_info) = remote_ctx
        .tracker
        .method_return_type_of(&remote_class_name, attr_name)
    {
        return Some(AttributeTypeInfo {
            type_str: return_info.type_str.clone(),
            type_node: return_info.type_node.clone(),
        });
    }

    None
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // Single-File MRO Tests
    // ========================================================================

    #[test]
    fn test_mro_single_class_no_bases() {
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec![]);

        let mro = compute_mro("A", &hierarchy).unwrap();
        assert_eq!(mro, vec!["A"]);
    }

    #[test]
    fn test_mro_single_inheritance() {
        let mut hierarchy = HashMap::new();
        hierarchy.insert("Child".to_string(), vec!["Parent".to_string()]);
        hierarchy.insert("Parent".to_string(), vec![]);

        let mro = compute_mro("Child", &hierarchy).unwrap();
        assert_eq!(mro, vec!["Child", "Parent"]);
    }

    #[test]
    fn test_mro_two_level_inheritance() {
        let mut hierarchy = HashMap::new();
        hierarchy.insert("C".to_string(), vec!["B".to_string()]);
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        hierarchy.insert("A".to_string(), vec![]);

        let mro = compute_mro("C", &hierarchy).unwrap();
        assert_eq!(mro, vec!["C", "B", "A"]);
    }

    #[test]
    fn test_mro_multiple_inheritance() {
        let mut hierarchy = HashMap::new();
        hierarchy.insert("C".to_string(), vec!["A".to_string(), "B".to_string()]);
        hierarchy.insert("A".to_string(), vec![]);
        hierarchy.insert("B".to_string(), vec![]);

        let mro = compute_mro("C", &hierarchy).unwrap();
        assert_eq!(mro, vec!["C", "A", "B"]);
    }

    #[test]
    fn test_mro_diamond_inheritance() {
        // Classic diamond pattern:
        //     A
        //    / \
        //   B   C
        //    \ /
        //     D
        let mut hierarchy = HashMap::new();
        hierarchy.insert("D".to_string(), vec!["B".to_string(), "C".to_string()]);
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        hierarchy.insert("C".to_string(), vec!["A".to_string()]);
        hierarchy.insert("A".to_string(), vec![]);

        let mro = compute_mro("D", &hierarchy).unwrap();
        // C3 linearization: D, B, C, A
        assert_eq!(mro, vec!["D", "B", "C", "A"]);
    }

    #[test]
    fn test_mro_deep_inheritance() {
        // A -> B -> C -> D -> E (5 levels)
        let mut hierarchy = HashMap::new();
        hierarchy.insert("E".to_string(), vec!["D".to_string()]);
        hierarchy.insert("D".to_string(), vec!["C".to_string()]);
        hierarchy.insert("C".to_string(), vec!["B".to_string()]);
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        hierarchy.insert("A".to_string(), vec![]);

        let mro = compute_mro("E", &hierarchy).unwrap();
        assert_eq!(mro, vec!["E", "D", "C", "B", "A"]);
    }

    #[test]
    fn test_mro_inconsistent_hierarchy() {
        // Create an inconsistent hierarchy:
        // A(B, C), B(C, D), C(D, B) - circular in MRO sense
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec!["B".to_string(), "C".to_string()]);
        hierarchy.insert("B".to_string(), vec!["D".to_string()]);
        hierarchy.insert("C".to_string(), vec!["D".to_string(), "B".to_string()]);
        hierarchy.insert("D".to_string(), vec![]);

        // This should produce an inconsistent MRO error
        let result = compute_mro("A", &hierarchy);
        assert!(result.is_err());
    }

    #[test]
    fn test_mro_missing_base_class() {
        // Class with a base that's not in the hierarchy (external)
        let mut hierarchy = HashMap::new();
        hierarchy.insert("Child".to_string(), vec!["ExternalBase".to_string()]);

        // Should still compute MRO, just skipping the unknown base
        let mro = compute_mro("Child", &hierarchy).unwrap();
        assert_eq!(mro, vec!["Child", "ExternalBase"]);
    }

    #[test]
    fn test_mro_class_not_in_hierarchy() {
        let hierarchy = HashMap::new();

        // Unknown class should return just itself
        let mro = compute_mro("Unknown", &hierarchy).unwrap();
        assert_eq!(mro, vec!["Unknown"]);
    }

    #[test]
    fn test_mro_generic_base() {
        // CST's InheritanceCollector strips generic params, so bases are already clean
        // e.g., "class MyList(Generic[T])" -> bases: ["Generic"]
        let mut hierarchy = HashMap::new();
        hierarchy.insert("MyList".to_string(), vec!["Generic".to_string()]);
        hierarchy.insert("Generic".to_string(), vec![]);

        let mro = compute_mro("MyList", &hierarchy).unwrap();
        assert_eq!(mro, vec!["MyList", "Generic"]);
    }

    #[test]
    fn test_mro_generic_mapping() {
        // CST's InheritanceCollector strips generic params
        // e.g., "class Dict(Mapping[K, V])" -> bases: ["Mapping"]
        let mut hierarchy = HashMap::new();
        hierarchy.insert("Dict".to_string(), vec!["Mapping".to_string()]);
        hierarchy.insert("Mapping".to_string(), vec![]);

        let mro = compute_mro("Dict", &hierarchy).unwrap();
        assert_eq!(mro, vec!["Dict", "Mapping"]);
    }

    // ========================================================================
    // Helper Function Tests
    // ========================================================================

    #[test]
    fn test_merge_simple() {
        let mut seqs = vec![
            vec!["B".to_string(), "A".to_string()],
            vec!["B".to_string()],
        ];

        let result = merge(&mut seqs).unwrap();
        assert_eq!(result, vec!["B", "A"]);
    }

    #[test]
    fn test_merge_diamond() {
        // Merging for D(B, C) where B(A), C(A)
        let mut seqs = vec![
            vec!["B".to_string(), "A".to_string()], // MRO of B
            vec!["C".to_string(), "A".to_string()], // MRO of C
            vec!["B".to_string(), "C".to_string()], // Direct bases of D
        ];

        let result = merge(&mut seqs).unwrap();
        assert_eq!(result, vec!["B", "C", "A"]);
    }

    #[test]
    fn test_merge_empty() {
        let mut seqs: Vec<Vec<String>> = vec![];
        let result = merge(&mut seqs).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_merge_inconsistent() {
        // A appears before B in one list, B appears before A in another
        let mut seqs = vec![
            vec!["A".to_string(), "B".to_string()],
            vec!["B".to_string(), "A".to_string()],
        ];

        let result = merge(&mut seqs);
        assert!(result.is_none());
    }

    // ========================================================================
    // Cross-File Resolution Tests (Unit-level)
    // ========================================================================

    #[test]
    fn test_resolve_base_class_local() {
        use crate::cross_file_types::ClassHierarchyInfo;

        // Test that local classes return None (caller should use current context)
        let mut hierarchies = HashMap::new();
        hierarchies.insert(
            "LocalClass".to_string(),
            ClassHierarchyInfo {
                name: "LocalClass".to_string(),
                bases: vec![],
                mro: None,
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies,
        };

        let result = resolve_base_class("LocalClass", &ctx);
        assert!(result.is_none()); // Local classes return None
    }

    #[test]
    fn test_resolve_base_class_from_import() {
        use crate::cross_file_types::ImportTarget;
        use std::path::PathBuf;

        let mut import_targets = HashMap::new();
        import_targets.insert(
            (vec!["<module>".to_string()], "Handler".to_string()),
            ImportTarget {
                file_path: PathBuf::from("handler.py"),
                kind: ImportTargetKind::FromImport {
                    imported_name: "Handler".to_string(),
                    imported_module: false,
                },
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets,
            class_hierarchies: HashMap::new(),
        };

        let result = resolve_base_class("Handler", &ctx);
        assert!(result.is_some());
        let (class_name, file_path) = result.unwrap();
        assert_eq!(class_name, "Handler");
        assert_eq!(file_path, PathBuf::from("handler.py"));
    }

    #[test]
    fn test_resolve_base_class_dotted_module_import() {
        use crate::cross_file_types::ImportTarget;
        use std::path::PathBuf;

        let mut import_targets = HashMap::new();
        import_targets.insert(
            (vec!["<module>".to_string()], "mod".to_string()),
            ImportTarget {
                file_path: PathBuf::from("pkg/mod.py"),
                kind: ImportTargetKind::ModuleImport,
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets,
            class_hierarchies: HashMap::new(),
        };

        let result = resolve_base_class("mod.Base", &ctx);
        assert!(result.is_some());
        let (class_name, file_path) = result.unwrap();
        assert_eq!(class_name, "Base");
        assert_eq!(file_path, PathBuf::from("pkg/mod.py"));
    }

    #[test]
    fn test_resolve_base_class_dotted_submodule_import() {
        use crate::cross_file_types::ImportTarget;
        use std::path::PathBuf;

        let mut import_targets = HashMap::new();
        // `from pkg import mod` where mod is a submodule
        import_targets.insert(
            (vec!["<module>".to_string()], "mod".to_string()),
            ImportTarget {
                file_path: PathBuf::from("pkg/mod.py"),
                kind: ImportTargetKind::FromImport {
                    imported_name: "mod".to_string(),
                    imported_module: true, // This is key - it's a submodule
                },
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets,
            class_hierarchies: HashMap::new(),
        };

        let result = resolve_base_class("mod.Base", &ctx);
        assert!(result.is_some());
        let (class_name, file_path) = result.unwrap();
        assert_eq!(class_name, "Base");
        assert_eq!(file_path, PathBuf::from("pkg/mod.py"));
    }

    #[test]
    fn test_resolve_base_class_aliased_from_import() {
        use crate::cross_file_types::ImportTarget;
        use std::path::PathBuf;

        let mut import_targets = HashMap::new();
        // `from handler import Handler as H`
        import_targets.insert(
            (vec!["<module>".to_string()], "H".to_string()),
            ImportTarget {
                file_path: PathBuf::from("handler.py"),
                kind: ImportTargetKind::FromImport {
                    imported_name: "Handler".to_string(),
                    imported_module: false,
                },
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets,
            class_hierarchies: HashMap::new(),
        };

        let result = resolve_base_class("H", &ctx);
        assert!(result.is_some());
        let (class_name, file_path) = result.unwrap();
        assert_eq!(class_name, "Handler"); // Returns the original imported name
        assert_eq!(file_path, PathBuf::from("handler.py"));
    }

    #[test]
    fn test_resolve_base_class_module_import_as_base() {
        use crate::cross_file_types::ImportTarget;
        use std::path::PathBuf;

        let mut import_targets = HashMap::new();
        // `import mod` - module import cannot be used as a base class directly
        import_targets.insert(
            (vec!["<module>".to_string()], "mod".to_string()),
            ImportTarget {
                file_path: PathBuf::from("mod.py"),
                kind: ImportTargetKind::ModuleImport,
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets,
            class_hierarchies: HashMap::new(),
        };

        // "mod" alone (not "mod.Class") cannot be a base class
        let result = resolve_base_class("mod", &ctx);
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_base_class_unknown() {
        use std::path::PathBuf;

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: crate::type_tracker::TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: HashMap::new(),
        };

        let result = resolve_base_class("Unknown", &ctx);
        assert!(result.is_none());
    }

    // ========================================================================
    // MRO Stress Tests - Additional Edge Cases
    // ========================================================================

    #[test]
    fn test_mro_direct_self_inheritance() {
        // class A(A): pass - direct self-reference should be detected
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec!["A".to_string()]);

        let result = compute_mro("A", &hierarchy);
        assert!(result.is_err(), "Self-inheritance should fail");
    }

    #[test]
    fn test_mro_mutual_inheritance_cycle() {
        // class A(B): pass
        // class B(A): pass
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec!["B".to_string()]);
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);

        let result = compute_mro("A", &hierarchy);
        assert!(result.is_err(), "Mutual inheritance cycle should fail");
    }

    #[test]
    fn test_mro_three_way_cycle() {
        // class A(B): pass
        // class B(C): pass
        // class C(A): pass
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec!["B".to_string()]);
        hierarchy.insert("B".to_string(), vec!["C".to_string()]);
        hierarchy.insert("C".to_string(), vec!["A".to_string()]);

        let result = compute_mro("A", &hierarchy);
        assert!(result.is_err(), "Three-way cycle should fail");
    }

    #[test]
    fn test_mro_complex_diamond_with_extra_base() {
        // More complex diamond:
        //       A
        //      /|\
        //     B C D
        //      \|/
        //       E
        let mut hierarchy = HashMap::new();
        hierarchy.insert(
            "E".to_string(),
            vec!["B".to_string(), "C".to_string(), "D".to_string()],
        );
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        hierarchy.insert("C".to_string(), vec!["A".to_string()]);
        hierarchy.insert("D".to_string(), vec!["A".to_string()]);
        hierarchy.insert("A".to_string(), vec![]);

        let mro = compute_mro("E", &hierarchy).unwrap();
        // E, B, C, D, A - children before parent, left-to-right order
        assert_eq!(mro, vec!["E", "B", "C", "D", "A"]);
    }

    #[test]
    fn test_mro_double_diamond() {
        // Two diamonds stacked:
        //       A
        //      / \
        //     B   C
        //      \ /
        //       D
        //      / \
        //     E   F
        //      \ /
        //       G
        let mut hierarchy = HashMap::new();
        hierarchy.insert("G".to_string(), vec!["E".to_string(), "F".to_string()]);
        hierarchy.insert("E".to_string(), vec!["D".to_string()]);
        hierarchy.insert("F".to_string(), vec!["D".to_string()]);
        hierarchy.insert("D".to_string(), vec!["B".to_string(), "C".to_string()]);
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        hierarchy.insert("C".to_string(), vec!["A".to_string()]);
        hierarchy.insert("A".to_string(), vec![]);

        let mro = compute_mro("G", &hierarchy).unwrap();
        assert_eq!(mro, vec!["G", "E", "F", "D", "B", "C", "A"]);
    }

    #[test]
    fn test_mro_wide_inheritance() {
        // Class with many bases (tests performance and correctness with wide hierarchies)
        let mut hierarchy = HashMap::new();
        let bases: Vec<String> = (1..=10).map(|i| format!("Base{}", i)).collect();
        hierarchy.insert("Wide".to_string(), bases.clone());

        for base in &bases {
            hierarchy.insert(base.clone(), vec![]);
        }

        let mro = compute_mro("Wide", &hierarchy).unwrap();
        assert_eq!(mro.len(), 11); // Wide + 10 bases
        assert_eq!(mro[0], "Wide");
        for (i, base) in bases.iter().enumerate() {
            assert_eq!(&mro[i + 1], base);
        }
    }

    #[test]
    fn test_mro_very_deep_inheritance() {
        // 10-level deep inheritance chain
        let mut hierarchy = HashMap::new();
        let depth = 10;

        for i in 0..depth {
            let class_name = format!("Level{}", i);
            if i == 0 {
                hierarchy.insert(class_name, vec![]);
            } else {
                hierarchy.insert(class_name, vec![format!("Level{}", i - 1)]);
            }
        }

        let mro = compute_mro(&format!("Level{}", depth - 1), &hierarchy).unwrap();
        assert_eq!(mro.len(), depth);
        for i in 0..depth {
            assert_eq!(mro[i], format!("Level{}", depth - 1 - i));
        }
    }

    #[test]
    fn test_mro_python_classic_example() {
        // Classic Python MRO example from documentation
        // class O: pass
        // class A(O): pass
        // class B(O): pass
        // class C(O): pass
        // class D(O): pass
        // class E(O): pass
        // class K1(A, B, C): pass
        // class K2(D, B, E): pass
        // class K3(D, A): pass
        // class Z(K1, K2, K3): pass
        let mut hierarchy = HashMap::new();
        hierarchy.insert("O".to_string(), vec![]);
        hierarchy.insert("A".to_string(), vec!["O".to_string()]);
        hierarchy.insert("B".to_string(), vec!["O".to_string()]);
        hierarchy.insert("C".to_string(), vec!["O".to_string()]);
        hierarchy.insert("D".to_string(), vec!["O".to_string()]);
        hierarchy.insert("E".to_string(), vec!["O".to_string()]);
        hierarchy.insert(
            "K1".to_string(),
            vec!["A".to_string(), "B".to_string(), "C".to_string()],
        );
        hierarchy.insert(
            "K2".to_string(),
            vec!["D".to_string(), "B".to_string(), "E".to_string()],
        );
        hierarchy.insert("K3".to_string(), vec!["D".to_string(), "A".to_string()]);
        hierarchy.insert(
            "Z".to_string(),
            vec!["K1".to_string(), "K2".to_string(), "K3".to_string()],
        );

        let mro = compute_mro("Z", &hierarchy).unwrap();
        // Expected: Z, K1, K2, K3, D, A, B, C, E, O
        assert_eq!(
            mro,
            vec!["Z", "K1", "K2", "K3", "D", "A", "B", "C", "E", "O"]
        );
    }

    #[test]
    fn test_mro_inconsistent_hierarchy_variant_1() {
        // Python's classic inconsistent example:
        // class X(A, B): pass
        // class Y(B, A): pass
        // class Z(X, Y): pass  # This fails!
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec![]);
        hierarchy.insert("B".to_string(), vec![]);
        hierarchy.insert("X".to_string(), vec!["A".to_string(), "B".to_string()]);
        hierarchy.insert("Y".to_string(), vec!["B".to_string(), "A".to_string()]);
        hierarchy.insert("Z".to_string(), vec!["X".to_string(), "Y".to_string()]);

        let result = compute_mro("Z", &hierarchy);
        assert!(result.is_err(), "Inconsistent order of A and B should fail");
    }

    #[test]
    fn test_mro_inconsistent_hierarchy_variant_2() {
        // Another inconsistent pattern
        // class A: pass
        // class B(A): pass
        // class C(A, B): pass  # B before A, but B inherits from A
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec![]);
        hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        hierarchy.insert("C".to_string(), vec!["A".to_string(), "B".to_string()]);

        let result = compute_mro("C", &hierarchy);
        assert!(result.is_err(), "A before B when B(A) should fail");
    }

    #[test]
    fn test_mro_with_many_shared_ancestors() {
        // Multiple classes sharing multiple ancestors
        //     A   B
        //    /|\ /|\
        //   C D E F G
        //    \ | | /
        //      \ | /
        //        H
        let mut hierarchy = HashMap::new();
        hierarchy.insert("A".to_string(), vec![]);
        hierarchy.insert("B".to_string(), vec![]);
        hierarchy.insert("C".to_string(), vec!["A".to_string()]);
        hierarchy.insert("D".to_string(), vec!["A".to_string(), "B".to_string()]);
        hierarchy.insert("E".to_string(), vec!["A".to_string(), "B".to_string()]);
        hierarchy.insert("F".to_string(), vec!["B".to_string()]);
        hierarchy.insert("G".to_string(), vec!["B".to_string()]);
        hierarchy.insert(
            "H".to_string(),
            vec![
                "C".to_string(),
                "D".to_string(),
                "E".to_string(),
                "F".to_string(),
                "G".to_string(),
            ],
        );

        let mro = compute_mro("H", &hierarchy).unwrap();
        // Should produce valid MRO with A and B appearing once each at the end
        assert!(mro.contains(&"A".to_string()));
        assert!(mro.contains(&"B".to_string()));
        // A and B should appear after all their children
        let a_pos = mro.iter().position(|x| x == "A").unwrap();
        let b_pos = mro.iter().position(|x| x == "B").unwrap();
        let c_pos = mro.iter().position(|x| x == "C").unwrap();
        let d_pos = mro.iter().position(|x| x == "D").unwrap();
        assert!(c_pos < a_pos);
        assert!(d_pos < a_pos);
        assert!(d_pos < b_pos);
    }

    #[test]
    fn test_mro_mixin_pattern() {
        // Common mixin pattern:
        // class Mixin1: pass
        // class Mixin2: pass
        // class Base: pass
        // class Derived(Mixin1, Mixin2, Base): pass
        let mut hierarchy = HashMap::new();
        hierarchy.insert("Mixin1".to_string(), vec![]);
        hierarchy.insert("Mixin2".to_string(), vec![]);
        hierarchy.insert("Base".to_string(), vec![]);
        hierarchy.insert(
            "Derived".to_string(),
            vec![
                "Mixin1".to_string(),
                "Mixin2".to_string(),
                "Base".to_string(),
            ],
        );

        let mro = compute_mro("Derived", &hierarchy).unwrap();
        assert_eq!(mro, vec!["Derived", "Mixin1", "Mixin2", "Base"]);
    }

    #[test]
    fn test_mro_mixin_with_shared_base() {
        // Mixins that share a common base:
        // class CommonBase: pass
        // class Mixin1(CommonBase): pass
        // class Mixin2(CommonBase): pass
        // class Base(CommonBase): pass
        // class Derived(Mixin1, Mixin2, Base): pass
        let mut hierarchy = HashMap::new();
        hierarchy.insert("CommonBase".to_string(), vec![]);
        hierarchy.insert("Mixin1".to_string(), vec!["CommonBase".to_string()]);
        hierarchy.insert("Mixin2".to_string(), vec!["CommonBase".to_string()]);
        hierarchy.insert("Base".to_string(), vec!["CommonBase".to_string()]);
        hierarchy.insert(
            "Derived".to_string(),
            vec![
                "Mixin1".to_string(),
                "Mixin2".to_string(),
                "Base".to_string(),
            ],
        );

        let mro = compute_mro("Derived", &hierarchy).unwrap();
        assert_eq!(
            mro,
            vec!["Derived", "Mixin1", "Mixin2", "Base", "CommonBase"]
        );
    }

    #[test]
    fn test_mro_with_multiple_generic_bases() {
        // Multiple bases - CST's InheritanceCollector strips generic params
        // e.g., "class MyClass(List[T], Dict[K, V], Generic[T, K, V])"
        // produces bases: ["List", "Dict", "Generic"]
        let mut hierarchy = HashMap::new();
        hierarchy.insert(
            "MyClass".to_string(),
            vec![
                "List".to_string(),
                "Dict".to_string(),
                "Generic".to_string(),
            ],
        );
        hierarchy.insert("List".to_string(), vec![]);
        hierarchy.insert("Dict".to_string(), vec![]);
        hierarchy.insert("Generic".to_string(), vec![]);

        let mro = compute_mro("MyClass", &hierarchy).unwrap();
        assert_eq!(mro, vec!["MyClass", "List", "Dict", "Generic"]);
    }

    #[test]
    fn test_mro_partial_external_bases() {
        // Some bases are known, some are external
        let mut hierarchy = HashMap::new();
        hierarchy.insert(
            "MyClass".to_string(),
            vec![
                "KnownBase".to_string(),
                "ExternalBase".to_string(), // Not in hierarchy
                "AnotherKnown".to_string(),
            ],
        );
        hierarchy.insert("KnownBase".to_string(), vec![]);
        hierarchy.insert("AnotherKnown".to_string(), vec![]);

        let mro = compute_mro("MyClass", &hierarchy).unwrap();
        // Should include known bases and skip external
        assert_eq!(
            mro,
            vec!["MyClass", "KnownBase", "ExternalBase", "AnotherKnown"]
        );
    }

    #[test]
    fn test_merge_complex_sequences() {
        // Test merge with more complex sequence patterns
        let mut seqs = vec![
            vec![
                "A".to_string(),
                "B".to_string(),
                "C".to_string(),
                "D".to_string(),
            ],
            vec!["E".to_string(), "B".to_string(), "D".to_string()],
            vec![
                "F".to_string(),
                "C".to_string(),
                "D".to_string(),
                "E".to_string(),
            ],
            vec!["A".to_string(), "E".to_string(), "F".to_string()],
        ];

        let result = merge(&mut seqs);
        // This should succeed - verify all elements present in correct order
        if let Some(merged) = result {
            // All elements should be present
            assert!(merged.contains(&"A".to_string()));
            assert!(merged.contains(&"B".to_string()));
            assert!(merged.contains(&"C".to_string()));
            assert!(merged.contains(&"D".to_string()));
            assert!(merged.contains(&"E".to_string()));
            assert!(merged.contains(&"F".to_string()));

            // Check relative ordering constraints
            let pos = |s: &str| merged.iter().position(|x| x == s).unwrap();
            assert!(pos("A") < pos("B")); // From seq 0
            assert!(pos("E") < pos("B")); // From seq 1
            assert!(pos("F") < pos("C")); // From seq 2
        }
    }

    #[test]
    fn test_merge_all_same_element() {
        // All sequences have the same single element
        let mut seqs = vec![
            vec!["A".to_string()],
            vec!["A".to_string()],
            vec!["A".to_string()],
        ];

        let result = merge(&mut seqs).unwrap();
        assert_eq!(result, vec!["A"]);
    }

    #[test]
    fn test_mro_single_base_deep_chain() {
        // A single inheritance chain to verify basic functionality
        // Level0 <- Level1 <- Level2 <- ... <- Level19
        let mut hierarchy = HashMap::new();
        let depth = 20;

        for i in 0..depth {
            let class_name = format!("Level{}", i);
            if i == 0 {
                hierarchy.insert(class_name, vec![]);
            } else {
                hierarchy.insert(class_name, vec![format!("Level{}", i - 1)]);
            }
        }

        let mro = compute_mro(&format!("Level{}", depth - 1), &hierarchy).unwrap();
        assert_eq!(mro.len(), depth);

        // Verify each level appears in correct order (newest to oldest)
        for i in 0..depth {
            assert_eq!(mro[i], format!("Level{}", depth - 1 - i));
        }
    }

    #[test]
    fn test_mro_realistic_django_like_hierarchy() {
        // Simulate a Django-like model hierarchy
        // Model <- AbstractBaseUser <- PermissionsMixin <- AbstractUser <- User
        // with managers mixed in
        let mut hierarchy = HashMap::new();
        hierarchy.insert("Model".to_string(), vec![]);
        hierarchy.insert("AbstractBaseUser".to_string(), vec!["Model".to_string()]);
        hierarchy.insert("PermissionsMixin".to_string(), vec!["Model".to_string()]);
        hierarchy.insert(
            "AbstractUser".to_string(),
            vec![
                "AbstractBaseUser".to_string(),
                "PermissionsMixin".to_string(),
            ],
        );
        hierarchy.insert("User".to_string(), vec!["AbstractUser".to_string()]);

        let mro = compute_mro("User", &hierarchy).unwrap();
        assert_eq!(
            mro,
            vec![
                "User",
                "AbstractUser",
                "AbstractBaseUser",
                "PermissionsMixin",
                "Model"
            ]
        );
    }

    // ========================================================================
    // MRO-Based Attribute Lookup Tests (Step 5)
    // ========================================================================

    /// Helper function to build a TypeTracker from source code.
    fn build_type_tracker_from_source(source: &str) -> crate::type_tracker::TypeTracker {
        let analysis = crate::cst_bridge::parse_and_analyze(source).unwrap();

        let mut tracker = crate::type_tracker::TypeTracker::new();

        // Convert CST assignments to types::AssignmentInfo
        let assignments: Vec<crate::types::AssignmentInfo> = analysis
            .assignments
            .iter()
            .map(|a| crate::types::AssignmentInfo {
                target: a.target.clone(),
                scope_path: a.scope_path.clone(),
                type_source: a.type_source.as_str().to_string(),
                inferred_type: a.inferred_type.clone(),
                rhs_name: a.rhs_name.clone(),
                callee_name: a.callee_name.clone(),
                span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                    start: s.start,
                    end: s.end,
                }),
                line: a.line,
                col: a.col,
                is_self_attribute: a.is_self_attribute,
                attribute_name: a.attribute_name.clone(),
            })
            .collect();

        // Convert CST annotations to types::AnnotationInfo
        let annotations: Vec<crate::types::AnnotationInfo> = analysis
            .annotations
            .iter()
            .map(|a| crate::types::AnnotationInfo {
                name: a.name.clone(),
                annotation_kind: a.annotation_kind.as_str().to_string(),
                source_kind: a.source_kind.as_str().to_string(),
                type_str: a.type_str.clone(),
                scope_path: a.scope_path.clone(),
                span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                    start: s.start,
                    end: s.end,
                }),
                line: a.line,
                col: a.col,
                type_node: a.type_node.clone(),
                // Pass through the string annotation span (enables renaming type references
                // inside forward reference strings like "Handler" - see Phase 14 Step 1.0)
                annotation_span: a.annotation_span.as_ref().map(|s| crate::types::SpanInfo {
                    start: s.start,
                    end: s.end,
                }),
            })
            .collect();

        // Convert CST signatures to adapter SignatureData
        let adapter_signatures: Vec<_> = analysis
            .signatures
            .iter()
            .map(crate::analyzer::convert_cst_signature)
            .collect();

        tracker.process_annotations(&annotations);
        tracker.process_instance_attributes(&assignments);
        tracker.process_signatures(&adapter_signatures);
        tracker.process_properties(&adapter_signatures);
        tracker.process_assignments(&assignments);
        tracker.resolve_types();

        tracker
    }

    /// Test Fixture 11D-F03: Single inheritance MRO attribute lookup.
    ///
    /// class Animal:
    ///     name: str
    ///
    /// class Dog(Animal):
    ///     def bark(self): pass
    ///
    /// d: Dog = Dog()
    /// d.name  # Should resolve to Animal.name via MRO
    #[test]
    fn test_mro_attr_single_inheritance() {
        use crate::analyzer::analyze_file;
        use crate::cross_file_types::{build_class_hierarchies, CrossFileTypeCache};
        use std::collections::HashSet;
        use tugtool_core::patch::FileId;

        let source = r#"class Animal:
    name: str

class Dog(Animal):
    def bark(self): pass

d: Dog = Dog()
"#;

        // Analyze the file
        let analysis = analyze_file(FileId::new(0), "test.py", source).unwrap();
        let hierarchies = build_class_hierarchies(&analysis);

        // Build type tracker
        let tracker = build_type_tracker_from_source(source);

        // Create FileTypeContext - we need one for the cache and one for the test call
        let ctx_for_cache = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: tracker.clone(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies.clone(),
        };
        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker,
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies,
        };

        // Create cache and insert the context
        let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);
        cache.insert_context(PathBuf::from("test.py"), ctx_for_cache);

        // Test: Dog has "bark" as its own method
        let bark_attr = ctx.attribute_type_of_with_mro("Dog", "bark", &mut cache, Path::new("."));
        assert!(bark_attr.is_none()); // bark is a method, not an attribute with type annotation

        // Test: Dog inherits "name" from Animal via MRO
        let name_attr = ctx.attribute_type_of_with_mro("Dog", "name", &mut cache, Path::new("."));
        assert!(
            name_attr.is_some(),
            "Dog should have 'name' from Animal via MRO"
        );
        assert_eq!(name_attr.unwrap().type_str, "str");
    }

    /// Test Fixture 11D-F04: Diamond inheritance MRO attribute lookup.
    ///
    /// class A:
    ///     attr: int
    ///
    /// class B(A):
    ///     pass
    ///
    /// class C(A):
    ///     attr: str  # Override
    ///
    /// class D(B, C):
    ///     pass
    ///
    /// d: D = D()
    /// d.attr  # Should resolve to C.attr (C3 linearization: D, B, C, A)
    #[test]
    fn test_mro_attr_diamond_inheritance() {
        use crate::analyzer::analyze_file;
        use crate::cross_file_types::{build_class_hierarchies, CrossFileTypeCache};
        use std::collections::HashSet;
        use tugtool_core::patch::FileId;

        let source = r#"class A:
    attr: int

class B(A):
    pass

class C(A):
    attr: str

class D(B, C):
    pass
"#;

        // Analyze the file
        let analysis = analyze_file(FileId::new(0), "test.py", source).unwrap();
        let hierarchies = build_class_hierarchies(&analysis);

        // Build type tracker
        let tracker = build_type_tracker_from_source(source);

        // Create FileTypeContext - we need one for the cache and one for the test call
        let ctx_for_cache = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: tracker.clone(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies.clone(),
        };
        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker,
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies,
        };

        // Create cache and insert the context
        let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);
        cache.insert_context(PathBuf::from("test.py"), ctx_for_cache);

        // Test: D's attr should be C.attr (str) per C3 linearization
        // MRO: D, B, C, A - C comes before A, so C's override is found first
        let attr = ctx.attribute_type_of_with_mro("D", "attr", &mut cache, Path::new("."));
        assert!(attr.is_some(), "D should have 'attr' via MRO");
        assert_eq!(
            attr.unwrap().type_str,
            "str",
            "D.attr should be str from C, not int from A"
        );
    }

    /// Test: Verify MRO computation for diamond inheritance is correct.
    #[test]
    fn test_mro_attr_diamond_mro_order() {
        use crate::cross_file_types::ClassHierarchyInfo;

        // Build hierarchy for diamond pattern
        let mut hierarchies = HashMap::new();
        hierarchies.insert(
            "A".to_string(),
            ClassHierarchyInfo {
                name: "A".to_string(),
                bases: vec![],
                mro: None,
            },
        );
        hierarchies.insert(
            "B".to_string(),
            ClassHierarchyInfo {
                name: "B".to_string(),
                bases: vec!["A".to_string()],
                mro: None,
            },
        );
        hierarchies.insert(
            "C".to_string(),
            ClassHierarchyInfo {
                name: "C".to_string(),
                bases: vec!["A".to_string()],
                mro: None,
            },
        );
        hierarchies.insert(
            "D".to_string(),
            ClassHierarchyInfo {
                name: "D".to_string(),
                bases: vec!["B".to_string(), "C".to_string()],
                mro: None,
            },
        );

        // Build flat hierarchy for compute_mro
        let mut flat_hierarchy = HashMap::new();
        flat_hierarchy.insert("A".to_string(), vec![]);
        flat_hierarchy.insert("B".to_string(), vec!["A".to_string()]);
        flat_hierarchy.insert("C".to_string(), vec!["A".to_string()]);
        flat_hierarchy.insert("D".to_string(), vec!["B".to_string(), "C".to_string()]);

        let mro = compute_mro("D", &flat_hierarchy).unwrap();
        assert_eq!(mro, vec!["D", "B", "C", "A"]);
    }

    /// Test: Method return type lookup via MRO.
    #[test]
    fn test_mro_attr_method_return_type() {
        use crate::analyzer::analyze_file;
        use crate::cross_file_types::{build_class_hierarchies, CrossFileTypeCache};
        use std::collections::HashSet;
        use tugtool_core::patch::FileId;

        let source = r#"class Base:
    def process(self) -> str:
        return "result"

class Derived(Base):
    pass
"#;

        // Analyze the file
        let analysis = analyze_file(FileId::new(0), "test.py", source).unwrap();
        let hierarchies = build_class_hierarchies(&analysis);

        // Build type tracker
        let tracker = build_type_tracker_from_source(source);

        // Create FileTypeContext - we need one for the cache and one for the test call
        let ctx_for_cache = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: tracker.clone(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies.clone(),
        };
        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker,
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies,
        };

        // Create cache and insert the context
        let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);
        cache.insert_context(PathBuf::from("test.py"), ctx_for_cache);

        // Test: Derived inherits "process" from Base
        let process_attr =
            ctx.attribute_type_of_with_mro("Derived", "process", &mut cache, Path::new("."));
        assert!(
            process_attr.is_some(),
            "Derived should have 'process' from Base via MRO"
        );
        assert_eq!(process_attr.unwrap().type_str, "str");
    }

    /// Test: MRO cache is populated after computation.
    #[test]
    fn test_mro_attr_cache_populated() {
        use crate::cross_file_types::ClassHierarchyInfo;
        use crate::cross_file_types::{CrossFileTypeCache, FileTypeContext};
        use crate::type_tracker::TypeTracker;
        use std::collections::HashSet;
        use std::path::PathBuf;

        // Create a simple hierarchy
        let mut hierarchies = HashMap::new();
        hierarchies.insert(
            "Base".to_string(),
            ClassHierarchyInfo {
                name: "Base".to_string(),
                bases: vec![],
                mro: None,
            },
        );
        hierarchies.insert(
            "Child".to_string(),
            ClassHierarchyInfo {
                name: "Child".to_string(),
                bases: vec!["Base".to_string()],
                mro: None,
            },
        );

        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies,
        };

        // Create cache and insert context
        let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Insert context into cache using test helper
        cache.insert_context(PathBuf::from("test.py"), ctx);

        // Cache MRO using MROEntry format
        let mro_entries = vec![
            MROEntry::new("Child", PathBuf::from("test.py")),
            MROEntry::new("Base", PathBuf::from("test.py")),
        ];
        cache.cache_mro(Path::new("test.py"), "Child", mro_entries);

        // Verify cache
        let cached_mro = cache.get_cached_mro(Path::new("test.py"), "Child");
        assert!(cached_mro.is_some());
        let mro = cached_mro.unwrap();
        assert_eq!(mro.len(), 2);
        assert_eq!(mro[0].class_name, "Child");
        assert_eq!(mro[1].class_name, "Base");
    }

    /// Test Fixture 11D-F14: Multi-hop cross-file inheritance.
    ///
    /// Tests MRO-based attribute lookup through multiple file boundaries:
    /// - root.py: class Root with method `root() -> str`
    /// - base.py: class Base(Root) imports from root
    /// - mid.py: class Mid(Base) imports from base
    ///
    /// Expected: Mid().root() should resolve to Root.root via cross-file MRO
    #[test]
    fn test_mro_attr_multi_hop_cross_file() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        // Create temp directory with test files
        let temp_dir = TempDir::new().unwrap();
        let root_path = temp_dir.path().join("root.py");
        let base_path = temp_dir.path().join("base.py");
        let mid_path = temp_dir.path().join("mid.py");

        // root.py - defines Root class with `root()` method
        let root_content = r#"class Root:
    def root(self) -> str:
        return "ok"
"#;

        // base.py - Base inherits from Root
        let base_content = r#"from root import Root

class Base(Root):
    pass
"#;

        // mid.py - Mid inherits from Base
        let mid_content = r#"from base import Base

class Mid(Base):
    pass
"#;

        // Write all files
        std::fs::write(&root_path, root_content).unwrap();
        std::fs::write(&base_path, base_content).unwrap();
        std::fs::write(&mid_path, mid_content).unwrap();

        // Build workspace files set (relative paths from temp_dir)
        let workspace_files: HashSet<String> = [
            "root.py".to_string(),
            "base.py".to_string(),
            "mid.py".to_string(),
        ]
        .into_iter()
        .collect();
        let namespace_packages = HashSet::new();

        // Create cache
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // First, analyze mid.py and verify its hierarchy
        {
            let mid_ctx = cache.get_or_analyze(&mid_path, temp_dir.path()).unwrap();

            // Get the class hierarchies - Mid should have Base as its base
            assert!(mid_ctx.class_hierarchies.contains_key("Mid"));
            let mid_hierarchy = mid_ctx.class_hierarchies.get("Mid").unwrap();
            assert_eq!(mid_hierarchy.bases, vec!["Base"]);
        }
        // Reference dropped here, cache is no longer borrowed

        // Now test MRO-based attribute lookup on Mid for "root" method
        // We need to re-acquire the context reference within a fresh scope
        // to call attribute_type_of_with_mro which needs &mut cache
        //
        // The lookup should:
        // 1. Not find "root" in Mid (it has no methods)
        // 2. Follow MRO through Base -> Root and find Root.root
        //
        // Since attribute_type_of_with_mro takes &self (FileTypeContext) and &mut cache,
        // we need to avoid holding a reference to cache while calling it.
        // The solution is to use lookup_attr_in_mro directly which is designed for this case.
        let root_attr = {
            let mid_ctx = cache.get_or_analyze(&mid_path, temp_dir.path()).unwrap();
            // Clone the hierarchies we need
            let mid_hierarchies = mid_ctx.class_hierarchies.clone();
            let mid_tracker = mid_ctx.tracker.clone();
            let mid_import_targets = mid_ctx.import_targets.clone();

            // Build a new context to pass to lookup (we own this data now)
            let owned_ctx = FileTypeContext {
                file_path: PathBuf::from("mid.py"),
                tracker: mid_tracker,
                symbol_kinds: HashMap::new(),
                symbol_map: HashMap::new(),
                import_targets: mid_import_targets,
                class_hierarchies: mid_hierarchies,
            };

            // Now we can call with &mut cache since we don't hold a reference to cache
            owned_ctx.attribute_type_of_with_mro("Mid", "root", &mut cache, temp_dir.path())
        };

        // The "root" method should be found via MRO with return type "str"
        assert!(
            root_attr.is_some(),
            "Mid should have 'root' method via MRO chain: Mid -> Base -> Root"
        );
        assert_eq!(
            root_attr.unwrap().type_str,
            "str",
            "Root.root() should return str"
        );
    }

    /// Test Fixture 11D-F05: Property Decorator.
    ///
    /// class Person:
    ///     _name: str
    ///
    ///     @property
    ///     def name(self) -> str:
    ///         return self._name
    ///
    /// p: Person = Person()
    /// p.name  # Should resolve to str via property return type
    #[test]
    fn test_property_decorator_fixture_11d_f05() {
        let source = r#"
class Person:
    _name: str

    @property
    def name(self) -> str:
        return self._name

p: Person = Person()
"#;

        let tracker = build_type_tracker_from_source(source);

        // Direct property lookup
        let prop = tracker.property_type_of("Person", "name");
        assert!(prop.is_some(), "Person.name property should be tracked");
        assert_eq!(
            prop.unwrap().type_str,
            "str",
            "Person.name property should have type str"
        );

        // Attribute fallback should also work
        let attr = tracker.attribute_type_of("Person", "name");
        assert!(
            attr.is_some(),
            "attribute_type_of should fall back to property"
        );
        assert_eq!(
            attr.unwrap().type_str,
            "str",
            "attribute_type_of fallback should return str"
        );
    }

    /// Test Fixture 11D-F08: Inherited Property.
    ///
    /// class Base:
    ///     @property
    ///     def value(self) -> int:
    ///         return 42
    ///
    /// class Derived(Base):
    ///     pass
    ///
    /// d: Derived = Derived()
    /// d.value  # Should resolve to int via inherited property
    #[test]
    fn test_inherited_property_fixture_11d_f08() {
        use crate::analyzer::analyze_file;
        use crate::cross_file_types::{build_class_hierarchies, CrossFileTypeCache};
        use std::collections::HashSet;
        use tugtool_core::patch::FileId;

        let source = r#"
class Base:
    @property
    def value(self) -> int:
        return 42

class Derived(Base):
    pass

d: Derived = Derived()
"#;

        // Analyze the file
        let analysis = analyze_file(FileId::new(0), "test.py", source).unwrap();
        let hierarchies = build_class_hierarchies(&analysis);

        // Build type tracker
        let tracker = build_type_tracker_from_source(source);

        // Create contexts for cache and test
        let ctx_for_cache = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker: tracker.clone(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies.clone(),
        };
        let ctx = FileTypeContext {
            file_path: PathBuf::from("test.py"),
            tracker,
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: hierarchies,
        };

        // Create cache and insert the context
        let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);
        cache.insert_context(PathBuf::from("test.py"), ctx_for_cache);

        // Look up inherited property via MRO
        let value_attr =
            ctx.attribute_type_of_with_mro("Derived", "value", &mut cache, Path::new("."));
        assert!(
            value_attr.is_some(),
            "Derived should have 'value' property inherited from Base"
        );
        assert_eq!(
            value_attr.unwrap().type_str,
            "int",
            "Inherited property should return int"
        );
    }

    // ========================================================================
    // Type Stub Integration Tests - Phase 11D Step 7
    // ========================================================================

    /// Fixture 11D-F06: Type Stub Override
    ///
    /// Tests that stub types override source types when a .pyi file exists.
    ///
    /// Source file has:
    /// ```python
    /// # service.py
    /// class Service:
    ///     def process(self):
    ///         return "result"
    /// ```
    ///
    /// Stub file has:
    /// ```python
    /// # service.pyi (stub)
    /// class Service:
    ///     def process(self) -> str: ...
    /// ```
    ///
    /// Consumer expects `result = s.process()` to resolve to type `str`.
    #[test]
    fn test_stub_override_fixture_11d_f06() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // Create service.py (source file - no return type annotation)
        let source_content = r#"class Service:
    def process(self):
        return "result"
"#;
        std::fs::write(workspace_root.join("service.py"), source_content).unwrap();

        // Create service.pyi (stub file - with return type annotation)
        let stub_content = r#"class Service:
    def process(self) -> str: ...
"#;
        std::fs::write(workspace_root.join("service.pyi"), stub_content).unwrap();

        let workspace_files: HashSet<String> = ["service.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Analyze source file
        let source = std::fs::read_to_string(workspace_root.join("service.py")).unwrap();
        let mut source_tracker = build_type_tracker_from_source(&source);

        // Source tracker should NOT have return type (no annotation in source)
        let source_return = source_tracker.method_return_type_of("Service", "process");
        assert!(
            source_return.is_none(),
            "Source should not have return type annotation"
        );

        // Load stub and merge
        let stub_tracker = cache.load_stub_if_exists(Path::new("service.py"), workspace_root);
        assert!(stub_tracker.is_some(), "Stub should be found");
        source_tracker.merge_from_stub(stub_tracker.unwrap());

        // After merge, return type should come from stub
        let merged_return = source_tracker.method_return_type_of("Service", "process");
        assert_eq!(
            merged_return.map(|t| t.type_str.as_str()),
            Some("str"),
            "After stub merge, process() should return str"
        );
    }

    /// Fixture 11D-F11: Project-Level Stubs Directory
    ///
    /// Tests that stubs in the workspace `stubs/` directory are discovered
    /// and used when no inline stub exists.
    ///
    /// ```python
    /// # stubs/service.pyi
    /// class Service:
    ///     def process(self) -> str: ...
    ///
    /// # service.py
    /// class Service:
    ///     def process(self):
    ///         return 123  # runtime type differs
    /// ```
    #[test]
    fn test_stubs_directory_fixture_11d_f11() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // Create service.py (source file - runtime returns int, but stub says str)
        let source_content = r#"class Service:
    def process(self):
        return 123  # runtime type differs from stub
"#;
        std::fs::write(workspace_root.join("service.py"), source_content).unwrap();

        // Create stubs/ directory with service.pyi
        std::fs::create_dir(workspace_root.join("stubs")).unwrap();
        let stub_content = r#"class Service:
    def process(self) -> str: ...
"#;
        std::fs::write(workspace_root.join("stubs/service.pyi"), stub_content).unwrap();

        let workspace_files: HashSet<String> = ["service.py".to_string()].into_iter().collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Analyze source file
        let source = std::fs::read_to_string(workspace_root.join("service.py")).unwrap();
        let mut source_tracker = build_type_tracker_from_source(&source);

        // Load stub from stubs/ directory
        let stub_tracker = cache.load_stub_if_exists(Path::new("service.py"), workspace_root);
        assert!(
            stub_tracker.is_some(),
            "Stub should be found in stubs/ directory"
        );

        // Verify stub path is from stubs/
        let cached_stub = cache.get_stub_path(Path::new("service.py"));
        assert!(cached_stub.is_some());
        assert_eq!(cached_stub.unwrap().to_str().unwrap(), "stubs/service.pyi");

        // Merge stub
        source_tracker.merge_from_stub(stub_tracker.unwrap());

        // Return type should be str from stub (not int from runtime)
        let merged_return = source_tracker.method_return_type_of("Service", "process");
        assert_eq!(
            merged_return.map(|t| t.type_str.as_str()),
            Some("str"),
            "After stub merge, process() should return str (not int)"
        );
    }

    // ========================================================================
    // End-to-End Integration Tests - Phase 11D Step 9
    // ========================================================================

    /// Fixture 11D-F01: Cross-File Attribute Resolution
    ///
    /// Tests basic cross-file attribute resolution where an attribute's type
    /// is defined in a different file.
    ///
    /// ```python
    /// # handler.py
    /// class Handler:
    ///     def process(self) -> str:
    ///         return "done"
    ///
    /// # service.py
    /// from handler import Handler
    /// class Service:
    ///     handler: Handler
    ///     def run(self):
    ///         self.handler.process()  # Should resolve to Handler.process
    /// ```
    #[test]
    fn test_cross_file_attribute_resolution_fixture_11d_f01() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // handler.py
        let handler_content = r#"class Handler:
    def process(self) -> str:
        return "done"
"#;
        std::fs::write(workspace_root.join("handler.py"), handler_content).unwrap();

        // service.py
        let service_content = r#"from handler import Handler

class Service:
    handler: Handler

    def run(self):
        self.handler.process()
"#;
        std::fs::write(workspace_root.join("service.py"), service_content).unwrap();

        // Build workspace
        let workspace_files: HashSet<String> = ["handler.py", "service.py"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Analyze service.py
        let service_ctx = cache
            .get_or_analyze(&workspace_root.join("service.py"), workspace_root)
            .expect("service.py should analyze successfully");

        // Verify Service has handler attribute with type Handler
        let handler_attr = service_ctx.tracker.attribute_type_of("Service", "handler");
        assert!(
            handler_attr.is_some(),
            "Service should have 'handler' attribute"
        );
        assert_eq!(handler_attr.unwrap().type_str, "Handler");

        // Verify Handler.process method return type is available
        let handler_ctx = cache
            .get_or_analyze(&workspace_root.join("handler.py"), workspace_root)
            .expect("handler.py should analyze successfully");

        let process_return = handler_ctx
            .tracker
            .method_return_type_of("Handler", "process");
        assert_eq!(
            process_return.map(|t| t.type_str.as_str()),
            Some("str"),
            "Handler.process should return str"
        );
    }

    /// Fixture 11D-F02: Cross-File Chain (Two Hops)
    ///
    /// Tests cross-file resolution through two levels of inheritance.
    ///
    /// ```python
    /// # base.py
    /// class Base:
    ///     def method(self) -> int:
    ///         return 42
    ///
    /// # middle.py
    /// from base import Base
    /// class Middle(Base):
    ///     pass
    ///
    /// # consumer.py
    /// from middle import Middle
    /// class Consumer:
    ///     obj: Middle
    ///     def use(self):
    ///         self.obj.method()  # Should resolve to Base.method via MRO
    /// ```
    #[test]
    fn test_cross_file_chain_two_hops_fixture_11d_f02() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // base.py
        std::fs::write(
            workspace_root.join("base.py"),
            r#"class Base:
    def method(self) -> int:
        return 42
"#,
        )
        .unwrap();

        // middle.py
        std::fs::write(
            workspace_root.join("middle.py"),
            r#"from base import Base

class Middle(Base):
    pass
"#,
        )
        .unwrap();

        // consumer.py
        std::fs::write(
            workspace_root.join("consumer.py"),
            r#"from middle import Middle

class Consumer:
    obj: Middle

    def use(self):
        self.obj.method()
"#,
        )
        .unwrap();

        // Build workspace
        let workspace_files: HashSet<String> = ["base.py", "middle.py", "consumer.py"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Analyze all files to populate cache
        cache
            .get_or_analyze(&workspace_root.join("base.py"), workspace_root)
            .expect("base.py should analyze");
        cache
            .get_or_analyze(&workspace_root.join("middle.py"), workspace_root)
            .expect("middle.py should analyze");

        // The key test: Middle inherits Base.method via MRO
        let middle_ctx = cache
            .get_or_analyze(&workspace_root.join("middle.py"), workspace_root)
            .unwrap();
        let middle_hierarchies = middle_ctx.class_hierarchies.clone();
        let middle_tracker = middle_ctx.tracker.clone();
        let middle_import_targets = middle_ctx.import_targets.clone();

        let owned_ctx = FileTypeContext {
            file_path: PathBuf::from("middle.py"),
            tracker: middle_tracker,
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: middle_import_targets,
            class_hierarchies: middle_hierarchies,
        };

        let method_attr =
            owned_ctx.attribute_type_of_with_mro("Middle", "method", &mut cache, workspace_root);
        assert!(
            method_attr.is_some(),
            "Middle should have 'method' via MRO from Base"
        );
        assert_eq!(
            method_attr.unwrap().type_str,
            "int",
            "Base.method should return int"
        );
    }

    /// Fixture 11D-F12: Aliased From-Import
    ///
    /// Tests that aliased imports are handled correctly for type resolution.
    ///
    /// ```python
    /// # handler.py
    /// class Handler:
    ///     def process(self) -> str:
    ///         return "ok"
    ///
    /// # consumer.py
    /// from handler import Handler as H
    /// h: H = H()
    /// h.process()  # Should resolve to Handler.process via alias
    /// ```
    #[test]
    fn test_aliased_from_import_fixture_11d_f12() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // handler.py
        std::fs::write(
            workspace_root.join("handler.py"),
            r#"class Handler:
    def process(self) -> str:
        return "ok"
"#,
        )
        .unwrap();

        // consumer.py with aliased import
        std::fs::write(
            workspace_root.join("consumer.py"),
            r#"from handler import Handler as H

h: H = H()
"#,
        )
        .unwrap();

        let workspace_files: HashSet<String> = ["handler.py", "consumer.py"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Analyze consumer.py
        let consumer_ctx = cache
            .get_or_analyze(&workspace_root.join("consumer.py"), workspace_root)
            .expect("consumer.py should analyze");

        // Verify import target resolves H -> handler.py:Handler
        let import_target = consumer_ctx
            .import_targets
            .get(&(vec!["<module>".to_string()], "H".to_string()));
        assert!(import_target.is_some(), "H should be in import_targets");
        assert_eq!(
            import_target.unwrap().file_path.to_str().unwrap(),
            "handler.py"
        );
    }

    /// Fixture 11D-F15: From-Import Submodule
    ///
    /// Tests that `from pkg import mod` imports are handled correctly.
    ///
    /// ```python
    /// # pkg/mod.py
    /// class Worker:
    ///     def run(self) -> int:
    ///         return 1
    ///
    /// # consumer.py
    /// from pkg import mod
    /// mod.Worker().run()
    /// ```
    #[test]
    fn test_from_import_submodule_fixture_11d_f15() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // Create pkg/ directory
        std::fs::create_dir(workspace_root.join("pkg")).unwrap();

        // pkg/__init__.py (empty)
        std::fs::write(workspace_root.join("pkg/__init__.py"), "").unwrap();

        // pkg/mod.py
        std::fs::write(
            workspace_root.join("pkg/mod.py"),
            r#"class Worker:
    def run(self) -> int:
        return 1
"#,
        )
        .unwrap();

        // consumer.py
        std::fs::write(
            workspace_root.join("consumer.py"),
            r#"from pkg import mod

w = mod.Worker()
"#,
        )
        .unwrap();

        let workspace_files: HashSet<String> = ["pkg/__init__.py", "pkg/mod.py", "consumer.py"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Analyze consumer.py
        let consumer_ctx = cache
            .get_or_analyze(&workspace_root.join("consumer.py"), workspace_root)
            .expect("consumer.py should analyze");

        // Verify 'mod' is recognized as an import target pointing to pkg/mod.py
        let import_target = consumer_ctx
            .import_targets
            .get(&(vec!["<module>".to_string()], "mod".to_string()));
        assert!(import_target.is_some(), "mod should be in import_targets");

        // Verify Worker class is available in pkg/mod.py
        let mod_ctx = cache
            .get_or_analyze(&workspace_root.join("pkg/mod.py"), workspace_root)
            .expect("pkg/mod.py should analyze");

        let worker_return = mod_ctx.tracker.method_return_type_of("Worker", "run");
        assert_eq!(
            worker_return.map(|t| t.type_str.as_str()),
            Some("int"),
            "Worker.run should return int"
        );
    }

    /// Performance test: Verify resolution completes within acceptable time
    /// for a project with 50 files.
    #[test]
    fn test_performance_50_file_project() {
        use crate::cross_file_types::CrossFileTypeCache;
        use std::collections::HashSet;
        use std::time::Instant;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let workspace_root = temp_dir.path();

        // Create 50 files with simple classes
        let mut workspace_files = HashSet::new();
        for i in 0..50 {
            let filename = format!("file_{}.py", i);
            let content = format!(
                r#"class Class{}:
    attr: int
    def method(self) -> str:
        return "result"
"#,
                i
            );
            std::fs::write(workspace_root.join(&filename), content).unwrap();
            workspace_files.insert(filename);
        }

        // Create a consumer file that imports several of them
        let consumer_content = r#"from file_0 import Class0
from file_10 import Class10
from file_20 import Class20
from file_30 import Class30
from file_40 import Class40

class Consumer:
    a: Class0
    b: Class10
    c: Class20
    d: Class30
    e: Class40
"#;
        std::fs::write(workspace_root.join("consumer.py"), consumer_content).unwrap();
        workspace_files.insert("consumer.py".to_string());

        let namespace_packages = HashSet::new();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Time the analysis
        let start = Instant::now();

        // Analyze all 50 files
        for i in 0..50 {
            let filename = format!("file_{}.py", i);
            let _ = cache.get_or_analyze(&workspace_root.join(&filename), workspace_root);
        }
        // Analyze consumer.py
        let _ = cache.get_or_analyze(&workspace_root.join("consumer.py"), workspace_root);

        let elapsed = start.elapsed();

        // Should complete in under 100ms (generous threshold for CI environments)
        assert!(
            elapsed.as_millis() < 100,
            "50-file analysis took {}ms, should be <100ms",
            elapsed.as_millis()
        );
    }
}

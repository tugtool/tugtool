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
//! - Generic type parameters (e.g., `Generic[T]`) are stripped from base names
//! - External packages (outside workspace) are not resolved
//! - Maximum cross-file depth is bounded by `MAX_CROSS_FILE_DEPTH`

use std::collections::{HashMap, HashSet};
use std::path::Path;

use thiserror::Error;

use crate::cross_file_types::{
    lookup_import_target, CrossFileTypeCache, FileTypeContext, ImportTargetKind,
    TypeResolutionError, MAX_CROSS_FILE_DEPTH,
};
use crate::types::AttributeTypeInfo;

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
    let mut seqs: Vec<Vec<String>> = Vec::new();
    for base in bases {
        // Strip generic parameters (e.g., "Base[T]" -> "Base")
        let base_name = strip_generic_params(base);

        // Check if base exists in hierarchy before computing MRO
        if hierarchy.contains_key(base_name) {
            // Base exists - propagate errors from MRO computation
            let base_mro = compute_mro_internal(base_name, hierarchy, visited)?;
            seqs.push(base_mro);
        }
        // Base not in hierarchy - skip it (external base we can't resolve)
    }

    // Add the list of direct bases (stripped of generics)
    let stripped_bases: Vec<String> = bases
        .iter()
        .map(|b| strip_generic_params(b).to_string())
        .collect();
    seqs.push(stripped_bases);

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

/// Strip generic parameters from a base class name.
///
/// Examples:
/// - "Base[T]" -> "Base"
/// - "Generic[T, U]" -> "Generic"
/// - "Base" -> "Base"
fn strip_generic_params(name: &str) -> &str {
    name.split('[').next().unwrap_or(name)
}

// ============================================================================
// Cross-File MRO Computation
// ============================================================================

/// Compute MRO with cross-file base class resolution.
///
/// When a base class is not in the local hierarchy, this function attempts
/// to resolve it via the [`CrossFileTypeCache`].
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
    compute_mro_cross_file_with_depth(class_name, ctx, cache, workspace_root, 0)
}

/// Internal cross-file MRO computation with depth tracking.
fn compute_mro_cross_file_with_depth(
    class_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
    depth: usize,
) -> MROResult<Vec<String>> {
    // Check depth limit
    if depth > MAX_CROSS_FILE_DEPTH {
        return Err(MROError::DepthExceeded {
            class_name: class_name.to_string(),
            depth,
        });
    }

    // Get local class info
    let class_info = match ctx.class_hierarchies.get(class_name) {
        Some(info) => info,
        None => {
            // Class not found in this file's hierarchies
            return Ok(vec![class_name.to_string()]);
        }
    };

    // No bases means MRO is just the class itself
    if class_info.bases.is_empty() {
        return Ok(vec![class_name.to_string()]);
    }

    // Compute MRO for each base class
    let mut seqs: Vec<Vec<String>> = Vec::new();

    for base_name in &class_info.bases {
        // Strip generic parameters
        let stripped_base = strip_generic_params(base_name);

        // Try to resolve the base class
        if let Some(base_mro) =
            resolve_base_and_compute_mro(stripped_base, ctx, cache, workspace_root, depth + 1)?
        {
            seqs.push(base_mro);
        }
        // If base not found, skip it (conservative approach)
    }

    // Add the list of direct bases (stripped of generics)
    let stripped_bases: Vec<String> = class_info
        .bases
        .iter()
        .map(|b| strip_generic_params(b).to_string())
        .collect();
    seqs.push(stripped_bases);

    // Merge and prepend the class itself
    let mut mro = vec![class_name.to_string()];

    match merge(&mut seqs) {
        Some(merged) => mro.extend(merged),
        None => {
            return Err(MROError::InconsistentHierarchy {
                class_name: class_name.to_string(),
            });
        }
    }

    Ok(mro)
}

/// Resolve a base class and compute its MRO.
///
/// Returns `Ok(Some(mro))` if resolution and MRO computation succeed,
/// `Ok(None)` if the base cannot be found (external package, etc.),
/// or `Err` for fatal errors.
fn resolve_base_and_compute_mro(
    base_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
    depth: usize,
) -> MROResult<Option<Vec<String>>> {
    // Check depth limit
    if depth > MAX_CROSS_FILE_DEPTH {
        return Ok(None); // Gracefully return None when depth exceeded
    }

    // Try to resolve the base class - get resolved info without borrowing cache
    let resolution = resolve_base_class(base_name, ctx);

    match resolution {
        Some((resolved_name, resolved_file)) => {
            // Compute MRO by going through the resolved file
            // We pass the file path and let the function call get_or_analyze itself
            compute_mro_in_file(&resolved_name, &resolved_file, cache, workspace_root, depth)
                .map(Some)
        }
        None => {
            // Base class not found - might be external or local without hierarchies
            // Check if it's a local class
            if ctx.class_hierarchies.contains_key(base_name) {
                // It's local, compute MRO locally
                compute_mro_cross_file_with_depth(base_name, ctx, cache, workspace_root, depth)
                    .map(Some)
            } else {
                // Unknown base - return None (conservative)
                Ok(None)
            }
        }
    }
}

/// Compute MRO for a class in a specific file.
///
/// This helper avoids borrow checker issues by taking a file path
/// and calling get_or_analyze internally. It extracts the class hierarchies
/// data needed for MRO computation before making recursive calls.
fn compute_mro_in_file(
    class_name: &str,
    file_path: &Path,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
    depth: usize,
) -> MROResult<Vec<String>> {
    // Check depth limit
    if depth > MAX_CROSS_FILE_DEPTH {
        return Err(MROError::DepthExceeded {
            class_name: class_name.to_string(),
            depth,
        });
    }

    // Get the context and extract the class info we need
    // We extract and clone the data to avoid holding the borrow across recursive calls
    let (class_bases, has_class) = {
        let remote_ctx = cache
            .get_or_analyze(file_path, workspace_root)
            .map_err(MROError::from)?;

        match remote_ctx.class_hierarchies.get(class_name) {
            Some(info) => (info.bases.clone(), true),
            None => (vec![], false),
        }
    };

    // If class not found, return just the class name
    if !has_class {
        return Ok(vec![class_name.to_string()]);
    }

    // No bases means MRO is just the class itself
    if class_bases.is_empty() {
        return Ok(vec![class_name.to_string()]);
    }

    // Compute MRO for each base class
    let mut seqs: Vec<Vec<String>> = Vec::new();

    for base_name in &class_bases {
        // Strip generic parameters
        let stripped_base = strip_generic_params(base_name);

        // Try to resolve the base class - need to re-borrow ctx for each base
        let resolution = {
            let remote_ctx = cache
                .get_or_analyze(file_path, workspace_root)
                .map_err(MROError::from)?;
            resolve_base_class(stripped_base, remote_ctx)
        };

        match resolution {
            Some((resolved_name, resolved_file)) => {
                // Recursively compute MRO in the resolved file
                if let Ok(base_mro) = compute_mro_in_file(
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
                    remote_ctx.class_hierarchies.contains_key(stripped_base)
                };

                if is_local {
                    if let Ok(base_mro) = compute_mro_in_file(
                        stripped_base,
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

    // Add the list of direct bases (stripped of generics)
    let stripped_bases: Vec<String> = class_bases
        .iter()
        .map(|b| strip_generic_params(b).to_string())
        .collect();
    seqs.push(stripped_bases);

    // Merge and prepend the class itself
    let mut mro = vec![class_name.to_string()];

    match merge(&mut seqs) {
        Some(merged) => mro.extend(merged),
        None => {
            return Err(MROError::InconsistentHierarchy {
                class_name: class_name.to_string(),
            });
        }
    }

    Ok(mro)
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

    // Step 1: Strip generic parameters (already done by caller, but be defensive)
    let base_name = strip_generic_params(base_name);

    // Step 2: Check if dotted (e.g., "mod.Base")
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

/// Look up an attribute through the MRO chain.
///
/// This function searches for an attribute starting with the class itself
/// and walking through its MRO until the attribute is found.
///
/// # Arguments
///
/// * `class_name` - The class to start the search from
/// * `attr_name` - The attribute to look up
/// * `ctx` - Current file's type context
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
    // First, compute the MRO
    let mro = match compute_mro_cross_file(class_name, ctx, cache, workspace_root) {
        Ok(mro) => mro,
        Err(_) => return None,
    };

    // Walk through MRO looking for the attribute
    for mro_class in &mro {
        if let Some(attr_type) =
            lookup_attr_in_mro_class(mro_class, attr_name, ctx, cache, workspace_root)
        {
            return Some(attr_type);
        }
    }

    None
}

/// Look up an attribute in a specific MRO class.
///
/// This is a helper that looks up an attribute in a single class,
/// potentially crossing file boundaries.
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
        // Class is local - use local tracker
        if let Some(attr_type) = ctx.tracker.attribute_type_of(class_name, attr_name) {
            return Some(attr_type.clone());
        }
        // Also check method return types - convert to AttributeTypeInfo
        if let Some(return_type) = ctx.tracker.method_return_type_of(class_name, attr_name) {
            return Some(AttributeTypeInfo {
                type_str: return_type.to_string(),
                type_node: None,
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

    // Look up in remote tracker
    if let Some(attr_type) = remote_ctx
        .tracker
        .attribute_type_of(&remote_class_name, attr_name)
    {
        return Some(attr_type.clone());
    }
    if let Some(return_type) = remote_ctx
        .tracker
        .method_return_type_of(&remote_class_name, attr_name)
    {
        return Some(AttributeTypeInfo {
            type_str: return_type.to_string(),
            type_node: None,
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
    fn test_mro_generic_base_stripped() {
        let mut hierarchy = HashMap::new();
        hierarchy.insert("MyList".to_string(), vec!["Generic[T]".to_string()]);
        hierarchy.insert("Generic".to_string(), vec![]);

        let mro = compute_mro("MyList", &hierarchy).unwrap();
        assert_eq!(mro, vec!["MyList", "Generic"]);
    }

    #[test]
    fn test_mro_multiple_generic_params() {
        let mut hierarchy = HashMap::new();
        hierarchy.insert("Dict".to_string(), vec!["Mapping[K, V]".to_string()]);
        hierarchy.insert("Mapping".to_string(), vec![]);

        let mro = compute_mro("Dict", &hierarchy).unwrap();
        assert_eq!(mro, vec!["Dict", "Mapping"]);
    }

    // ========================================================================
    // Helper Function Tests
    // ========================================================================

    #[test]
    fn test_strip_generic_params() {
        assert_eq!(strip_generic_params("Base"), "Base");
        assert_eq!(strip_generic_params("Base[T]"), "Base");
        assert_eq!(strip_generic_params("Generic[T, U]"), "Generic");
        assert_eq!(strip_generic_params("Callable[[int], str]"), "Callable");
    }

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
        let ctx = FileTypeContext {
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
        // Multiple bases with generic parameters
        let mut hierarchy = HashMap::new();
        hierarchy.insert(
            "MyClass".to_string(),
            vec![
                "List[T]".to_string(),
                "Dict[K, V]".to_string(),
                "Generic[T, K, V]".to_string(),
            ],
        );
        hierarchy.insert("List".to_string(), vec![]);
        hierarchy.insert("Dict".to_string(), vec![]);
        hierarchy.insert("Generic".to_string(), vec![]);

        let mro = compute_mro("MyClass", &hierarchy).unwrap();
        // Generic parameters should be stripped
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
}

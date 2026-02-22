//! Implementation of the `tug beads sync` command (Spec S06)

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use tugtool_core::{
    BeadsCli, Config, ResolveResult, TugError, TugPlan, find_project_root, parse_tugplan,
    resolve_plan,
};

use crate::output::{JsonIssue, JsonResponse};

/// Sync result data for JSON output
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncData {
    pub file: String,
    pub root_bead_id: Option<String>,
    pub steps_synced: usize,
    pub deps_added: usize,
    pub dry_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enriched: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enrich_errors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_mapping: Option<HashMap<String, String>>,
}

/// Options for the sync command
pub struct SyncOptions {
    pub file: String,
    pub dry_run: bool,
    pub enrich: bool,
    pub prune_deps: bool,
    pub substeps_mode: String,
    pub json_output: bool,
    pub quiet: bool,
}

/// Run the beads sync command
pub fn run_sync(opts: SyncOptions) -> Result<i32, String> {
    let SyncOptions {
        file,
        dry_run,
        enrich,
        prune_deps,
        substeps_mode,
        json_output,
        quiet,
    } = opts;
    // Find project root
    let project_root = match find_project_root() {
        Ok(root) => root,
        Err(_) => {
            return output_error(
                json_output,
                "E009",
                ".tugtool directory not initialized",
                &file,
                9,
            );
        }
    };

    // Load config
    let config = Config::load_from_project(&project_root).unwrap_or_default();
    let bd_path =
        std::env::var("TUG_BD_PATH").unwrap_or_else(|_| config.tugtool.beads.bd_path.clone());
    let beads = BeadsCli::new(bd_path);

    // Check if beads CLI is installed
    if !beads.is_installed(None) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            &file,
            5,
        );
    }

    // Check if beads is initialized
    if !beads.is_initialized(&project_root) {
        return output_error(
            json_output,
            "E013",
            "beads not initialized. Run: tugcode worktree create <plan>",
            &file,
            13,
        );
    }

    // Resolve file path
    let path = match resolve_plan(&file, &project_root) {
        Ok(ResolveResult::Found { path, .. }) => path,
        Ok(ResolveResult::NotFound) | Ok(ResolveResult::Ambiguous(_)) => {
            return output_error(
                json_output,
                "E002",
                &format!("file not found: {}", file),
                &file,
                2,
            );
        }
        Err(e) => {
            return output_error(
                json_output,
                e.code(),
                &format!("Resolution failed: {}", e),
                &file,
                e.exit_code(),
            );
        }
    };

    // Read and parse the plan
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            return output_error(
                json_output,
                "E002",
                &format!("failed to read file: {}", e),
                &file,
                2,
            );
        }
    };

    let plan = match parse_tugplan(&content) {
        Ok(s) => s,
        Err(e) => {
            return output_error(
                json_output,
                "E001",
                &format!("failed to parse plan: {}", e),
                &file,
                1,
            );
        }
    };

    // Perform sync
    let ctx = SyncContext {
        beads: &beads,
        config: &config,
        dry_run,
        enrich,
        prune_deps,
        substeps_mode: &substeps_mode,
        quiet,
        working_dir: None,
    };
    let result = sync_plan_to_beads(&path, &plan, &content, &ctx);

    match result {
        Ok((root_id, steps_synced, deps_added, bead_mapping, enrich_errors)) => {
            if json_output {
                let data = SyncData {
                    file: file.clone(),
                    root_bead_id: root_id.clone(),
                    steps_synced,
                    deps_added,
                    dry_run,
                    enriched: if enrich { Some(true) } else { None },
                    enrich_errors: if enrich_errors.is_empty() {
                        None
                    } else {
                        Some(enrich_errors.clone())
                    },
                    bead_mapping: if bead_mapping.is_empty() {
                        None
                    } else {
                        Some(bead_mapping)
                    },
                };
                let response = JsonResponse::ok("beads sync", data);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if !quiet {
                if dry_run {
                    println!("[dry-run] Would sync {} to beads:", file);
                } else {
                    println!("Synced {} to beads:", file);
                }
                if let Some(id) = root_id {
                    println!("  Root bead: {}", id);
                }
                println!("  Steps synced: {}", steps_synced);
                println!("  Dependencies added: {}", deps_added);
                if enrich {
                    if enrich_errors.is_empty() {
                        println!("  Enriched: all beads updated successfully");
                    } else {
                        println!("  Enriched: with {} errors", enrich_errors.len());
                        for error in &enrich_errors {
                            eprintln!("    - {}", error);
                        }
                    }
                }
            }

            Ok(0)
        }
        Err(e) => {
            let code = match &e {
                TugError::BeadsNotInstalled => "E005",
                TugError::BeadsNotInitialized => "E013",
                _ => "E016",
            };
            let exit_code = e.exit_code();
            output_error(json_output, code, &e.to_string(), &file, exit_code)
        }
    }
}

/// Internal context for sync operations
struct SyncContext<'a> {
    beads: &'a BeadsCli,
    config: &'a Config,
    dry_run: bool,
    enrich: bool,
    prune_deps: bool,
    substeps_mode: &'a str,
    #[allow(dead_code)] // Used for debugging/warnings - may be re-enabled later
    quiet: bool,
    working_dir: Option<&'a Path>,
}

/// Sync a plan to beads
#[allow(clippy::type_complexity)] // Return tuple includes enrichment errors
fn sync_plan_to_beads(
    _path: &Path,
    plan: &TugPlan,
    _content: &str,
    ctx: &SyncContext<'_>,
) -> Result<
    (
        Option<String>,
        usize,
        usize,
        HashMap<String, String>,
        Vec<String>,
    ),
    TugError,
> {
    let mut steps_synced = 0;
    let mut deps_added = 0;

    // Get phase title for root bead
    let phase_title = plan
        .phase_title
        .clone()
        .unwrap_or_else(|| "Untitled plan".to_string());

    // Ensure root bead exists (uses title-based matching)
    let (root_id, root_created) = ensure_root_bead(plan, &phase_title, ctx)?;

    // Track newly created beads to avoid double-updates during enrichment
    let mut created_beads: HashSet<String> = HashSet::new();
    if root_created {
        created_beads.insert(root_id.clone());
    }

    // Build a map of step anchors to bead IDs (existing)
    let mut anchor_to_bead: HashMap<String, String> = HashMap::new();

    // Process each step
    for step in &plan.steps {
        let (step_bead_id, step_created) =
            ensure_step_bead(step, &root_id, plan, ctx)?;

        anchor_to_bead.insert(step.anchor.clone(), step_bead_id.clone());
        if step_created {
            created_beads.insert(step_bead_id.clone());
        }
        steps_synced += 1;

        // Handle substeps if mode is "children"
        if ctx.substeps_mode == "children" {
            for substep in &step.substeps {
                let (substep_bead_id, substep_created) =
                    ensure_substep_bead(substep, &step_bead_id, plan, ctx)?;

                anchor_to_bead.insert(substep.anchor.clone(), substep_bead_id.clone());
                if substep_created {
                    created_beads.insert(substep_bead_id);
                }
                steps_synced += 1;
            }
        }
    }

    // Step 3: Create dependency edges
    // Optimization: if bead was reused (not in created_beads) and we're not pruning,
    // skip dependency sync entirely - deps were set when bead was first created.
    for step in &plan.steps {
        if let Some(bead_id) = anchor_to_bead.get(&step.anchor) {
            // Skip if bead was reused and not pruning (deps already set)
            if created_beads.contains(bead_id) || ctx.prune_deps {
                let added = sync_dependencies(
                    bead_id,
                    &step.depends_on,
                    &anchor_to_bead,
                    ctx.beads,
                    ctx.prune_deps,
                    ctx.dry_run,
                    ctx.working_dir,
                )?;
                deps_added += added;
            }
        }

        // Handle substep dependencies
        if ctx.substeps_mode == "children" {
            for substep in &step.substeps {
                if let Some(bead_id) = anchor_to_bead.get(&substep.anchor) {
                    // Skip if bead was reused and not pruning
                    if created_beads.contains(bead_id) || ctx.prune_deps {
                        // Substeps inherit parent deps if no explicit deps
                        let deps = if substep.depends_on.is_empty() {
                            &step.depends_on
                        } else {
                            &substep.depends_on
                        };
                        let added = sync_dependencies(
                            bead_id,
                            deps,
                            &anchor_to_bead,
                            ctx.beads,
                            ctx.prune_deps,
                            ctx.dry_run,
                            ctx.working_dir,
                        )?;
                        deps_added += added;
                    }
                }
            }
        }
    }

    // Phase 4: Enrich beads with rich content if requested
    let mut enrich_errors = Vec::new();
    if ctx.enrich {
        // Enrich root bead (skip if just created - already enriched)
        if !created_beads.contains(&root_id) {
            let root_errors = enrich_root_bead(plan, &root_id, ctx);
            enrich_errors.extend(root_errors);
        }

        // Enrich step beads
        for step in &plan.steps {
            if let Some(bead_id) = anchor_to_bead.get(&step.anchor) {
                // Skip if just created - already enriched
                if !created_beads.contains(bead_id) {
                    let step_errors = enrich_step_bead(step, bead_id, plan, ctx);
                    enrich_errors.extend(step_errors);
                }
            }

            // Enrich substep beads if using children mode
            if ctx.substeps_mode == "children" {
                for substep in &step.substeps {
                    if let Some(bead_id) = anchor_to_bead.get(&substep.anchor) {
                        // Skip if just created - already enriched
                        if !created_beads.contains(bead_id) {
                            // Convert Substep to Step for enrichment (substeps have same fields)
                            let substep_as_step = tugtool_core::Step {
                                number: substep.number.clone(),
                                title: substep.title.clone(),
                                anchor: substep.anchor.clone(),
                                line: substep.line,
                                depends_on: substep.depends_on.clone(),
                                bead_id: substep.bead_id.clone(),
                                beads_hints: substep.beads_hints.clone(),
                                commit_message: substep.commit_message.clone(),
                                references: substep.references.clone(),
                                tasks: substep.tasks.clone(),
                                tests: substep.tests.clone(),
                                checkpoints: substep.checkpoints.clone(),
                                artifacts: substep.artifacts.clone(),
                                substeps: vec![],
                            };
                            let substep_errors =
                                enrich_step_bead(&substep_as_step, bead_id, plan, ctx);
                            enrich_errors.extend(substep_errors);
                        }
                    }
                }
            }
        }
    }

    Ok((
        Some(root_id),
        steps_synced,
        deps_added,
        anchor_to_bead,
        enrich_errors,
    ))
}

/// Ensure root bead exists and return its ID and whether it was newly created
fn ensure_root_bead(
    plan: &TugPlan,
    phase_title: &str,
    ctx: &SyncContext<'_>,
) -> Result<(String, bool), TugError> {
    if ctx.dry_run {
        // Generate a fake ID for dry run
        let fake_id = "bd-dryrun-root".to_string();
        return Ok((fake_id, true));
    }

    // Try to find existing root bead by title
    if let Some(existing) = ctx.beads.find_by_title(phase_title, None, ctx.working_dir)? {
        return Ok((existing.id, false));
    }

    // No existing bead found, create new one
    let description = plan.render_root_description();
    let design = plan.render_root_design();
    let acceptance = plan.render_root_acceptance();
    let issue_type = &ctx.config.tugtool.beads.root_issue_type;

    let issue = ctx.beads.create(
        phase_title,
        Some(&description),
        None,
        Some(issue_type),
        None,
        if !design.is_empty() {
            Some(&design)
        } else {
            None
        },
        if !acceptance.is_empty() {
            Some(&acceptance)
        } else {
            None
        },
        None,
        ctx.working_dir,
    )?;

    Ok((issue.id, true))
}

/// Ensure step bead exists and return its ID and whether it was newly created
fn ensure_step_bead(
    step: &tugtool_core::Step,
    root_id: &str,
    plan: &TugPlan,
    ctx: &SyncContext<'_>,
) -> Result<(String, bool), TugError> {
    let title = format!("Step {}: {}", step.number, step.title);

    if ctx.dry_run {
        // Generate a fake ID for dry run
        let fake_id = format!("bd-dryrun-{}", step.anchor);
        return Ok((fake_id, true));
    }

    // Try to find existing step bead by title (within parent)
    if let Some(existing) = ctx.beads.find_by_title(&title, Some(root_id), ctx.working_dir)? {
        return Ok((existing.id, false));
    }

    // No existing bead found, create new one
    let description = step.render_description();
    let acceptance = step.render_acceptance_criteria();
    let design = resolve_step_design(step, plan);

    let issue = ctx.beads.create(
        &title,
        Some(&description),
        Some(root_id),
        None,
        None,
        if !design.is_empty() {
            Some(&design)
        } else {
            None
        },
        if !acceptance.is_empty() {
            Some(&acceptance)
        } else {
            None
        },
        None,
        ctx.working_dir,
    )?;

    Ok((issue.id, true))
}

/// Ensure substep bead exists and return its ID and whether it was newly created
fn ensure_substep_bead(
    substep: &tugtool_core::Substep,
    parent_bead_id: &str,
    plan: &TugPlan,
    ctx: &SyncContext<'_>,
) -> Result<(String, bool), TugError> {
    let title = format!("Step {}: {}", substep.number, substep.title);

    if ctx.dry_run {
        let fake_id = format!("bd-dryrun-{}", substep.anchor);
        return Ok((fake_id, true));
    }

    // Try to find existing substep bead by title (within parent)
    if let Some(existing) = ctx.beads.find_by_title(&title, Some(parent_bead_id), ctx.working_dir)? {
        return Ok((existing.id, false));
    }

    // No existing bead found, create new one
    // Convert Substep to Step for rendering (substeps have same fields)
    let substep_as_step = tugtool_core::Step {
        number: substep.number.clone(),
        title: substep.title.clone(),
        anchor: substep.anchor.clone(),
        line: substep.line,
        depends_on: substep.depends_on.clone(),
        bead_id: substep.bead_id.clone(),
        beads_hints: substep.beads_hints.clone(),
        commit_message: substep.commit_message.clone(),
        references: substep.references.clone(),
        tasks: substep.tasks.clone(),
        tests: substep.tests.clone(),
        checkpoints: substep.checkpoints.clone(),
        artifacts: substep.artifacts.clone(),
        substeps: vec![],
    };

    let description = substep_as_step.render_description();
    let acceptance = substep_as_step.render_acceptance_criteria();
    let design = resolve_step_design(&substep_as_step, plan);

    let issue = ctx.beads.create(
        &title,
        Some(&description),
        Some(parent_bead_id),
        None,
        None,
        if !design.is_empty() {
            Some(&design)
        } else {
            None
        },
        if !acceptance.is_empty() {
            Some(&acceptance)
        } else {
            None
        },
        None,
        ctx.working_dir,
    )?;

    Ok((issue.id, true))
}

/// Sync dependencies for a bead
fn sync_dependencies(
    bead_id: &str,
    depends_on: &[String],
    anchor_to_bead: &HashMap<String, String>,
    beads: &BeadsCli,
    prune_deps: bool,
    dry_run: bool,
    working_dir: Option<&Path>,
) -> Result<usize, TugError> {
    if dry_run {
        return Ok(depends_on.len());
    }

    let mut added = 0;

    // Get current dependencies
    let current_deps = beads.dep_list(bead_id, working_dir).unwrap_or_default();
    let current_dep_ids: std::collections::HashSet<String> =
        current_deps.iter().map(|d| d.id.clone()).collect();

    // Add missing dependencies
    for dep_anchor in depends_on {
        if let Some(dep_bead_id) = anchor_to_bead.get(dep_anchor) {
            if !current_dep_ids.contains(dep_bead_id) {
                beads.dep_add(bead_id, dep_bead_id, working_dir)?;
                added += 1;
            }
        }
    }

    // Prune extra dependencies if requested
    if prune_deps {
        let desired_dep_ids: std::collections::HashSet<String> = depends_on
            .iter()
            .filter_map(|a| anchor_to_bead.get(a).cloned())
            .collect();

        for dep in current_deps {
            if !desired_dep_ids.contains(&dep.id) {
                beads.dep_remove(bead_id, &dep.id, working_dir)?;
            }
        }
    }

    Ok(added)
}

/// Resolve step references and expand decision IDs to titles
fn resolve_step_design(step: &tugtool_core::Step, plan: &TugPlan) -> String {
    use regex::Regex;
    use std::sync::LazyLock;

    static DECISION_REF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[([DQ]\d+)\]").unwrap());
    static ANCHOR_REF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"#([a-z0-9-]+)").unwrap());

    let references = match &step.references {
        Some(r) => r,
        None => return String::new(),
    };

    let mut design_lines = vec!["## References".to_string()];

    // Build decision lookup map
    let decision_map: HashMap<String, String> = plan
        .decisions
        .iter()
        .map(|d| (d.id.clone(), d.title.clone()))
        .collect();

    // Extract decision references and expand them
    let mut decisions = Vec::new();
    for cap in DECISION_REF.captures_iter(references) {
        let id = cap.get(1).unwrap().as_str();
        if let Some(title) = decision_map.get(id) {
            decisions.push(format!("- [{}] {}", id, title));
        } else {
            // Decision not found, pass through as-is
            decisions.push(format!("- [{}]", id));
        }
    }

    // Extract anchor references
    let mut anchors = Vec::new();
    for cap in ANCHOR_REF.captures_iter(references) {
        let anchor = cap.get(1).unwrap().as_str();
        // Only include if not part of a decision reference
        if !DECISION_REF.is_match(&format!("[{}]", anchor)) {
            anchors.push(format!("- #{}", anchor));
        }
    }

    // Add decisions first
    let has_decisions = !decisions.is_empty();
    if has_decisions {
        design_lines.extend(decisions);
    }

    // Add anchors
    if !anchors.is_empty() {
        if has_decisions {
            design_lines.push(String::new()); // Blank line between sections
        }
        design_lines.extend(anchors);
    }

    if design_lines.len() == 1 {
        // Only header, return empty
        String::new()
    } else {
        design_lines.join("\n")
    }
}

/// Enrich root bead with full plan content
fn enrich_root_bead(plan: &TugPlan, root_id: &str, ctx: &SyncContext<'_>) -> Vec<String> {
    let mut errors = Vec::new();

    if ctx.dry_run {
        return errors;
    }

    // Update description (purpose + strategy + success criteria)
    let description = plan.render_root_description();
    if !description.is_empty() {
        if let Err(e) = ctx.beads.update_description(root_id, &description, ctx.working_dir) {
            errors.push(format!("Failed to update root description: {}", e));
        }
    }

    // Update design (decision summary)
    let design = plan.render_root_design();
    if !design.is_empty() {
        if let Err(e) = ctx.beads.update_design(root_id, &design, ctx.working_dir) {
            errors.push(format!("Failed to update root design: {}", e));
        }
    }

    // Update acceptance criteria (phase exit criteria)
    let acceptance = plan.render_root_acceptance();
    if !acceptance.is_empty() {
        if let Err(e) = ctx.beads.update_acceptance(root_id, &acceptance, ctx.working_dir) {
            errors.push(format!("Failed to update root acceptance: {}", e));
        }
    }

    errors
}

/// Enrich step bead with full step content
fn enrich_step_bead(
    step: &tugtool_core::Step,
    bead_id: &str,
    plan: &TugPlan,
    ctx: &SyncContext<'_>,
) -> Vec<String> {
    let mut errors = Vec::new();

    if ctx.dry_run {
        return errors;
    }

    // Update description (tasks + artifacts + commit template)
    let description = step.render_description();
    if !description.is_empty() {
        if let Err(e) = ctx.beads.update_description(bead_id, &description, ctx.working_dir) {
            errors.push(format!(
                "Failed to update description for {}: {}",
                bead_id, e
            ));
        }
    }

    // Update acceptance criteria (tests + checkpoints)
    let acceptance = step.render_acceptance_criteria();
    if !acceptance.is_empty() {
        if let Err(e) = ctx.beads.update_acceptance(bead_id, &acceptance, ctx.working_dir) {
            errors.push(format!(
                "Failed to update acceptance for {}: {}",
                bead_id, e
            ));
        }
    }

    // Update design (resolved references)
    let design = resolve_step_design(step, plan);
    if !design.is_empty() {
        if let Err(e) = ctx.beads.update_design(bead_id, &design, ctx.working_dir) {
            errors.push(format!("Failed to update design for {}: {}", bead_id, e));
        }
    }

    errors
}

/// Output an error in JSON or text format
fn output_error(
    json_output: bool,
    code: &str,
    message: &str,
    file: &str,
    exit_code: i32,
) -> Result<i32, String> {
    if json_output {
        let issues = vec![JsonIssue {
            code: code.to_string(),
            severity: "error".to_string(),
            message: message.to_string(),
            file: Some(file.to_string()),
            line: None,
            anchor: None,
        }];
        let response: JsonResponse<SyncData> = JsonResponse::error(
            "beads sync",
            SyncData {
                file: file.to_string(),
                root_bead_id: None,
                steps_synced: 0,
                deps_added: 0,
                dry_run: false,
                enriched: None,
                enrich_errors: None,
                bead_mapping: None,
            },
            issues,
        );
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}

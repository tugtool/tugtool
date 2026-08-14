//! Plans — the `tugutil plan …` namespace. A thin shell over
//! [`tugutil_core::plan`]: read the document named on the command line, parse
//! it, run the rules, and format the outcome as `--json` (the shared
//! `{schema_version, command, status, data, issues}` envelope) or a plain
//! read-out.
//!
//! The path is explicit. There is no `resolve_plan` cascade here and no
//! `PLAN_SEARCH_DIRS` — a linter that guesses which document you meant is worse
//! than one that asks.

use std::path::Path;
use std::process::ExitCode;

use serde::Serialize;
use tugutil_core::plan::{self, Severity};

use crate::changes::{self, AppError};
use crate::cli::PlanCommands;
use crate::output::{JsonIssue, JsonResponse};

/// Dispatch a `plan` subcommand. Exit 0 clean-or-warnings, 1 on any error
/// diagnostic, 2 when the document cannot be read or is not a plan.
pub fn dispatch(cmd: PlanCommands, json: bool) -> ExitCode {
    changes::finish(match cmd {
        PlanCommands::Lint { path } => run_lint(Path::new(&path), json),
        PlanCommands::ReviewRequest {
            plan,
            session,
            port,
            instance,
        } => run_review_request(Path::new(&plan), session, port, instance, json),
    })
}

/// `--json` payload for `plan lint`. The diagnostics themselves ride in the
/// envelope's `issues`, which already carries exactly a lint diagnostic's shape.
#[derive(Debug, Serialize)]
struct LintData {
    /// The document that was linted, as it was named on the command line.
    path: String,
    /// How many error-severity diagnostics the run produced.
    errors: usize,
    /// How many warning-severity diagnostics the run produced.
    warnings: usize,
}

fn run_lint(path: &Path, json: bool) -> Result<(), AppError> {
    let source = std::fs::read_to_string(path)
        .map_err(|e| AppError::Exit2(format!("{}: {e}", path.display())))?;

    let doc = plan::parse(&source)
        .map_err(|e| AppError::Exit2(format!("{}: {e}", path.display())))?;

    let diagnostics = plan::lint(&doc);
    let errors = diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .count();
    let warnings = diagnostics.len() - errors;

    if json {
        let data = LintData {
            path: path.display().to_string(),
            errors,
            warnings,
        };
        let issues: Vec<JsonIssue> = diagnostics
            .iter()
            .map(|d| JsonIssue {
                code: d.code.clone(),
                severity: d.severity.as_str().to_string(),
                message: d.message.clone(),
                file: Some(path.display().to_string()),
                line: d.line,
                anchor: d.anchor.as_ref().map(|a| format!("#{a}")),
            })
            .collect();
        // `print_ok` hardcodes `status: "ok"`, so a run carrying an error
        // diagnostic has to build its own envelope.
        let response = if errors > 0 {
            JsonResponse::error("plan lint", data, issues)
        } else {
            let mut ok = JsonResponse::ok("plan lint", data);
            ok.issues = issues;
            ok
        };
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else {
        for d in &diagnostics {
            match d.line {
                Some(line) => println!(
                    "{}:{}: {} {} {}",
                    path.display(),
                    line,
                    d.code,
                    d.severity,
                    d.message
                ),
                None => println!("{}: {} {} {}", path.display(), d.code, d.severity, d.message),
            }
        }
        println!(
            "{}: {} error{}, {} warning{}",
            path.display(),
            errors,
            if errors == 1 { "" } else { "s" },
            warnings,
            if warnings == 1 { "" } else { "s" }
        );
    }

    if errors > 0 {
        return Err(AppError::Exit1(format!(
            "{}: {errors} error diagnostic{}",
            path.display(),
            if errors == 1 { "" } else { "s" }
        )));
    }
    Ok(())
}

/// `--json` payload for `plan review-request`.
#[derive(Debug, Serialize)]
struct ReviewRequestData {
    /// The session whose card was told.
    tug_session_id: String,
    /// The absolute path that was sent.
    plan_path: String,
}

fn run_review_request(
    plan: &Path,
    session: Option<String>,
    port: Option<u16>,
    instance: Option<String>,
    json: bool,
) -> Result<(), AppError> {
    use crate::commands::tell::{Remedy, resolve_port_any};

    let tug_session_id = session
        .or_else(|| std::env::var("TUG_SESSION_ID").ok())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Exit1(
                "no session — pass --session, or run inside a Tug session so TUG_SESSION_ID is set"
                    .to_string(),
            )
        })?;

    // The card does not share the cwd this ran in, so a relative path could
    // only be resolved wrongly on the other side.
    let plan_path = if plan.is_absolute() {
        plan.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| AppError::Exit1(format!("cannot resolve cwd: {e}")))?
            .join(plan)
    };
    if !plan_path.exists() {
        return Err(AppError::Exit1(format!(
            "no plan at {}",
            plan_path.display()
        )));
    }
    let plan_path = plan_path.to_string_lossy().into_owned();

    let port = resolve_port_any(port, instance).map_err(|e| {
        AppError::Exit1(format!(
            "the plan review runs in a Tug card, but no running Tug instance was found ({}) — \
             run `/tugplug:review-plan {plan_path}` by hand instead",
            e.describe(Remedy::Flags)
        ))
    })?;
    let url = format!("http://127.0.0.1:{port}/api/plan-review");
    let response = ureq::post(&url)
        .send_json(serde_json::json!({
            "tug_session_id": tug_session_id,
            "plan_path": plan_path,
        }))
        .map_err(|e| {
            AppError::Exit1(format!(
                "cannot reach tugcast at {url}: {e} — \
                 run `/tugplug:review-plan {plan_path}` by hand instead"
            ))
        })?;
    let value: serde_json::Value = response
        .into_body()
        .read_json()
        .map_err(|e| AppError::Exit1(format!("bad response from tugcast: {e}")))?;
    if value.get("status").and_then(|s| s.as_str()) != Some("ok") {
        let message = value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(AppError::Exit1(format!(
            "plan review request failed: {message}"
        )));
    }

    let data = ReviewRequestData {
        tug_session_id,
        plan_path,
    };
    if json {
        crate::output::print_ok("plan review-request", &data);
    } else {
        println!("review requested for {}", data.plan_path);
    }
    Ok(())
}

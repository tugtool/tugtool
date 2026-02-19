//! Token usage stats collector
//!
//! Extracts Claude Code token usage from tmux pane output.
//! This is a best-effort collector that may fail if the status line format changes.

use super::StatCollector;
use regex::Regex;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tugcast_core::FeedId;

/// Collects token usage stats from Claude Code status line via tmux capture-pane.
///
/// Expected Claude Code status line format (approximate):
/// "X/Y tokens (Z%)" or similar patterns showing input/output/total tokens
///
/// This collector is fragile by design and returns Value::Null on parse failure.
pub struct TokenUsageCollector {
    session: String,
    warned: AtomicBool,
}

impl TokenUsageCollector {
    /// Create a new TokenUsageCollector for the given tmux session.
    pub fn new(session: String) -> Self {
        Self {
            session,
            warned: AtomicBool::new(false),
        }
    }

    /// Parse token usage from tmux output.
    ///
    /// Looks for patterns like:
    /// - "15000/8000 tokens" (input/output format)
    /// - "23000 tokens" (total format)
    /// - "(45.2%)" (context window percentage)
    fn parse_token_usage(output: &str) -> Option<serde_json::Value> {
        // Pattern 1: Look for "X/Y tokens" format (input/output)
        let input_output_re = Regex::new(r"(\d+)/(\d+)\s+tokens?").ok()?;
        if let Some(caps) = input_output_re.captures(output) {
            let input_tokens = caps.get(1)?.as_str().parse::<u64>().ok()?;
            let output_tokens = caps.get(2)?.as_str().parse::<u64>().ok()?;
            let total_tokens = input_tokens + output_tokens;

            // Try to extract percentage
            let pct_re = Regex::new(r"\((\d+(?:\.\d+)?)\%\)").ok()?;
            let context_window_percent = pct_re
                .captures(output)
                .and_then(|c| c.get(1)?.as_str().parse::<f64>().ok())
                .unwrap_or(0.0);

            return Some(serde_json::json!({
                "name": "token_usage",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "context_window_percent": context_window_percent
            }));
        }

        // Pattern 2: Look for just total tokens
        let total_re = Regex::new(r"(\d+)\s+tokens?").ok()?;
        if let Some(caps) = total_re.captures(output) {
            let total_tokens = caps.get(1)?.as_str().parse::<u64>().ok()?;

            return Some(serde_json::json!({
                "name": "token_usage",
                "input_tokens": null,
                "output_tokens": null,
                "total_tokens": total_tokens,
                "context_window_percent": 0.0
            }));
        }

        None
    }
}

impl StatCollector for TokenUsageCollector {
    fn name(&self) -> &str {
        "token_usage"
    }

    fn feed_id(&self) -> FeedId {
        FeedId::StatsTokenUsage
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    fn collect(&self) -> serde_json::Value {
        // Run tmux capture-pane synchronously
        let output = match Command::new("tmux")
            .args(["capture-pane", "-t", &self.session, "-p"])
            .output()
        {
            Ok(o) => o,
            Err(e) => {
                if !self.warned.swap(true, Ordering::Relaxed) {
                    tracing::debug!(
                        session = %self.session,
                        error = ?e,
                        "Failed to run tmux capture-pane"
                    );
                }
                return serde_json::Value::Null;
            }
        };

        if !output.status.success() {
            if !self.warned.swap(true, Ordering::Relaxed) {
                tracing::debug!(
                    session = %self.session,
                    status = ?output.status,
                    "tmux capture-pane failed"
                );
            }
            return serde_json::Value::Null;
        }

        let text = match String::from_utf8(output.stdout) {
            Ok(t) => t,
            Err(e) => {
                if !self.warned.swap(true, Ordering::Relaxed) {
                    tracing::debug!(
                        error = ?e,
                        "tmux output is not valid UTF-8"
                    );
                }
                return serde_json::Value::Null;
            }
        };

        match Self::parse_token_usage(&text) {
            Some(value) => {
                // Reset warned flag on successful parse
                self.warned.store(false, Ordering::Relaxed);
                value
            }
            None => {
                if !self.warned.swap(true, Ordering::Relaxed) {
                    tracing::debug!("Failed to parse token usage from tmux output");
                }
                serde_json::Value::Null
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_usage_null_on_parse_failure() {
        // Create collector with a nonexistent session
        let collector = TokenUsageCollector::new("nonexistent_session_12345".to_string());
        let value = collector.collect();
        assert_eq!(value, serde_json::Value::Null);
    }

    #[test]
    fn test_token_usage_feed_id() {
        let collector = TokenUsageCollector::new("test".to_string());
        assert_eq!(collector.feed_id(), FeedId::StatsTokenUsage);
    }

    #[test]
    fn test_token_usage_interval() {
        let collector = TokenUsageCollector::new("test".to_string());
        assert_eq!(collector.interval(), Duration::from_secs(10));
    }

    #[test]
    fn test_token_usage_name() {
        let collector = TokenUsageCollector::new("test".to_string());
        assert_eq!(collector.name(), "token_usage");
    }

    #[test]
    fn test_token_usage_parse_fixture_input_output() {
        let fixture = "Some output\n15000/8000 tokens (45.2%)\nMore text";
        let result = TokenUsageCollector::parse_token_usage(fixture);

        assert!(result.is_some());
        let value = result.unwrap();
        let obj = value.as_object().unwrap();

        assert_eq!(obj["name"], "token_usage");
        assert_eq!(obj["input_tokens"], 15000);
        assert_eq!(obj["output_tokens"], 8000);
        assert_eq!(obj["total_tokens"], 23000);
        assert_eq!(obj["context_window_percent"], 45.2);
    }

    #[test]
    fn test_token_usage_parse_fixture_total_only() {
        let fixture = "Some output\n23000 tokens\nMore text";
        let result = TokenUsageCollector::parse_token_usage(fixture);

        assert!(result.is_some());
        let value = result.unwrap();
        let obj = value.as_object().unwrap();

        assert_eq!(obj["name"], "token_usage");
        assert_eq!(obj["total_tokens"], 23000);
    }

    #[test]
    fn test_token_usage_parse_no_match() {
        let fixture = "No token information here";
        let result = TokenUsageCollector::parse_token_usage(fixture);
        assert!(result.is_none());
    }

    #[test]
    fn test_token_usage_golden_schema() {
        let fixture = "15000/8000 tokens (45.2%)";
        let result = TokenUsageCollector::parse_token_usage(fixture).unwrap();

        // Verify schema matches Spec S02
        assert!(result.is_object());
        let obj = result.as_object().unwrap();

        assert_eq!(obj["name"].as_str().unwrap(), "token_usage");
        assert!(obj["input_tokens"].as_u64().is_some());
        assert!(obj["output_tokens"].as_u64().is_some());
        assert!(obj["total_tokens"].as_u64().is_some());
        assert!(obj["context_window_percent"].as_f64().is_some());
    }
}

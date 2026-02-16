//! Build status stats collector
//!
//! Monitors the target/ directory to detect recent build activity.

use super::StatCollector;
use std::path::PathBuf;
use std::time::Duration;
use tugcast_core::FeedId;

/// Collects build status by monitoring the target/ directory modification time.
#[allow(dead_code)]
pub struct BuildStatusCollector {
    target_dir: PathBuf,
}

impl BuildStatusCollector {
    /// Create a new BuildStatusCollector for the given target directory.
    #[allow(dead_code)]
    pub fn new(target_dir: PathBuf) -> Self {
        Self { target_dir }
    }
}

impl StatCollector for BuildStatusCollector {
    fn name(&self) -> &str {
        "build_status"
    }

    fn feed_id(&self) -> FeedId {
        FeedId::StatsBuildStatus
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    fn collect(&self) -> serde_json::Value {
        // Try to stat the target directory
        let metadata = match std::fs::metadata(&self.target_dir) {
            Ok(m) => m,
            Err(_) => {
                // Directory doesn't exist - report idle
                return serde_json::json!({
                    "name": "build_status",
                    "last_build_time": null,
                    "target_modified_secs_ago": null,
                    "status": "idle"
                });
            }
        };

        // Get modification time
        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(error = ?e, "Failed to get target/ modification time");
                return serde_json::json!({
                    "name": "build_status",
                    "last_build_time": null,
                    "target_modified_secs_ago": null,
                    "status": "idle"
                });
            }
        };

        // Calculate seconds since modification
        let elapsed = match modified.elapsed() {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(error = ?e, "System time went backwards?");
                return serde_json::json!({
                    "name": "build_status",
                    "last_build_time": null,
                    "target_modified_secs_ago": null,
                    "status": "idle"
                });
            }
        };

        let secs_ago = elapsed.as_secs();

        // Convert to ISO 8601 timestamp
        let last_build_time = {
            let timestamp: chrono::DateTime<chrono::Utc> = modified.into();
            timestamp.to_rfc3339()
        };

        // Determine status: "building" if modified within 10 seconds, "idle" otherwise
        let status = if secs_ago <= 10 {
            "building"
        } else {
            "idle"
        };

        serde_json::json!({
            "name": "build_status",
            "last_build_time": last_build_time,
            "target_modified_secs_ago": secs_ago,
            "status": status
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_build_status_idle_no_target() {
        let temp_dir = TempDir::new().unwrap();
        let nonexistent = temp_dir.path().join("nonexistent");

        let collector = BuildStatusCollector::new(nonexistent);
        let value = collector.collect();

        assert!(value.is_object());
        let obj = value.as_object().unwrap();

        assert_eq!(obj["name"], "build_status");
        assert_eq!(obj["status"], "idle");
        assert!(obj["last_build_time"].is_null());
        assert!(obj["target_modified_secs_ago"].is_null());
    }

    #[test]
    fn test_build_status_building_recent() {
        let temp_dir = TempDir::new().unwrap();
        let target_dir = temp_dir.path().join("target");
        fs::create_dir(&target_dir).unwrap();

        // The directory was just created, so it should be "building"
        let collector = BuildStatusCollector::new(target_dir);
        let value = collector.collect();

        assert!(value.is_object());
        let obj = value.as_object().unwrap();

        assert_eq!(obj["name"], "build_status");
        assert_eq!(obj["status"], "building");
        assert!(obj["last_build_time"].is_string());
        assert!(obj["target_modified_secs_ago"].is_number());

        let secs_ago = obj["target_modified_secs_ago"].as_u64().unwrap();
        assert!(secs_ago <= 10, "Should be recently modified");
    }

    #[test]
    fn test_build_status_feed_id() {
        let collector = BuildStatusCollector::new(PathBuf::from("/tmp/test"));
        assert_eq!(collector.feed_id(), FeedId::StatsBuildStatus);
    }

    #[test]
    fn test_build_status_interval() {
        let collector = BuildStatusCollector::new(PathBuf::from("/tmp/test"));
        assert_eq!(collector.interval(), Duration::from_secs(10));
    }

    #[test]
    fn test_build_status_name() {
        let collector = BuildStatusCollector::new(PathBuf::from("/tmp/test"));
        assert_eq!(collector.name(), "build_status");
    }

    #[test]
    fn test_build_status_golden_schema() {
        let temp_dir = TempDir::new().unwrap();
        let target_dir = temp_dir.path().join("target");
        fs::create_dir(&target_dir).unwrap();

        let collector = BuildStatusCollector::new(target_dir);
        let value = collector.collect();

        // Verify schema matches Spec S02
        assert!(value.is_object());
        let obj = value.as_object().unwrap();

        assert_eq!(obj["name"].as_str().unwrap(), "build_status");
        assert!(obj["last_build_time"].is_string());
        assert!(obj["target_modified_secs_ago"].as_u64().is_some());
        assert!(obj["status"].is_string());

        let status = obj["status"].as_str().unwrap();
        assert!(status == "building" || status == "idle");
    }
}

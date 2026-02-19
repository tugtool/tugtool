//! Process info stats collector
//!
//! Collects CPU, memory, and uptime statistics for the current tugcast process.

use super::StatCollector;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tugcast_core::FeedId;

/// Collects process information stats (CPU, memory, uptime) for the current process.
pub struct ProcessInfoCollector {
    system: Mutex<System>,
    pid: Pid,
    start_time: Instant,
}

impl ProcessInfoCollector {
    /// Create a new ProcessInfoCollector for the current process.
    pub fn new() -> Self {
        let mut system = System::new();
        let pid = Pid::from_u32(std::process::id());

        // Initial refresh of the current process
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::everything(),
        );

        Self {
            system: Mutex::new(system),
            pid,
            start_time: Instant::now(),
        }
    }
}

impl Default for ProcessInfoCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatCollector for ProcessInfoCollector {
    fn name(&self) -> &str {
        "process_info"
    }

    fn feed_id(&self) -> FeedId {
        FeedId::StatsProcessInfo
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn collect(&self) -> serde_json::Value {
        let mut system = match self.system.lock() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = ?e, "Failed to lock system mutex");
                return serde_json::Value::Null;
            }
        };

        // Refresh process info
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.pid]),
            true,
            ProcessRefreshKind::everything(),
        );

        // Get process stats
        if let Some(process) = system.process(self.pid) {
            let cpu_percent = process.cpu_usage() as f64;
            let memory_mb = process.memory() as f64 / 1_048_576.0; // bytes to MB
            let uptime_secs = self.start_time.elapsed().as_secs();

            serde_json::json!({
                "name": "process_info",
                "pid": self.pid.as_u32(),
                "cpu_percent": cpu_percent,
                "memory_mb": memory_mb,
                "uptime_secs": uptime_secs
            })
        } else {
            tracing::warn!(pid = self.pid.as_u32(), "Process not found in sysinfo");
            serde_json::Value::Null
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_info_collect_returns_valid_json() {
        let collector = ProcessInfoCollector::new();
        let value = collector.collect();

        assert!(value.is_object(), "Should return a JSON object");
        let obj = value.as_object().unwrap();

        assert!(obj.contains_key("name"));
        assert_eq!(obj["name"], "process_info");

        assert!(obj.contains_key("pid"));
        assert!(obj["pid"].is_number());

        assert!(obj.contains_key("cpu_percent"));
        assert!(obj["cpu_percent"].is_number());

        assert!(obj.contains_key("memory_mb"));
        assert!(obj["memory_mb"].is_number());

        assert!(obj.contains_key("uptime_secs"));
        assert!(obj["uptime_secs"].is_number());
    }

    #[test]
    fn test_process_info_feed_id() {
        let collector = ProcessInfoCollector::new();
        assert_eq!(collector.feed_id(), FeedId::StatsProcessInfo);
    }

    #[test]
    fn test_process_info_interval() {
        let collector = ProcessInfoCollector::new();
        assert_eq!(collector.interval(), Duration::from_secs(5));
    }

    #[test]
    fn test_process_info_name() {
        let collector = ProcessInfoCollector::new();
        assert_eq!(collector.name(), "process_info");
    }

    #[test]
    fn test_process_info_golden_schema() {
        let collector = ProcessInfoCollector::new();
        let value = collector.collect();

        // Verify schema matches Spec S02
        assert!(value.is_object());
        let obj = value.as_object().unwrap();

        // Required fields with correct types
        assert_eq!(obj["name"].as_str().unwrap(), "process_info");
        assert!(obj["pid"].as_u64().is_some());
        assert!(obj["cpu_percent"].as_f64().is_some());
        assert!(obj["memory_mb"].as_f64().is_some());
        assert!(obj["uptime_secs"].as_u64().is_some());
    }
}

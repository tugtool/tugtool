//! Stats feed framework for tugcast
//!
//! This module implements the stats collection system with pluggable collectors.
//! Each collector runs as a separate SnapshotFeed with its own FeedId and watch channel.
//!
//! Note: These items will be used in step-2 when stats feeds are wired into main.rs.
//! Until then, they're marked as allowed dead code to prevent warnings.

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use tugcast_core::{FeedId, Frame, StatSnapshot};

pub mod build_status;
pub mod process_info;
pub mod token_usage;

#[allow(unused_imports)]
pub use build_status::BuildStatusCollector;
#[allow(unused_imports)]
pub use process_info::ProcessInfoCollector;
#[allow(unused_imports)]
pub use token_usage::TokenUsageCollector;

/// A pluggable stats collector that produces periodic snapshots.
///
/// Each collector runs on its own timer and produces a JSON value
/// representing its current measurement.
#[allow(dead_code)]
pub trait StatCollector: Send + Sync {
    /// Unique name for this collector (e.g., "process_info")
    fn name(&self) -> &str;

    /// The FeedId for this collector's individual feed
    fn feed_id(&self) -> FeedId;

    /// Collect current stats, returning a JSON value.
    /// Returns Value::Null on collection failure.
    ///
    /// This is a synchronous method that may perform blocking I/O.
    /// The StatsRunner wraps calls in spawn_blocking.
    fn collect(&self) -> serde_json::Value;

    /// Collection interval
    fn interval(&self) -> Duration;
}

/// Manages lifecycle of multiple stat collectors and produces aggregate feed.
#[allow(dead_code)]
pub struct StatsRunner {
    collectors: Vec<Arc<dyn StatCollector>>,
}

impl StatsRunner {
    /// Create a new StatsRunner with the given collectors.
    #[allow(dead_code)]
    pub fn new(collectors: Vec<Arc<dyn StatCollector>>) -> Self {
        Self { collectors }
    }

    /// Run all collectors and produce aggregate feed.
    ///
    /// Spawns one task per collector for individual collection, and one
    /// aggregator task that combines all collector outputs into a StatSnapshot.
    ///
    /// # Arguments
    ///
    /// * `aggregate_tx` - Watch sender for the aggregate feed (FeedId::Stats)
    /// * `individual_txs` - Watch senders for individual collector feeds (must match order of collectors)
    /// * `cancel` - Cancellation token to stop all tasks
    #[allow(dead_code)]
    pub async fn run(
        self,
        aggregate_tx: watch::Sender<Frame>,
        individual_txs: Vec<watch::Sender<Frame>>,
        cancel: CancellationToken,
    ) {
        assert_eq!(
            self.collectors.len(),
            individual_txs.len(),
            "Must provide one watch sender per collector"
        );

        // Spawn a task for each collector
        for (collector, tx) in self.collectors.iter().zip(individual_txs.iter()) {
            let collector_name = collector.name().to_string();
            let feed_id = collector.feed_id();
            let interval = collector.interval();
            let tx = tx.clone();
            let cancel = cancel.clone();
            let collector = Arc::clone(collector);

            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(interval);
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

                loop {
                    tokio::select! {
                        _ = ticker.tick() => {
                            // Clone Arc for the blocking task
                            let collector_clone = Arc::clone(&collector);

                            // Wrap the blocking collect() call in spawn_blocking
                            let value = match tokio::task::spawn_blocking(move || {
                                collector_clone.collect()
                            }).await {
                                Ok(v) => v,
                                Err(e) => {
                                    tracing::warn!(
                                        collector = %collector_name,
                                        error = ?e,
                                        "Collector task panicked"
                                    );
                                    serde_json::Value::Null
                                }
                            };

                            // Serialize to JSON bytes
                            let payload = match serde_json::to_vec(&value) {
                                Ok(p) => p,
                                Err(e) => {
                                    tracing::error!(
                                        collector = %collector_name,
                                        error = ?e,
                                        "Failed to serialize collector output"
                                    );
                                    continue;
                                }
                            };

                            // Send frame on individual watch channel
                            let frame = Frame::new(feed_id, payload);
                            if tx.send(frame).is_err() {
                                tracing::warn!(
                                    collector = %collector_name,
                                    "Collector watch channel closed"
                                );
                                break;
                            }
                        }
                        _ = cancel.cancelled() => {
                            tracing::debug!(collector = %collector_name, "Collector task cancelled");
                            break;
                        }
                    }
                }
            });
        }

        // Spawn aggregator task that combines all individual collectors
        let collectors_metadata: Vec<(String, FeedId)> = self
            .collectors
            .iter()
            .map(|c| (c.name().to_string(), c.feed_id()))
            .collect();

        let mut individual_rxs: Vec<watch::Receiver<Frame>> =
            individual_txs.iter().map(|tx| tx.subscribe()).collect();

        let cancel_agg = cancel.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(1));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        // Build aggregate snapshot
                        let mut collectors_map = std::collections::HashMap::new();

                        for (rx, (name, _feed_id)) in individual_rxs.iter_mut().zip(collectors_metadata.iter()) {
                            let frame = rx.borrow_and_update().clone();
                            // Skip empty frames (initial state)
                            if frame.payload.is_empty() {
                                continue;
                            }

                            // Deserialize the payload
                            match serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                                Ok(value) => {
                                    collectors_map.insert(name.clone(), value);
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        collector = name,
                                        error = ?e,
                                        "Failed to deserialize collector output in aggregator"
                                    );
                                }
                            }
                        }

                        // Build StatSnapshot
                        let snapshot = StatSnapshot {
                            collectors: collectors_map,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                        };

                        // Serialize and send
                        let payload = match serde_json::to_vec(&snapshot) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!(error = ?e, "Failed to serialize aggregate snapshot");
                                continue;
                            }
                        };

                        let frame = Frame::new(FeedId::Stats, payload);
                        if aggregate_tx.send(frame).is_err() {
                            tracing::warn!("Aggregate watch channel closed");
                            break;
                        }
                    }
                    _ = cancel_agg.cancelled() => {
                        tracing::debug!("Aggregator task cancelled");
                        break;
                    }
                }
            }
        });

        // Keep the StatsRunner alive until cancellation
        cancel.cancelled().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::time::timeout;

    // Mock collector for testing
    struct MockCollector {
        name: String,
        feed_id: FeedId,
        value: Arc<std::sync::Mutex<serde_json::Value>>,
    }

    impl MockCollector {
        fn new(name: &str, feed_id: FeedId) -> Self {
            Self {
                name: name.to_string(),
                feed_id,
                value: Arc::new(std::sync::Mutex::new(serde_json::json!({
                    "name": name,
                    "test": 42
                }))),
            }
        }
    }

    impl StatCollector for MockCollector {
        fn name(&self) -> &str {
            &self.name
        }

        fn feed_id(&self) -> FeedId {
            self.feed_id
        }

        fn collect(&self) -> serde_json::Value {
            self.value.lock().unwrap().clone()
        }

        fn interval(&self) -> Duration {
            Duration::from_millis(100)
        }
    }

    #[tokio::test]
    async fn test_stats_runner_integration() {
        let collectors: Vec<Arc<dyn StatCollector>> = vec![
            Arc::new(MockCollector::new("test1", FeedId::StatsProcessInfo)),
            Arc::new(MockCollector::new("test2", FeedId::StatsTokenUsage)),
        ];

        let (agg_tx, mut agg_rx) = watch::channel(Frame::new(FeedId::Stats, vec![]));
        let (tx1, _rx1) = watch::channel(Frame::new(FeedId::StatsProcessInfo, vec![]));
        let (tx2, _rx2) = watch::channel(Frame::new(FeedId::StatsTokenUsage, vec![]));

        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        let runner = StatsRunner::new(collectors);
        tokio::spawn(async move {
            runner.run(agg_tx, vec![tx1, tx2], cancel_clone).await;
        });

        // Wait for at least one aggregate frame
        let result = timeout(Duration::from_secs(2), async {
            loop {
                agg_rx.changed().await.unwrap();
                let frame = agg_rx.borrow().clone();
                if !frame.payload.is_empty() {
                    return frame;
                }
            }
        })
        .await;

        assert!(result.is_ok(), "Aggregate frame should arrive within 2 seconds");
        let frame = result.unwrap();

        // Verify it's a valid StatSnapshot
        let snapshot: StatSnapshot = serde_json::from_slice(&frame.payload).unwrap();
        assert!(!snapshot.timestamp.is_empty());
        assert!(snapshot.collectors.contains_key("test1") || snapshot.collectors.is_empty());

        cancel.cancel();
    }
}

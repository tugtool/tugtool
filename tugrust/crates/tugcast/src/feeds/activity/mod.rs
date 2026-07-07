//! ACTIVITY feed OS instrument.
//!
//! The stream-derived activity channels (text / tokens / tools / subagents)
//! are produced by tugcode and diverted onto `FeedId::ACTIVITY` by the
//! supervisor's merger ([P13]). This module adds the *cast-side* half: the OS
//! signals (CPU / memory / disk) sampled over each session's tugcode process
//! **subtree**, published onto the same feed as gauge channels ([P09]).
//!
//! - [`resource`] owns the subtree sampler: one shared `System`, a
//!   `parent()`-link walk from each session's tugcode child pid, and the
//!   `(pid, start_time)` reuse-guard that keeps a recycled pid from being
//!   misattributed ([P08], [P10], [P20]).

pub mod resource;

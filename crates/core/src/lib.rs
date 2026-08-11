//! HandheldMaid core library.
//!
//! Platform-agnostic building blocks shared across every frontend:
//! - [`behavior`]  rule-based behavior engine (event -> action)
//! - [`input`]     global keyboard/mouse hooks (behind `input` feature)
//! - [`automation`] system automation helpers (behind `automation` feature)

pub mod behavior;

#[cfg(feature = "input")]
pub mod input;

#[cfg(feature = "automation")]
pub mod automation;

/// Re-export the common error type.
pub use behavior::BehaviorError;

/// Semantic version of the core API surface, exposed to frontends.
pub const CORE_API_VERSION: &str = env!("CARGO_PKG_VERSION");

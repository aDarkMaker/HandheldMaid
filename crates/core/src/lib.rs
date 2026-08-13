//! HandheldMaid core library.
//!
//! Platform-agnostic building blocks shared across every frontend:
//! - [`action`]    behavior actions (model/speak/tool), categorized by execution site
//! - [`behavior`]  rule-based behavior engine (event -> named event -> action)
//! - [`event_bus`] named-event subscriptions with weighted random selection
//! - [`tool`]      MCP-style tool trait + registry (the plugin contract)
//! - [`input`]     global keyboard/mouse hooks (behind `input` feature)
//!
//! Built-in capability tools (time, archive, system_control) live in the
//! separate `hm-mcp` crate, not here — `hm-core` keeps only the tool *contract*.

pub mod action;
pub mod behavior;
pub mod event_bus;
pub mod tool;

#[cfg(feature = "input")]
pub mod input;

pub use behavior::BehaviorError;

/// Semantic version of the core API surface, exposed to frontends.
pub const CORE_API_VERSION: &str = env!("CARGO_PKG_VERSION");

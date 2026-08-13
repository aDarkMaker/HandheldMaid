//! HandheldMaid MCP-style tools.
//!
//! Built-in capability tools that are **not** part of the pet's core function
//! (time, archive, system_control) live here, separated from `hm-core` (which
//! keeps only the `tool` trait + registry — the plugin contract). This crate is
//! also the host for future external/official plugins: a plugin is anything that
//! implements `hm_core::tool::Tool` and is registered into the `ToolRegistry`.
//!
//! Each tool module is individually gated behind a feature flag when it depends
//! on a platform backend; dependency-free tools (`time`) are always built.

/// `time` tool — no platform dependencies, always available.
pub mod time;

/// `system_control` tool — simulates keyboard/mouse input via enigo.
#[cfg(feature = "automation")]
pub mod system_control;

/// `archive` tool — compress/extract zip & tar.gz.
#[cfg(feature = "archive")]
pub mod archive;

/// enigo-backed input backend used by `system_control`.
#[cfg(feature = "automation")]
pub mod automation;

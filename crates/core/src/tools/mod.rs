//! Built-in tools shipped with the core.
//!
//! Each module implements [`crate::tool::Tool`] and is registered by the
//! desktop shell at startup. Tools live behind feature flags when they depend
//! on platform backends.

#[cfg(feature = "automation")]
pub mod system_control;

#[cfg(feature = "archive")]
pub mod archive;

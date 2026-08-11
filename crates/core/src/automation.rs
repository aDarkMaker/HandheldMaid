//! System automation helpers (simulate input, clipboard, process control).
//!
//! Gated behind the `automation` feature. Used by the "do work on your
//! computer" roadmap item.

use enigo::{Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AutomationError {
    #[error("automation backend error: {0}")]
    Backend(String),
}

/// Thin wrapper over enigo so callers don't depend on enigo directly.
pub struct Automation {
    enigo: Enigo,
}

impl Default for Automation {
    fn default() -> Self {
        Self::new()
    }
}

impl Automation {
    pub fn new() -> Self {
        // Enigo::new can fail to acquire the platform input backend.
        let enigo = Enigo::new(&Settings::default()).expect("failed to initialize enigo backend");
        Self { enigo }
    }

    /// Type a string of text.
    pub fn type_text(&mut self, text: &str) -> Result<(), AutomationError> {
        self.enigo.text(text).map_err(|e| AutomationError::Backend(e.to_string()))
    }

    /// Press and release a single key.
    pub fn key(&mut self, key: Key) -> Result<(), AutomationError> {
        self.enigo.key(key, Direction::Click).map_err(|e| AutomationError::Backend(e.to_string()))
    }

    /// Move the mouse to absolute screen coordinates.
    pub fn move_mouse(&mut self, x: i32, y: i32) -> Result<(), AutomationError> {
        self.enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| AutomationError::Backend(e.to_string()))
    }

    /// Click the primary mouse button.
    pub fn click(&mut self) -> Result<(), AutomationError> {
        self.enigo.button(Button::Left, Direction::Click).map_err(|e| AutomationError::Backend(e.to_string()))
    }
}

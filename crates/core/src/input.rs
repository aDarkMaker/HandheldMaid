//! Global input hooks (keyboard + mouse) via `rdev`.
//!
//! This module only compiles when the `input` feature is enabled, so the core
//! stays buildable in environments without display/input access (CI, tests).

use std::sync::{Arc, Mutex};
use tracing::{debug, warn};

/// A high-level input event normalized across platforms.
#[derive(Debug, Clone)]
pub struct InputEvent {
    pub kind: InputKind,
    /// Logical screen coordinates for pointer events; unused for keys.
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputKind {
    KeyDown,
    KeyUp,
    Click,
}

/// Callback handed every captured input event.
pub type InputCallback = Arc<dyn Fn(InputEvent) + Send + Sync>;

/// A global input listener. Owns the rdev listen loop on its own thread.
pub struct InputListener {
    callback: InputCallback,
    _stop: Arc<Mutex<bool>>,
}

impl InputListener {
    pub fn new(callback: InputCallback) -> Self {
        Self { callback, _stop: Arc::new(Mutex::new(false)) }
    }

    /// Start listening on a background thread. Returns immediately.
    /// Errors here are non-fatal: rdev simply won't capture events.
    pub fn start(&self) {
        let cb = self.callback.clone();
        std::thread::spawn(move || {
            if let Err(e) = rdev::listen(move |event| translate(&event, &cb)) {
                // rdev's ListenError does not implement Display; use Debug.
                warn!(error = ?e, "rdev listen loop exited");
            }
        });
        debug!("input listener started");
    }
}

fn translate(event: &rdev::Event, cb: &InputCallback) {
    let translated = match event.event_type {
        rdev::EventType::KeyPress(_) => Some(InputEvent { kind: InputKind::KeyDown, x: 0, y: 0 }),
        rdev::EventType::KeyRelease(_) => Some(InputEvent { kind: InputKind::KeyUp, x: 0, y: 0 }),
        rdev::EventType::ButtonPress(btn) => {
            let (x, y) = coords(event);
            debug!(button = ?btn, x, y, "click");
            Some(InputEvent { kind: InputKind::Click, x, y })
        }
        _ => None,
    };
    if let Some(e) = translated {
        cb(e);
    }
}

fn coords(event: &rdev::Event) -> (i32, i32) {
    match event.event_type {
        rdev::EventType::MouseMove { x, y } => (x as i32, y as i32),
        _ => (0, 0),
    }
}

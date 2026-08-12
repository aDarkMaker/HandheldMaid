//! Global input (rdev) wiring: dynamic click-through + gaze following +
//! behavior dispatch. rdev is a global hook, so it keeps firing even while the
//! window is click-through.

use crate::dispatch::dispatch;
use crate::state::AppState;
use hm_core::behavior::EventKind;
use hm_core::input::{InputCallback, InputEvent, InputListener};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// Update click-through from the global cursor position vs the hit area.
/// Only calls the platform API on transitions to avoid spamming it on every move.
pub fn update_click_through(app: &tauri::AppHandle, cursor_x: i32, cursor_y: i32) {
    let state = app.state::<AppState>();
    let hit = state.hit_area.lock().unwrap();
    let want_passthrough = match *hit {
        Some(area) => !area.contains(cursor_x, cursor_y),
        None => true, // no hit area registered yet -> stay click-through
    };
    drop(hit);

    let mut current = state.click_through.lock().unwrap();
    if *current == want_passthrough {
        return; // no transition
    }
    *current = want_passthrough;
    drop(current);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(want_passthrough);
    }
}

/// Emit the cursor position relative to the main window so the frontend can
/// drive gaze following (eyes track the pointer anywhere on screen).
/// Window-relative pixels (top-left = 0,0), matching Live2D's `focus(x, y)`.
pub fn emit_cursor(app: &tauri::AppHandle, cursor_x: i32, cursor_y: i32) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(win_pos) = window.outer_position() else { return };
    let rel_x = cursor_x - win_pos.x;
    let rel_y = cursor_y - win_pos.y;
    let _ = app.emit("hm://cursor", serde_json::json!({ "x": rel_x, "y": rel_y }));
}

/// Build and start the global rdev input listener. Wires MouseMove to dynamic
/// click-through + throttled gaze following, and all other events to dispatch.
/// The listener is returned so the caller can keep it alive.
pub fn start_input_listener(app: tauri::AppHandle) -> InputListener {
    let app_handle = app.clone();
    let last_cursor_emit = Arc::new(Mutex::new(std::time::Instant::now()));
    let callback: InputCallback = Arc::new(move |ev: InputEvent| {
        let handle = app_handle.clone();
        match ev.kind {
            hm_core::input::InputKind::MouseMove => {
                // Dynamic click-through (cheap, runs every move).
                update_click_through(&handle, ev.x, ev.y);
                // Gaze following: throttled to ~30fps to avoid flooding IPC.
                let now = std::time::Instant::now();
                let should_emit = {
                    let mut last = last_cursor_emit.lock().unwrap();
                    if now.duration_since(*last) >= std::time::Duration::from_millis(33) {
                        *last = now;
                        true
                    } else {
                        false
                    }
                };
                if should_emit {
                    emit_cursor(&handle, ev.x, ev.y);
                }
            }
            _ => {
                let kind = EventKind::from(ev.kind);
                tauri::async_runtime::spawn(dispatch(handle, kind));
            }
        }
    });
    let listener = InputListener::new(callback);
    listener.start();
    listener
}

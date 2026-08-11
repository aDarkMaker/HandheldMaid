//! Tauri 2 desktop shell for HandheldMaid.
//!
//! The shell is intentionally thin: window lifecycle, IPC commands, and
//! wiring the platform input hooks from `hm-core`. All real logic lives in
//! the core crate so it can be reused by future frontends (mobile, CLI).

use hm_core::behavior::{BehaviorEngine, EventKind, Rule};
use std::sync::Mutex;
use tauri::Manager;

/// Shared behavior engine. Held in app state, mutated behind a Mutex so IPC
/// commands can register/unregister rules from any thread.
struct AppState {
    behavior: Mutex<BehaviorEngine>,
}

#[tauri::command]
fn register_rule(state: tauri::State<AppState>, rule: Rule) -> Result<(), String> {
    state.behavior.lock().unwrap().register(rule).map_err(|e| e.to_string())
}

#[tauri::command]
fn unregister_rule(state: tauri::State<AppState>, name: String) -> Result<(), String> {
    state.behavior.lock().unwrap().unregister(&name).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn matched_rules(state: tauri::State<AppState>, kind: EventKind) -> Vec<String> {
    state
        .behavior
        .lock()
        .unwrap()
        .matched(kind)
        .into_iter()
        .map(|r| r.name.clone())
        .collect()
}

/// Move the window by a relative offset (used for drag-to-move on the
/// transparent, frameless window).
#[tauri::command]
fn move_window(window: tauri::WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: pos.x + x,
            y: pos.y + y,
        }))
        .map_err(|e| e.to_string())
}

/// Toggle click-through so the pet can be either interactive or let clicks
/// pass to the desktop behind it.
#[tauri::command]
fn set_ignore_mouse_events(window: tauri::WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let state = AppState { behavior: Mutex::new(BehaviorEngine::new()) };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            register_rule,
            unregister_rule,
            matched_rules,
            move_window,
            set_ignore_mouse_events,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            // Start click-through so the pet floats over the desktop by default.
            let _ = window.set_ignore_cursor_events(true);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

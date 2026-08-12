//! Settings IPC commands: pet size, input-action settings + cooldown, and
//! archive settings. Each setter broadcasts a change event so the main window
//! can react immediately.

use crate::events::{EVENT_ARCHIVE_SETTINGS_CHANGED, EVENT_INPUT_SETTINGS_CHANGED, EVENT_SIZE_CHANGED};
use crate::state::{ArchiveSettings, AppState, InputActionSettings};
use tauri::Emitter;

/// Get the current pet physical size. Returns the default on first run.
#[tauri::command]
pub fn get_pet_size(state: tauri::State<AppState>) -> (u32, u32) {
    *state.pet_size.lock().unwrap()
}

/// Set the pet's physical size, persist it, and broadcast it so the main
/// window re-applies it immediately. The size lives here (not in webview
/// localStorage) because the settings and main windows have isolated storage.
#[tauri::command]
pub fn set_pet_size(app: tauri::AppHandle, state: tauri::State<AppState>, w: u32, h: u32) -> Result<(), String> {
    let clamped = (w.clamp(100, 2000), h.clamp(100, 2000));
    *state.pet_size.lock().unwrap() = clamped;
    let _ = app.emit(EVENT_SIZE_CHANGED, clamped);
    Ok(())
}

/// Get the input-action settings (enable flags + cooldown).
#[tauri::command]
pub fn get_input_action_settings(state: tauri::State<AppState>) -> InputActionSettings {
    *state.input_action.settings.lock().unwrap()
}

/// Set the input-action settings and broadcast so the main window can react.
#[tauri::command]
pub fn set_input_action_settings(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    keyboard_enabled: bool,
    click_enabled: bool,
    cooldown_ms: u64,
) -> Result<(), String> {
    let s = InputActionSettings {
        keyboard_enabled,
        click_enabled,
        cooldown_ms: cooldown_ms.clamp(0, 600_000),
    };
    *state.input_action.settings.lock().unwrap() = s;
    let _ = app.emit(EVENT_INPUT_SETTINGS_CHANGED, s);
    Ok(())
}

/// Called by the frontend when an input-triggered action finishes playing,
/// so the backend starts the shared cooldown timer. (Click actions also
/// reach here, so they (re)start the cooldown as specified.)
#[tauri::command]
pub fn notify_action_done(state: tauri::State<AppState>) -> Result<(), String> {
    state.start_cooldown();
    Ok(())
}

/// Get the archive (drag-drop compress/extract) settings.
#[tauri::command]
pub fn get_archive_settings(state: tauri::State<AppState>) -> ArchiveSettings {
    *state.archive_settings.lock().unwrap()
}

/// Set the archive settings and broadcast so the main window can react.
#[tauri::command]
pub fn set_archive_settings(app: tauri::AppHandle, state: tauri::State<AppState>, enabled: bool) -> Result<(), String> {
    let s = ArchiveSettings { enabled };
    *state.archive_settings.lock().unwrap() = s;
    let _ = app.emit(EVENT_ARCHIVE_SETTINGS_CHANGED, s);
    Ok(())
}

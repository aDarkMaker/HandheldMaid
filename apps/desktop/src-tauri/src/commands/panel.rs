//! Settings panel + context menu IPC commands: open/focus the settings window
//! with a fade transition, and show the native right-click menu.

use crate::events::{EVENT_DEV_MODE_TOGGLED, EVENT_PANEL_CLOSING, EVENT_PANEL_OPENING};
use crate::state::AppState;
use tauri::{Emitter, Manager};

/// Open the settings window (or focus it if already open). It is a normal,
/// framed, non-always-on-top window, independent of the transparent pet window.
///
/// Instead of hiding the pet window instantly (which looks abrupt), emit
/// `hm://panel-opening` so the frontend can fade the model out first, then
/// call `hide_main_window` to actually hide it. On close, show the window then
/// emit `hm://panel-closing` so the frontend fades the model back in.
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let settings = tauri::WebviewWindowBuilder::new(&app, "settings", tauri::WebviewUrl::App("settings.html".into()))
        .title("HandheldMaid Settings")
        .inner_size(480.0, 600.0)
        .decorations(true)
        .always_on_top(false)
        .resizable(true)
        .transparent(false)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;

    // Force click-through while the panel is open so rdev MouseMove doesn't
    // re-enable interaction. Don't hide yet — let the frontend fade out first,
    // then call `hide_main_window`.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_ignore_cursor_events(true);
        let state = app.state::<AppState>();
        *state.click_through.lock().unwrap() = true;
        let _ = app.emit(EVENT_PANEL_OPENING, ());
    }
    let app_handle = app.clone();
    settings.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(main) = app_handle.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_ignore_cursor_events(true);
                // Reset so the next mouse move re-evaluates the hit area.
                let state = app_handle.state::<AppState>();
                *state.click_through.lock().unwrap() = true;
                let _ = app_handle.emit(EVENT_PANEL_CLOSING, ());
            }
        }
    });

    Ok(())
}

/// Show a native context menu near the cursor (Open Settings / Dev / Quit).
/// "Dev" is a checkable item mirroring `AppState.dev_mode`: it toggles the
/// debug overlay (grid + pixel-map + hit/bounds rects + debug bubble + red
/// visible-top line). Off by default; the check mark shows the current state.
#[tauri::command]
pub fn show_context_menu(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};

    let window = app.get_webview_window("main").ok_or("main window not found")?;
    let open = MenuItem::with_id(&app, "open_settings", "Open Settings", true, None::<&str>).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    let dev_on = *state.dev_mode.lock().unwrap();
    let dev = CheckMenuItem::with_id(&app, "toggle_dev", "Dev", true, dev_on, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let sep1 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &sep1, &dev, &sep2, &quit]).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// Handle context-menu item clicks (Open Settings / toggle Dev / Quit).
pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "open_settings" => {
            let _ = open_settings(app.clone());
        }
        "toggle_dev" => {
            // Toggle the shared dev-mode flag and notify the frontend so it
            // shows/hides all debug overlays. Keep the menu item's check mark
            // in sync with the flag (the native menu does this automatically
            // for CheckMenuItem, but re-assert for safety).
            let state = app.state::<AppState>();
            let next = !*state.dev_mode.lock().unwrap();
            *state.dev_mode.lock().unwrap() = next;
            let _ = app.emit(EVENT_DEV_MODE_TOGGLED, next);
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

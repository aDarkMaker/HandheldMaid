//! Tauri 2 desktop shell for HandheldMaid.
//!
//! Thin: window lifecycle, IPC commands, and wiring the platform input
//! hooks from `hm-core`. All real logic lives in the core crate so it can be
//! reused by future frontends (mobile, CLI).
//!
//! Event flow:
//!   input source -> BehaviorEngine.dispatch(kind) -> Vec<Action>
//!     Action::Model/Speak -> emit("hm://action", action)  (frontend runs it)
//!     Action::Tool        -> ToolRegistry.invoke(name, args) (core runs it)
//!
//! Module layout:
//! - [`state`]        shared app state, settings structs, asset resolution
//! - [`events`]       Tauri event name constants
//! - [`dispatch`]     behavior event dispatch (the single event sink)
//! - [`input_wiring`] rdev global input -> click-through + gaze + dispatch
//! - [`commands`]     IPC commands, grouped by domain
//! - [`models`]       Live2D model discovery

mod commands;
mod dispatch;
mod events;
mod input_wiring;
mod models;
mod state;

use commands::panel::handle_menu_event;
use input_wiring::start_input_listener;
use state::{resolve_assets_dir, AppState};
use std::sync::{Arc, Mutex};
use tauri::Manager;

use hm_core::automation::Automation;
use hm_core::tools::archive::ArchiveTool;
use hm_core::tools::system_control::{SystemControlTool, NAME as SYSTEM_CONTROL_NAME};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(crate::generate_handler!())
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            // Start click-through so the pet floats over the desktop by default.
            let _ = window.set_ignore_cursor_events(true);
            // Apply the persisted pet size (defaults to 400x400) on launch. The
            // window is taller than the pet: the extra top slice is the speech
            // bubble area (sized to the model's scanned transparent-top space;
            // defaults to ~20% before the first scan — see window-size.ts).
            let (pw, ph) = *app.state::<AppState>().pet_size.lock().unwrap();
            let win_h = ph + ((ph as f32 * 0.2).round() as u32);
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: pw, height: win_h }));

            // Resolve the initial model (prefer "miku", else the first discovered).
            let initial = {
                #[allow(clippy::needless_borrow)]
                let assets = resolve_assets_dir(&app.handle());
                let models_list = models::list_models(&assets);
                models_list
                    .into_iter()
                    .find(|m| m.id == "miku")
                    .or_else(|| models::list_models(&assets).into_iter().next())
            };
            if let Some(m) = &initial {
                tracing::info!(model = %m.id, "initial model");
            }
            *app.state::<AppState>().current_model.lock().unwrap() = initial;

            // Register the built-in tools.
            {
                let state = app.state::<AppState>();
                let mut tools = state.tools.lock().unwrap();
                let automation = Arc::new(Mutex::new(Automation::new()));
                tools.register(Arc::new(SystemControlTool::new(automation)));
                tracing::info!(tool = SYSTEM_CONTROL_NAME, "registered tool");
                tools.register(Arc::new(ArchiveTool::new()));
                tracing::info!(tool = hm_core::tools::archive::NAME, "registered tool");
            }

            // Wire global input (rdev) -> behavior dispatch + dynamic click-through
            // + gaze following. rdev is a global hook, so it keeps firing even
            // while the window is click-through.
            let listener = start_input_listener(app.handle().clone());
            *app.state::<AppState>()._input_listener.lock().unwrap() = Some(listener);

            // Handle context-menu item clicks (Open Settings / Quit).
            let menu_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                handle_menu_event(&menu_handle, event);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

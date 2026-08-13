//! IPC commands, grouped by domain. Each submodule exposes `#[tauri::command]`
//! functions; this module re-exports them and registers them all in one place.

pub mod archive;
pub mod behavior;
pub mod models;
pub mod panel;
pub mod settings;
pub mod tools;
pub mod window;

/// Register every IPC command with the Tauri builder.
/// Call as `.invoke_handler(commands::generate_handler!())`.
#[macro_export]
macro_rules! generate_handler {
    () => {
        tauri::generate_handler![
            $crate::commands::behavior::register_rule,
            $crate::commands::behavior::unregister_rule,
            $crate::commands::behavior::matched_rules,
            $crate::commands::behavior::subscribe,
            $crate::commands::behavior::unsubscribe,
            $crate::commands::behavior::dispatch_event,
            $crate::commands::tools::list_tools,
            $crate::commands::tools::invoke_tool,
            $crate::commands::window::move_window,
            $crate::commands::window::resize_window_physical,
            $crate::commands::window::resize_window_keep_bottom,
            $crate::commands::window::hide_main_window,
            $crate::commands::window::set_ignore_mouse_events,
            $crate::commands::window::register_hit_area,
            $crate::commands::models::list_models,
            $crate::commands::models::get_current_model,
            $crate::commands::models::switch_model,
            $crate::commands::models::import_model,
            $crate::commands::models::rename_model,
            $crate::commands::models::delete_model,
            $crate::commands::settings::get_pet_size,
            $crate::commands::settings::set_pet_size,
            $crate::commands::settings::get_input_action_settings,
            $crate::commands::settings::set_input_action_settings,
            $crate::commands::settings::notify_action_done,
            $crate::commands::settings::get_archive_settings,
            $crate::commands::settings::set_archive_settings,
            $crate::commands::archive::handle_drop,
            $crate::commands::panel::open_settings,
            $crate::commands::panel::show_context_menu,
        ]
    };
}

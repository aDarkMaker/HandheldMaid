//! Tauri event name constants. Centralized so emitters and listeners reference
//! a single source of truth.

pub const EVENT_ACTION: &str = "hm://action";
pub const EVENT_MODEL_CHANGED: &str = "hm://model-changed";
/// Pet's physical size changes (settings -> main).
pub const EVENT_SIZE_CHANGED: &str = "hm://size-changed";
/// Input-action settings change (settings -> main).
pub const EVENT_INPUT_SETTINGS_CHANGED: &str = "hm://input-settings-changed";
/// Tells the frontend to play a random input-triggered action (backend -> main).
pub const EVENT_TRIGGER_INPUT_ACTION: &str = "hm://trigger-input-action";
/// Before the settings panel opens: main window fades out, then hides.
pub const EVENT_PANEL_OPENING: &str = "hm://panel-opening";
/// After the settings panel closes: main window shows, then fades in.
pub const EVENT_PANEL_CLOSING: &str = "hm://panel-closing";
/// Archive settings change (settings -> main).
pub const EVENT_ARCHIVE_SETTINGS_CHANGED: &str = "hm://archive-settings-changed";
/// Result of a drag-drop archive operation (backend -> main), for toasts.
pub const EVENT_ARCHIVE_RESULT: &str = "hm://archive-result";
/// Dev (debug overlay) mode toggled via the right-click menu. Carries `bool`.
pub const EVENT_DEV_MODE_TOGGLED: &str = "hm://dev-mode-toggled";

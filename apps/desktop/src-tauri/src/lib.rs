//! Tauri 2 desktop shell for HandheldMaid.
//!
//! Thin: window lifecycle, IPC commands, and wiring the platform input hooks
//! from `hm-core`. All real logic lives in the core crate so it can be reused
//! by future frontends (mobile, CLI).
//!
//! Event flow:
//!   input source -> BehaviorEngine.dispatch(kind) -> Vec<Action>
//!     Action::Model/Speak -> emit("hm://action", action)  (frontend runs it)
//!     Action::Tool        -> ToolRegistry.invoke(name, args) (core runs it)

use hm_core::action::Action;
use hm_core::automation::Automation;
use hm_core::behavior::{BehaviorEngine, EventKind, Rule};
use hm_core::event_bus::Subscription;
use hm_core::input::{InputCallback, InputEvent, InputListener};
use hm_core::tool::{Tool, ToolInfo, ToolRegistry};
use hm_core::tools::system_control::{SystemControlTool, NAME as SYSTEM_CONTROL_NAME};
use models::ModelInfo;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

mod models;

const EVENT_ACTION: &str = "hm://action";
const EVENT_MODEL_CHANGED: &str = "hm://model-changed";
/// Tauri event emitted when the pet's physical size changes (settings -> main).
const EVENT_SIZE_CHANGED: &str = "hm://size-changed";

/// Screen-space rectangle the pet occupies, used for dynamic click-through
/// (absolute screen pixels).
#[derive(Debug, Clone, Copy)]
struct HitArea {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

impl HitArea {
    fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

/// Shared app state. Everything is behind `Mutex` so IPC commands and the
/// input thread can mutate it.
struct AppState {
    behavior: Mutex<BehaviorEngine>,
    tools: Mutex<ToolRegistry>,
    /// RNG for weighted-random selection. Seeded from entropy so behavior is
    /// non-deterministic at runtime.
    rng: Mutex<ChaCha8Rng>,
    /// Kept alive so the rdev thread isn't dropped (it is detached).
    _input_listener: Mutex<Option<InputListener>>,
    /// Screen-space hit area registered by the frontend. The window is
    /// interactive when the cursor is inside it, click-through outside.
    hit_area: Mutex<Option<HitArea>>,
    /// Last click-through state applied; the platform API is only called on
    /// transitions (rdev MouseMove fires very frequently).
    click_through: Mutex<bool>,
    /// The currently active model.
    current_model: Mutex<Option<ModelInfo>>,
    /// The pet's physical window size (px), set from the settings window.
    /// Shared as the single source of truth between the two webviews.
    pet_size: Mutex<(u32, u32)>,
}

/// Default physical pet size.
const DEFAULT_PET_SIZE: (u32, u32) = (400, 400);

/// Resolve the `assets/` directory. In dev it lives at the repo root (three
/// levels above src-tauri); in prod it is the bundled resource dir.
fn resolve_assets_dir(app: &tauri::AppHandle) -> PathBuf {
    let dev_assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../assets");
    if dev_assets.exists() {
        return dev_assets;
    }
    app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("assets"))
}

/// Dispatch a behavior event end-to-end: match rules, roll probability,
/// weighted-select subscriptions, then route each action by category.
///
/// Single sink for every event source (rdev global input, the frontend
/// `dispatch_event` IPC, timers). Locks are held only for each read; tool
/// execution is awaited *after* the registry lock is released.
async fn dispatch(app: tauri::AppHandle, kind: EventKind) {
    let actions: Vec<Action> = {
        let state = app.state::<AppState>();
        let engine = state.behavior.lock().unwrap();
        let mut rng = state.rng.lock().unwrap();
        engine.dispatch(kind, &mut *rng)
    };
    tracing::debug!(event = ?kind, matched = actions.len(), "dispatch");

    for action in actions {
        match action {
            Action::Model(_) | Action::Speak(_) => {
                if let Err(e) = app.emit(EVENT_ACTION, action) {
                    tracing::warn!(error = %e, "emit action failed");
                }
            }
            Action::Tool(tool_action) => {
                // Clone the Arc and release the registry lock before awaiting.
                let tool: Option<Arc<dyn Tool>> = app
                    .state::<AppState>()
                    .tools
                    .lock()
                    .unwrap()
                    .get(&tool_action.name);
                match tool {
                    Some(t) => {
                        if let Err(e) = t.execute(tool_action.args).await {
                            tracing::warn!(error = %e, tool = %tool_action.name, "tool execute failed");
                        }
                    }
                    None => tracing::warn!(tool = %tool_action.name, "tool not found"),
                }
            }
        }
    }
}

/// Update click-through from the global cursor position vs the hit area.
/// Only calls the platform API on transitions to avoid spamming it on every move.
fn update_click_through(app: &tauri::AppHandle, cursor_x: i32, cursor_y: i32) {
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
fn emit_cursor(app: &tauri::AppHandle, cursor_x: i32, cursor_y: i32) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(win_pos) = window.outer_position() else { return };
    let rel_x = cursor_x - win_pos.x;
    let rel_y = cursor_y - win_pos.y;
    let _ = app.emit("hm://cursor", serde_json::json!({ "x": rel_x, "y": rel_y }));
}

#[tauri::command]
fn register_rule(state: tauri::State<AppState>, rule: Rule) -> Result<(), String> {
    state.behavior.lock().unwrap().register(rule).map_err(|e| e.to_string())
}

#[tauri::command]
fn unregister_rule(state: tauri::State<AppState>, name: String) -> Result<(), String> {
    state
        .behavior
        .lock()
        .unwrap()
        .unregister(&name)
        .map(|_| ())
        .map_err(|e| e.to_string())
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

#[tauri::command]
fn subscribe(state: tauri::State<AppState>, subscription: Subscription) -> Result<(), String> {
    state.behavior.lock().unwrap().bus_mut().subscribe(subscription).map_err(|e| e.to_string())
}

#[tauri::command]
fn unsubscribe(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.behavior.lock().unwrap().bus_mut().unsubscribe(&id).map(|_| ()).map_err(|e| e.to_string())
}

/// Frontend-originated event (e.g. canvas pointertap -> PetTap). Feeds into
/// the same dispatch sink as global input.
#[tauri::command]
async fn dispatch_event(app: tauri::AppHandle, kind: EventKind) -> Result<(), String> {
    dispatch(app, kind).await;
    Ok(())
}

#[tauri::command]
fn list_tools(state: tauri::State<AppState>) -> Vec<ToolInfo> {
    state.tools.lock().unwrap().list()
}

#[tauri::command]
async fn invoke_tool(
    state: tauri::State<'_, AppState>,
    name: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let tool = state
        .tools
        .lock()
        .unwrap()
        .get(&name)
        .ok_or_else(|| format!("tool not found: {name}"))?;
    tool.execute(args).await.map_err(|e| e.to_string())
}

/// Move the window to an absolute top-left position (physical pixels).
/// `x`/`y` are the desired top-left, computed in the renderer from the cursor
/// minus the grab offset — absolute, so drags can't drift from increments.
#[tauri::command]
fn move_window(window: tauri::WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}

/// Get the current pet physical size. Returns the default on first run.
#[tauri::command]
fn get_pet_size(state: tauri::State<AppState>) -> (u32, u32) {
    *state.pet_size.lock().unwrap()
}

/// Set the pet's physical size, persist it, and broadcast it so the main
/// window re-applies it immediately. The size lives here (not in webview
/// localStorage) because the settings and main windows have isolated storage.
#[tauri::command]
fn set_pet_size(app: tauri::AppHandle, state: tauri::State<AppState>, w: u32, h: u32) -> Result<(), String> {
    let clamped = (w.clamp(100, 2000), h.clamp(100, 2000));
    *state.pet_size.lock().unwrap() = clamped;
    let _ = app.emit(EVENT_SIZE_CHANGED, clamped);
    Ok(())
}

/// Resize the window to a physical size. Keeps the pet's on-screen size
/// stable across DPI / display changes (window sized in physical px, renderer
/// layout in matching CSS px).
#[tauri::command]
fn resize_window_physical(window: tauri::WebviewWindow, w: u32, h: u32) -> Result<(), String> {
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w, height: h }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_ignore_mouse_events(window: tauri::WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// Register the pet's screen-space hit area for dynamic click-through.
/// Called by the frontend after the model is laid out (and on move/resize).
#[tauri::command]
fn register_hit_area(state: tauri::State<AppState>, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    *state.hit_area.lock().unwrap() = Some(HitArea { x, y, w, h });
    Ok(())
}

/// List all bundled Live2D models discovered under assets/models/.
#[tauri::command]
fn list_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    Ok(models::list_models(&resolve_assets_dir(&app)))
}

#[tauri::command]
fn get_current_model(state: tauri::State<AppState>) -> Result<ModelInfo, String> {
    state
        .current_model
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no model selected".to_string())
}

/// Switch the active model. Emits `hm://model-changed` so the main window
/// reloads the model.
#[tauri::command]
fn switch_model(app: tauri::AppHandle, state: tauri::State<AppState>, id: String) -> Result<ModelInfo, String> {
    let model = models::list_models(&resolve_assets_dir(&app))
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("model not found: {id}"))?;
    *state.current_model.lock().unwrap() = Some(model.clone());
    tracing::info!(model = %model.id, "switch_model");
    let _ = app.emit(EVENT_MODEL_CHANGED, &model);
    Ok(model)
}

/// Open the settings window (or focus it if already open). It is a normal,
/// framed, non-always-on-top window, independent of the transparent pet window.
#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
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

    // Hide the pet window while settings is open and force click-through so
    // rdev MouseMove doesn't re-enable it.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_ignore_cursor_events(true);
        let _ = main.hide();
        let state = app.state::<AppState>();
        *state.click_through.lock().unwrap() = true;
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
            }
        }
    });

    Ok(())
}

/// Show a native context menu near the cursor (Open Settings / Quit).
#[tauri::command]
fn show_context_menu(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let window = app.get_webview_window("main").ok_or("main window not found")?;
    let open = MenuItem::with_id(&app, "open_settings", "Open Settings", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &sep, &quit]).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "open_settings" => {
            let _ = open_settings(app.clone());
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let state = AppState {
        behavior: Mutex::new(BehaviorEngine::new()),
        tools: Mutex::new(ToolRegistry::new()),
        rng: Mutex::new(ChaCha8Rng::from_entropy()),
        _input_listener: Mutex::new(None),
        hit_area: Mutex::new(None),
        click_through: Mutex::new(true),
        current_model: Mutex::new(None),
        pet_size: Mutex::new(DEFAULT_PET_SIZE),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            register_rule,
            unregister_rule,
            matched_rules,
            subscribe,
            unsubscribe,
            dispatch_event,
            list_tools,
            invoke_tool,
            move_window,
            resize_window_physical,
            get_pet_size,
            set_pet_size,
            set_ignore_mouse_events,
            register_hit_area,
            list_models,
            get_current_model,
            switch_model,
            open_settings,
            show_context_menu,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            // Start click-through so the pet floats over the desktop by default.
            let _ = window.set_ignore_cursor_events(true);
            // Apply the persisted pet size (defaults to 400x400) on launch.
            let (pw, ph) = *app.state::<AppState>().pet_size.lock().unwrap();
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: pw, height: ph }));

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

            // Register the built-in system_control tool.
            let automation = Arc::new(Mutex::new(Automation::new()));
            app.state::<AppState>()
                .tools
                .lock()
                .unwrap()
                .register(Arc::new(SystemControlTool::new(automation)));
            tracing::info!(tool = SYSTEM_CONTROL_NAME, "registered tool");

            // Wire global input (rdev) -> behavior dispatch + dynamic click-through
            // + gaze following. rdev is a global hook, so it keeps firing even
            // while the window is click-through.
            let app_handle = app.handle().clone();
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
            *app.state::<AppState>()._input_listener.lock().unwrap() = Some(listener);

            let menu_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                handle_menu_event(&menu_handle, event);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

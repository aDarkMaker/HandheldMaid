//! Behavior engine IPC commands: rule registration, subscriptions, and event
//! dispatch.

use crate::dispatch::dispatch;
use crate::state::AppState;
use hm_core::behavior::{EventKind, Rule};
use hm_core::event_bus::Subscription;

#[tauri::command]
pub fn register_rule(state: tauri::State<AppState>, rule: Rule) -> Result<(), String> {
    state.behavior.lock().unwrap().register(rule).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unregister_rule(state: tauri::State<AppState>, name: String) -> Result<(), String> {
    state
        .behavior
        .lock()
        .unwrap()
        .unregister(&name)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn matched_rules(state: tauri::State<AppState>, kind: EventKind) -> Vec<String> {
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
pub fn subscribe(state: tauri::State<AppState>, subscription: Subscription) -> Result<(), String> {
    state.behavior.lock().unwrap().bus_mut().subscribe(subscription).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unsubscribe(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state
        .behavior
        .lock()
        .unwrap()
        .bus_mut()
        .unsubscribe(&id)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Frontend-originated event (e.g. canvas pointertap -> PetTap). Feeds into
/// the same dispatch sink as global input.
#[tauri::command]
pub async fn dispatch_event(app: tauri::AppHandle, kind: EventKind) -> Result<(), String> {
    dispatch(app, kind).await;
    Ok(())
}


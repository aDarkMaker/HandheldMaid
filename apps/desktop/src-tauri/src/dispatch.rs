//! Behavior event dispatch: the single sink for every event source (rdev
//! global input, the frontend `dispatch_event` IPC, timers).

use crate::events::EVENT_ACTION;
use crate::events::EVENT_TRIGGER_INPUT_ACTION;
use crate::state::AppState;
use hm_core::action::Action;
use hm_core::behavior::EventKind;
use hm_core::tool::Tool;
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Dispatch a behavior event end-to-end: match rules, roll probability,
/// weighted-select subscriptions, then route each action by category.
///
/// Locks are held only for each read; tool execution is awaited *after* the
/// registry lock is released.
pub async fn dispatch(app: tauri::AppHandle, kind: EventKind) {
    // Input-action gate: click/keyboard may trigger a random action directly,
    // bypassing the rule engine (the action content is chosen in the frontend).
    {
        let state = app.state::<AppState>();
        let mut rng = state.rng.lock().unwrap();
        if let Some(source) = state.gate_input_action(kind, &mut *rng) {
            // Click always fires and resets the cooldown; the cooldown is
            // (re)started when the frontend reports the action finished.
            if source == "click" {
                state.reset_cooldown();
            }
            let _ = app.emit(
                EVENT_TRIGGER_INPUT_ACTION,
                serde_json::json!({ "source": source }),
            );
            return;
        }
    }

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

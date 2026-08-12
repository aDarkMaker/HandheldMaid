//! Live2D model discovery and switching IPC commands.

use crate::events::EVENT_MODEL_CHANGED;
use crate::models::ModelInfo;
use crate::models as model_discovery;
use crate::state::{resolve_assets_dir, AppState};
use tauri::Emitter;

/// List all bundled Live2D models discovered under assets/models/.
#[tauri::command]
pub fn list_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    Ok(model_discovery::list_models(&resolve_assets_dir(&app)))
}

#[tauri::command]
pub fn get_current_model(state: tauri::State<AppState>) -> Result<ModelInfo, String> {
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
pub fn switch_model(app: tauri::AppHandle, state: tauri::State<AppState>, id: String) -> Result<ModelInfo, String> {
    let model = model_discovery::list_models(&resolve_assets_dir(&app))
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("model not found: {id}"))?;
    *state.current_model.lock().unwrap() = Some(model.clone());
    tracing::info!(model = %model.id, "switch_model");
    let _ = app.emit(EVENT_MODEL_CHANGED, &model);
    Ok(model)
}


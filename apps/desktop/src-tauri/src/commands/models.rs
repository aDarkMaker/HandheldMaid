//! Live2D model discovery, switching, and import IPC commands.

use crate::events::{EVENT_MODEL_CHANGED, EVENT_MODEL_IMPORTED};
use crate::models as model_discovery;
use crate::models::{ImportedModel, ModelInfo};
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
pub fn switch_model(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
) -> Result<ModelInfo, String> {
    let model = model_discovery::list_models(&resolve_assets_dir(&app))
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("model not found: {id}"))?;
    *state.current_model.lock().unwrap() = Some(model.clone());
    tracing::info!(model = %model.id, "switch_model");
    let _ = app.emit(EVENT_MODEL_CHANGED, &model);
    Ok(model)
}

/// Import Live2D model(s) from a dropped folder or archive. Archives are
/// extracted; every discovered model3.json is archived under models/<id>/runtime/.
/// Emits `hm://model-imported` with the per-model results for the frontend to
/// toast and refresh the list.
#[tauri::command]
pub fn import_model(app: tauri::AppHandle, path: String) -> Result<Vec<ImportedModel>, String> {
    let assets = resolve_assets_dir(&app);
    let source = std::path::PathBuf::from(&path);
    tracing::info!(source = %path, "import_model");
    let imported = model_discovery::import_model(&assets, &source).map_err(|e| e.to_string())?;
    let _ = app.emit(EVENT_MODEL_IMPORTED, &imported);
    Ok(imported)
}

/// Set a custom display name for a model (any model). Empty/None restores the
/// default. Emits `hm://model-changed` if the active model was renamed.
#[tauri::command]
pub fn rename_model(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
    name: Option<String>,
) -> Result<ModelInfo, String> {
    let assets = resolve_assets_dir(&app);
    let info =
        model_discovery::rename_model(&assets, &id, name.as_deref()).map_err(|e| e.to_string())?;
    // If the active model was renamed, refresh its display name.
    let mut current = state.current_model.lock().unwrap();
    if let Some(c) = current.as_mut() {
        if c.id == id {
            c.name = info.name.clone();
            let _ = app.emit(EVENT_MODEL_CHANGED, c.clone());
        }
    }
    Ok(info)
}

/// Permanently delete an imported model. Refuses built-in models. If the
/// active model is deleted, the next available model becomes active.
#[tauri::command]
pub fn delete_model(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
) -> Result<(), String> {
    let assets = resolve_assets_dir(&app);
    model_discovery::delete_model(&assets, &id).map_err(|e| e.to_string())?;
    tracing::info!(model = %id, "delete_model");

    // If the active model was deleted, fall back to the next available.
    let mut current = state.current_model.lock().unwrap();
    let was_active = current.as_ref().is_some_and(|c| c.id == id);
    if was_active {
        let next = model_discovery::list_models(&assets).into_iter().next();
        *current = next.clone();
        if let Some(m) = &next {
            let _ = app.emit(EVENT_MODEL_CHANGED, m.clone());
        }
    }
    Ok(())
}

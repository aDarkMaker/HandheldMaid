//! Drag-drop archive IPC command: compress folders / extract archives dropped
//! onto the pet window, then broadcast the result for the frontend to toast.

use crate::events::EVENT_ARCHIVE_RESULT;
use crate::state::AppState;
use tauri::Emitter;

/// Handle a dropped file: compress folders, extract archives. Called from the
/// frontend's drop handler with the dropped file's absolute path. The result
/// is broadcast via `hm://archive-result` so the frontend can toast it.
#[tauri::command]
pub async fn handle_drop(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    if !state.archive_settings.lock().unwrap().enabled {
        let _ = app.emit(
            EVENT_ARCHIVE_RESULT,
            serde_json::json!({ "ok": false, "error": "Archive feature is disabled" }),
        );
        return Ok(());
    }
    let tool = state
        .tools
        .lock()
        .unwrap()
        .get(hm_mcp::archive::NAME)
        .ok_or_else(|| "archive tool not registered".to_string())?;
    // Decide compress vs extract from the path type.
    let p = std::path::PathBuf::from(&path);
    let action = if p.is_dir() { "compress" } else { "extract" };
    let result = tool
        .execute(serde_json::json!({ "action": action, "path": path }))
        .await;
    let payload = match result {
        Ok(v) => serde_json::json!({ "ok": true, "action": action, "result": v }),
        Err(e) => serde_json::json!({ "ok": false, "action": action, "error": e.to_string() }),
    };
    let _ = app.emit(EVENT_ARCHIVE_RESULT, payload);
    Ok(())
}

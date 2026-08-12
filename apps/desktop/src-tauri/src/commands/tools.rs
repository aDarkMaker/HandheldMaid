//! Tool registry IPC commands: list and invoke registered tools.

use crate::state::AppState;
use hm_core::tool::ToolInfo;

#[tauri::command]
pub fn list_tools(state: tauri::State<AppState>) -> Vec<ToolInfo> {
    state.tools.lock().unwrap().list()
}

#[tauri::command]
pub async fn invoke_tool(
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

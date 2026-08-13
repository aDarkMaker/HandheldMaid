//! `system_control` tool: simulate keyboard/mouse input via the automation backend.
//!
//! `Automation` methods take `&mut self`; `Tool::execute` takes `&self`, so the
//! automation backend is held in an `Arc<Mutex<_>>` for interior mutability.

use crate::automation::Automation;
use async_trait::async_trait;
use hm_core::tool::{Tool, ToolError};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

/// Tool name, exposed for registration wiring.
pub const NAME: &str = "system_control";

pub struct SystemControlTool {
    automation: Arc<Mutex<Automation>>,
}

impl SystemControlTool {
    pub fn new(automation: Arc<Mutex<Automation>>) -> Self {
        Self { automation }
    }
}

#[async_trait]
impl Tool for SystemControlTool {
    fn name(&self) -> &str {
        NAME
    }

    fn description(&self) -> &str {
        "Simulate keyboard and mouse input: type text, press keys, move the mouse, click."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["type_text", "move_mouse", "click"],
                    "description": "Which input action to perform."
                },
                "text": { "type": "string", "description": "Text to type (for type_text)." },
                "x": { "type": "integer", "description": "Absolute screen X (for move_mouse)." },
                "y": { "type": "integer", "description": "Absolute screen Y (for move_mouse)." }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArgs("missing `action`".into()))?;

        // Keep the lock scope tight (no await while held).
        let mut a = self
            .automation
            .lock()
            .map_err(|e| ToolError::Execution(format!("automation lock poisoned: {e}")))?;

        match action {
            "type_text" => {
                let text = args
                    .get("text")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ToolError::InvalidArgs("missing `text`".into()))?;
                a.type_text(text)
                    .map_err(|e| ToolError::Execution(e.to_string()))?;
            }
            "move_mouse" => {
                let x = args
                    .get("x")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| ToolError::InvalidArgs("missing `x`".into()))?
                    as i32;
                let y = args
                    .get("y")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| ToolError::InvalidArgs("missing `y`".into()))?
                    as i32;
                a.move_mouse(x, y)
                    .map_err(|e| ToolError::Execution(e.to_string()))?;
            }
            "click" => {
                a.click().map_err(|e| ToolError::Execution(e.to_string()))?;
            }
            other => return Err(ToolError::InvalidArgs(format!("unknown action: {other}"))),
        }

        Ok(json!({ "ok": true, "action": action }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_has_action_enum() {
        let tool = SystemControlTool::new(Arc::new(Mutex::new(Automation::new())));
        let schema = tool.input_schema();
        let actions = schema["properties"]["action"]["enum"].as_array().unwrap();
        assert!(actions.iter().any(|v| v == "type_text"));
        assert!(actions.iter().any(|v| v == "move_mouse"));
        assert!(actions.iter().any(|v| v == "click"));
    }
}

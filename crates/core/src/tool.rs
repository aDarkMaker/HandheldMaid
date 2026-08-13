//! MCP-style tool registry.
//!
//! The [`Tool`] trait mirrors the MCP spec: `name`/`description`/`input_schema`
//! map to a `tools/list` entry, `execute` maps to `tools/call`. Wrapping this
//! registry in a stdio JSON-RPC transport turns it into a standard MCP server.

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

/// Errors raised by tool invocation.
#[derive(Debug, Error)]
pub enum ToolError {
    #[error("tool not found: {0}")]
    NotFound(String),
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("tool execution failed: {0}")]
    Execution(String),
}

/// Serializable tool descriptor. Maps 1:1 to an MCP `tools/list` item.
/// `input_schema` is camelCase to match the MCP spec.
#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// A single tool, object-safe via `async_trait`. Raw JSON in/out keeps the
/// trait open to arbitrary tools without per-tool generics.
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    async fn execute(&self, args: Value) -> Result<Value, ToolError>;
}

/// Registry of named tools. Insertion order is preserved for deterministic
/// `list()` output.
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
    order: Vec<String>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            order: Vec::new(),
        }
    }

    /// Register (or replace) a tool by its name.
    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        let name = tool.name().to_string();
        let is_new = !self.tools.contains_key(&name);
        self.tools.insert(name.clone(), tool);
        if is_new {
            self.order.push(name);
        }
    }

    /// Remove a tool by name.
    pub fn unregister(&mut self, name: &str) -> Result<(), ToolError> {
        self.order.retain(|n| n != name);
        self.tools
            .remove(name)
            .map(|_| ())
            .ok_or_else(|| ToolError::NotFound(name.to_string()))
    }

    /// Borrow a tool as `Arc` so callers can release the registry lock before
    /// awaiting `execute` (never hold a lock across an await).
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    /// List all tools in registration order. Maps to MCP `tools/list`.
    pub fn list(&self) -> Vec<ToolInfo> {
        self.order
            .iter()
            .filter_map(|n| self.tools.get(n))
            .map(|t| ToolInfo {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
            })
            .collect()
    }

    /// Convenience: look up and execute in one call. The `Arc` is cloned first,
    /// so `execute` is awaited after the borrow of `self` ends.
    pub async fn invoke(&self, name: &str, args: Value) -> Result<Value, ToolError> {
        match self.tools.get(name) {
            Some(t) => {
                let t = Arc::clone(t);
                t.execute(args).await
            }
            None => Err(ToolError::NotFound(name.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoTool;

    #[async_trait]
    impl Tool for EchoTool {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "echoes back its args"
        }
        fn input_schema(&self) -> Value {
            serde_json::json!({ "type": "object" })
        }
        async fn execute(&self, args: Value) -> Result<Value, ToolError> {
            Ok(args)
        }
    }

    #[test]
    fn register_and_list_preserves_order() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        let info = reg.list();
        assert_eq!(info.len(), 1);
        assert_eq!(info[0].name, "echo");
        assert_eq!(info[0].input_schema["type"], "object");
    }

    #[tokio::test]
    async fn invoke_returns_args() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        let out = reg
            .invoke("echo", serde_json::json!({"hi": 1}))
            .await
            .unwrap();
        assert_eq!(out["hi"], 1);
    }

    #[tokio::test]
    async fn invoke_missing_tool_errors() {
        let reg = ToolRegistry::new();
        let err = reg.invoke("nope", Value::Null).await.unwrap_err();
        assert!(matches!(err, ToolError::NotFound(_)));
    }

    #[test]
    fn unregister_removes_tool() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        reg.unregister("echo").unwrap();
        assert!(reg.list().is_empty());
    }
}

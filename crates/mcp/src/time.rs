//! `time` tool: return the current system date/time in several formats. No
//! platform dependencies — always available.

use hm_core::tool::{Tool, ToolError};
use async_trait::async_trait;
use chrono::{Local, Utc};
use serde_json::{json, Value};

/// Tool name, exposed for registration wiring.
pub const NAME: &str = "time";

pub struct TimeTool;

impl Default for TimeTool {
    fn default() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for TimeTool {
    fn name(&self) -> &str {
        NAME
    }

    fn description(&self) -> &str {
        "Get the current system date and time. Returns ISO-8601 (UTC), a local \
         timestamp, the Unix epoch seconds/millis, and the local timezone offset."
    }

    fn input_schema(&self) -> Value {
        // No arguments: the tool reports the system local timezone.
        json!({ "type": "object", "additionalProperties": false })
    }

    async fn execute(&self, _args: Value) -> Result<Value, ToolError> {
        let utc = Utc::now();
        let local = Local::now();
        Ok(json!({
            "iso_utc": utc.to_rfc3339(),
            "iso_local": local.to_rfc3339(),
            "unix_seconds": utc.timestamp(),
            "unix_millis": utc.timestamp_millis(),
            "timezone": local.offset().to_string(),
            "offset": local.offset().to_string(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_is_empty_object() {
        let schema = TimeTool.input_schema();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
    }

    #[tokio::test]
    async fn returns_iso_utc_and_unix() {
        let out = TimeTool.execute(json!({})).await.unwrap();
        assert!(out["iso_utc"].as_str().unwrap().contains('T'));
        assert!(out["unix_seconds"].as_i64().unwrap() > 0);
        assert!(out["unix_millis"].as_i64().unwrap() > 0);
        assert!(out["timezone"].as_str().unwrap().len() > 0);
    }
}

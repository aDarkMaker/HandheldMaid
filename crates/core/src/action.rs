//! Behavior actions, tagged with `category` so the TypeScript mirror is a
//! clean discriminated union.
//!
//! - [`Action::Model`] / [`Action::Speak`] run in the frontend renderer.
//! - [`Action::Tool`] runs in the Rust core via the [`crate::tool::ToolRegistry`].

use serde::{Deserialize, Serialize};

/// A frontend Live2D model action: play a motion group and/or set an expression.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAction {
    /// Motion group name as defined in the model3.json (e.g. "Tap", "Idle").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<String>,
    /// Expression id (reserved; the demo model has no expressions yet).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
}

/// A text-to-speech action executed in the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakAction {
    pub text: String,
    /// BCP-47 language tag, e.g. "ja-JP".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

/// A tool invocation executed in the Rust core via the tool registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolAction {
    /// Registered tool name (see [`crate::tool::ToolRegistry`]).
    pub name: String,
    #[serde(default = "serde_json::Value::default")]
    pub args: serde_json::Value,
}

/// A behavior action, categorized by execution site.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "category", rename_all = "lowercase")]
pub enum Action {
    Model(ModelAction),
    Speak(SpeakAction),
    Tool(ToolAction),
}

impl Action {
    pub fn is_frontend(&self) -> bool {
        matches!(self, Action::Model(_) | Action::Speak(_))
    }

    pub fn is_backend(&self) -> bool {
        matches!(self, Action::Tool(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_action_serializes_with_category_tag() {
        let action = Action::Model(ModelAction { motion: Some("Tap".into()), expression: None });
        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["category"], "model");
        assert_eq!(json["motion"], "Tap");
        assert!(json.get("expression").is_none());
    }

    #[test]
    fn tool_action_serializes_with_args() {
        let action = Action::Tool(ToolAction {
            name: "system_control".into(),
            args: serde_json::json!({"action": "type", "text": "hi"}),
        });
        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["category"], "tool");
        assert_eq!(json["name"], "system_control");
        assert_eq!(json["args"]["text"], "hi");
    }

    #[test]
    fn speak_action_round_trips() {
        let action = Action::Speak(SpeakAction { text: "hello".into(), lang: Some("en-US".into()) });
        let json = serde_json::to_string(&action).unwrap();
        let back: Action = serde_json::from_str(&json).unwrap();
        match back {
            Action::Speak(s) => {
                assert_eq!(s.text, "hello");
                assert_eq!(s.lang.as_deref(), Some("en-US"));
            }
            _ => panic!("expected Speak"),
        }
    }

    #[test]
    fn category_predicates() {
        assert!(Action::Model(ModelAction { motion: None, expression: None }).is_frontend());
        assert!(Action::Speak(SpeakAction { text: "x".into(), lang: None }).is_frontend());
        assert!(
            Action::Tool(ToolAction { name: "t".into(), args: serde_json::Value::Null }).is_backend()
        );
    }
}

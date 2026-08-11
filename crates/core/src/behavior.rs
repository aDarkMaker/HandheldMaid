//! Rule-based behavior engine.
//!
//! Events from the platform layer (input hooks, timers, frontend IPC) are
//! matched against registered rules. A rule may gate its action on a
//! probability and is identified by a stable name so it can be toggled at
//! runtime.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Errors raised by the behavior engine.
#[derive(Debug, thiserror::Error)]
pub enum BehaviorError {
    #[error("duplicate rule name: {0}")]
    DuplicateRule(String),
    #[error("rule not found: {0}")]
    RuleNotFound(String),
}

/// The kind of event a rule reacts to. Mirrors the events the input layer
/// can emit, plus interval/timer based ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    KeyDown,
    KeyUp,
    Click,
    DoubleClick,
    Interval,
}

/// A serializable rule definition. Frontends can push rules over IPC using
/// this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub name: String,
    pub event: EventKind,
    /// Trigger probability in `0.0..=1.0`. Defaults to `1.0` when omitted.
    #[serde(default = "default_probability")]
    pub probability: f64,
}

fn default_probability() -> f64 {
    1.0
}

/// The behavior engine. Owns the registered rules and dispatches events.
///
/// `A` is the action context handed to matched rules; keeping it generic lets
/// the desktop shell pass a Tauri `AppHandle` while tests pass a mock.
pub struct BehaviorEngine {
    rules: HashMap<String, Rule>,
    /// Names ordered by insertion so dispatch stays deterministic.
    order: Vec<String>,
}

impl Default for BehaviorEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl BehaviorEngine {
    pub fn new() -> Self {
        Self { rules: HashMap::new(), order: Vec::new() }
    }

    /// Register a rule. Replaces an existing rule with the same name.
    pub fn register(&mut self, rule: Rule) -> Result<(), BehaviorError> {
        let name = rule.name.clone();
        let is_new = !self.rules.contains_key(&name);
        self.rules.insert(name.clone(), rule);
        if is_new {
            self.order.push(name);
        }
        Ok(())
    }

    /// Remove a rule by name.
    pub fn unregister(&mut self, name: &str) -> Result<Rule, BehaviorError> {
        self.order.retain(|n| n != name);
        self.rules.remove(name).ok_or(BehaviorError::RuleNotFound(name.to_string()))
    }

    /// Return the names of rules that match `kind`. Order is insertion order.
    pub fn matched(&self, kind: EventKind) -> Vec<&Rule> {
        self.order
            .iter()
            .filter_map(|name| self.rules.get(name))
            .filter(|r| r.event == kind)
            .collect()
    }

    /// True if a rule with `name` is registered.
    pub fn has(&self, name: &str) -> bool {
        self.rules.contains_key(name)
    }

    pub fn len(&self) -> usize {
        self.rules.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(name: &str, event: EventKind) -> Rule {
        Rule { name: name.into(), event, probability: 1.0 }
    }

    #[test]
    fn register_and_match() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("greet", EventKind::KeyDown)).unwrap();
        engine.register(rule("idle", EventKind::Interval)).unwrap();

        assert_eq!(engine.matched(EventKind::KeyDown).len(), 1);
        assert_eq!(engine.matched(EventKind::Interval).len(), 1);
        assert_eq!(engine.matched(EventKind::Click).len(), 0);
    }

    #[test]
    fn unregister_removes_rule() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("greet", EventKind::KeyDown)).unwrap();
        engine.unregister("greet").unwrap();
        assert!(engine.is_empty());
    }

    #[test]
    fn duplicate_name_replaces() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("greet", EventKind::KeyDown)).unwrap();
        engine.register(rule("greet", EventKind::Click)).unwrap();
        assert_eq!(engine.len(), 1);
        assert_eq!(engine.matched(EventKind::Click).len(), 1);
    }
}

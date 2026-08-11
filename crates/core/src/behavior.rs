//! Rule-based behavior engine.
//!
//! Events are matched against registered rules. A matched rule *emits a named
//! event* (e.g. `"on_pet"`); the [`crate::event_bus::EventBus`] then selects
//! one subscription by weighted random choice and yields its
//! [`crate::action::Action`]. The engine is pure — execution is the shell's job.

use crate::action::Action;
use crate::event_bus::EventBus;
use rand::Rng;
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

/// The kind of event a rule reacts to.
///
/// `PetTap` (frontend pointertap on the pet) is kept distinct from `Click`
/// (any click captured by rdev) so the two semantics get separate rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    KeyDown,
    KeyUp,
    Click,
    DoubleClick,
    Interval,
    PetTap,
}

/// A serializable rule definition. Frontends can push rules over IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub name: String,
    pub event: EventKind,
    /// Probability in `0.0..=1.0` that the rule fires when its event matches.
    #[serde(default = "default_probability")]
    pub probability: f64,
    /// Named event emitted when the rule fires (e.g. `"on_pet"`).
    pub emit_event: String,
}

fn default_probability() -> f64 {
    1.0
}

/// The behavior engine. Owns the rules and the event bus.
pub struct BehaviorEngine {
    rules: HashMap<String, Rule>,
    /// Names in insertion order so dispatch stays deterministic.
    order: Vec<String>,
    bus: EventBus,
}

impl Default for BehaviorEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl BehaviorEngine {
    pub fn new() -> Self {
        Self { rules: HashMap::new(), order: Vec::new(), bus: EventBus::new() }
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

    /// Return the rules that match `kind`, in insertion order.
    pub fn matched(&self, kind: EventKind) -> Vec<&Rule> {
        self.order
            .iter()
            .filter_map(|name| self.rules.get(name))
            .filter(|r| r.event == kind)
            .collect()
    }

    pub fn bus(&self) -> &EventBus {
        &self.bus
    }

    pub fn bus_mut(&mut self) -> &mut EventBus {
        &mut self.bus
    }

    /// Dispatch an event: match rules, roll probability, and for each firing
    /// rule select one subscription (weighted random) from the event bus.
    /// The engine performs no side effects — the shell executes the actions.
    pub fn dispatch<R: Rng>(&self, kind: EventKind, rng: &mut R) -> Vec<Action> {
        let mut actions = Vec::new();
        for rule in self.matched(kind) {
            if rng.gen::<f64>() > rule.probability {
                continue;
            }
            if let Some(sub) = self.bus.select(&rule.emit_event, rng) {
                actions.push(sub.action.clone());
            }
        }
        actions
    }

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
    use crate::action::ModelAction;
    use crate::event_bus::Subscription;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn rule(name: &str, event: EventKind, emit: &str) -> Rule {
        Rule { name: name.into(), event, probability: 1.0, emit_event: emit.into() }
    }

    fn model_action(motion: &str) -> Action {
        Action::Model(ModelAction { motion: Some(motion.into()), expression: None })
    }

    fn seeded() -> ChaCha8Rng {
        ChaCha8Rng::seed_from_u64(0)
    }

    #[test]
    fn register_and_match() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("greet", EventKind::KeyDown, "on_key")).unwrap();
        engine.register(rule("idle", EventKind::Interval, "on_idle")).unwrap();

        assert_eq!(engine.matched(EventKind::KeyDown).len(), 1);
        assert_eq!(engine.matched(EventKind::Interval).len(), 1);
        assert_eq!(engine.matched(EventKind::Click).len(), 0);
    }

    #[test]
    fn unregister_removes_rule() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("greet", EventKind::KeyDown, "on_key")).unwrap();
        engine.unregister("greet").unwrap();
        assert!(engine.is_empty());
    }

    #[test]
    fn duplicate_name_replaces() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("greet", EventKind::KeyDown, "on_key")).unwrap();
        engine.register(rule("greet", EventKind::Click, "on_click")).unwrap();
        assert_eq!(engine.len(), 1);
        assert_eq!(engine.matched(EventKind::Click).len(), 1);
    }

    #[test]
    fn dispatch_yields_selected_subscription_action() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("pet", EventKind::PetTap, "on_pet")).unwrap();
        engine
            .bus_mut()
            .subscribe(Subscription::new("pet_tap", "on_pet", model_action("Tap")))
            .unwrap();

        let actions = engine.dispatch(EventKind::PetTap, &mut seeded());
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            Action::Model(m) => assert_eq!(m.motion.as_deref(), Some("Tap")),
            _ => panic!("expected Model action"),
        }
    }

    #[test]
    fn dispatch_with_no_subscriptions_yields_nothing() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("pet", EventKind::PetTap, "on_pet")).unwrap();
        // No subscriptions on "on_pet".
        let actions = engine.dispatch(EventKind::PetTap, &mut seeded());
        assert!(actions.is_empty());
    }

    #[test]
    fn dispatch_probability_gate_skips_rule() {
        let mut engine = BehaviorEngine::new();
        let mut r = rule("pet", EventKind::PetTap, "on_pet");
        r.probability = 0.0; // never fires
        engine.register(r).unwrap();
        engine
            .bus_mut()
            .subscribe(Subscription::new("pet_tap", "on_pet", model_action("Tap")))
            .unwrap();

        let actions = engine.dispatch(EventKind::PetTap, &mut seeded());
        assert!(actions.is_empty(), "probability 0 must never fire");
    }

    #[test]
    fn dispatch_picks_one_of_many_subscriptions() {
        let mut engine = BehaviorEngine::new();
        engine.register(rule("idle", EventKind::Interval, "on_idle")).unwrap();
        engine
            .bus_mut()
            .subscribe(Subscription::new("idle1", "on_idle", model_action("Idle1")).with_weight(1))
            .unwrap();
        engine
            .bus_mut()
            .subscribe(Subscription::new("idle2", "on_idle", model_action("Idle2")).with_weight(1))
            .unwrap();

        // Each dispatch yields exactly one action (one rule, one selected sub).
        let actions = engine.dispatch(EventKind::Interval, &mut seeded());
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            Action::Model(m) => {
                let motion = m.motion.as_deref().unwrap();
                assert!(motion == "Idle1" || motion == "Idle2");
            }
            _ => panic!("expected Model action"),
        }
    }
}

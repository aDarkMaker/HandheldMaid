//! Event bus: named-event subscriptions with weighted random selection.
//!
//! Multiple [`Subscription`]s can listen on the same named event; when it
//! fires, one is selected by weighted random choice. This lets a single
//! trigger (`on_idle`) pick among many candidate actions without touching the
//! rule itself — add richness by subscribing more actions, not by editing
//! triggers. The bus is pure data + selection logic.

use crate::action::Action;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Errors raised by the event bus.
#[derive(Debug, thiserror::Error)]
pub enum EventBusError {
    #[error("duplicate subscription id: {0}")]
    DuplicateSubscription(String),
    #[error("subscription not found: {0}")]
    SubscriptionNotFound(String),
}

/// A subscription linking a named event to an action with a selection weight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: String,
    pub event: String,
    pub action: Action,
    /// Weighted-random selection weight. Defaults to 1. Must be > 0 to be selectable.
    #[serde(default = "default_weight")]
    pub weight: u32,
}

fn default_weight() -> u32 {
    1
}

impl Subscription {
    pub fn new(id: impl Into<String>, event: impl Into<String>, action: Action) -> Self {
        Self {
            id: id.into(),
            event: event.into(),
            action,
            weight: 1,
        }
    }

    pub fn with_weight(mut self, weight: u32) -> Self {
        self.weight = weight;
        self
    }
}

/// A registry of subscriptions keyed by named event.
pub struct EventBus {
    /// event name -> subscriptions (in insertion order).
    by_event: HashMap<String, Vec<Subscription>>,
    /// id -> event name, for O(1) removal by id.
    id_index: HashMap<String, String>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            by_event: HashMap::new(),
            id_index: HashMap::new(),
        }
    }

    /// Subscribe an action to a named event.
    pub fn subscribe(&mut self, sub: Subscription) -> Result<(), EventBusError> {
        if self.id_index.contains_key(&sub.id) {
            return Err(EventBusError::DuplicateSubscription(sub.id));
        }
        let event = sub.event.clone();
        self.id_index.insert(sub.id.clone(), event.clone());
        self.by_event.entry(event).or_default().push(sub);
        Ok(())
    }

    /// Remove a subscription by id.
    pub fn unsubscribe(&mut self, id: &str) -> Result<Subscription, EventBusError> {
        let event = self
            .id_index
            .remove(id)
            .ok_or(EventBusError::SubscriptionNotFound(id.to_string()))?;
        let subs = self
            .by_event
            .get_mut(&event)
            .expect("id_index and by_event must stay in sync");
        let pos = subs
            .iter()
            .position(|s| s.id == id)
            .expect("id_index and by_event must stay in sync");
        let removed = subs.remove(pos);
        if subs.is_empty() {
            self.by_event.remove(&event);
        }
        Ok(removed)
    }

    /// All subscriptions for `event`, in insertion order.
    pub fn subscriptions_for(&self, event: &str) -> &[Subscription] {
        self.by_event
            .get(event)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Select one subscription for `event` using weighted random choice.
    /// Returns `None` if the event has no subscriptions or all weights are 0.
    pub fn select<R: Rng>(&self, event: &str, rng: &mut R) -> Option<&Subscription> {
        let subs = self.subscriptions_for(event);
        let total: u32 = subs.iter().map(|s| s.weight).sum();
        if total == 0 {
            return None;
        }
        let mut pick = rng.gen_range(0..total);
        for s in subs {
            if pick < s.weight {
                return Some(s);
            }
            pick -= s.weight;
        }
        // Unreachable: total > 0 guarantees a hit.
        None
    }

    pub fn len(&self) -> usize {
        self.id_index.len()
    }

    pub fn is_empty(&self) -> bool {
        self.id_index.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::ModelAction;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn model_action(motion: &str) -> Action {
        Action::Model(ModelAction {
            motion: Some(motion.into()),
            expression: None,
        })
    }

    #[test]
    fn subscribe_and_lookup() {
        let mut bus = EventBus::new();
        bus.subscribe(Subscription::new("a", "on_pet", model_action("Tap")))
            .unwrap();
        assert_eq!(bus.subscriptions_for("on_pet").len(), 1);
        assert!(bus.subscriptions_for("on_idle").is_empty());
    }

    #[test]
    fn duplicate_id_rejected() {
        let mut bus = EventBus::new();
        bus.subscribe(Subscription::new("a", "on_pet", model_action("Tap")))
            .unwrap();
        let err = bus
            .subscribe(Subscription::new("a", "on_idle", model_action("Idle")))
            .unwrap_err();
        assert!(matches!(err, EventBusError::DuplicateSubscription(_)));
    }

    #[test]
    fn unsubscribe_removes_subscription() {
        let mut bus = EventBus::new();
        bus.subscribe(Subscription::new("a", "on_pet", model_action("Tap")))
            .unwrap();
        bus.unsubscribe("a").unwrap();
        assert!(bus.is_empty());
    }

    #[test]
    fn select_returns_none_when_empty() {
        let bus = EventBus::new();
        let mut rng = ChaCha8Rng::seed_from_u64(0);
        assert!(bus.select("on_pet", &mut rng).is_none());
    }

    #[test]
    fn weighted_selection_favors_heavier_weight() {
        // With weights 1:99, the heavy one should win ~99% of the time.
        let mut bus = EventBus::new();
        bus.subscribe(Subscription::new("light", "e", model_action("Light")).with_weight(1))
            .unwrap();
        bus.subscribe(Subscription::new("heavy", "e", model_action("Heavy")).with_weight(99))
            .unwrap();

        let mut rng = ChaCha8Rng::seed_from_u64(42);
        let mut heavy = 0;
        for _ in 0..1000 {
            if bus.select("e", &mut rng).unwrap().id == "heavy" {
                heavy += 1;
            }
        }
        // Allow generous slack; 99% expected → assert comfortably above 90%.
        assert!(heavy > 900, "heavy picked {heavy}/1000, expected ~990");
    }

    #[test]
    fn select_with_seeded_rng_is_deterministic() {
        let mut bus = EventBus::new();
        bus.subscribe(Subscription::new("a", "e", model_action("A")).with_weight(1))
            .unwrap();
        bus.subscribe(Subscription::new("b", "e", model_action("B")).with_weight(1))
            .unwrap();

        let mut r1 = ChaCha8Rng::seed_from_u64(7);
        let mut r2 = ChaCha8Rng::seed_from_u64(7);
        for _ in 0..50 {
            assert_eq!(
                bus.select("e", &mut r1).unwrap().id,
                bus.select("e", &mut r2).unwrap().id
            );
        }
    }

    #[test]
    fn zero_weight_subscriptions_excluded() {
        let mut bus = EventBus::new();
        bus.subscribe(Subscription::new("zero", "e", model_action("Zero")).with_weight(0))
            .unwrap();
        bus.subscribe(Subscription::new("one", "e", model_action("One")).with_weight(1))
            .unwrap();

        let mut rng = ChaCha8Rng::seed_from_u64(0);
        for _ in 0..100 {
            assert_eq!(bus.select("e", &mut rng).unwrap().id, "one");
        }
    }
}

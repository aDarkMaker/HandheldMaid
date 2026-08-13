//! Shared app state, settings structs, and helpers shared across modules.

use crate::models::ModelInfo;
use hm_core::behavior::{BehaviorEngine, EventKind};
use hm_core::tool::ToolRegistry;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Per-keyboard-press trigger probability for input-triggered actions.
pub const KEYBOARD_TRIGGER_PROBABILITY: f64 = 0.01;
/// Default cooldown (ms) after an input-triggered action finishes.
pub const DEFAULT_COOLDOWN_MS: u64 = 30_000;
/// Default physical pet size.
pub const DEFAULT_PET_SIZE: (u32, u32) = (400, 400);

/// Input-action settings: enable flags + cooldown. Shared source of truth
/// between the settings and main windows (their localStorage is isolated).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct InputActionSettings {
    /// Whether keyboard input can trigger random actions.
    pub keyboard_enabled: bool,
    /// Whether clicking the pet can trigger random actions.
    pub click_enabled: bool,
    /// Cooldown (ms) after an action finishes before keyboard can trigger again.
    pub cooldown_ms: u64,
}

impl Default for InputActionSettings {
    fn default() -> Self {
        Self {
            keyboard_enabled: true,
            click_enabled: true,
            cooldown_ms: DEFAULT_COOLDOWN_MS,
        }
    }
}

/// Input-action runtime state: settings + cooldown bookkeeping.
pub struct InputActionState {
    pub settings: Mutex<InputActionSettings>,
    /// Instant when the current cooldown expires. `None` = ready to trigger.
    pub cooldown_until: Mutex<Option<std::time::Instant>>,
}

/// Whether drag-drop archive (compress/extract) is enabled. Defaults to on.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ArchiveSettings {
    pub enabled: bool,
}

impl Default for ArchiveSettings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

/// Screen-space rectangle the pet occupies, used for dynamic click-through
/// (absolute screen pixels).
#[derive(Debug, Clone, Copy)]
pub struct HitArea {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl HitArea {
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

/// Shared app state. Everything is behind `Mutex` so IPC commands and the
/// input thread can mutate it.
pub struct AppState {
    pub behavior: Mutex<BehaviorEngine>,
    pub tools: Mutex<ToolRegistry>,
    /// RNG for weighted-random selection. Seeded from entropy so behavior is
    /// non-deterministic at runtime.
    pub rng: Mutex<ChaCha8Rng>,
    /// Kept alive so the rdev thread isn't dropped (it is detached).
    pub _input_listener: Mutex<Option<hm_core::input::InputListener>>,
    /// Screen-space hit area registered by the frontend.
    pub hit_area: Mutex<Option<HitArea>>,
    /// Last click-through state applied; the platform API is only called on
    /// transitions (rdev MouseMove fires very frequently).
    pub click_through: Mutex<bool>,
    /// The currently active model.
    pub current_model: Mutex<Option<ModelInfo>>,
    /// The pet's physical window size (px), single source of truth across webviews.
    pub pet_size: Mutex<(u32, u32)>,
    /// Input-action state: enable flags, cooldown, and cooldown bookkeeping.
    pub input_action: InputActionState,
    /// Whether drag-drop archive (compress/extract) is enabled.
    pub archive_settings: Mutex<ArchiveSettings>,
    /// Whether Dev (debug overlay) mode is on. Toggled via the right-click menu.
    pub dev_mode: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            behavior: Mutex::new(BehaviorEngine::new()),
            tools: Mutex::new(ToolRegistry::new()),
            rng: Mutex::new(ChaCha8Rng::from_entropy()),
            _input_listener: Mutex::new(None),
            hit_area: Mutex::new(None),
            click_through: Mutex::new(true),
            current_model: Mutex::new(None),
            pet_size: Mutex::new(DEFAULT_PET_SIZE),
            input_action: InputActionState {
                settings: Mutex::new(InputActionSettings::default()),
                cooldown_until: Mutex::new(None),
            },
            archive_settings: Mutex::new(ArchiveSettings::default()),
            dev_mode: Mutex::new(false),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    /// Decide whether an input event should trigger a random action, based on
    /// enable flags, cooldown, and (for keyboard) a low per-press probability.
    ///
    /// - Click: always triggers when enabled; never blocked by cooldown, but
    ///   *resets* the cooldown timer (so it counts toward the shared cooldown).
    /// - Keyboard: triggers only when enabled, not in cooldown, and the low
    ///   probability roll passes.
    pub fn gate_input_action(&self, kind: EventKind, rng: &mut impl Rng) -> Option<&'static str> {
        let settings = *self.input_action.settings.lock().unwrap();
        match kind {
            EventKind::PetTap if settings.click_enabled => Some("click"),
            EventKind::KeyDown if settings.keyboard_enabled => {
                // Block while cooldown is active.
                let until = self.input_action.cooldown_until.lock().unwrap();
                if let Some(t) = *until {
                    if std::time::Instant::now() < t {
                        return None;
                    }
                }
                drop(until);
                // Low per-press probability gate.
                if rng.gen::<f64>() < KEYBOARD_TRIGGER_PROBABILITY {
                    Some("keyboard")
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Start the cooldown timer after an input-triggered action finishes.
    pub fn start_cooldown(&self) {
        let ms = self.input_action.settings.lock().unwrap().cooldown_ms;
        *self.input_action.cooldown_until.lock().unwrap() =
            Some(std::time::Instant::now() + std::time::Duration::from_millis(ms));
    }

    /// Clear the cooldown timer — used when a click triggers so it begins a
    /// fresh cooldown only after its action finishes (via `hm://action-done`).
    pub fn reset_cooldown(&self) {
        *self.input_action.cooldown_until.lock().unwrap() = None;
    }
}

/// Resolve the `assets/` directory. In dev it lives at the repo root (three
/// levels above src-tauri); in prod it is the bundled resource dir.
pub fn resolve_assets_dir(app: &tauri::AppHandle) -> PathBuf {
    let dev_assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../assets");
    if dev_assets.exists() {
        return dev_assets;
    }
    app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("assets"))
}

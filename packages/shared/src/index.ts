/**
 * Shared types and IPC protocol between the Rust core/backend and the TS
 * frontends. All types are manual mirrors of the corresponding Rust types in
 * `crates/core/src` — keep both sides in sync. Rust uses
 * `#[serde(rename_all = "lowercase")]` / `#[serde(tag = "category")]`, so the
 * TS shapes must match the serialized form exactly.
 */

/** Mirrors `hm_core::behavior::EventKind`. `pettap` = tap on the pet itself. */
export type EventKind = 'keydown' | 'keyup' | 'click' | 'dblclick' | 'interval' | 'pettap';

/** Mirrors `hm_core::action::ModelAction`. */
export interface ModelAction {
	motion?: string;
	expression?: string;
}

/** Mirrors `hm_core::action::SpeakAction`. */
export interface SpeakAction {
	text: string;
	lang?: string;
}

/** Mirrors `hm_core::action::ToolAction`. */
export interface ToolAction {
	name: string;
	args?: unknown;
}

/**
 * Mirrors `hm_core::action::Action` (`#[serde(tag = "category")]`).
 * Discriminated union: dispatch on `category` to route by execution site.
 * - `model` / `speak`: executed in the frontend renderer.
 * - `tool`: executed in the Rust core via the tool registry.
 */
export type Action =
	| { category: 'model'; motion?: string; expression?: string }
	| { category: 'speak'; text: string; lang?: string }
	| { category: 'tool'; name: string; args?: unknown };

/** Mirrors `hm_core::behavior::Rule`. */
export interface Rule {
	name: string;
	event: EventKind;
	/** Trigger probability in [0, 1]. Defaults to 1. */
	probability?: number;
	/** Named event emitted when the rule fires (e.g. "on_pet"). */
	emit_event: string;
}

/** Mirrors `hm_core::event_bus::Subscription`. */
export interface Subscription {
	id: string;
	event: string;
	action: Action;
	/** Weighted-random selection weight. Defaults to 1. */
	weight?: number;
}

/** Mirrors `hm_core::tool::ToolInfo` (camelCase `inputSchema` per MCP). */
export interface ToolInfo {
	name: string;
	description: string;
	inputSchema: unknown;
}

/** A bundled Live2D model, discovered by the backend under assets/models/. */
export interface ModelInfo {
	/** Stable id = model directory name (e.g. "wanko", "miku"). */
	id: string;
	/** Display name (model3.json filename stem). */
	name: string;
	/** Path relative to assets/ (e.g. "models/wanko/runtime/wanko_touch.model3.json"). */
	path: string;
}

/** A behavior event emitted to the frontend. */
export interface BehaviorEvent {
	kind: EventKind;
	data?: unknown;
}

/** Input-action settings: enable flags + cooldown. Mirrors the Rust struct. */
export interface InputActionSettings {
	/** Whether keyboard input can trigger random actions. */
	keyboard_enabled: boolean;
	/** Whether clicking the pet can trigger random actions. */
	click_enabled: boolean;
	/** Cooldown (ms) after an action finishes before keyboard can trigger again. */
	cooldown_ms: number;
}

/** Source that triggered an input action (`hm://trigger-input-action` payload). */
export type InputActionSource = 'click' | 'keyboard';

/** IPC command names exposed by the Tauri backend. */
export const IPC = {
	REGISTER_RULE: 'register_rule',
	UNREGISTER_RULE: 'unregister_rule',
	MATCHED_RULES: 'matched_rules',
	DISPATCH_EVENT: 'dispatch_event',
	SUBSCRIBE: 'subscribe',
	UNSUBSCRIBE: 'unsubscribe',
	LIST_TOOLS: 'list_tools',
	INVOKE_TOOL: 'invoke_tool',
	MOVE_WINDOW: 'move_window',
	RESIZE_WINDOW_PHYSICAL: 'resize_window_physical',
	GET_PET_SIZE: 'get_pet_size',
	SET_PET_SIZE: 'set_pet_size',
	GET_INPUT_ACTION_SETTINGS: 'get_input_action_settings',
	SET_INPUT_ACTION_SETTINGS: 'set_input_action_settings',
	NOTIFY_ACTION_DONE: 'notify_action_done',
	SET_IGNORE_MOUSE_EVENTS: 'set_ignore_mouse_events',
	REGISTER_HIT_AREA: 'register_hit_area',
	LIST_MODELS: 'list_models',
	GET_CURRENT_MODEL: 'get_current_model',
	SWITCH_MODEL: 'switch_model',
	OPEN_SETTINGS: 'open_settings',
	SHOW_CONTEXT_MENU: 'show_context_menu',
} as const;

export type IpcCommand = (typeof IPC)[keyof typeof IPC];

/** Tauri event names emitted by the backend to the frontend. */
export const EVENT = {
	/** Carries an `Action` for the frontend to execute (model/speak). */
	ACTION: 'hm://action',
	/** Carries a `ModelInfo` when the active model changes (settings -> main window). */
	MODEL_CHANGED: 'hm://model-changed',
	/** Carries a `[w, h]` physical size when the pet size changes (settings -> main window). */
	SIZE_CHANGED: 'hm://size-changed',
	/** Carries an `InputActionSettings` when input-action settings change. */
	INPUT_SETTINGS_CHANGED: 'hm://input-settings-changed',
	/** Carries `{ source }` telling the frontend to play a random action. */
	TRIGGER_INPUT_ACTION: 'hm://trigger-input-action',
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

/**
 * Shared types and IPC protocol between the Rust core/backend and the TS
 * frontends. Kept framework-agnostic so it can be consumed by the desktop
 * renderer and any future frontends.
 */

/** Mirrors `hm_core::behavior::EventKind`. */
export type EventKind = 'keydown' | 'keyup' | 'click' | 'dblclick' | 'interval';

/** Mirrors `hm_core::behavior::Rule` (without the action). */
export interface Rule {
	name: string;
	event: EventKind;
	/** Trigger probability in [0, 1]. Defaults to 1. */
	probability?: number;
}

/** A behavior event emitted to the frontend. */
export interface BehaviorEvent {
	kind: EventKind;
	/** Optional payload (key code, coords, etc.). */
	data?: unknown;
}

/** IPC command names exposed by the Tauri backend. */
export const IPC = {
	REGISTER_RULE: 'register_rule',
	UNREGISTER_RULE: 'unregister_rule',
	MATCHED_RULES: 'matched_rules',
	MOVE_WINDOW: 'move_window',
	SET_IGNORE_MOUSE_EVENTS: 'set_ignore_mouse_events',
} as const;

export type IpcCommand = (typeof IPC)[keyof typeof IPC];

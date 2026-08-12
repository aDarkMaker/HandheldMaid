/// <reference types="vite/client" />

import { listen } from '@tauri-apps/api/event';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import { MotionPriority } from 'pixi-live2d-display/cubism4';
import type { Action, InputActionSource } from '@handheld-maid/shared';
import { EVENT, IPC } from '@handheld-maid/shared';
import { invoke } from '@tauri-apps/api/core';

/**
 * Frontend action executor. Listens for actions emitted by the backend (those
 * routed to the frontend: `Model` and `Speak`) and runs them against the
 * Live2D model / Web Speech API. `Tool` actions never arrive here.
 *
 * Also handles input-triggered random actions (`hm://trigger-input-action`):
 * it generically enumerates the model's motion groups + expressions, picks one
 * at random, plays it, and notifies the backend when it finishes so the shared
 * cooldown can start. While an expression is playing (fade-in + 2s hold +
 * fade-out) all input signals are ignored.
 */

let currentModel: Live2DModel | null = null;

/** Bind the executor to a model. Call once after the model is loaded. */
export function bindModel(model: Live2DModel) {
	currentModel = model;
	// Rebuild the action picker's candidate list for the new model.
	picker.rebuild();
}

export function executeAction(action: Action) {
	switch (action.category) {
		case 'model':
			executeModelAction(action);
			break;
		case 'speak':
			speak(action.text, action.lang);
			break;
		case 'tool':
			break;
	}
}

/**
 * Direct the model's gaze at a point. x/y are stage pixel coords
 * (window-relative). Uses smoothed following (no `instant`) to avoid jitter
 * when the pointer is close to the model.
 */
export function focusModel(x: number, y: number) {
	currentModel?.focus(x, y);
}

/**
 * Apply the model's default expression after load. Models that ship a
 * `no_watermark` expression (e.g. miku, whose watermark is on by default)
 * play it to zero the watermark parameter — credits are in the settings About
 * page. No-op for models without it.
 */
export function applyDefaultExpression() {
	if (!currentModel) return;
	void currentModel.expression('no_watermark').catch(() => {});
}

function executeModelAction(action: { motion?: string; expression?: string }) {
	if (!currentModel) return;
	if (action.motion) {
		void currentModel.motion(action.motion);
	}
	if (action.expression) {
		void currentModel.expression(action.expression);
	}
}

function speak(text: string, lang?: string) {
	if (!('speechSynthesis' in window)) {
		console.warn('[HandheldMaid] speechSynthesis unavailable');
		return;
	}
	const utterance = new SpeechSynthesisUtterance(text);
	if (lang) utterance.lang = lang;
	window.speechSynthesis.speak(utterance);
}

/** Subscribe to backend-emitted actions for the lifetime of the app. */
export async function startActionListener(): Promise<() => void> {
	const unlistenAction = await listen<Action>(EVENT.ACTION, (event) => {
		executeAction(event.payload);
	});
	const unlistenTrigger = await listen<{ source: InputActionSource }>(EVENT.TRIGGER_INPUT_ACTION, (event) => {
		void playRandomInputAction(event.payload.source);
	});
	return () => {
		unlistenAction();
		unlistenTrigger();
	};
}

// ── Input-triggered random actions ──────────────────────────────────────────

/** Whether an input-triggered action is currently playing (signals ignored). */
let actionPlaying = false;

/** How long an expression holds at full strength (ms), excluding transitions. */
const EXPRESSION_HOLD_MS = 2000;
/** Poll interval (ms) for detecting motion playback completion. */
const MOTION_POLL_MS = 100;

/** A playable action candidate: a motion group or an expression index. */
type Candidate = { key: string; type: 'motion'; group: string } | { key: string; type: 'expression'; index: number };

/** Weight for a candidate already played this round vs. one not yet played. */
const WEIGHT_PLAYED = 1;
const WEIGHT_UNPLAYED = 5;
/** How many recent picks are excluded from the next pick (no repeat window). */
const RECENT_WINDOW = 3;
/** Minimum candidates for the fair-rotation logic to apply; below this we
 *  just pick uniformly at random (too few to exclude/rotate meaningfully). */
const MIN_CANDIDATES_FOR_ROTATION = RECENT_WINDOW + 1;

/**
 * Fair-rotation selector over the model's actions. Behavior:
 * - With enough candidates (>= MIN_CANDIDATES_FOR_ROTATION): candidates played
 *   this round weigh less than unplayed ones; the last RECENT_WINDOW picks are
 *   excluded (no repeats within that window); once all are played the round
 *   resets, looping indefinitely.
 * - With fewer candidates: pick uniformly at random (no rotation control). The
 *   caller still applies the shared cooldown either way.
 */
const picker = {
	candidates: [] as Candidate[],
	/** Keys played in the current round. Cleared once all are played. */
	played: new Set<string>(),
	/** Recently played keys, newest last; excluded from the next pick. */
	recent: [] as string[],

	/** Rebuild the candidate list from the current model. Called on bind. */
	rebuild() {
		this.candidates = [];
		this.played.clear();
		this.recent = [];
		if (!currentModel) return;
		const motionManager = currentModel.internalModel.motionManager;
		const idleGroup = motionManager.groups.idle;
		for (const g of Object.keys(motionManager.definitions)) {
			if (g === idleGroup) continue;
			this.candidates.push({ key: `motion:${g}`, type: 'motion', group: g });
		}
		const exprDefs = motionManager.expressionManager?.definitions ?? [];
		exprDefs.forEach((_, i) => {
			this.candidates.push({ key: `expression:${i}`, type: 'expression', index: i });
		});
	},

	/** Pick a candidate. Applies rotation only when there are enough candidates. */
	pick(): Candidate | null {
		if (this.candidates.length === 0) return null;
		// Too few candidates to exclude/rotate — just pick uniformly at random.
		if (this.candidates.length < MIN_CANDIDATES_FOR_ROTATION) {
			return this.candidates[Math.floor(Math.random() * this.candidates.length)];
		}
		// Exclude the recent window so the same action can't repeat within it.
		let pool = this.candidates.filter((c) => !this.recent.includes(c.key));
		if (pool.length === 0) pool = this.candidates;

		const weights = pool.map((c) => (this.played.has(c.key) ? WEIGHT_PLAYED : WEIGHT_UNPLAYED));
		const total = weights.reduce((a, b) => a + b, 0);
		let r = Math.random() * total;
		for (let i = 0; i < pool.length; i++) {
			r -= weights[i];
			if (r <= 0) return pool[i];
		}
		return pool[pool.length - 1];
	},

	/** Record that `c` was just played; reset the round when all are played. */
	markPlayed(c: Candidate) {
		// Only track rotation state when the rotation logic is active.
		if (this.candidates.length < MIN_CANDIDATES_FOR_ROTATION) return;
		this.played.add(c.key);
		this.recent.push(c.key);
		if (this.recent.length > RECENT_WINDOW) this.recent.shift();
		// Once every candidate has been played this round, start a fresh round.
		if (this.candidates.every((c) => this.played.has(c.key))) {
			this.played.clear();
		}
	},
};

/**
 * Pick and play a random motion or expression from the current model.
 * Generic over any model: enumerates motion groups + expression definitions.
 * Uses a fair-rotation picker (unplayed actions favored, no recent repeats,
 * round resets once all are played). Notifies the backend when the action
 * finishes so the shared cooldown can start.
 */
async function playRandomInputAction(_source: InputActionSource) {
	if (!currentModel || actionPlaying) return;
	if (picker.candidates.length === 0) picker.rebuild();
	const candidate = picker.pick();
	if (!candidate) return;

	actionPlaying = true;
	try {
		if (candidate.type === 'motion') {
			await playMotion(candidate.group);
		} else {
			await playExpression(candidate.index);
		}
		picker.markPlayed(candidate);
	} catch (e) {
		console.error('[HandheldMaid] input action failed:', e);
	} finally {
		actionPlaying = false;
		// Notify the backend to start the shared cooldown.
		void invoke(IPC.NOTIFY_ACTION_DONE).catch(() => {});
	}
}

/** Play a motion group, wait for it to finish. */
async function playMotion(group: string) {
	const motionManager = currentModel!.internalModel.motionManager;
	const started = await currentModel!.motion(group, undefined, MotionPriority.FORCE);
	if (!started) return;
	await waitForMotionFinish(motionManager);
}

/** Play an expression by index: fade-in → hold 2s → fade-out (reset). */
async function playExpression(index: number) {
	const expressionManager = currentModel!.internalModel.motionManager.expressionManager;
	if (!expressionManager) return;
	const ok = await expressionManager.setExpression(index);
	if (!ok) return;
	// Hold at full strength for the configured duration (excluding transitions).
	await delay(EXPRESSION_HOLD_MS);
	// Reset to the default expression (fade-out transition handled by the SDK).
	expressionManager.resetExpression();
	// Allow the fade-out transition to play out before signaling completion.
	await delay(expressionFadeMs());
}

/** Resolve the SDK's expression fade duration (ms) for the fade-out wait. */
function expressionFadeMs(): number {
	// pixi-live2d-display exposes the default fading duration via the config
	// namespace; fall back to a sensible default if unavailable.
	const cfg = (window as unknown as { PIXI?: { live2d?: { config?: { expressionFadingDuration?: number } } } }).PIXI?.live2d?.config;
	return cfg?.expressionFadingDuration ?? 1000;
}

/** Poll until the motion manager reports no motion playing. */
function waitForMotionFinish(motionManager: Live2DModel['internalModel']['motionManager']): Promise<void> {
	return new Promise((resolve) => {
		// If nothing is playing already, resolve immediately.
		if (motionManager.isFinished()) {
			resolve();
			return;
		}
		const id = window.setInterval(() => {
			if (motionManager.isFinished()) {
				window.clearInterval(id);
				resolve();
			}
		}, MOTION_POLL_MS);
	});
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

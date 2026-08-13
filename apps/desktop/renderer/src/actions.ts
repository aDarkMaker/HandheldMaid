/// <reference types="vite/client" />

import { listen } from '@tauri-apps/api/event';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { Action, InputActionSource } from '@handheld-maid/shared';
import { EVENT } from '@handheld-maid/shared';
import { bindInputActions, playRandomInputAction } from './lib/input-actions';

/**
 * Frontend action executor. Listens for actions emitted by the backend (those
 * routed to the frontend: `Model` and `Speak`) and runs them against the
 * Live2D model / Web Speech API. `Tool` actions never arrive here.
 *
 * Input-triggered random actions (`hm://trigger-input-action`) are delegated to
 * `lib/input-actions` (fair-rotation picker over the model's motions + expressions).
 */

let currentModel: Live2DModel | null = null;

/** Bind the executor to a model. Call once after the model is loaded. */
export function bindModel(model: Live2DModel) {
	currentModel = model;
	bindInputActions(model);
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

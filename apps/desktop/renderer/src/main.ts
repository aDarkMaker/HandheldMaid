/// <reference types="vite/client" />

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as PIXI from 'pixi.js';
import { Application, SCALE_MODES, settings } from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { bindModel, focusModel, startActionListener } from './actions';
import { IPC, EVENT } from '@handheld-maid/shared';
import type { ModelInfo, Rule, Subscription } from '@handheld-maid/shared';

/**
 * True when running inside a real Tauri webview (has the injected internals).
 * When false (e.g. opening the dev URL in a plain browser tab), Tauri IPC is
 * unavailable so we gracefully degrade to model-only rendering instead of
 * throwing `Cannot read properties of undefined (reading 'transformCallback')`.
 */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** invoke wrapper that no-ops outside Tauri so the renderer still loads in a browser. */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
	if (!isTauri) return undefined;
	return invoke<T>(cmd, args);
}

// pixi-live2d-display (cubism4) expects a global PIXI and a global
// Live2DCubismCore (loaded via <script> in index.html).
declare global {
	interface Window {
		PIXI: typeof PIXI;
		Live2DCubismCore?: unknown;
	}
}

/** Resolve once the Cubism Core global is available (loaded in index.html). */
function waitForCubismCore(timeoutMs = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		if (window.Live2DCubismCore) return resolve();
		const start = performance.now();
		const id = setInterval(() => {
			if (window.Live2DCubismCore) {
				clearInterval(id);
				resolve();
			} else if (performance.now() - start > timeoutMs) {
				clearInterval(id);
				reject(new Error('Live2DCubismCore not loaded (check /live2dcubismcore.min.js)'));
			}
		}, 16);
	});
}

/** URL of the currently loaded model3.json (set by loadModel). */
let currentModelUrl = '/assets/models/wanko/runtime/wanko_touch.model3.json';

async function loadModel(): Promise<Live2DModel> {
	// Ask the backend for the active model; fall back to wanko if unavailable
	// (e.g. running outside Tauri in a plain browser tab).
	const info = await safeInvoke<ModelInfo>(IPC.GET_CURRENT_MODEL).catch(() => undefined);
	currentModelUrl = info ? `/assets/${info.path}` : '/assets/models/miku/runtime/miku.model3.json';
	const model = await Live2DModel.from(currentModelUrl);
	model.visible = true;
	return model;
}

function layoutModel(model: Live2DModel, app: Application) {
	const scale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.9;
	model.scale.set(scale);
	model.anchor.set(0.5, 0.5);
	model.x = app.renderer.width / 2;
	model.y = app.renderer.height / 2;
}

/**
 * Register the model's screen-space bounding box with the backend so it can
 * drive dynamic click-through (interactive when the cursor is over the pet,
 * click-through everywhere else). Call after layout and on window move/resize.
 */
function updateHitArea(model: Live2DModel) {
	const bounds = model.getBounds();
	// rdev's MouseMove coordinates and the backend's window outer_position are
	// in physical pixels, but `window.screenX` and Pixi's bounds are in logical
	// (CSS) pixels. Convert to physical pixels so the hit area matches the
	// cursor coordinates the backend compares against.
	const dpr = window.devicePixelRatio || 1;
	const x = Math.round((window.screenX + bounds.x) * dpr);
	const y = Math.round((window.screenY + bounds.y) * dpr);
	const w = Math.round(bounds.width * dpr);
	const h = Math.round(bounds.height * dpr);
	void safeInvoke(IPC.REGISTER_HIT_AREA, { x, y, w, h }).catch(() => {});
}

/**
 * Load the active model, add it to the stage, lay it out, and wire pet-tap.
 * Reused for the initial load and on model switch. Returns the mounted model.
 */
async function mountModel(app: Application): Promise<Live2DModel> {
	const model = await loadModel();
	app.stage.addChild(model);
	layoutModel(model, app);
	// Register the hit area so the backend can drive dynamic click-through.
	updateHitArea(model);

	// Pet tap -> forward to the behavior engine (engine picks the action).
	model.interactive = true;
	model.on('pointertap', () => {
		void safeInvoke(IPC.DISPATCH_EVENT, { kind: 'pettap' }).catch(() => {});
	});
	// Right-click on the pet -> native context menu (Open Settings / Quit).
	model.on('rightdown', () => {
		void safeInvoke(IPC.SHOW_CONTEXT_MENU).catch(() => {});
	});

	// Bind the action executor and suppress the authorship watermark (credits
	// are in the About page). Watermark suppression is generic: it discovers
	// watermark parts by name and forces their opacity to 0.
	bindModel(model);
	void suppressWatermark(app, model);

	return model;
}

// Suppress the browser's default context menu so right-click only triggers our
// native menu (otherwise it refreshes the page / shows the webview menu).
window.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Suppress the model's watermark (authorship overlay).
 *
 * The watermark is a Live2D *Part* (e.g. "水印.psd") whose opacity defaults to
 * 1 in the .moc3. We discover watermark parts by reading the model3.json's
 * DisplayInfo (cdi3.json) — any Part whose name matches "水印"/"watermark" —
 * then force each part's opacity to 0 on every `beforeModelUpdate` (the last
 * hook before render, after motion/expression/eyeBlink/focus/physics/pose have
 * all set their values, so nothing overwrites our 0 before draw). Credits are
 * in the About page. No-op for models without watermark parts.
 */
async function suppressWatermark(_app: Application, model: Live2DModel) {
	const partIds = await watermarkPartIds();
	if (partIds.length === 0) return;

	const internal = (
		model as unknown as {
			internalModel: {
				coreModel: { setPartOpacityById: (id: string, opacity: number) => void };
				on: (event: string, fn: () => void) => void;
			};
		}
	).internalModel;

	internal.on('beforeModelUpdate', () => {
		for (const id of partIds) {
			internal.coreModel.setPartOpacityById(id, 0);
		}
	});
}

/** Fetch the model3.json -> cdi3.json, return ids of Parts named 水印/watermark. */
async function watermarkPartIds(): Promise<string[]> {
	const base = currentModelUrl.substring(0, currentModelUrl.lastIndexOf('/') + 1);
	try {
		const res = await fetch(currentModelUrl);
		const json = (await res.json()) as {
			FileReferences?: { DisplayInfo?: string };
		};
		const cdi = json.FileReferences?.DisplayInfo;
		if (!cdi) return [];
		const cr = await fetch(base + cdi);
		const cj = (await cr.json()) as { Parts?: Array<{ Id: string; Name: string }> };
		return (cj.Parts ?? []).filter((p) => /水印|watermark/i.test(p.Name)).map((p) => p.Id);
	} catch (e) {
		console.error('[HandheldMaid] watermark discovery failed:', e);
		return [];
	}
}

/** Register the default behavior: pet-tap -> Tap motion, idle timer -> Idle motion. */
async function registerDefaultBehavior() {
	// Rule: a tap on the pet emits the "on_pet" named event.
	const petRule: Rule = { name: 'pet', event: 'pettap', probability: 1, emit_event: 'on_pet' };
	// Subscription: "on_pet" -> play the Tap motion.
	const petSub: Subscription = {
		id: 'pet_tap',
		event: 'on_pet',
		action: { category: 'model', motion: 'Tap' },
		weight: 1,
	};
	// Rule: an idle tick (every 30s) emits "on_idle", 30% chance each tick.
	const idleRule: Rule = { name: 'idle', event: 'interval', probability: 0.3, emit_event: 'on_idle' };
	// Subscription: "on_idle" -> play an Idle motion.
	const idleSub: Subscription = {
		id: 'idle_motion',
		event: 'on_idle',
		action: { category: 'model', motion: 'Idle' },
		weight: 1,
	};

	await safeInvoke(IPC.REGISTER_RULE, { rule: petRule }).catch((e) => console.error('[HandheldMaid] register pet rule:', e));
	await safeInvoke(IPC.SUBSCRIBE, { subscription: petSub }).catch((e) => console.error('[HandheldMaid] subscribe pet:', e));
	await safeInvoke(IPC.REGISTER_RULE, { rule: idleRule }).catch((e) => console.error('[HandheldMaid] register idle rule:', e));
	await safeInvoke(IPC.SUBSCRIBE, { subscription: idleSub }).catch((e) => console.error('[HandheldMaid] subscribe idle:', e));
}

async function init() {
	await waitForCubismCore();

	window.PIXI = PIXI;
	settings.SCALE_MODE = SCALE_MODES.LINEAR;

	const canvas = document.getElementById('canvas') as HTMLCanvasElement;
	const app = new Application({
		view: canvas,
		backgroundAlpha: 0,
		antialias: true,
		resizeTo: window,
		width: window.innerWidth,
		height: window.innerHeight,
	});

	// Load the initial model and bind its interactions.
	let model = await mountModel(app);

	if (isTauri) {
		await startActionListener().catch((e) => console.error('[HandheldMaid] listener error:', e));
	} else {
		console.warn('[HandheldMaid] non-tauri context, skipping IPC listener');
	}

	// Reload the model when the backend signals a model switch (settings window).
	if (isTauri) {
		await listen<ModelInfo>(EVENT.MODEL_CHANGED, async () => {
			try {
				app.stage.removeChild(model);
				model.destroy({ children: true, texture: true, baseTexture: true });
				model = await mountModel(app);
				updateHitArea(model);
			} catch (e) {
				console.error('[HandheldMaid] model-changed error:', e);
			}
		}).catch((e) => console.error('[HandheldMaid] model-changed listener error:', e));
	}

	// Gaze following: the backend emits the cursor position (relative to the
	// window) from the global rdev hook, so the pet's eyes follow the pointer
	// anywhere on screen — even when click-through.
	if (isTauri) {
		await listen<{ x: number; y: number }>('hm://cursor', (e) => {
			focusModel(e.payload.x, e.payload.y);
		}).catch((e) => console.error('[HandheldMaid] cursor listener error:', e));
	}

	// Re-layout on resize; keep the hit area in sync so click-through tracks the model.
	window.addEventListener('resize', () => {
		layoutModel(model, app);
		updateHitArea(model);
	});

	// Idle timer: every 30s, feed an Interval event to the engine.
	window.setInterval(() => {
		void safeInvoke(IPC.DISPATCH_EVENT, { kind: 'interval' }).catch(() => {});
	}, 30_000);

	// Register the default behavior rules + subscriptions.
	await registerDefaultBehavior();

	// Drag-to-move: when the left button is down on the pet, move the window.
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	canvas.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return; // left button only
		dragging = true;
		lastX = e.screenX;
		lastY = e.screenY;
	});
	window.addEventListener('mousemove', (e) => {
		if (!dragging) return;
		const dx = e.screenX - lastX;
		const dy = e.screenY - lastY;
		lastX = e.screenX;
		lastY = e.screenY;
		void safeInvoke(IPC.MOVE_WINDOW, { x: dx, y: dy }).catch(() => {});
		// Keep the hit area in sync as the window moves.
		updateHitArea(model);
	});
	// Reset drag on any button release — including when the window was hidden
	// mid-drag (the mouseup may have been missed). Also reset on blur and when
	// the window becomes visible again (e.g. after closing settings).
	const stopDrag = () => {
		dragging = false;
	};
	window.addEventListener('mouseup', stopDrag);
	window.addEventListener('blur', stopDrag);
	window.addEventListener('mouseleave', stopDrag);
	document.addEventListener('visibilitychange', stopDrag);

	// Click-through is now driven dynamically by the backend (rdev global
	// cursor vs the registered hit area), so we do NOT force the whole window
	// non-click-through here — that would make blank areas block clicks again.

	document.body.style.background = 'transparent';
}

init().catch((err) => console.error('[HandheldMaid] Initialization failed:', err));

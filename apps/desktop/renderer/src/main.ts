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
 * True when running inside a real Tauri webview. When false (e.g. opening the
 * dev URL in a plain browser tab), Tauri IPC is unavailable so we gracefully
 * degrade to model-only rendering instead of throwing on undefined internals.
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
	// Fall back to miku if the backend is unavailable (e.g. a plain browser tab).
	const info = await safeInvoke<ModelInfo>(IPC.GET_CURRENT_MODEL).catch(() => undefined);
	currentModelUrl = info ? `/assets/${info.path}` : '/assets/models/miku/runtime/miku.model3.json';
	const model = await Live2DModel.from(currentModelUrl);
	model.visible = true;
	return model;
}

/**
 * Target on-screen (physical) window size. Kept constant so the pet's visual
 * size is stable regardless of screen resolution or DPI scaling. Settable from
 * the settings window; defaults to 400x400. When a `SIZE_CHANGED` event arrives
 * this is replaced and the window resized proportionally.
 */
let targetSize = { w: 400, h: 400 };

/**
 * Size the window to a fixed physical size so the pet's on-screen footprint
 * stays constant. Because the webview's CSS pixels scale by `devicePixelRatio`,
 * sizing in physical px means the layout (and the model laid out against it)
 * keeps a stable physical size across DPI / display changes.
 */
function applyWindowSize(app: Application) {
	const dpr = window.devicePixelRatio || 1;
	app.renderer.resize(targetSize.w / dpr, targetSize.h / dpr);
	void safeInvoke(IPC.RESIZE_WINDOW_PHYSICAL, { w: targetSize.w, h: targetSize.h }).catch(() => {});
}

function layoutModel(model: Live2DModel, app: Application) {
	// Use the model's original (unscaled) dimensions, not the live width/height
	// (which change with scale and would make the ratio self-dependent, so the
	// pet never grew on resize). Cache the original size once on first layout.
	const m = model as Live2DModel & { __origW?: number; __origH?: number };
	if (m.__origW === undefined || m.__origH === undefined) {
		// model.width/height reflect the current scale; divide it out to get the
		// unscaled size on first layout (scale starts at the loader's default 1).
		const s = model.scale.x || 1;
		m.__origW = model.width / s;
		m.__origH = model.height / s;
	}
	const scale = Math.min(app.renderer.width / m.__origW, app.renderer.height / m.__origH) * 0.9;
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
	// rdev coordinates and the backend's window outer_position are physical
	// pixels, but `window.screenX` and Pixi's bounds are logical (CSS) pixels.
	// Convert to physical so the hit area matches the cursor coordinates.
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
	updateHitArea(model);

	// Pet tap -> forward to the behavior engine (it picks the action).
	model.interactive = true;
	model.on('pointertap', () => {
		void safeInvoke(IPC.DISPATCH_EVENT, { kind: 'pettap' }).catch(() => {});
	});
	// Right-click -> native context menu (Open Settings / Quit).
	model.on('rightdown', () => {
		void safeInvoke(IPC.SHOW_CONTEXT_MENU).catch(() => {});
	});

	bindModel(model);
	void suppressWatermark(app, model);

	return model;
}

// Suppress the browser's default context menu so right-click only triggers our
// native menu (otherwise it refreshes the page / shows the webview menu).
window.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Suppress the model's watermark (authorship overlay). The watermark is a
 * Live2D *Part* whose opacity defaults to 1 in the .moc3. We discover watermark
 * parts by name from the cdi3.json, then force each part's opacity to 0 on
 * every `beforeModelUpdate` (the last hook before render, after motion/
 * expression/eyeBlink/focus/physics/pose have set their values, so nothing
 * overwrites our 0 before draw). No-op for models without watermark parts.
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
	// Pet tap emits "on_pet" -> play the Tap motion.
	const petRule: Rule = { name: 'pet', event: 'pettap', probability: 1, emit_event: 'on_pet' };
	const petSub: Subscription = {
		id: 'pet_tap',
		event: 'on_pet',
		action: { category: 'model', motion: 'Tap' },
		weight: 1,
	};
	// Idle tick (every 30s, 30% chance) emits "on_idle" -> play an Idle motion.
	const idleRule: Rule = { name: 'idle', event: 'interval', probability: 0.3, emit_event: 'on_idle' };
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

	// Load the persisted pet size before sizing the renderer.
	const size = await safeInvoke<[number, number]>(IPC.GET_PET_SIZE).catch(() => [400, 400]);
	if (size) {
		targetSize = { w: Math.round(size[0]), h: Math.round(size[1]) };
	}
	const dprInit = window.devicePixelRatio || 1;

	const canvas = document.getElementById('canvas') as HTMLCanvasElement;
	const app = new Application({
		view: canvas,
		backgroundAlpha: 0,
		antialias: true,
		width: targetSize.w / dprInit,
		height: targetSize.h / dprInit,
	});

	let model = await mountModel(app);
	applyWindowSize(app);

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

	// Keep the pet's physical size constant when the window, DPI scaling, or
	// display changes: enforce the physical window size, resize the renderer to
	// the matching CSS size, then re-layout and resync the click-through area.
	const relayout = () => {
		applyWindowSize(app);
		layoutModel(model, app);
		updateHitArea(model);
	};
	window.addEventListener('resize', relayout);
	// Fires when DPI scaling changes (e.g. moving the window onto a differently
	// scaled display, or changing the system scale). Re-assert the physical size.
	const matchDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
	matchDpr.addEventListener('change', relayout);

	// Resize the pet when the size is changed in the settings window. The size
	// arrives as `[w, h]` physical px from the backend broadcast.
	if (isTauri) {
		await listen<[number, number]>(EVENT.SIZE_CHANGED, (e) => {
			targetSize = { w: Math.round(e.payload[0]), h: Math.round(e.payload[1]) };
			relayout();
		}).catch((err) => console.error('[HandheldMaid] size-changed listener error:', err));
	}

	// Gaze following: backend emits the cursor position (window-relative) from
	// the global rdev hook, so the pet's eyes follow the pointer even off-window.
	if (isTauri) {
		await listen<{ x: number; y: number }>('hm://cursor', (e) => {
			focusModel(e.payload.x, e.payload.y);
		}).catch((e) => console.error('[HandheldMaid] cursor listener error:', e));
	}

	// Idle timer: every 30s, feed an Interval event to the engine.
	window.setInterval(() => {
		void safeInvoke(IPC.DISPATCH_EVENT, { kind: 'interval' }).catch(() => {});
	}, 30_000);

	await registerDefaultBehavior();

	// Drag-to-move: left button down on the pet moves the window. Uses absolute
	// screen coordinates derived from a grabbed offset, so the move can't drift
	// from accumulated increments or out-of-order async invokes.
	const dpr = window.devicePixelRatio || 1;
	let dragging = false;
	let grabX = 0;
	let grabY = 0;
	canvas.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return;
		dragging = true;
		// Offset of the grab point relative to the window's top-left.
		grabX = e.clientX;
		grabY = e.clientY;
	});
	window.addEventListener('mousemove', (e) => {
		if (!dragging) return;
		// Desired window top-left (logical px) keeps the grab point under the
		// cursor; convert to physical px to match the backend's set_position.
		const wx = Math.round((e.screenX - grabX) * dpr);
		const wy = Math.round((e.screenY - grabY) * dpr);
		void safeInvoke(IPC.MOVE_WINDOW, { x: wx, y: wy }).catch(() => {});
		// Keep the hit area in sync as the window moves.
		updateHitArea(model);
	});
	// Reset drag on any button release, blur, or visibility change — covers a
	// missed mouseup when the window was hidden mid-drag.
	const stopDrag = () => {
		dragging = false;
	};
	window.addEventListener('mouseup', stopDrag);
	window.addEventListener('blur', stopDrag);
	window.addEventListener('mouseleave', stopDrag);
	document.addEventListener('visibilitychange', stopDrag);

	// Click-through is driven dynamically by the backend (rdev global cursor
	// vs the registered hit area), so we don't force it here.

	document.body.style.background = 'transparent';
}

init().catch((err) => console.error('[HandheldMaid] Initialization failed:', err));

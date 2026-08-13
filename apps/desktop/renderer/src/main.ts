/// <reference types="vite/client" />

import { Application, SCALE_MODES, settings } from 'pixi.js';
import * as PIXI from 'pixi.js';
import { bindModel, startActionListener } from './actions';
import { IPC } from '@handheld-maid/shared';
import { isTauri, safeInvoke, waitForCubismCore } from './lib/tauri';
import { mountModel, scanVisibleExtent, refreshPixelMap } from './lib/model';
import { setTargetSize } from './lib/window-size';
import { registerDefaultBehavior } from './lib/behavior';
import { wireDragToMove } from './lib/drag-move';
import { positionBubble, wireDragDrop, onBubbleResize } from './lib/drag-drop';
import { refreshDebugOverlay } from './lib/dev/debug-overlay';
import { initDevMode } from './lib/dev/dev-mode';
import { makeRelayout, wireEventListeners } from './lib/events';

// Suppress the browser's default context menu so right-click only triggers our
// native menu (otherwise it refreshes the page / shows the webview menu).
window.addEventListener('contextmenu', (e) => e.preventDefault());

async function init() {
	await waitForCubismCore();

	window.PIXI = PIXI;
	settings.SCALE_MODE = SCALE_MODES.LINEAR;

	// Load the persisted pet size before sizing the renderer.
	const size = await safeInvoke<[number, number]>(IPC.GET_PET_SIZE).catch(() => [400, 400]);
	if (size) {
		setTargetSize(Math.round(size[0]), Math.round(size[1]));
	}
	const dprInit = window.devicePixelRatio || 1;

	const canvas = document.getElementById('canvas') as HTMLCanvasElement;
	const app = new Application({
		view: canvas,
		backgroundAlpha: 0,
		antialias: true,
		width: 400 / dprInit,
		height: 400 / dprInit,
	});

	let model = await mountModel(app);
	// Re-layout after the window size is applied. mountModel laid out against
	// the initial 400x400; the native window resize is awaited so layoutModel
	// runs against the real (post-resize) canvas height — without this, the
	// pet's bottom is clipped (the renderer resizes synchronously, the native
	// window does not).
	await makeRelayout(app, model)();
	positionBubble(null);

	// Scan the model's visible extent (async, non-blocking) to size the bubble
	// area to the model's actual transparent-top space. Cached per model URL, so
	// this only runs on first load. After scanning, re-apply the (now
	// model-specific) window size + relayout + bubble position, then refresh the
	// purple pixel map so it matches the model's *final* (post-relayout) position.
	void scanVisibleExtent(model, app).then(async () => {
		await makeRelayout(app, model)();
		positionBubble(null);
		await refreshPixelMap(app);
	});

	// Holder so the MODEL_CHANGED listener can swap the live model.
	const modelRef = { model };

	if (isTauri) {
		await startActionListener().catch((e) => console.error('[HandheldMaid] listener error:', e));
	} else {
		console.warn('[HandheldMaid] non-tauri context, skipping IPC listener');
	}

	// Relayout: enforce the physical window size, resize the renderer, re-layout
	// the model, resync the hit area, reposition the bubble, and refresh the
	// debug overlays + purple pixel map. `relayoutNow` (awaitable) is used by the
	// Dev transition so it can wait for everything to settle before fading in;
	// `relayout` (fire-and-forget) is used by resize/DPI-change listeners.
	const relayoutNow = async () => {
		await makeRelayout(app, modelRef.model)();
		positionBubble(null);
		refreshDebugOverlay();
		await refreshPixelMap(app);
	};
	const relayout = () => {
		void relayoutNow();
	};
	window.addEventListener('resize', relayout);
	// Fires when DPI scaling changes (e.g. moving the window onto a differently
	// scaled display, or changing the system scale). Re-assert the physical size.
	const matchDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
	matchDpr.addEventListener('change', relayout);

	// Dev mode: debug overlays are off by default, toggled from the right-click
	// menu. The toggle is a staged 4s fade that hides the window resize.
	await initDevMode(relayoutNow);

	// Register all backend-event listeners (model switch, size, gaze, panel fade).
	await wireEventListeners(app, canvas, modelRef, relayout);

	// When the toast's height changes (text wraps), relayout so the window top
	// rises to make room (model stays put, bottom-anchored). Registered before
	// wireDragDrop creates the toast (and its ResizeObserver).
	onBubbleResize(relayout);

	// Drag-drop archive (compress/extract) with a speech-bubble toast.
	await wireDragDrop();

	// Idle timer: every 30s, feed an Interval event to the engine.
	window.setInterval(() => {
		void safeInvoke(IPC.DISPATCH_EVENT, { kind: 'interval' }).catch(() => {});
	}, 30_000);

	await registerDefaultBehavior();

	// Drag-to-move the window by dragging the pet.
	wireDragToMove(canvas, app, modelRef.model);

	// Click-through is driven dynamically by the backend (rdev global cursor
	// vs the registered hit area), so we don't force it here.
	document.body.style.background = 'transparent';
}

init().catch((err) => console.error('[HandheldMaid] Initialization failed:', err));

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { ModelInfo } from '@handheld-maid/shared';
import { EVENT, IPC } from '@handheld-maid/shared';
import { focusModel } from '../actions';
import { isTauri } from './tauri';
import { mountModel, updateHitArea, layoutModel, currentModelUrl, scanVisibleExtent, refreshPixelMap } from './model';
import { applyWindowSize, fadeCanvas, setTargetSize } from './window-size';

/** Fade duration (ms) for the settings panel open/close transition. Shorter
 * than the Dev toggle — just enough to make the appear/disappear smooth. */
const PANEL_FADE_MS = 600;

/**
 * Register all backend-event listeners that drive the main window:
 * - `MODEL_CHANGED`: hot-swap the model (load new before destroying old).
 * - `SIZE_CHANGED`: resize the pet (from the settings window).
 * - `hm://cursor`: gaze following (eyes track the pointer off-window).
 * - `PANEL_OPENING` / `PANEL_CLOSING`: fade the model out/in around the panel.
 *
 * `modelRef` is a holder so the MODEL_CHANGED handler can swap the live model.
 */
export async function wireEventListeners(
	app: Application,
	canvas: HTMLCanvasElement,
	modelRef: { model: Live2DModel },
	relayout: () => void,
) {
	if (!isTauri) return;

	// Model switches are serialized via a promise chain. `listen` fires the
	// async callback without awaiting it, so two rapid MODEL_CHANGED events
	// would run concurrently — both capturing the same old model and destroying
	// it twice, leaving the first new model on stage alongside the second.
	// Serializing also keeps each scan's framebuffer read from interleaving with
	// another switch's mount/teardown.
	let switchChain: Promise<void> = Promise.resolve();

	await listen<ModelInfo>(EVENT.MODEL_CHANGED, () => {
		switchChain = switchChain
			.then(async () => {
				const oldModel = modelRef.model;
				// Hide the old model so the scan reads only the new one; it's
				// torn down after the scan to avoid an empty-frame flicker.
				oldModel.visible = false;
				modelRef.model = await mountModel(app);
				await makeRelayout(app, modelRef.model)();
				updateHitArea(modelRef.model);
				// Scan (cached per URL), then relayout + refresh the purple map
				// at the model's final position.
				await scanVisibleExtent(modelRef.model, app);
				await makeRelayout(app, modelRef.model)();
				updateHitArea(modelRef.model);
				await refreshPixelMap(app);
				app.stage.removeChild(oldModel);
				oldModel.destroy({ children: true, texture: true, baseTexture: true });
			})
			.catch((e) => console.error('[HandheldMaid] model-changed error:', e));
	}).catch((e) => console.error('[HandheldMaid] model-changed listener error:', e));

	// Resize the pet when the size is changed in the settings window.
	await listen<[number, number]>(EVENT.SIZE_CHANGED, (e) => {
		setTargetSize(Math.round(e.payload[0]), Math.round(e.payload[1]));
		relayout();
	}).catch((err) => console.error('[HandheldMaid] size-changed listener error:', err));

	// Gaze following: backend emits the cursor position (window-relative) from
	// the global rdev hook, so the pet's eyes follow the pointer even off-window.
	await listen<{ x: number; y: number }>('hm://cursor', (e) => {
		focusModel(e.payload.x, e.payload.y);
	}).catch((e) => console.error('[HandheldMaid] cursor listener error:', e));

	// Panel open/close: fade the model out before hiding the window (when the
	// settings panel opens) and fade it back in after the window reappears
	// (when the panel closes), so the appear/disappear isn't abrupt.
	await listen(EVENT.PANEL_OPENING, async () => {
		try {
			await fadeCanvas(canvas, 0, PANEL_FADE_MS);
			void invoke(IPC.HIDE_MAIN_WINDOW).catch(() => {});
		} catch {
			void invoke(IPC.HIDE_MAIN_WINDOW).catch(() => {});
		}
	}).catch((e) => console.error('[HandheldMaid] panel-opening listener error:', e));
	await listen(EVENT.PANEL_CLOSING, () => {
		// Reset opacity to 0 before fading in (the window was hidden at 0).
		canvas.style.opacity = '0';
		void fadeCanvas(canvas, 1, PANEL_FADE_MS).catch(() => {});
	}).catch((e) => console.error('[HandheldMaid] panel-closing listener error:', e));
}

/**
 * Apply the window size, then lay out + re-register the hit area. Awaits the
 * native window resize so layout runs against the window's *new* CSS size —
 * otherwise `layoutModel` would use the renderer's new height (resized
 * synchronously) while the real canvas is still the old (shorter) height, and
 * the pet's bottom would be clipped. `modelUrl` selects the cached bubble area.
 */
export function makeRelayout(app: Application, model: Live2DModel) {
	return async () => {
		await applyWindowSize(app, currentModelUrl);
		layoutModel(model, app);
		updateHitArea(model);
	};
}

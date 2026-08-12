import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { ModelInfo } from '@handheld-maid/shared';
import { EVENT, IPC } from '@handheld-maid/shared';
import { focusModel } from '../actions';
import { isTauri } from './tauri';
import { mountModel, updateHitArea, layoutModel, currentModelUrl, scanVisibleExtent } from './model';
import { applyWindowSize, fadeCanvas, setTargetSize } from './window-size';

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

	// Reload the model when the backend signals a model switch (settings window).
	// Load the new model BEFORE destroying the old one so there's no empty-frame
	// flicker while assets re-fetch and decode. The old model's teardown is
	// deferred to the next frame so its GL/GC work doesn't block the new model's
	// first render.
	await listen<ModelInfo>(EVENT.MODEL_CHANGED, async () => {
		try {
			const oldModel = modelRef.model;
			// Mount the new model (adds to stage, lays out, wires events).
			modelRef.model = await mountModel(app);
			// Re-apply the window size + relayout so the new model lays out
			// against the correct (pet+bubble) canvas.
			await makeRelayout(app, modelRef.model)();
			updateHitArea(modelRef.model);
			// Scan the new model's visible extent (async, non-blocking). The
			// scan is cached per model URL, so this only runs on first load of
			// each model. It waits for the model to render, then reads pixels to
			// find the true visible top → the bubble-area size for this model.
			// After scanning, re-apply the window size (the bubble area may
			// change from the default to the model-specific value) + relayout.
			void scanVisibleExtent(modelRef.model, app).then(async () => {
				await makeRelayout(app, modelRef.model)();
				updateHitArea(modelRef.model);
			});
			// Tear down the previous model after the new one has rendered a frame.
			window.setTimeout(() => {
				app.stage.removeChild(oldModel);
				oldModel.destroy({ children: true, texture: true, baseTexture: true });
			}, 0);
		} catch (e) {
			console.error('[HandheldMaid] model-changed error:', e);
		}
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
			await fadeCanvas(canvas, 0);
			void invoke(IPC.HIDE_MAIN_WINDOW).catch(() => {});
		} catch {
			void invoke(IPC.HIDE_MAIN_WINDOW).catch(() => {});
		}
	}).catch((e) => console.error('[HandheldMaid] panel-opening listener error:', e));
	await listen(EVENT.PANEL_CLOSING, () => {
		// Reset opacity to 0 before fading in (the window was hidden at 0).
		canvas.style.opacity = '0';
		void fadeCanvas(canvas, 1).catch(() => {});
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

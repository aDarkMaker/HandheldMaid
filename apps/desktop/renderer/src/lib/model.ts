import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { ModelInfo } from '@handheld-maid/shared';
import { IPC } from '@handheld-maid/shared';
import { bindModel } from '../actions';
import { setDebugText } from './debug';
import { positionDebugLine } from './debug-line';
import { getVisExtent, setVisExtent, targetSize, bubbleAreaHeight } from './window-size';
import { safeInvoke } from './tauri';

/** URL of the currently loaded model3.json (set by loadModel). */
export let currentModelUrl = '/assets/models/wanko/runtime/wanko_touch.model3.json';

export async function loadModel(): Promise<Live2DModel> {
	// Fall back to miku if the backend is unavailable (e.g. a plain browser tab).
	const { Live2DModel } = await import('pixi-live2d-display/cubism4');
	const info = await safeInvoke<ModelInfo>(IPC.GET_CURRENT_MODEL).catch(() => undefined);
	currentModelUrl = info ? `/assets/${info.path}` : '/assets/models/miku/runtime/miku.model3.json';
	const model = await Live2DModel.from(currentModelUrl);
	model.visible = true;
	return model;
}

/**
 * Lay out the model: fit its whole canvas into the pet region (targetSize.w ×
 * targetSize.h), centered horizontally, **anchored to the window bottom**. The
 * model's position is independent of the bubble area — when the bubble grows,
 * the window's *top* moves up to make room (applyWindowSize raises the window
 * top + grows the height, keeping the bottom fixed), so the model never moves.
 * All adaptation is based on the *correctly loaded & rendered* model.
 */
export function layoutModel(model: Live2DModel, app: Application) {
	// Cache the model's original (unscaled) canvas size once; model.width/height
	// change with scale and would make the fit ratio self-dependent.
	const m = model as Live2DModel & { __origW?: number; __origH?: number };
	if (m.__origW === undefined || m.__origH === undefined) {
		const s = model.scale.x || 1;
		m.__origW = model.width / s;
		m.__origH = model.height / s;
	}

	// The pet region: targetSize.w × targetSize.h, anchored to the window
	// BOTTOM. Use targetSize (the constant pet size) — not app.renderer dims,
	// which differ between the desktop window and a plain browser tab. The
	// model sits at the bottom of the window regardless of the bubble area
	// above it, so it stays put when the bubble grows.
	const bubble = bubbleAreaHeight(currentModelUrl);
	const petW = targetSize.w;
	const petH = targetSize.h;
	// Pet region top = window height - pet height (bottom-anchored).
	const petTop = app.renderer.height - petH;
	const petBottom = app.renderer.height;

	// Fit the whole canvas into the pet region, centered. margin so the canvas
	// never touches the edges (the model may overflow its canvas, so a little
	// slack avoids clipping at the very top/bottom of overflow-prone models).
	const margin = 0.9;
	const scale = Math.max(0.01, Math.min(petW / m.__origW!, petH / m.__origH!) * margin);
	model.scale.set(scale);
	model.anchor.set(0.5, 0.5);
	// Center the canvas in the pet region (bottom-anchored).
	model.x = petW / 2;
	model.y = petTop + petH / 2;

	// DIAG: live per-model diagnostics (remove once layout is verified).
	const ext = getVisExtent(currentModelUrl);
	// The model's visible top in world/CSS px = pet region top + topRatio * petH.
	const visTopCss = ext ? petTop + ext.topRatio * petH : null;
	positionDebugLine(visTopCss);
	const dpr = window.devicePixelRatio || 1;
	const diag =
		`${currentModelUrl.split('/').slice(-2).join('/')}` +
		` canvas=${m.__origW!.toFixed(0)}x${m.__origH!.toFixed(0)}` +
		` scale=${scale.toFixed(3)}` +
		` bubble=${bubble.toFixed(0)}` +
		` petTop=${petTop.toFixed(0)}` +
		` petBot=${petBottom.toFixed(0)}` +
		` modelY=${model.y.toFixed(1)}` +
		` visTop=${visTopCss == null ? '?' : visTopCss.toFixed(0)}` +
		` ext=${ext ? `top=${ext.topRatio.toFixed(2)} bot=${ext.botRatio.toFixed(2)}` : '(unscaled)'}` +
		` renderer=${app.renderer.width.toFixed(0)}x${app.renderer.height.toFixed(0)}` +
		` win=${window.innerWidth}x${window.innerHeight}` +
		` dpr=${dpr}`;
	console.log(`[HM layout] ${diag}`);
	setDebugText(diag);
}

/**
 * Scan the *rendered* canvas pixels to find the model's true visible top/bottom
 * (the first/last rows with any non-transparent pixel). This is the only
 * reliable "visual top" — vertex bounds include transparent padding. The result
 * is stored as a fraction of targetSize.h so it stays valid when the target
 * size changes (proportional resize, no re-scan).
 *
 * Runs *after* the model has been laid out & rendered, so it doesn't block the
 * model's first appearance. The scan reads the whole renderer framebuffer, so
 * the model must be the only thing on stage (it is — the pet window has just
 * the model + the toast overlay, which is a separate DOM element, not on the
 * Pixi stage).
 */
export async function scanVisibleExtent(model: Live2DModel, app: Application): Promise<void> {
	// Already scanned for this model — no need to re-scan.
	if (getVisExtent(currentModelUrl)) return;

	// Wait several frames so the model has rendered and (on a model switch)
	// the previous model has been destroyed and its leftover pixels cleared
	// from the framebuffer by the ticker's per-frame clear. Reading the live
	// framebuffer too early picks up the old model's residual pixels, which
	// corrupted the scan (wanko's topRatio came back 0.00 from miku's
	// residual). ~5 frames is well past the old model's deferred destroy.
	const waitFrames = (n: number) =>
		new Promise<void>((r) => {
			let i = 0;
			const tick = () => (++i >= n ? r() : requestAnimationFrame(tick));
			requestAnimationFrame(tick);
		});
	await waitFrames(5);

	const renderer = app.renderer as unknown as {
		plugins: { extract: { pixels(target?: unknown): Uint8Array } };
		resolution: number;
	};
	if (!renderer.plugins?.extract?.pixels) return;

	// extract.pixels() reads at the renderer's resolution, so the returned
	// array is (logicalW * resolution) × (logicalH * resolution). Index in
	// device px, convert back to logical (CSS) px for the ratio math.
	const resolution = renderer.resolution || 1;
	const logicalW = app.renderer.width;
	const logicalH = app.renderer.height;
	const devW = Math.round(logicalW * resolution);
	const devH = Math.round(logicalH * resolution);
	if (devW <= 0 || devH <= 0) return;

	let pixels: Uint8Array;
	try {
		pixels = renderer.plugins.extract.pixels();
	} catch (e) {
		console.error('[HandheldMaid] pixel scan failed:', e);
		return;
	}
	// Sanity: the array should be devW * devH * 4.
	if (pixels.length < devW * devH * 4) {
		console.error('[HandheldMaid] pixel scan: short pixel buffer', pixels.length, devW, devH);
		return;
	}

	// Find first/last rows with any opaque pixel (alpha > threshold), within
	// the pet region [petTop, petTop+petH] (device px).
	const bubble = bubbleAreaHeight(currentModelUrl);
	const petTopDev = Math.max(0, Math.floor(bubble * resolution));
	const petBotDev = Math.min(devH, Math.ceil((bubble + targetSize.h) * resolution));
	const alphaThresh = 8;
	let visTopDev = -1;
	let visBotDev = -1;
	for (let y = petTopDev; y < petBotDev; y++) {
		const rowStart = y * devW * 4;
		for (let x = 0; x < devW; x++) {
			if (pixels[rowStart + x * 4 + 3] > alphaThresh) {
				if (visTopDev < 0) visTopDev = y;
				visBotDev = y;
				break;
			}
		}
	}
	if (visTopDev < 0) {
		console.warn('[HM scan] no visible pixels found in pet region');
		return;
	}

	// Convert device px back to logical, then to a fraction of targetSize.h.
	const visTop = visTopDev / resolution;
	const visBot = visBotDev / resolution;
	const topRatio = Math.max(0, (visTop - bubble) / targetSize.h);
	const botRatio = Math.min(1, (visBot - bubble) / targetSize.h);
	setVisExtent(currentModelUrl, topRatio, botRatio);
	console.log(
		`[HM scan] ${currentModelUrl.split('/').slice(-2).join('/')}` +
		` visTop=${visTop.toFixed(1)} visBot=${visBot.toFixed(1)}` +
		` topRatio=${topRatio.toFixed(3)} botRatio=${botRatio.toFixed(3)}` +
		` devW=${devW} devH=${devH} res=${resolution}`,
	);
}

/**
 * Register the model's screen-space bounding box with the backend so it can
 * drive dynamic click-through (interactive when the cursor is over the pet,
 * click-through everywhere else). Call after layout and on window move/resize.
 */
export function updateHitArea(model: Live2DModel) {
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
export async function mountModel(app: Application): Promise<Live2DModel> {
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

/** Cache of model3.json URL -> watermark part ids, to avoid re-fetching on switch. */
const watermarkCache = new Map<string, string[]>();

/**
 * Discover watermark part ids for the model. Fetches the model3.json ->
 * cdi3.json, returns ids of Parts named 水印/watermark. Results are cached per
 * model URL so repeated model switches don't re-fetch.
 */
async function watermarkPartIds(): Promise<string[]> {
	const cached = watermarkCache.get(currentModelUrl);
	if (cached) return cached;

	const base = currentModelUrl.substring(0, currentModelUrl.lastIndexOf('/') + 1);
	try {
		const res = await fetch(currentModelUrl);
		const json = (await res.json()) as { FileReferences?: { DisplayInfo?: string } };
		const cdi = json.FileReferences?.DisplayInfo;
		if (!cdi) return [];
		const cr = await fetch(base + cdi);
		const cj = (await cr.json()) as { Parts?: Array<{ Id: string; Name: string }> };
		const ids = (cj.Parts ?? []).filter((p) => /水印|watermark/i.test(p.Name)).map((p) => p.Id);
		watermarkCache.set(currentModelUrl, ids);
		return ids;
	} catch (e) {
		console.error('[HandheldMaid] watermark discovery failed:', e);
		return [];
	}
}

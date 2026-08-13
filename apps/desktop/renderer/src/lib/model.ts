import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { ModelInfo } from '@handheld-maid/shared';
import { IPC } from '@handheld-maid/shared';
import { bindModel } from '../actions';
import { setDebugText } from './dev/debug';
import { positionDebugLine } from './dev/debug-line';
import { refreshDebugOverlay, showModelBoundsRect, showHitAreaRect, showPixelMap } from './dev/debug-overlay';
import { pauseBubbleResize, resumeBubbleResize } from './drag-drop';
import { getVisExtent, setVisExtent, targetSize, bubbleAreaHeight } from './window-size';
import { safeInvoke } from './tauri';
import { isDevMode } from './dev/dev-mode';

/** URL of the currently loaded model3.json (set by loadModel). */
export let currentModelUrl = '/assets/models/wanko/runtime/wanko_touch.model3.json';

/** First non-transparent rows from the last scan (shown in the debug bubble). */
export let lastScanFirstHits: Array<{ y: number; maxA: number }> = [];

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
 * The model's *visible* bounds (smallest rect containing all scanned
 * non-transparent pixels) in CSS px, relative to the renderer. Returns null
 * before the first scan. This is the ground truth for the red debug line
 * (top), the blue/yellow rects (model region = interactive region), and the
 * toast anchor. Replaces `getBounds()`, which returns the whole canvas incl.
 * transparent padding.
 */
export function visibleBounds(model: Live2DModel): { x: number; y: number; w: number; h: number } | null {
	const ext = getVisExtent(currentModelUrl);
	if (!ext) return null;
	const m = model as Live2DModel & { __origW?: number; __origH?: number };
	const scale = model.scale.x || 1;
	const canvasW = (m.__origW ?? 0) * scale;
	const canvasH = (m.__origH ?? 0) * scale;
	const canvasTop = model.y - canvasH / 2;
	const canvasLeft = model.x - canvasW / 2;
	const x = canvasLeft + ext.leftRatio * canvasW;
	const y = canvasTop + ext.topRatio * canvasH;
	const w = (ext.rightRatio - ext.leftRatio) * canvasW;
	const h = (ext.botRatio - ext.topRatio) * canvasH;
	return { x, y, w, h };
}

/**
 * Fit the model's whole canvas into the pet region (targetSize.w × targetSize.h),
 * centered horizontally and anchored to the window bottom. The model position is
 * independent of the bubble area: when the bubble grows the window's *top* moves
 * up (applyWindowSize keeps the bottom fixed), so the model never moves.
 */
export function layoutModel(model: Live2DModel, app: Application) {
	// Cache the original (unscaled) canvas size once; model.width/height change
	// with scale and would make the fit ratio self-dependent.
	const m = model as Live2DModel & { __origW?: number; __origH?: number };
	if (m.__origW === undefined || m.__origH === undefined) {
		const s = model.scale.x || 1;
		m.__origW = model.width / s;
		m.__origH = model.height / s;
	}

	// targetSize is physical px; convert to CSS px (Pixi layout is CSS px) so the
	// fit/position are correct at any DPR. The pet region is bottom-anchored.
	const dpr = window.devicePixelRatio || 1;
	const bubble = bubbleAreaHeight(currentModelUrl);
	const petW = targetSize.w / dpr;
	const petH = targetSize.h / dpr;
	const petTop = app.renderer.height - petH;

	// Fit the whole canvas into the pet region, centered. A 0.9 margin gives
	// slack so overflow-prone models don't clip at the edges.
	const margin = 0.9;
	const scale = Math.max(0.01, Math.min(petW / m.__origW!, petH / m.__origH!) * margin);
	model.scale.set(scale);
	model.anchor.set(0.5, 0.5);
	model.x = petW / 2;
	model.y = petTop + petH / 2;

	// If we've scanned the visible extent, shift so the *visible region* (not the
	// whole canvas) is centered — some models sit off-center in their canvas.
	const ext = getVisExtent(currentModelUrl);
	const canvasH = m.__origH! * scale;
	const canvasW = m.__origW! * scale;
	if (ext) {
		const visCenterX = canvasW * (ext.leftRatio + ext.rightRatio) / 2;
		const visCenterY = canvasH * (ext.topRatio + ext.botRatio) / 2;
		model.x = petW / 2 - (visCenterX - canvasW / 2);
		model.y = petTop + petH / 2 - (visCenterY - canvasH / 2);
	}

	// Publish visTop so drag-drop.ts can anchor the toast there without a model
	// reference. Drives the red debug line + blue/yellow rects too.
	const vb = visibleBounds(model);
	const visTopCss = vb ? vb.y : null;
	positionDebugLine(visTopCss);
	if (visTopCss != null) {
		document.documentElement.style.setProperty('--vis-top-css', `${visTopCss}`);
	}
	refreshDebugOverlay();
	if (vb) {
		showModelBoundsRect(vb);
	} else {
		const mb = model.getBounds();
		showModelBoundsRect({ x: mb.x, y: mb.y, w: mb.width, h: mb.height });
	}
	const diag =
		`${currentModelUrl.split('/').slice(-2).join('/')}` +
		` canvas=${m.__origW!.toFixed(0)}x${m.__origH!.toFixed(0)}` +
		` scale=${scale.toFixed(3)} bubble=${bubble.toFixed(0)}` +
		` petTop=${petTop.toFixed(0)} modelY=${model.y.toFixed(1)}` +
		` visTop=${visTopCss == null ? '?' : visTopCss.toFixed(0)}` +
		` ext=${ext ? `t=${ext.topRatio.toFixed(2)} b=${ext.botRatio.toFixed(2)} l=${ext.leftRatio.toFixed(2)} r=${ext.rightRatio.toFixed(2)}` : '(unscaled)'}` +
		` renderer=${app.renderer.width.toFixed(0)}x${app.renderer.height.toFixed(0)}` +
		` win=${window.innerWidth}x${window.innerHeight} dpr=${dpr}`;
	console.log(`[HM layout] ${diag}`);
	setDebugText(diag + ` hits=${JSON.stringify(lastScanFirstHits)}`);
}

/**
 * Scan the rendered framebuffer to find the model's true visible top/bottom
 * (the first/last rows with non-transparent pixels). Vertex bounds include
 * transparent padding, so this is the only reliable "visual top". The result
 * is stored as a fraction of the rendered canvas so it stays valid when the
 * target size changes (proportional resize, no re-scan). Cached per model URL.
 */
export async function scanVisibleExtent(model: Live2DModel, app: Application): Promise<void> {
	const alreadyScanned = !!getVisExtent(currentModelUrl);
	// Pause toast-height relayouts during the framebuffer read so the
	// framebuffer is stable (a mid-scan relayout shifts the model in it).
	// try/finally guarantees resume on every exit path.
	pauseBubbleResize();
	try {
		await scanExtentBody(model, app, alreadyScanned);
	} finally {
		resumeBubbleResize();
	}
}

async function scanExtentBody(
	model: Live2DModel,
	app: Application,
	alreadyScanned: boolean,
): Promise<void> {
	// Wait several frames so the model has rendered and (on a switch) the
	// previous model's leftover pixels have been cleared from the framebuffer.
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

	const resolution = renderer.resolution || 1;
	const devW = Math.round(app.renderer.width * resolution);
	const devH = Math.round(app.renderer.height * resolution);
	if (devW <= 0 || devH <= 0) return;

	let pixels: Uint8Array;
	try {
		pixels = renderer.plugins.extract.pixels();
	} catch (e) {
		console.error('[HandheldMaid] pixel scan failed:', e);
		return;
	}
	if (pixels.length < devW * devH * 4) return;

	// Count opaque pixels per row and per column. To reject stray/near-invisible
	// specks above the real model top, a row/col only counts if it has enough
	// opaque pixels (a real model slice is wide). extract.pixels() reads the
	// framebuffer bottom-up (GL origin bottom-left), so index rowCounts with
	// (devH-1-y) to get top-down rows matching DOM coordinates.
	const alphaThresh = 8;
	const rowCounts = new Uint32Array(devH);
	const colCounts = new Uint32Array(devW);
	let a0 = 0, aLow = 0, aHigh = 0;
	for (let y = 0; y < devH; y++) {
		const rowStart = y * devW * 4;
		const topDownY = devH - 1 - y;
		for (let x = 0; x < devW; x++) {
			const a = pixels[rowStart + x * 4 + 3];
			if (a === 0) a0++;
			else if (a <= alphaThresh) aLow++;
			else { aHigh++; rowCounts[topDownY]++; colCounts[x]++; }
		}
	}
	console.log(
		`[HM scan-alpha] ${currentModelUrl.split('/').slice(-2).join('/')}` +
		` total=${devW * devH} alpha0=${a0}(${(a0 / (devW * devH) * 100).toFixed(1)}%)` +
		` alphaLow=${aLow} alphaHigh=${aHigh}(${(aHigh / (devW * devH) * 100).toFixed(1)}%)`,
	);
	// The purple pixel map is drawn separately by refreshPixelMap, from the
	// framebuffer after the model is in its final (post-relayout) position.

	const minRowCount = Math.max(4, Math.round(devW * 0.01));
	const minColCount = Math.max(2, Math.round(devH * 0.002));
	let visLeft = -1;
	let visRight = -1;
	for (let x = 0; x < devW; x++) {
		if (colCounts[x] >= minColCount) {
			if (visLeft < 0) visLeft = x;
			visRight = x;
		}
	}
	if (visLeft < 0) {
		console.warn('[HM scan] no visible column span', { devW, devH, minRowCount, minColCount });
		return;
	}

	let visTopDev = -1;
	let visBotDev = -1;
	const firstHits: Array<{ y: number; maxA: number }> = [];
	for (let y = 0; y < devH; y++) {
		if (rowCounts[y] < minRowCount) continue;
		// Count only pixels inside the visible column span; read the framebuffer
		// row bottom-up (topDown y → framebuffer (devH-1-y)).
		let spanCount = 0;
		const rowStart = (devH - 1 - y) * devW * 4;
		for (let x = visLeft; x <= visRight; x++) {
			if (pixels[rowStart + x * 4 + 3] > alphaThresh) spanCount++;
		}
		if (spanCount < minRowCount) continue;
		if (visTopDev < 0) visTopDev = y;
		visBotDev = y;
		if (firstHits.length < 8) firstHits.push({ y, maxA: spanCount });
	}
	if (visTopDev < 0) {
		console.warn('[HM scan] no visible row span', { colSpan: `${visLeft}-${visRight}`, minRowCount });
		return;
	}

	// Convert device px back to ratios of the rendered canvas (from canvasTop/
	// canvasLeft), clamped to [0, 1]. Correct even when the model overflows its
	// canvas or the pet region has bubble space above it.
	const m = model as Live2DModel & { __origW?: number; __origH?: number };
	const canvasH = (m.__origH ?? 0) * model.scale.y;
	const canvasW = (m.__origW ?? 0) * model.scale.x;
	const canvasTop = model.y - canvasH / 2;
	const canvasLeft = model.x - canvasW / 2;
	const visTopCss = visTopDev / resolution;
	const visBotCss = visBotDev / resolution;
	const visLeftCss = visLeft / resolution;
	const visRightCss = visRight / resolution;
	const topRatio = canvasH > 0 ? Math.max(0, Math.min(1, (visTopCss - canvasTop) / canvasH)) : 0;
	const botRatio = canvasH > 0 ? Math.max(0, Math.min(1, (visBotCss - canvasTop) / canvasH)) : 1;
	const leftRatio = canvasW > 0 ? Math.max(0, Math.min(1, (visLeftCss - canvasLeft) / canvasW)) : 0;
	const rightRatio = canvasW > 0 ? Math.max(0, Math.min(1, (visRightCss - canvasLeft) / canvasW)) : 1;
	// Cache only on the first scan; later scans keep the cache but still re-read
	// the framebuffer above (to refresh the purple overlay on a switch back).
	if (!alreadyScanned) setVisExtent(currentModelUrl, topRatio, botRatio, leftRatio, rightRatio);
	lastScanFirstHits = firstHits;
	console.log(
		`[HM scan] ${currentModelUrl.split('/').slice(-2).join('/')}` +
		` visTopCss=${visTopCss.toFixed(1)} visBotCss=${visBotCss.toFixed(1)}` +
		` topRatio=${topRatio.toFixed(3)} botRatio=${botRatio.toFixed(3)}` +
		` leftRatio=${leftRatio.toFixed(3)} rightRatio=${rightRatio.toFixed(3)}` +
		` colSpan=${visLeft}-${visRight} firstHits=${JSON.stringify(firstHits)}`,
	);
}

/**
 * Re-capture the framebuffer and redraw the purple pixel map at the model's
 * *current* position. scanVisibleExtent reads the framebuffer at the pre-relayout
 * position; the post-scan relayout then shifts the model, so drawing there would
 * leave the map offset. Called after the final relayout so the map lines up with
 * the model and the blue/yellow rects. No-op unless Dev mode is on.
 */
export async function refreshPixelMap(app: Application): Promise<void> {
	if (!isDevMode()) return;
	const renderer = app.renderer as unknown as {
		plugins: { extract: { pixels(target?: unknown): Uint8Array } };
		resolution: number;
	};
	if (!renderer.plugins?.extract?.pixels) return;
	const resolution = renderer.resolution || 1;
	const devW = Math.round(app.renderer.width * resolution);
	const devH = Math.round(app.renderer.height * resolution);
	if (devW <= 0 || devH <= 0) return;
	let pixels: Uint8Array;
	try {
		pixels = renderer.plugins.extract.pixels();
	} catch (e) {
		console.error('[HandheldMaid] refreshPixelMap failed:', e);
		return;
	}
	if (pixels.length < devW * devH * 4) return;
	showPixelMap(pixels, devW, devH, 8, resolution);
}

/**
 * Register the model's rendered bounds with the backend so it can drive dynamic
 * click-through (interactive over the model, click-through elsewhere). The hit
 * area is the visible bounds (smallest rect of all scanned pixels) — the whole
 * pet region is too large (it includes transparent canvas the model doesn't
 * cover). Falls back to getBounds before the first scan.
 */
export function updateHitArea(model: Live2DModel) {
	const vb = visibleBounds(model);
	const src = vb ?? model.getBounds();
	const bounds = { x: src.x, y: src.y, w: 'width' in src ? src.width : src.w, h: 'height' in src ? src.height : src.h };
	if (bounds.w <= 0 || bounds.h <= 0) {
		console.warn('[HandheldMaid] updateHitArea: degenerate bounds, skipping', bounds);
		showHitAreaRect(null);
		return;
	}
	const dpr = window.devicePixelRatio || 1;
	const x = Math.round((window.screenX + bounds.x) * dpr);
	const y = Math.round((window.screenY + bounds.y) * dpr);
	const w = Math.round(bounds.w * dpr);
	const h = Math.round(bounds.h * dpr);
	showHitAreaRect(bounds);
	console.log(`[HM hit] ${vb ? 'vis' : 'getBounds'} ${bounds.w.toFixed(0)}x${bounds.h.toFixed(0)} physical=${w}x${h} dpr=${dpr}`);
	void safeInvoke(IPC.REGISTER_HIT_AREA, { x, y, w, h }).catch((e) => {
		console.error('[HandheldMaid] register hit area failed:', e);
	});
}

/** Load the active model, add it to the stage, lay it out, and wire pet-tap. */
export async function mountModel(app: Application): Promise<Live2DModel> {
	const model = await loadModel();
	app.stage.addChild(model);
	layoutModel(model, app);

	// Wait one frame so getBounds() is valid before registering the hit area.
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	updateHitArea(model);

	model.interactive = true;
	model.on('pointertap', () => {
		void safeInvoke(IPC.DISPATCH_EVENT, { kind: 'pettap' }).catch(() => {});
	});
	model.on('rightdown', () => {
		void safeInvoke(IPC.SHOW_CONTEXT_MENU).catch(() => {});
	});

	bindModel(model);
	void suppressWatermark(app, model);

	return model;
}

/**
 * Suppress the model's watermark (authorship overlay). The watermark is a
 * Live2D Part whose opacity defaults to 1; we force it to 0 on every
 * beforeModelUpdate (the last hook before render). No-op without watermark parts.
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

/** Cache of model3.json URL -> watermark part ids. */
const watermarkCache = new Map<string, string[]>();

/** Discover watermark part ids (Parts named 水印/watermark) from cdi3.json. */
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

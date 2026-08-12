import type { Application } from 'pixi.js';
import { IPC } from '@handheld-maid/shared';
import { safeInvoke } from './tauri';

/**
 * Target on-screen (physical) **pet** size. Kept constant so the pet's visual
 * size is stable regardless of screen resolution or DPI scaling. Settable from
 * the settings window; defaults to 400x400. When a `SIZE_CHANGED` event arrives
 * this is replaced and the window resized proportionally.
 */
export let targetSize = { w: 400, h: 400 };

/** Update the target size (e.g. from a `SIZE_CHANGED` event). */
export function setTargetSize(w: number, h: number) {
	targetSize = { w, h };
}

/**
 * Per-model visible-extent cache, keyed by model3.json URL. Holds the model's
 * visible top/bottom as a *fraction of targetSize.h*, so it stays correct when
 * the target size changes (global proportional resize — no re-scan needed).
 *
 * `topRatio` is the transparent space above the model's first visible pixel:
 * that space is where the speech bubble lives. `botRatio` is the model's last
 * visible pixel (≤ 1). Until the first scan completes, these are undefined and
 * a default bubble area is used.
 */
interface VisExtent {
	/** Visible top Y / targetSize.h (0 = model touches canvas top). */
	topRatio: number;
	/** Visible bottom Y / targetSize.h. */
	botRatio: number;
}
const visExtentCache = new Map<string, VisExtent>();

/** Record a model's scanned visible extent (called after the pixel scan). */
export function setVisExtent(modelUrl: string, topRatio: number, botRatio: number) {
	visExtentCache.set(modelUrl, { topRatio, botRatio });
}

/** Get a model's cached visible extent, or null if not scanned yet. */
export function getVisExtent(modelUrl: string): VisExtent | null {
	return visExtentCache.get(modelUrl) ?? null;
}

/**
 * The bubble area is the reserved space above the model where the speech
 * bubble floats. It's driven by the toast's **actual rendered height** (via a
 * ResizeObserver in drag-drop.ts), so the model always sits just below the
 * bubble — no matter how many lines the bubble wraps to, it never overlaps or
 * clips the model. A minimum keeps a little breathing room when the toast is
 * empty/hidden.
 *
 * Units: physical px (same as `targetSize`), so it composes directly with
 * `targetSize.h` in `windowPhysicalSize` and `layoutModel`. The toast's DOM
 * height is CSS px, so `setToastHeight` scales by DPR on the way in.
 */
const MIN_BUBBLE_AREA = 16;
/** Small gap between the bubble bottom and the model top (physical px). */
const BUBBLE_GAP = 6;
/**
 * Rendered height of every active bubble source, in physical px. The reserved
 * area must be the *largest* bubble, not whichever ResizeObserver happened to
 * fire last: the hidden archive toast's one-line height was overwriting the
 * multi-line debug/visible toast height, shrinking the desktop window to 424px
 * and clipping the real bubble at the top.
 */
const toastHeights = new Map<string, number>();
let toastHeight = 0;

/**
 * Update one bubble source's height (called by its ResizeObserver). `h` is CSS
 * px (from offsetHeight); it is scaled to physical px to match `targetSize`.
 * The reserved area is the maximum height across sources. Returns true only
 * when that maximum changes, so callers relayout only when necessary.
 */
export function setToastHeight(source: string, h: number): boolean {
	const dpr = window.devicePixelRatio || 1;
	toastHeights.set(source, Math.max(0, Math.round(h * dpr)));
	const next = Math.max(0, ...toastHeights.values());
	if (next === toastHeight) return false;
	toastHeight = next;
	return true;
}

/**
 * The bubble area height (physical px): the toast's rendered height + a gap,
 * with a minimum. The model is laid out below this area, so the toast never
 * overlaps the model regardless of how tall it gets.
 */
export function bubbleAreaHeight(_modelUrl: string): number {
	return Math.max(MIN_BUBBLE_AREA, toastHeight + BUBBLE_GAP);
}

/**
 * The physical window size: pet width, pet height + the model-specific bubble
 * area on top. The window is only as tall as the model needs (its transparent
 * top space becomes the bubble area), so a model that sits high in its canvas
 * (small top space) gets a short window, and one that sits low (large top
 * space) gets a taller window. Sizing in physical px keeps the layout stable
 * across DPI / display changes.
 */
export function windowPhysicalSize(modelUrl: string) {
	return { w: targetSize.w, h: targetSize.h + bubbleAreaHeight(modelUrl) };
}

/**
 * Wait until the native window's CSS size reaches `targetCss` (within 1px), or
 * `timeoutMs` elapses. On Windows, Tauri's `set_size` returns *before* the OS
 * has actually resized the window, so `window.innerHeight` is still the old
 * value right after the call. The `<canvas>` is sized by CSS (`width/height:
 * 100%`), so if we resize the Pixi renderer to the *new* height while the
 * canvas element is still the *old* height, everything the renderer draws below
 * the old height is clipped by the canvas.
 */
function waitForNativeResize(targetCss: { w: number; h: number }, timeoutMs = 300): Promise<void> {
	const eps = 1;
	if (Math.abs(window.innerWidth - targetCss.w) < eps && Math.abs(window.innerHeight - targetCss.h) < eps) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const start = performance.now();
		const check = () => {
			if (
				Math.abs(window.innerWidth - targetCss.w) < eps &&
				Math.abs(window.innerHeight - targetCss.h) < eps
			) {
				resolve();
				return;
			}
			if (performance.now() - start > timeoutMs) {
				resolve(); // give up waiting; layout against the actual size below
				return;
			}
			requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
}

/**
 * Every resize is serialized. A toast `ResizeObserver` can fire while a native
 * resize is still waiting to land; dropping that re-entrant request was the
 * reason the desktop window stayed at its previous (too-short) height and
 * clipped the toast. A promise chain preserves *every* height change and runs
 * each request after the previous native resize is fully settled.
 */
let resizeChain: Promise<void> = Promise.resolve();

/** Apply one exact physical/CSS window size. */
async function applyWindowSizeOnce(app: Application, modelUrl: string): Promise<void> {
	const dpr = window.devicePixelRatio || 1;
	const win = windowPhysicalSize(modelUrl);
	const css = { w: win.w / dpr, h: win.h / dpr };
	// In Tauri, resize keeping the bottom edge fixed (model stays put); in a
	// plain browser tab this is a no-op (the window is the viewport).
	await safeInvoke(IPC.RESIZE_WINDOW_KEEP_BOTTOM, { w: win.w, h: win.h }).catch(() => {});
	await waitForNativeResize(css);
	app.renderer.resize(css.w, css.h);
	const view = app.view as HTMLCanvasElement;
	view.style.width = `${css.w}px`;
	view.style.height = `${css.h}px`;
	// Size the #stage container (the toast's positioning context) to match,
	// so the toast aligns to the canvas regardless of the viewport size.
	document.documentElement.style.setProperty('--stage-w', `${css.w}px`);
	document.documentElement.style.setProperty('--stage-h', `${css.h}px`);
}

/**
 * Size the window to the pet width + (pet height + current toast height),
 * keeping the **bottom edge fixed** so the model never moves. Calls are
 * serialized rather than dropped: if wrapping changes the toast height during
 * a native resize, the follow-up resize executes next and expands the window
 * top to the correct final height. That guarantees the full toast is inside
 * the desktop window rather than being clipped at its top edge.
 */
export function applyWindowSize(app: Application, modelUrl: string): Promise<void> {
	const run = () => applyWindowSizeOnce(app, modelUrl);
	resizeChain = resizeChain.then(run, run);
	return resizeChain;
}

/** Fade duration (ms) for the pet appear/disappear transition. */
const FADE_MS = 200;

/**
 * Animate the canvas CSS opacity from its current value to `to` over `FADE_MS`.
 * Uses the canvas element's `opacity` rather than `app.stage.alpha` because
 * pixi-live2d-display's `_render` draws the model via its own GL path and
 * bypasses Pixi's alpha, so stage/model alpha has no effect on Live2D output.
 */
export function fadeCanvas(canvas: HTMLCanvasElement, to: number): Promise<void> {
	return new Promise((resolve) => {
		const from = parseFloat(canvas.style.opacity || '1');
		if (Math.abs(from - to) < 0.001) {
			canvas.style.opacity = String(to);
			resolve();
			return;
		}
		const start = performance.now();
		const tick = () => {
			const t = Math.min(1, (performance.now() - start) / FADE_MS);
			// ease-out-expo, matching the Cirrus motion curve.
			const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
			canvas.style.opacity = String(from + (to - from) * eased);
			if (t >= 1) {
				resolve();
			} else {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
}

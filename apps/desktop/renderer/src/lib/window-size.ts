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
 * Per-model visible-extent cache, keyed by model3.json URL. The model's visible
 * bounds as fractions of the rendered canvas, so they stay correct when the
 * target size changes (proportional resize, no re-scan). Until the first scan
 * completes these are null and a default bubble area + canvas-centered layout
 * is used.
 */
interface VisExtent {
	topRatio: number;
	botRatio: number;
	leftRatio: number;
	rightRatio: number;
}
const visExtentCache = new Map<string, VisExtent>();

/** Record a model's scanned visible extent (called after the pixel scan). */
export function setVisExtent(
	modelUrl: string,
	topRatio: number,
	botRatio: number,
	leftRatio: number,
	rightRatio: number,
) {
	visExtentCache.set(modelUrl, { topRatio, botRatio, leftRatio, rightRatio });
}

/** Get a model's cached visible extent, or null if not scanned yet. */
export function getVisExtent(modelUrl: string): VisExtent | null {
	return visExtentCache.get(modelUrl) ?? null;
}

/**
 * The bubble area is the reserved space above the model where the toast floats,
 * driven by the toast's actual rendered height (via a ResizeObserver in
 * drag-drop.ts). Units are physical px (same as `targetSize`); `setToastHeight`
 * scales the toast's CSS-px height by DPR on the way in.
 */
const MIN_BUBBLE_AREA = 16;
/** Small gap between the bubble bottom and the model top (physical px). */
const BUBBLE_GAP = 6;
/**
 * Rendered height of every active bubble source, in physical px. The reserved
 * area must be the *largest* bubble across sources (not whichever
 * ResizeObserver fired last), so a hidden one-line toast doesn't shrink the
 * window below a visible multi-line toast.
 */
const toastHeights = new Map<string, number>();
let toastHeight = 0;

/**
 * Update one bubble source's height (called by its ResizeObserver). `h` is CSS
 * px, scaled to physical px. The reserved area is the max across sources.
 * Returns true only when that max changes, so callers relayout only then.
 */
export function setToastHeight(source: string, h: number): boolean {
	const dpr = window.devicePixelRatio || 1;
	toastHeights.set(source, Math.max(0, Math.round(h * dpr)));
	const next = Math.max(0, ...toastHeights.values());
	if (next === toastHeight) return false;
	toastHeight = next;
	return true;
}

/** The bubble area height (physical px): the toast's rendered height + a gap,
 * with a minimum. */
export function bubbleAreaHeight(_modelUrl: string): number {
	return Math.max(MIN_BUBBLE_AREA, toastHeight + BUBBLE_GAP);
}

/** The physical window size: pet width, pet height + the bubble area on top. */
export function windowPhysicalSize(modelUrl: string) {
	return { w: targetSize.w, h: targetSize.h + bubbleAreaHeight(modelUrl) };
}

/**
 * Wait until the native window's CSS size reaches `targetCss` (within 1px), or
 * `timeoutMs` elapses. On Windows, Tauri's `set_size` returns before the OS
 * has actually resized the window, so resizing the Pixi renderer immediately
 * would clip everything below the old canvas height.
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
 * Every resize is serialized via a promise chain. A toast ResizeObserver can
 * fire while a native resize is still waiting to land; a promise chain
 * preserves every height change and runs each after the previous native resize
 * has fully settled, so none is dropped (which previously clipped the toast).
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
 * Size the window keeping the bottom edge fixed so the model never moves.
 * Serialized so a toast-height change during a native resize isn't dropped.
 */
export function applyWindowSize(app: Application, modelUrl: string): Promise<void> {
	const run = () => applyWindowSizeOnce(app, modelUrl);
	resizeChain = resizeChain.then(run, run);
	return resizeChain;
}

/** Default fade duration (ms) for the pet appear/disappear transition. */
const FADE_MS = 200;

/**
 * Animate the canvas CSS opacity from its current value to `to` over `ms` ms
 * (default 200). Uses the canvas element's `opacity` rather than `app.stage.alpha`
 * because pixi-live2d-display's `_render` draws the model via its own GL path
 * and bypasses Pixi's alpha, so stage/model alpha has no effect on Live2D output.
 */
export function fadeCanvas(canvas: HTMLCanvasElement, to: number, ms = FADE_MS): Promise<void> {
	return new Promise((resolve) => {
		const from = parseFloat(canvas.style.opacity || '1');
		if (Math.abs(from - to) < 0.001) {
			canvas.style.opacity = String(to);
			resolve();
			return;
		}
		const start = performance.now();
		const tick = () => {
			const t = Math.min(1, (performance.now() - start) / ms);
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

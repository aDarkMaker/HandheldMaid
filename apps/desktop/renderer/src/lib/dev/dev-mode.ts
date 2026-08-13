/** Central Dev-mode controller.
 *
 * All debug overlays are off by default and toggled from the right-click menu.
 * The debug bubble contributes to the window height, so a toggle resizes the
 * window. The transition is staged so the resize is hidden inside an opaque gap:
 *
 *   0–1.5s    model fades fully OUT; debug UI hidden.
 *   1.5–2.5s  opaque gap: window resize + debug redraw while both invisible.
 *   2.5–4.0s  model AND the full debug UI fade IN together.
 */
import { listen } from '@tauri-apps/api/event';
import { EVENT } from '@handheld-maid/shared';
import { isTauri } from '../tauri';
import { fadeCanvas } from '../window-size';
import {
	createDebugBubble,
	destroyDebugBubble,
	onDebugResize,
	setDebugResizeEnabled,
} from './debug';
import { createDebugLine, destroyDebugLine } from './debug-line';
import { createDebugOverlay, destroyDebugOverlay } from './debug-overlay';
import { destroyDevContainer, ensureDevContainer, setDevOpacity } from './dev-container';

const FADE_OUT_MS = 1500;
const RESIZE_HOLD_MS = 1000;
const FADE_IN_MS = 1500;

let devMode = false;
let mounted = false;
let toggling = false;

/** Repaint callback: redraws the debug UI for the current layout; resolves only
 * after the window resize/layout has settled. */
let repaintCb: (() => Promise<void>) | null = null;

/** Current Dev-mode state (for layout code to gate debug draws). */
export function isDevMode(): boolean {
	return devMode;
}

function mountDebug() {
	if (mounted) return;
	ensureDevContainer();
	createDebugBubble();
	createDebugLine();
	createDebugOverlay();
	mounted = true;
}

function unmountDebug() {
	if (!mounted) return;
	destroyDebugOverlay();
	destroyDebugLine();
	destroyDebugBubble();
	destroyDevContainer();
	mounted = false;
}

function petCanvas(): HTMLCanvasElement | null {
	return document.getElementById('canvas') as HTMLCanvasElement | null;
}

function nextFrame(): Promise<void> {
	return new Promise<void>((r) => requestAnimationFrame(() => r()));
}

/** Wait `ms` so the opaque gap holds the full duration even if the resize
 * already settled. */
function hold(ms: number): Promise<void> {
	return new Promise<void>((r) => window.setTimeout(() => r(), ms));
}

/** Re-run the repaint until the window's inner height stops changing. The first
 * relayout fills the debug bubble with multi-line diag text; its ResizeObserver
 * then fires a second relayout to the full height. Draining ensures the bubble
 * is never clipped when it fades in. */
async function drainResizes() {
	let prev = window.innerHeight;
	for (let i = 0; i < 8; i++) {
		await nextFrame();
		await repaintCb?.();
		await nextFrame();
		if (window.innerHeight === prev) break;
		prev = window.innerHeight;
	}
}

/** Toggle Dev with a staged 4s transition. The resize runs inside an opaque gap
 * (both canvas and debug container transparent), then the model and complete
 * debug UI fade in together. On close, fade both out, shrink the window while
 * hidden, then restore the regular model. */
export async function setDevMode(on: boolean) {
	if (toggling || on === devMode) return;
	toggling = true;
	const canvas = petCanvas();
	try {
		if (on) {
			setDebugResizeEnabled(false);
			mountDebug();
			setDevOpacity(0);
			await fadeCanvas(canvas!, 0, FADE_OUT_MS);

			devMode = true;
			setDebugResizeEnabled(true);
			await repaintCb?.();
			await drainResizes();
			await hold(RESIZE_HOLD_MS);
			requestAnimationFrame(() => setDevOpacity(1));
			await fadeCanvas(canvas!, 1, FADE_IN_MS);
		} else {
			setDevOpacity(0);
			await fadeCanvas(canvas!, 0, FADE_OUT_MS);

			setDebugResizeEnabled(false);
			unmountDebug();
			await repaintCb?.();
			await nextFrame();
			await hold(RESIZE_HOLD_MS);
			devMode = false;
			setDebugResizeEnabled(true);
			await fadeCanvas(canvas!, 1, FADE_IN_MS);
		}
	} finally {
		toggling = false;
	}
}

/** Initialize Dev mode. `onRepaint` must await the full window resize/layout so
 * the transition keeps both scenes invisible until the final frame is ready. */
export async function initDevMode(onRepaint: () => Promise<void>) {
	repaintCb = onRepaint;
	onDebugResize(onRepaint);
	if (!isTauri) return;
	await listen<boolean>(EVENT.DEV_MODE_TOGGLED, (e) => {
		void setDevMode(!!e.payload);
	}).catch((e) => console.error('[HandheldMaid] dev-mode-toggled listener error:', e));
}

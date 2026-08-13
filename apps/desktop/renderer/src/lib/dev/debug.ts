/** DEBUG: a persistent bubble showing live layout diagnostics (Dev mode only).
 * Reuses the real toast's `.toast` styles and contributes to the window's
 * bubble-area height (via setToastHeight + a relayout callback), so its
 * multi-line text is never clipped. Refreshed on every `layoutModel` call. */
import { setToastHeight } from '../window-size';
import { ensureDevContainer } from './dev-container';

let debugEl: HTMLDivElement | null = null;
let debugResizeCb: (() => void | Promise<void>) | null = null;
let debugRO: ResizeObserver | null = null;
let debugResizeEnabled = true;

/** Register the relayout callback fired when the debug bubble height changes. */
export function onDebugResize(cb: () => void | Promise<void>) {
	debugResizeCb = cb;
}

/** Enable/disable debug-bubble-triggered relayouts. Height is always recorded;
 * disabling only blocks the ResizeObserver callback so it can't resize the
 * window partway through the Dev-mode fade transition. */
export function setDebugResizeEnabled(enabled: boolean) {
	debugResizeEnabled = enabled;
}

/** Destroy the debug bubble and clear its toast-height contribution. */
export function destroyDebugBubble() {
	if (debugRO) { debugRO.disconnect(); debugRO = null; }
	if (debugEl) { debugEl.remove(); debugEl = null; }
	setToastHeight('debug', 0);
	if (debugResizeEnabled) void debugResizeCb?.();
}

/** Create the debug bubble (once). */
export function createDebugBubble() {
	if (debugEl) return;
	debugEl = document.createElement('div');
	debugEl.className = 'toast toast--visible';
	debugEl.setAttribute('aria-hidden', 'true');
	debugEl.style.maxWidth = '92%';
	debugEl.style.whiteSpace = 'normal';
	debugEl.style.wordBreak = 'break-word';
	debugEl.style.fontSize = '10px';
	debugEl.style.lineHeight = '1.35';
	debugEl.style.left = '4%';
	debugEl.style.right = '4%';
	debugEl.style.zIndex = '210';
	debugEl.textContent = '…';
	ensureDevContainer().appendChild(debugEl);
	debugRO = new ResizeObserver(() => {
		if (debugEl && setToastHeight('debug', debugEl.offsetHeight) && debugResizeEnabled) {
			void debugResizeCb?.();
		}
	});
	debugRO.observe(debugEl);
	setToastHeight('debug', debugEl.offsetHeight);
}

/** Update the debug bubble text (live, on every layout). */
export function setDebugText(s: string) {
	if (debugEl) debugEl.textContent = s;
}

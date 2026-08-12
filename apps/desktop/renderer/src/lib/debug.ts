/**
 * DEBUG: a persistent on-screen bubble that shows live layout diagnostics. It's
 * refreshed on every `layoutModel` call (not via `positionBubble`), so the
 * numbers always reflect the *current* model — previous versions wrote debug
 * text only into a global that `positionBubble` read, which was never re-run on
 * model switch, so switching to miku still showed wanko's stale numbers.
 *
 * It also drives the bubble-area sizing (via setToastHeight + a relayout
 * callback registered by main.ts) so the debug bubble itself gets the same
 * dynamic top-expansion as the real toast — otherwise the multi-line debug text
 * would be clipped and the layout under test wouldn't match the real-toast
 * behavior.
 *
 * Remove this module (and its call sites) once the layout is verified.
 */
import { setToastHeight } from './window-size';

let debugEl: HTMLDivElement | null = null;
let debugResizeCb: (() => void) | null = null;

/** Register the relayout callback fired when the debug bubble height changes. */
export function onDebugResize(cb: () => void) {
	debugResizeCb = cb;
}

/** Create the persistent debug bubble (once). */
export function createDebugBubble() {
	if (debugEl) return;
	debugEl = document.createElement('div');
	debugEl.className = 'toast toast--visible';
	debugEl.setAttribute('role', 'status');
	debugEl.setAttribute('aria-label', 'layout debug');
	debugEl.style.maxWidth = '92%';
	debugEl.style.whiteSpace = 'normal';
	debugEl.style.wordBreak = 'break-word';
	debugEl.style.fontSize = '10px';
	debugEl.style.lineHeight = '1.35';
	debugEl.style.left = '4%';
	debugEl.style.right = '4%';
	debugEl.textContent = '…';
	// Append to #stage (the toast's positioning context) so the debug bubble
	// aligns to the pet canvas like the real toast, not the browser viewport.
	(document.getElementById('stage') ?? document.body).appendChild(debugEl);
	// Drive the bubble-area sizing from the debug bubble's height, so the
	// multi-line debug text expands the window top like the real toast would.
	const ro = new ResizeObserver(() => {
		if (debugEl && setToastHeight('debug', debugEl.offsetHeight)) {
			debugResizeCb?.();
		}
	});
	ro.observe(debugEl);
	setToastHeight('debug', debugEl.offsetHeight);
}

/** Update the debug bubble text (live, on every layout). */
export function setDebugText(s: string) {
	if (debugEl) debugEl.textContent = s;
}

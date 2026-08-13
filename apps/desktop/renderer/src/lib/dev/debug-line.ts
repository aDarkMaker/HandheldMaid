/**
 * DEBUG: a red horizontal line marking the model's *visible top* (the scan-
 * derived visTop), so we can see exactly where the layout thinks the model
 * starts (shown only in Dev mode).
 */
import { ensureDevContainer } from './dev-container';

let lineEl: HTMLDivElement | null = null;

/** Destroy the red debug line (remove from DOM, drop the ref). */
export function destroyDebugLine() {
	if (lineEl) { lineEl.remove(); lineEl = null; }
}

/** Create the red debug line (once), appended to the dev container. */
export function createDebugLine() {
	if (lineEl) return;
	lineEl = document.createElement('div');
	lineEl.setAttribute('aria-hidden', 'true');
	lineEl.style.position = 'absolute';
	lineEl.style.left = '0';
	lineEl.style.right = '0';
	lineEl.style.height = '2px';
	lineEl.style.background = '#ff0033';
	lineEl.style.zIndex = '200';
	lineEl.style.pointerEvents = 'none';
	lineEl.style.top = '-9999px'; // off-screen until positioned
	ensureDevContainer().appendChild(lineEl);
}

/**
 * Position the red line at the model's visible top. `visTopCss` is the visible
 * top in CSS px from the #stage top. The line spans the full stage width so the
 * gap between the line and the actual model pixels is obvious.
 */
export function positionDebugLine(visTopCss: number | null) {
	if (!lineEl) return;
	if (visTopCss == null) {
		lineEl.style.top = '-9999px';
		return;
	}
	lineEl.style.top = `${visTopCss}px`;
}

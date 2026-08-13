/**
 * DEBUG: a red horizontal line marking the model's *visible top* (the scan-
 * derived visTop), so we can see exactly where the layout thinks the model
 * starts. Reveals whether the "空白" (gap above the model) is because visTop is
 * too high (the scan picked up transparent canvas) or the model is positioned
 * too low.
 *
 * Remove this module (and its call sites) once the layout is verified.
 */

let lineEl: HTMLDivElement | null = null;

/** Create the red debug line (once), appended to #stage so it aligns to the
 * pet canvas like the toast. */
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
	(document.getElementById('stage') ?? document.body).appendChild(lineEl);
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

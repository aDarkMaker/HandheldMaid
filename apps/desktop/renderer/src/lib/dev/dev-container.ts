/** Shared container for all Dev-mode overlays. A single `#hm-dev` div lets one
 * `opacity` transition fade the whole debug UI in/out together. */

let containerEl: HTMLDivElement | null = null;

/** Create the `#hm-dev` container (once), appended to #stage. */
export function ensureDevContainer(): HTMLElement {
	if (containerEl) return containerEl;
	containerEl = document.createElement('div');
	containerEl.id = 'hm-dev';
	containerEl.setAttribute('aria-hidden', 'true');
	containerEl.style.position = 'absolute';
	containerEl.style.left = '0';
	containerEl.style.top = '0';
	containerEl.style.right = '0';
	containerEl.style.bottom = '0';
	containerEl.style.pointerEvents = 'none';
	containerEl.style.zIndex = '150';
	containerEl.style.opacity = '0';
	containerEl.style.transition = 'opacity 1.5s ease';
	(document.getElementById('stage') ?? document.body).appendChild(containerEl);
	return containerEl;
}

/** Remove the container (and thus all debug elements) from the DOM. */
export function destroyDevContainer() {
	if (containerEl) { containerEl.remove(); containerEl = null; }
}

/** Set the debug UI opacity (animated via the container's CSS transition). */
export function setDevOpacity(o: number) {
	if (containerEl) containerEl.style.opacity = String(o);
}

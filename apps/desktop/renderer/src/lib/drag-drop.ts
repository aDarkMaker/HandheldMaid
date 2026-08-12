import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { ArchiveResult } from '@handheld-maid/shared';
import { EVENT, IPC } from '@handheld-maid/shared';
import { isTauri } from './tauri';
import { currentModelUrl } from './model';
import { setToastHeight, targetSize } from './window-size';

/** The #stage element (the fixed-size pet window container); null until found. */
function stage(): HTMLElement | null {
	return document.getElementById('stage');
}

/** basename of a path, cross-platform (handles both / and \). */
function basename(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/');
	return parts[parts.length - 1] || p;
}

/**
 * Callback invoked when the toast's rendered height changes (via
 * ResizeObserver). Set by main.ts to enlarge/shrink the window's *top area*
 * while the model stays bottom-anchored. Keeps the toast from ever overlapping
 * or clipping against the model regardless of how many lines it wraps to.
 */
let bubbleResizeCb: (() => void) | null = null;

/** Register the relayout callback fired when the toast height changes. */
export function onBubbleResize(cb: () => void) {
	bubbleResizeCb = cb;
}

/** Create the speech-bubble toast element and return a `show` function. */
function createToast(): (message: string, persistent?: boolean) => void {
	const toast = document.createElement('div');
	toast.className = 'toast';
	toast.setAttribute('role', 'status');
	toast.setAttribute('aria-live', 'polite');
	// Append to #stage (the toast's positioning context) so the bubble aligns
	// to the pet canvas, not the browser viewport (which differs from the
	// desktop window and would misplace the bubble in a plain browser tab).
	(stage() ?? document.body).appendChild(toast);
	let toastTimer: number | undefined;

	// Watch the toast's rendered height. When it changes (e.g. text wraps to
	// more/fewer lines), update the tracked bubble height and relayout so the
	// model always sits just below the toast — the toast never overlaps or
	// clips the model, no matter how tall it gets.
	const ro = new ResizeObserver(() => {
		if (setToastHeight('archive', toast.offsetHeight)) {
			bubbleResizeCb?.();
		}
	});
	ro.observe(toast);
	// Seed the tracked height from the initial (empty) toast.
	setToastHeight('archive', toast.offsetHeight);

	return (message: string, persistent = false) => {
		toast.textContent = message;
		toast.classList.add('toast--visible');
		if (toastTimer !== undefined) window.clearTimeout(toastTimer);
		// Persistent toasts (e.g. "Processing…") stay until the next show() call
		// replaces them; non-persistent auto-dismiss after 2.5s.
		if (!persistent) {
			toastTimer = window.setTimeout(() => toast.classList.remove('toast--visible'), 2500);
		}
	};
}

/**
 * Position the bubble by its *bottom*, anchored just above the model's top.
 * The model is bottom-anchored (stays put when the bubble grows); the bubble
 * grows upward and the window top rises to make room, so a taller bubble never
 * overlaps the model or gets clipped. `--bubble-bottom` is the distance from
 * the #stage bottom to the bubble's bottom = the model's height (targetSize.h)
 * + a small gap (the model top sits `targetSize.h` above the stage bottom).
 * Relative to #stage (not the viewport) so it aligns to the pet in both
 * browser and desktop. `topY` is ignored/kept for API compatibility.
 */
export function positionBubble(_topY: number | null) {
	const dpr = window.devicePixelRatio || 1;
	const gap = 4; // small gap between the bubble bottom and the model top
	// Model top is targetSize.h above the stage bottom (bottom-anchored). The
	// bubble bottom sits `gap` above it.
	const bottom = Math.round(targetSize.h / dpr) + gap;
	document.documentElement.style.setProperty('--bubble-bottom', `${bottom}px`);
}

/**
 * Wire drag-drop archive: drop a folder to compress it, drop an archive to
 * extract it. Uses the Tauri webview drag-drop event (HTML5 drop is disabled
 * by Tauri's native drag-drop) which yields real file paths. Results are shown
 * as a speech-bubble toast above the pet.
 */
export async function wireDragDrop() {
	if (!isTauri) return;
	const showToast = createToast();

	// Show the result of a drag-drop archive operation as a toast. Keep the
	// text short — the pet window is small, so only the basename is shown.
	await listen<ArchiveResult>(EVENT.ARCHIVE_RESULT, (e) => {
		const r = e.payload;
		if (r.ok) {
			const out = r.result?.output ?? '';
			const verb = r.action === 'compress' ? 'Compressed' : 'Extracted';
			showToast(out ? `${verb}: ${basename(out)}` : verb);
		} else {
			// Trim long errors to fit the small bubble.
			const msg = (r.error ?? 'Archive failed').split('\n')[0];
			showToast(msg.length > 40 ? msg.slice(0, 37) + '…' : msg);
		}
	}).catch((e) => console.error('[HandheldMaid] archive-result listener error:', e));

	// Tauri webview drag-drop: fire on `drop` with the dropped file paths.
	const webview = getCurrentWebview();
	webview.onDragDropEvent((event) => {
		if (event.payload.type !== 'drop') return;
		const paths = event.payload.paths;
		if (!paths || paths.length === 0) return;
		// Only the first dropped item is handled. Show "Processing…" persistently
		// so it stays until the result event replaces it (no 2.5s auto-dismiss gap).
		showToast('Processing…', true);
		void invoke(IPC.HANDLE_DROP, { path: paths[0] }).catch((err) => showToast(`Failed: ${err}`));
	});
}

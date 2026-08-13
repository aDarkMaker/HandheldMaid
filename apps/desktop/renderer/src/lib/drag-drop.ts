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
 * ResizeObserver), so the window's top area can grow/shrink while the model
 * stays bottom-anchored.
 */
let bubbleResizeCb: (() => void) | null = null;

/** When true, toast-height changes are ignored (no relayout). Used during the
 * pixel scan so the framebuffer is stable. */
let bubbleResizePaused = false;

/** Pause toast-height-driven relayouts (e.g. during the pixel scan). */
export function pauseBubbleResize() {
	bubbleResizePaused = true;
}

/** Resume toast-height-driven relayouts and fire one if the height changed
 * while paused (so a missed change isn't dropped). */
export function resumeBubbleResize() {
	bubbleResizePaused = false;
	bubbleResizeCb?.();
}

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
	// to the pet canvas, not the browser viewport.
	(stage() ?? document.body).appendChild(toast);
	let toastTimer: number | undefined;

	// Watch the toast's rendered height; when it changes, update the tracked
	// bubble height and relayout so the toast never overlaps or clips the model.
	const ro = new ResizeObserver(() => {
		if (bubbleResizePaused) return;
		if (setToastHeight('archive', toast.offsetHeight)) {
			bubbleResizeCb?.();
		}
	});
	ro.observe(toast);
	setToastHeight('archive', toast.offsetHeight);

	return (message: string, persistent = false) => {
		toast.textContent = message;
		toast.classList.add('toast--visible');
		if (toastTimer !== undefined) window.clearTimeout(toastTimer);
		// Persistent toasts stay until the next show() replaces them; others
		// auto-dismiss after 2.5s.
		if (!persistent) {
			toastTimer = window.setTimeout(() => toast.classList.remove('toast--visible'), 2500);
		}
	};
}

/**
 * Position the bubble by its bottom, anchored just above the model's visible
 * top (visTop). `layoutModel` publishes visTop via the `--vis-top-css` custom
 * property (CSS px from the #stage top); read it here so this module doesn't
 * need a live model reference. Falls back to targetSize.h before the first
 * scan. `topY` is ignored (kept for API compatibility).
 */
export function positionBubble(_topY: number | null) {
	const dpr = window.devicePixelRatio || 1;
	const gap = 4;
	const stageH = (stage()?.offsetHeight ?? window.innerHeight);
	const root = document.documentElement;
	const published = getComputedStyle(root).getPropertyValue('--vis-top-css').trim();
	const visTopCss = published ? parseFloat(published) : stageH - targetSize.h / dpr;
	const bottom = Math.max(0, Math.round(stageH - visTopCss + gap));
	root.style.setProperty('--bubble-bottom', `${bottom}px`);
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

	// Show the result of a drag-drop archive operation as a toast. Keep the text
	// short — the pet window is small, so only the basename is shown.
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
		// so it stays until the result event replaces it.
		showToast('Processing…', true);
		void invoke(IPC.HANDLE_DROP, { path: paths[0] }).catch((err) => showToast(`Failed: ${err}`));
	});
}

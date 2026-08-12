import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import { IPC } from '@handheld-maid/shared';
import { safeInvoke } from './tauri';
import { updateHitArea } from './model';

/**
 * Drag-to-move: left button down on the pet moves the window. Uses absolute
 * screen coordinates derived from a grabbed offset, so the move can't drift
 * from accumulated increments or out-of-order async invokes.
 */
export function wireDragToMove(canvas: HTMLCanvasElement, _app: Application, model: Live2DModel) {
	const dpr = window.devicePixelRatio || 1;
	let dragging = false;
	let grabX = 0;
	let grabY = 0;
	canvas.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return;
		dragging = true;
		// Offset of the grab point relative to the window's top-left.
		grabX = e.clientX;
		grabY = e.clientY;
	});
	window.addEventListener('mousemove', (e) => {
		if (!dragging) return;
		// Desired window top-left (logical px) keeps the grab point under the
		// cursor; convert to physical px to match the backend's set_position.
		const wx = Math.round((e.screenX - grabX) * dpr);
		const wy = Math.round((e.screenY - grabY) * dpr);
		void safeInvoke(IPC.MOVE_WINDOW, { x: wx, y: wy }).catch(() => {});
		// Keep the hit area in sync as the window moves.
		updateHitArea(model);
	});
	// Reset drag on any button release, blur, or visibility change — covers a
	// missed mouseup when the window was hidden mid-drag.
	const stopDrag = () => {
		dragging = false;
	};
	window.addEventListener('mouseup', stopDrag);
	window.addEventListener('blur', stopDrag);
	window.addEventListener('mouseleave', stopDrag);
	document.addEventListener('visibilitychange', stopDrag);
}

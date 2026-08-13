/** DEBUG: layout/interaction overlay (Dev mode only):
 * 1. Grid ruler (every 50px major / 10px minor).
 * 2. Yellow rect = the interactive hit area.
 * 3. Blue rect = the model's visible bounds (visibleBounds).
 * 4. Purple pixel map = where the framebuffer scan found non-transparent pixels.
 *
 * All overlays live in the #hm-dev container and never capture pointer events. */
import { ensureDevContainer } from './dev-container';

let gridEl: HTMLDivElement | null = null;
let hitRectEl: HTMLDivElement | null = null;
let modelRectEl: HTMLDivElement | null = null;
let pixelMapEl: HTMLCanvasElement | null = null;

/** Destroy the debug overlay elements (remove from DOM, drop refs). */
export function destroyDebugOverlay() {
	if (gridEl) { gridEl.remove(); gridEl = null; }
	if (hitRectEl) { hitRectEl.remove(); hitRectEl = null; }
	if (modelRectEl) { modelRectEl.remove(); modelRectEl = null; }
	if (pixelMapEl) { pixelMapEl.remove(); pixelMapEl = null; }
}

/** Create the debug overlay elements (once). */
export function createDebugOverlay() {
	if (gridEl) return;
	const stage = ensureDevContainer();

	// 1. Grid ruler — an SVG background on a full-stage div.
	gridEl = document.createElement('div');
	gridEl.setAttribute('aria-hidden', 'true');
	gridEl.style.position = 'absolute';
	gridEl.style.left = '0';
	gridEl.style.top = '0';
	gridEl.style.right = '0';
	gridEl.style.bottom = '0';
	gridEl.style.pointerEvents = 'none';
	gridEl.style.zIndex = '150';
	stage.appendChild(gridEl);

	// 2. Hit-area rect (fluorescent yellow).
	hitRectEl = mkRect('rgba(255, 230, 0, 0.25)', '#ffe600', '2px solid #ffe600');
	stage.appendChild(hitRectEl);

	// 3. Model-bounds rect (fluorescent blue).
	modelRectEl = mkRect('rgba(0, 200, 255, 0.18)', '#00c8ff', '2px dashed #00c8ff');
	stage.appendChild(modelRectEl);

	// 4. Pixel map (purple) — the model's true rendered footprint at 1px
	//    resolution. If the purple doesn't match the visible model, the scan is
	//    reading the wrong data.
	pixelMapEl = document.createElement('canvas');
	pixelMapEl.setAttribute('aria-hidden', 'true');
	pixelMapEl.style.position = 'absolute';
	pixelMapEl.style.left = '0';
	pixelMapEl.style.top = '0';
	pixelMapEl.style.pointerEvents = 'none';
	pixelMapEl.style.zIndex = '155';
	pixelMapEl.style.opacity = '0.5';
	pixelMapEl.style.display = 'none';
	stage.appendChild(pixelMapEl);
}

function mkRect(bg: string, labelColor: string, border: string): HTMLDivElement {
	const el = document.createElement('div');
	el.setAttribute('aria-hidden', 'true');
	el.style.position = 'absolute';
	el.style.pointerEvents = 'none';
	el.style.zIndex = '160';
	el.style.background = bg;
	el.style.border = border;
	el.style.boxSizing = 'border-box';
	el.style.display = 'none';
	// Label (top-left) so it's clear which rect is which.
	const label = document.createElement('span');
	label.style.position = 'absolute';
	label.style.left = '2px';
	label.style.top = '-14px';
	label.style.font = '10px/1 monospace';
	label.style.color = labelColor;
	label.style.whiteSpace = 'nowrap';
	el.appendChild(label);
	return el;
}

/** Repaint the grid ruler for the current stage size. */
function paintGrid() {
	if (!gridEl) return;
	const w = gridEl.clientWidth;
	const h = gridEl.clientHeight;
	if (w <= 0 || h <= 0) return;
	const minor = 10;
	const major = 50;
	let lines = '';
	// Vertical lines.
	for (let x = 0; x <= w; x += minor) {
		const isMajor = x % major === 0;
		lines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${isMajor ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'}" stroke-width="1"/>`;
	}
	// Horizontal lines.
	for (let y = 0; y <= h; y += minor) {
		const isMajor = y % major === 0;
		lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${isMajor ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'}" stroke-width="1"/>`;
	}
	// Major-line labels (every 50px).
	let text = '';
	for (let x = major; x <= w; x += major) {
		text += `<text x="${x + 1}" y="10" fill="rgba(255,255,255,0.5)" font-size="9" font-family="monospace">${x}</text>`;
	}
	for (let y = major; y <= h; y += major) {
		text += `<text x="2" y="${y - 1}" fill="rgba(255,255,255,0.5)" font-size="9" font-family="monospace">${y}</text>`;
	}
	gridEl.innerHTML = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${lines}${text}</svg>`;
}

/**
 * Update the hit-area overlay (yellow). `rect` is the hit area in CSS px
 * relative to the #stage top-left (window-relative), or null to hide it.
 */
export function showHitAreaRect(rect: { x: number; y: number; w: number; h: number } | null) {
	if (!hitRectEl) return;
	if (!rect || rect.w <= 0 || rect.h <= 0) {
		hitRectEl.style.display = 'none';
		return;
	}
	hitRectEl.style.display = 'block';
	hitRectEl.style.left = `${rect.x}px`;
	hitRectEl.style.top = `${rect.y}px`;
	hitRectEl.style.width = `${rect.w}px`;
	hitRectEl.style.height = `${rect.h}px`;
	const label = hitRectEl.querySelector('span');
	if (label) label.textContent = `hit ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}×${Math.round(rect.h)}`;
}

/**
 * Update the model-bounds overlay (blue). `rect` is the model's getBounds in
 * CSS px relative to the #stage top-left, or null to hide it.
 */
export function showModelBoundsRect(rect: { x: number; y: number; w: number; h: number } | null) {
	if (!modelRectEl) return;
	if (!rect || rect.w <= 0 || rect.h <= 0) {
		modelRectEl.style.display = 'none';
		return;
	}
	modelRectEl.style.display = 'block';
	modelRectEl.style.left = `${rect.x}px`;
	modelRectEl.style.top = `${rect.y}px`;
	modelRectEl.style.width = `${rect.w}px`;
	modelRectEl.style.height = `${rect.h}px`;
	const label = modelRectEl.querySelector('span');
	if (label) label.textContent = `model ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}×${Math.round(rect.h)}`;
}

/**
 * Draw the framebuffer pixel map (purple) — every non-transparent pixel the
 * scan found, at device-px resolution. `pixels` is the RGBA Uint8Array from
 * `extract.pixels()`, `devW`/`devH` its device dimensions, `alphaThresh` the
 * cutoff. `resolution` is the renderer's density (its `renderer.resolution`).
 *
 * IMPORTANT: `devW`/`devH` are `renderer.width × renderer.resolution`, i.e. the
 * renderer's *own* density — not necessarily `window.devicePixelRatio`. Using
 * window DPR here would mis-scale the overlay on displays where the two differ
 * (e.g. moving between 100%/125%/150% scaling), so the purple map drifts from
 * the model while the CSS-absolute rects (red/blue/yellow) stay correct. We
 * must use the same `resolution` the buffer was read at.
 */
export function showPixelMap(
	pixels: Uint8Array,
	devW: number,
	devH: number,
	alphaThresh: number,
	resolution: number,
) {
	if (!pixelMapEl) return;
	// The pixel buffer is device px at `resolution`. Set the canvas backing store
	// to those device px and size it on screen in CSS px — devW/resolution — so it
	// aligns 1:1 with the renderer canvas at the renderer's own resolution.
	const res = resolution || 1;
	const cssW = devW / res;
	const cssH = devH / res;
	pixelMapEl.width = devW;
	pixelMapEl.height = devH;
	pixelMapEl.style.width = `${cssW}px`;
	pixelMapEl.style.height = `${cssH}px`;
	pixelMapEl.style.display = 'block';
	const ctx = pixelMapEl.getContext('2d');
	if (!ctx) return;
	const img = ctx.createImageData(devW, devH);
	const out = img.data;
	// extract.pixels() reads the WebGL framebuffer bottom-up (GL origin is
	// bottom-left), but the DOM canvas is top-down. Flip vertically: framebuffer
	// row y (from bottom) = display row (devH-1-y) (from top).
	for (let y = 0; y < devH; y++) {
		const srcRow = (devH - 1 - y) * devW * 4;
		const dstRow = y * devW * 4;
		for (let x = 0; x < devW; x++) {
			const a = pixels[srcRow + x * 4 + 3];
			if (a > alphaThresh) {
				// Purple.
				out[dstRow + x * 4] = 200;
				out[dstRow + x * 4 + 1] = 0;
				out[dstRow + x * 4 + 2] = 255;
				out[dstRow + x * 4 + 3] = a;
			} else {
				out[dstRow + x * 4 + 3] = 0;
			}
		}
	}
	ctx.putImageData(img, 0, 0);
}

/** Hide the pixel map (e.g. when no scan data is available). */
export function hidePixelMap() {
	if (pixelMapEl) pixelMapEl.style.display = 'none';
}

/** Refresh the grid + overlays (call on every layout / window resize). */
export function refreshDebugOverlay() {
	paintGrid();
}

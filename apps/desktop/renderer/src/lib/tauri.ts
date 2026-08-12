/// <reference types="vite/client" />

import { invoke } from '@tauri-apps/api/core';
import * as PIXI from 'pixi.js';

/**
 * True when running inside a real Tauri webview. When false (e.g. opening the
 * dev URL in a plain browser tab), Tauri IPC is unavailable so we gracefully
 * degrade to model-only rendering instead of throwing on undefined internals.
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** invoke wrapper that no-ops outside Tauri so the renderer still loads in a browser. */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
	if (!isTauri) return undefined;
	return invoke<T>(cmd, args);
}

// pixi-live2d-display (cubism4) expects a global PIXI and a global
// Live2DCubismCore (loaded via <script> in index.html).
declare global {
	interface Window {
		PIXI: typeof PIXI;
		Live2DCubismCore?: unknown;
	}
}

/** Resolve once the Cubism Core global is available (loaded in index.html). */
export function waitForCubismCore(timeoutMs = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		if (window.Live2DCubismCore) return resolve();
		const start = performance.now();
		const id = setInterval(() => {
			if (window.Live2DCubismCore) {
				clearInterval(id);
				resolve();
			} else if (performance.now() - start > timeoutMs) {
				clearInterval(id);
				reject(new Error('Live2DCubismCore not loaded (check /live2dcubismcore.min.js)'));
			}
		}, 16);
	});
}

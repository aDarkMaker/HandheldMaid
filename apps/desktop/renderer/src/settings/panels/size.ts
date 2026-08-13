/** Size panel: pet on-screen size slider. */

import { invoke } from '@tauri-apps/api/core';
import { IPC, type ModelInfo } from '@handheld-maid/shared';
import { showToast, wireSlider } from '../ui';

export async function wireSize() {
	const value = document.getElementById('size-value')!;
	const input = document.getElementById('size-slider') as HTMLInputElement | null;
	if (!input) return;

	// Mirror the persisted size into the slider (physical px side).
	try {
		const [w] = await invoke<[number, number]>(IPC.GET_PET_SIZE);
		input.value = String(w);
		value.textContent = `${w}px`;
	} catch {
		/* fall back to the default shown in the markup */
	}

	wireSlider(
		'size-slider-wrap',
		'size-slider',
		(v) => {
			value.textContent = `${v}px`;
		},
		async (v) => {
			showToast('Applying size…');
			try {
				await invoke<ModelInfo>(IPC.SET_PET_SIZE, { w: v, h: v });
				showToast(`Size set to ${v}px`, 'ok');
			} catch (e) {
				showToast(`Failed: ${e}`, 'error');
			}
		},
	);
}

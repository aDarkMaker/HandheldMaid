/** Input-actions panel: click/keyboard triggers + cooldown slider. */

import { invoke } from '@tauri-apps/api/core';
import { IPC, type InputActionSettings } from '@handheld-maid/shared';
import { showToast, wireSlider } from '../ui';

export async function wireInputActions() {
	const clickToggle = document.getElementById('click-toggle') as HTMLInputElement | null;
	const keyboardToggle = document.getElementById('keyboard-toggle') as HTMLInputElement | null;
	const cooldownValue = document.getElementById('cooldown-value')!;
	const cooldownInput = document.getElementById('cooldown-slider') as HTMLInputElement | null;
	if (!clickToggle || !keyboardToggle || !cooldownInput) return;

	// Load current settings into the controls.
	let current: InputActionSettings;
	try {
		current = await invoke<InputActionSettings>(IPC.GET_INPUT_ACTION_SETTINGS);
	} catch {
		current = { keyboard_enabled: true, click_enabled: true, cooldown_ms: 30_000 };
	}
	clickToggle.checked = current.click_enabled;
	keyboardToggle.checked = current.keyboard_enabled;
	cooldownInput.value = String(Math.round(current.cooldown_ms / 1000));
	cooldownValue.textContent = `${cooldownInput.value}s`;

	const apply = async () => {
		showToast('Applying…');
		try {
			await invoke(IPC.SET_INPUT_ACTION_SETTINGS, {
				keyboard_enabled: keyboardToggle.checked,
				click_enabled: clickToggle.checked,
				cooldown_ms: Number(cooldownInput.value) * 1000,
			});
			showToast('Saved', 'ok');
		} catch (e) {
			showToast(`Failed: ${e}`, 'error');
		}
	};

	clickToggle.addEventListener('change', apply);
	keyboardToggle.addEventListener('change', apply);
	wireSlider(
		'cooldown-slider-wrap',
		'cooldown-slider',
		(v) => {
			cooldownValue.textContent = `${v}s`;
		},
		apply,
	);
}

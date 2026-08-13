/** Drag-drop archive panel: enable/disable compress/extract on drop. */

import { invoke } from '@tauri-apps/api/core';
import { IPC, type ArchiveSettings } from '@handheld-maid/shared';
import { showToast } from '../ui';

export async function wireArchive() {
	const toggle = document.getElementById('archive-toggle') as HTMLInputElement | null;
	if (!toggle) return;
	try {
		const s = await invoke<ArchiveSettings>(IPC.GET_ARCHIVE_SETTINGS);
		toggle.checked = s.enabled;
	} catch {
		toggle.checked = true;
	}
	toggle.addEventListener('change', async () => {
		showToast('Applying…');
		try {
			await invoke(IPC.SET_ARCHIVE_SETTINGS, { enabled: toggle.checked });
			showToast(toggle.checked ? 'Drag-drop archive enabled' : 'Drag-drop archive disabled', 'ok');
		} catch (e) {
			showToast(`Failed: ${e}`, 'error');
		}
	});
}

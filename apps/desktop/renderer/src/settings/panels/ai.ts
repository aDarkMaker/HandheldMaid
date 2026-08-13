/** AI-mode panel: placeholder toggle (coming soon). */

import { showToast } from '../ui';

export function wireAiToggle() {
	const toggle = document.getElementById('ai-toggle') as HTMLInputElement | null;
	if (!toggle) return;
	toggle.addEventListener('change', () => {
		showToast(toggle.checked ? 'AI mode is coming soon — setting saved.' : 'AI mode disabled.');
		// Reflect the not-yet-implemented state by unchecking after feedback.
		if (toggle.checked) {
			window.setTimeout(() => {
				toggle.checked = false;
			}, 1200);
		}
	});
}

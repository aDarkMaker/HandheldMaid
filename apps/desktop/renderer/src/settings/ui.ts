/** Shared UI helpers for the settings panels: toast, custom slider wiring, escape. */

type ToastKind = 'info' | 'ok' | 'error';
let toastTimer: number | undefined;

/** Show a transient toast above the settings cards. Auto-dismisses after 2.5s. */
export function showToast(message: string, kind: ToastKind = 'info') {
	const toast = document.getElementById('toast');
	if (!toast) return;
	toast.textContent = message;
	toast.className = `toast toast--${kind} toast--visible`;
	if (toastTimer !== undefined) window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => {
		toast.classList.remove('toast--visible');
	}, 2500);
}

/** Sync a custom slider's fill/thumb position from its native range input. */
function syncSliderPct(wrap: HTMLElement, input: HTMLInputElement) {
	const min = Number(input.min);
	const max = Number(input.max);
	const pct = ((Number(input.value) - min) / (max - min)) * 100;
	wrap.style.setProperty('--pct', `${pct}%`);
}

/** Wire a custom slider: keep --pct in sync on input, call onChange on release. */
export function wireSlider(
	wrapId: string,
	inputId: string,
	onInput: (v: number) => void,
	onChange: (v: number) => void | Promise<void>,
) {
	const wrap = document.getElementById(wrapId) as HTMLElement | null;
	const input = document.getElementById(inputId) as HTMLInputElement | null;
	if (!wrap || !input) return;
	syncSliderPct(wrap, input);
	input.addEventListener('input', () => {
		syncSliderPct(wrap, input);
		onInput(Number(input.value));
	});
	input.addEventListener('change', () => {
		void onChange(Number(input.value));
	});
}

/** Escape a string for safe insertion into HTML attribute/element content. */
export function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

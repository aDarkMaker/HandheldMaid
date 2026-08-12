/// <reference types="vite/client" />

import { invoke } from '@tauri-apps/api/core';
import { IPC, type ArchiveSettings, type InputActionSettings, type ModelInfo } from '@handheld-maid/shared';
import './styles/settings.css';

/**
 * Settings window entry. Independent of the main pet window — no Pixi/Live2D
 * here. Renders Cirrus-styled controls for model selection, size, input
 * actions, and an AI-mode toggle placeholder.
 */

const root = document.getElementById('app')!;

function renderShell() {
	root.innerHTML = `
		<div class="toast" id="toast" role="status" aria-live="polite"></div>
		<main class="settings">
			<h1 class="settings__title">HandheldMaid</h1>
			<p class="settings__subtitle">Settings</p>

			<section class="section" id="model-section">
				<label class="section__label">Model</label>
				<p class="section__desc">Choose the Live2D model shown on the desktop.</p>
				<div class="opt-group" id="model-list"></div>
			</section>

			<section class="section">
				<label class="section__label">Size</label>
				<p class="section__desc">Adjust the pet's on-screen size.</p>
				<div class="field-row">
					<span class="field-row__label">Scale</span>
					<div class="slider" id="size-slider-wrap">
						<input type="range" id="size-slider" min="200" max="1000" step="25" value="400" />
						<span class="slider__track"></span>
						<span class="slider__fill"></span>
						<span class="slider__thumb"></span>
					</div>
					<span class="slider__value" id="size-value">400px</span>
				</div>
			</section>

			<section class="section">
				<label class="section__label">Input Actions</label>
				<p class="section__desc">Random actions triggered by clicking or typing. Click always fires; typing fires rarely with a cooldown.</p>
				<div class="toggle-row">
					<span class="opt__name">Click triggers actions</span>
					<label class="toggle">
						<input type="checkbox" id="click-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
				<div class="toggle-row">
					<span class="opt__name">Keyboard triggers actions</span>
					<label class="toggle">
						<input type="checkbox" id="keyboard-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
				<div class="field-row">
					<span class="field-row__label">Cooldown</span>
					<div class="slider" id="cooldown-slider-wrap">
						<input type="range" id="cooldown-slider" min="0" max="120" step="5" value="30" />
						<span class="slider__track"></span>
						<span class="slider__fill"></span>
						<span class="slider__thumb"></span>
					</div>
					<span class="slider__value" id="cooldown-value">30s</span>
				</div>
			</section>

			<section class="section">
				<label class="section__label">Drag &amp; Drop</label>
				<p class="section__desc">Drop a folder to compress it, or an archive to extract it. Output is placed next to the source.</p>
				<div class="toggle-row">
					<span class="opt__name">Enable drag-drop archive</span>
					<label class="toggle">
						<input type="checkbox" id="archive-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
			</section>

			<section class="section">
				<label class="section__label">AI Mode</label>
				<p class="section__desc">Chat and tool use via an LLM (coming soon).</p>
				<div class="toggle-row">
					<span class="opt__name">Enable AI</span>
					<label class="toggle">
						<input type="checkbox" id="ai-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
			</section>

			<section class="section about-section">
				<label class="section__label">Credits</label>
				<div class="about__credits">
					<div class="credit">
						<span class="credit__tag">wanko</span>
						<span class="credit__body">
							<span class="credit__source">Live2D official sample</span>
							<span class="credit__note">わんころもち PRO — Live2D Inc.</span>
						</span>
					</div>
					<div class="credit">
						<span class="credit__tag">miku</span>
						<span class="credit__body">
							<span class="credit__source">初音未来</span>
							<span class="credit__note">Art: 玄宝酱 · Modeling: 怂怂koe</span>
						</span>
					</div>
				</div>
				<p class="about__license">
					See <code>assets/README.md</code> for full credits &amp; licenses.<br />
					The miku model is non-commercial, no redistribution (不可二传二改).
				</p>
			</section>
		</main>
	`;
}

/** Sync a custom slider's fill/thumb position from its native range input. */
/** Toast kinds: neutral info, success, or error. */
type ToastKind = 'info' | 'ok' | 'error';
let toastTimer: number | undefined;

/** Show a transient toast above the settings cards. Auto-dismisses after 2.5s. */
function showToast(message: string, kind: ToastKind = 'info') {
	const toast = document.getElementById('toast');
	if (!toast) return;
	toast.textContent = message;
	toast.className = `toast toast--${kind} toast--visible`;
	if (toastTimer !== undefined) window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => {
		toast.classList.remove('toast--visible');
	}, 2500);
}

function syncSliderPct(wrap: HTMLElement, input: HTMLInputElement) {
	const min = Number(input.min);
	const max = Number(input.max);
	const pct = ((Number(input.value) - min) / (max - min)) * 100;
	wrap.style.setProperty('--pct', `${pct}%`);
}

/** Wire a custom slider: keep --pct in sync on input, call onChange on release. */
function wireSlider(
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

async function renderModels() {
	const list = document.getElementById('model-list')!;
	list.innerHTML = '<p class="opt__id">Loading…</p>';

	let models: ModelInfo[] = [];
	let current: ModelInfo | null = null;
	try {
		models = await invoke<ModelInfo[]>(IPC.LIST_MODELS);
		current = await invoke<ModelInfo>(IPC.GET_CURRENT_MODEL).catch(() => null);
	} catch (e) {
		list.innerHTML = `<p class="opt__id">Failed to load models: ${e}</p>`;
		return;
	}

	if (models.length === 0) {
		list.innerHTML = '<p class="opt__id">No models found under assets/models/.</p>';
		return;
	}

	list.innerHTML = models
		.map(
			(m) => `
			<label class="opt">
				<input type="radio" name="model" value="${m.id}" ${current?.id === m.id ? 'checked' : ''} />
				<span class="opt__dot"></span>
				<span class="opt__text">
					<span class="opt__name">${m.name}</span>
					<span class="opt__id">${m.id}</span>
				</span>
			</label>`,
		)
		.join('');

	list.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((input) => {
		input.addEventListener('change', async () => {
			if (!input.checked) return;
			showToast('Switching model…');
			try {
				await invoke<ModelInfo>(IPC.SWITCH_MODEL, { id: input.value });
				showToast(`Switched to ${input.value}`, 'ok');
			} catch (e) {
				showToast(`Failed: ${e}`, 'error');
			}
		});
	});
}

async function wireSize() {
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
				await invoke(IPC.SET_PET_SIZE, { w: v, h: v });
				showToast(`Size set to ${v}px`, 'ok');
			} catch (e) {
				showToast(`Failed: ${e}`, 'error');
			}
		},
	);
}

async function wireInputActions() {
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

async function wireArchive() {
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

function wireAiToggle() {
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

renderShell();
void renderModels();
void wireSize();
void wireInputActions();
void wireArchive();
wireAiToggle();

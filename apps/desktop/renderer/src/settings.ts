/// <reference types="vite/client" />

import { invoke } from '@tauri-apps/api/core';
import { IPC, type ModelInfo } from '@handheld-maid/shared';
import './settings.css';

/**
 * Settings window entry. Independent of the main pet window — no Pixi/Live2D
 * here. Renders Cirrus-styled option cards for model selection and an AI-mode
 * toggle placeholder.
 */

const root = document.getElementById('app')!;

function renderShell() {
	root.innerHTML = `
		<main class="settings">
			<h1 class="settings__title">HandheldMaid</h1>
			<p class="settings__subtitle">Settings</p>

			<section class="section" id="model-section">
				<label class="section__label">Model</label>
				<p class="section__desc">Choose the Live2D model shown on the desktop.</p>
				<div class="opt-group" id="model-list"></div>
				<p class="status" id="model-status"></p>
			</section>

			<section class="section">
				<label class="section__label">Size</label>
				<p class="section__desc">Adjust the pet's on-screen size.</p>
				<div class="size-row">
					<input type="range" id="size-slider" min="200" max="1000" step="25" value="400" />
					<span class="opt__id" id="size-value">400px</span>
				</div>
				<p class="status" id="size-status"></p>
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
				<p class="status" id="ai-status"></p>
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

async function renderModels() {
	const list = document.getElementById('model-list')!;
	const status = document.getElementById('model-status')!;
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
			</label>`
		)
		.join('');

	list.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((input) => {
		input.addEventListener('change', async () => {
			if (!input.checked) return;
			status.textContent = 'Switching…';
			try {
				await invoke<ModelInfo>(IPC.SWITCH_MODEL, { id: input.value });
				status.textContent = `Switched to ${input.value}`;
			} catch (e) {
				status.textContent = `Failed: ${e}`;
			}
		});
	});
}

async function wireSize() {
	const slider = document.getElementById('size-slider') as HTMLInputElement | null;
	const value = document.getElementById('size-value')!;
	const status = document.getElementById('size-status')!;
	if (!slider) return;

	// Mirror the persisted size into the slider (physical px side).
	try {
		const [w] = await invoke<[number, number]>(IPC.GET_PET_SIZE);
		slider.value = String(w);
		value.textContent = `${w}px`;
	} catch {
		/* fall back to the default shown in the markup */
	}

	// Persist + broadcast on release so dragging isn't thrashing IPC.
	slider.addEventListener('input', () => {
		value.textContent = `${slider.value}px`;
	});
	slider.addEventListener('change', async () => {
		const s = Number(slider.value);
		status.textContent = 'Applying…';
		try {
			await invoke(IPC.SET_PET_SIZE, { w: s, h: s });
			status.textContent = `Set to ${s}px`;
		} catch (e) {
			status.textContent = `Failed: ${e}`;
		}
	});
}

function wireAiToggle() {
	const toggle = document.getElementById('ai-toggle') as HTMLInputElement | null;
	const status = document.getElementById('ai-status')!;
	if (!toggle) return;
	toggle.addEventListener('change', () => {
		status.textContent = toggle.checked ? 'AI mode is coming soon — setting saved.' : 'AI mode disabled.';
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
wireAiToggle();

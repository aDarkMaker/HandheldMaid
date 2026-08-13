/** Model panel: list/switch/import/rename/delete Live2D models. */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { IPC, type ImportedModel, type ModelInfo } from '@handheld-maid/shared';
import { isTauri } from '../../lib/tauri';
import { esc, showToast } from '../ui';

export function wireModelPanel() {
	void renderModels();
	void wireModelDrop();
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
		.map((m) => {
			const checked = current?.id === m.id ? 'checked' : '';
			const badge = m.imported ? '<span class="opt__badge" title="Imported">imported</span>' : '';
			const del = m.imported
				? `<button class="opt__act opt__act--danger" data-act="delete" data-id="${esc(m.id)}" title="Delete this imported model" aria-label="Delete model">&times;</button>`
				: '';
			return `
			<div class="opt" data-id="${esc(m.id)}">
				<label class="opt__main">
					<input type="radio" name="model" value="${esc(m.id)}" ${checked} />
					<span class="opt__dot"></span>
					<span class="opt__text">
						<span class="opt__name" data-name>${esc(m.name)}</span>
						<span class="opt__meta">
							<span class="opt__id">${esc(m.id)}</span>${badge}
						</span>
					</span>
				</label>
				<div class="opt__acts">
					<button class="opt__act" data-act="rename" data-id="${esc(m.id)}" title="Rename" aria-label="Rename model">✎</button>
					${del}
				</div>
			</div>`;
		})
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

	list.querySelectorAll<HTMLButtonElement>('.opt__act').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const act = btn.dataset.act;
			const id = btn.dataset.id!;
			if (act === 'rename') void startRename(id);
			else if (act === 'delete') void confirmDelete(id);
		});
	});
}

/** Inline-rename a model: swap the name span for a text input on Enter/blur. */
async function startRename(id: string) {
	const card = document.querySelector<HTMLDivElement>(`.opt[data-id="${CSS.escape(id)}"]`);
	const nameEl = card?.querySelector<HTMLElement>('[data-name]');
	if (!card || !nameEl) return;
	const old = nameEl.textContent ?? '';
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'opt__rename';
	input.value = old;
	input.setAttribute('aria-label', 'Model name');
	nameEl.replaceWith(input);
	input.focus();
	input.select();

	const commit = async () => {
		const next = input.value.trim();
		if (!next || next === old) {
			input.replaceWith(nameEl);
			return;
		}
		showToast('Renaming…');
		try {
			await invoke<ModelInfo>(IPC.RENAME_MODEL, { id, name: next });
			showToast('Renamed', 'ok');
			await renderModels();
		} catch (e) {
			showToast(`Failed: ${e}`, 'error');
			await renderModels();
		}
	};

	input.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') { ev.preventDefault(); void commit(); }
		else if (ev.key === 'Escape') { input.replaceWith(nameEl); }
	});
	input.addEventListener('blur', () => void commit());
}

/** Confirm-then-delete an imported model. */
async function confirmDelete(id: string) {
	if (!window.confirm(`Delete model "${id}"? This cannot be undone.`)) return;
	showToast('Deleting…');
	try {
		await invoke(IPC.DELETE_MODEL, { id });
		showToast('Deleted', 'ok');
		await renderModels();
	} catch (e) {
		showToast(`Failed: ${e}`, 'error');
	}
}

/** Summarize a drag-drop import result list into a single toast line. */
function importToast(results: ImportedModel[]): string {
	const names = (s: string) => results.filter((r) => r.status === s).map((r) => r.name || r.id);
	const news = names('new');
	const same = names('same');
	const parts: string[] = [];
	if (news.length) parts.push(`Imported ${news.join(', ')}`);
	if (same.length) parts.push(`Already present (same): ${same.join(', ')}`);
	return parts.join(' · ') || 'No new models';
}

/** Wire the model-section dropzone: drop a folder/archive to import models. */
async function wireModelDrop() {
	if (!isTauri) return;
	const dz = document.getElementById('model-dropzone');
	if (!dz) return;

	const setActive = (active: boolean) => dz.classList.toggle('dropzone--active', active);

	getCurrentWebview().onDragDropEvent((event) => {
		const t = event.payload.type;
		if (t === 'enter' || t === 'over') return setActive(true);
		setActive(false);
		if (t !== 'drop') return;
		const paths = event.payload.paths;
		if (!paths || paths.length === 0) return;
		showToast('Importing…', 'info');
		invoke<ImportedModel[]>(IPC.IMPORT_MODEL, { path: paths[0] })
			.then((results) => {
				showToast(importToast(results), results.some((r) => r.status === 'new') ? 'ok' : 'info');
				return renderModels();
			})
			.catch((e) => {
				const msg = String(e).split('\n')[0];
				showToast(msg.length > 40 ? msg.slice(0, 37) + '…' : msg, 'error');
			});
	});
}

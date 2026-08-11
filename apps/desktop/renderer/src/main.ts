/// <reference types="vite/client" />

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Application, SCALE_MODES, settings } from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import type { Rule, EventKind } from '@handheld-maid/shared';

// pixi-live2d-display needs PIXI on the global scope.
declare global {
	interface Window {
		PIXI: typeof import('pixi.js');
	}
}

const appWindow = getCurrentWebviewWindow();

async function loadModel(): Promise<Live2DModel> {
	// The model path is resolved relative to the bundled assets. In dev the
	// assets are served from the project root; in production they are bundled
	// alongside the frontend.
	const modelUrl = '/assets/models/wanko/runtime/wanko_touch.model3.json';
	const model = await Live2DModel.from(modelUrl);
	model.visible = true;
	return model;
}

function layoutModel(model: Live2DModel, app: Application) {
	const scale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.9;
	model.scale.set(scale);
	model.anchor.set(0.5, 0.5);
	model.x = app.renderer.width / 2;
	model.y = app.renderer.height / 2;
}

async function init() {
	settings.SCALE_MODE = SCALE_MODES.LINEAR;

	const canvas = document.getElementById('canvas') as HTMLCanvasElement;
	const app = new Application({
		view: canvas,
		backgroundAlpha: 0,
		antialias: true,
		resizeTo: window,
		width: window.innerWidth,
		height: window.innerHeight,
	});

	window.PIXI = await import('pixi.js');

	const model = await loadModel();
	app.stage.addChild(model);
	layoutModel(model, app);

	// Tap to play the touch motion.
	model.interactive = true;
	model.on('pointertap', () => model.motion('Tap'));

	// Re-layout on resize.
	window.addEventListener('resize', () => layoutModel(model, app));

	// Register a sample behavior rule over IPC: greet on keydown (10%).
	const greetRule: Rule = {
		name: 'KeyboardGreet',
		event: 'keydown' as EventKind,
		probability: 0.1,
	};
	await invoke('register_rule', { rule: greetRule });

	// Drag-to-move: when the pointer is down on the model, move the window.
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	canvas.addEventListener('mousedown', (e) => {
		dragging = true;
		lastX = e.screenX;
		lastY = e.screenY;
	});
	window.addEventListener('mousemove', (e) => {
		if (!dragging) return;
		const dx = e.screenX - lastX;
		const dy = e.screenY - lastY;
		lastX = e.screenX;
		lastY = e.screenY;
		void invoke('move_window', { x: dx, y: dy });
	});
	window.addEventListener('mouseup', () => {
		dragging = false;
	});

	// Make the pet interactive again (overrides the default click-through).
	await invoke('set_ignore_mouse_events', { ignore: false });

	document.body.style.background = 'transparent';
}

init().catch((err) => console.error('Initialization failed:', err));

// Silence unused import in environments where appWindow is not yet wired.
void appWindow;

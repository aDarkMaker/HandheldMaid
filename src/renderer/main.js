const { waitForAppPath, waitForLive2DSDK } = require('./utils/wait');
const { createPixiApp } = require('./core/pixi-app');
const { loadModel } = require('./core/model-loader');
const { setupModelLayout, setupModelInteraction } = require('./core/model-controller');
const { setupClickThrough, setInteractive } = require('./core/window-controller');
const { BehaviorManager } = require('./core/behavior-manager');

const canvas = document.getElementById('canvas');

async function init() {
	try {
		await waitForAppPath();
		await waitForLive2DSDK();

		const app = createPixiApp(canvas);
		const model = await loadModel();

		app.stage.addChild(model);
		setupModelLayout(model);
		setupModelInteraction(model);
		setupClickThrough();

		const wrapper = document.getElementById('control-wrapper');
		const scaleRange = document.getElementById('scale-range');
		const scaleValue = document.getElementById('scale-value');
		const btnClose = document.getElementById('btn-close-panel');
		const dragArea = document.getElementById('drag-area');

		let isSettingsOpen = false;

		const toggleSettings = (open) => {
			isSettingsOpen = open;
			if (open) {
				wrapper.classList.add('active');
			} else {
				wrapper.classList.remove('active');
			}
			setInteractive(open);
		};

		scaleRange.addEventListener('input', (e) => {
			const val = parseFloat(e.target.value);
			scaleValue.textContent = val.toFixed(1);
			if (!model._initialScale) model._initialScale = model.scale.x;
			model.scale.set(val * model._initialScale);
		});

		btnClose.addEventListener('click', () => {
			toggleSettings(false);
		});

		// 拖动窗口逻辑
		let isDragging = false;
		let lastX, lastY;

		dragArea.addEventListener('mousedown', (e) => {
			isDragging = true;
			lastX = e.screenX;
			lastY = e.screenY;
		});

		window.addEventListener('mousemove', (e) => {
			if (isDragging) {
				const dx = e.screenX - lastX;
				const dy = e.screenY - lastY;
				lastX = e.screenX;
				lastY = e.screenY;
				require('electron').ipcRenderer.send('move-window', { x: dx, y: dy });
			}
		});

		window.addEventListener('mouseup', () => {
			isDragging = false;
		});

		// 初始化行为管理器
		const behavior = new BehaviorManager(model);

		// 监听双击：如果点击在模型范围内，则打开控制面板
		behavior.registerRule({
			name: 'Open Settings',
			event: 'dblclick',
			action: (m, data) => {
				console.log('[Behavior] DblClick Action triggered', { isSettingsOpen });
				if (isSettingsOpen) return;

				const winX = window.screenX;
				const winY = window.screenY;
				const localX = data.x - winX;
				const localY = data.y - winY;

				console.log('[Behavior] Hit test', { localX, localY, winX, winY });

				const bounds = m.getBounds();
				const padding = 20;
				const isHit =
					localX >= bounds.x - padding &&
					localX <= bounds.x + bounds.width + padding &&
					localY >= bounds.y - padding &&
					localY <= bounds.y + bounds.height + padding;

				console.log('[Behavior] Hit result:', isHit, bounds);

				if (isHit) {
					toggleSettings(true);
				}
			},
		});

		// --- extensibility: add your rules here ---

		// 规则 1: 键盘输入时，有 10% 的概率打招呼
		behavior.registerRule({
			name: 'Keyboard Response',
			event: 'keydown',
			probability: 0.1,
			action: (m) => m.reactions.playTap(),
		});

		// 规则 2: 每隔 30 秒，有 30% 概率播放一个随机动作
		setInterval(() => {
			if (Math.random() < 0.3) {
				model.motion('Idle');
			}
		}, 30000);

		model.visible = true;
		document.body.style.background = 'transparent';
	} catch (error) {
		console.error('Initialization failed:', error);
	}
}

init();

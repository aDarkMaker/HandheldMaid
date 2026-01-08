const { waitForAppPath, waitForLive2DSDK } = require('./utils/wait');
const { createPixiApp } = require('./core/pixi-app');
const { loadModel } = require('./core/model-loader');
const { setupModelLayout, setupModelInteraction } = require('./core/model-controller');
const { setupClickThrough } = require('./core/window-controller');
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

		const behavior = new BehaviorManager(model);

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
				console.log('[Behavior] Idle reaction');
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

const PIXI = require('pixi.js');

function createPixiApp(canvasElement) {
	window.PIXI = PIXI;

	PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

	const app = new PIXI.Application({
		view: canvasElement,
		transparent: true,
		autoStart: true,
		resizeTo: window,
		backgroundAlpha: 0,
		antialias: true,
		width: window.innerWidth,
		height: window.innerHeight,
	});

	app.stage.visible = true;

	return app;
}

module.exports = { createPixiApp };

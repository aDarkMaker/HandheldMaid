const path = require('path');
const fs = require('fs');

function getAppPath() {
	let appPath = window.__appPath;
	if (!appPath) {
		if (typeof __dirname !== 'undefined') {
			appPath = path.resolve(__dirname, '../..');
		} else {
			throw new Error('unable to determine application path');
		}
	}
	return appPath;
}

function getModelPath() {
	const appPath = getAppPath();

	const modelPath = path.resolve(appPath, 'assets', 'models', 'wanko', 'runtime', 'wanko_touch.model3.json');

	if (!fs.existsSync(modelPath)) {
		throw new Error(`model file not found: ${modelPath}`);
	}

	return modelPath;
}

module.exports = { getAppPath, getModelPath };

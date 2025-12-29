const path = require('path');
const fs = require('fs');

function getAppPath() {
	let appPath = window.__appPath;
	if (!appPath) {
		if (typeof __dirname !== 'undefined') {
			appPath = path.resolve(__dirname, '../..');
		} else {
			throw new Error('无法确定应用路径');
		}
	}
	return appPath;
}

function getModelPath() {
	const appPath = getAppPath();

	const modelPath = path.resolve(appPath, 'assets', 'models', 'wanko', 'runtime', 'wanko_touch.model3.json');

	if (!fs.existsSync(modelPath)) {
		throw new Error(`模型文件不存在: ${modelPath}`);
	}

	return modelPath;
}

module.exports = { getAppPath, getModelPath };

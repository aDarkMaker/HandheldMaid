function waitForAppPath() {
	return new Promise((resolve) => {
		if (window.__appPath) {
			resolve();
			return;
		}

		const checkInterval = setInterval(() => {
			if (window.__appPath) {
				clearInterval(checkInterval);
				resolve();
			}
		}, 10);

		setTimeout(() => {
			clearInterval(checkInterval);
			resolve();
		}, 1000);
	});
}

function waitForLive2DSDK() {
	return new Promise((resolve, reject) => {
		if (window.Live2DCubismCore) {
			resolve();
			return;
		}

		let attempts = 0;
		const maxAttempts = 100;

		const checkInterval = setInterval(() => {
			attempts++;
			if (window.Live2DCubismCore) {
				clearInterval(checkInterval);
				resolve();
			} else if (attempts >= maxAttempts) {
				clearInterval(checkInterval);
				reject(new Error('CubismCore SDK 加载超时'));
			}
		}, 50);
	});
}

module.exports = { waitForAppPath, waitForLive2DSDK };

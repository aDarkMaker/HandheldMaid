const { ipcRenderer } = require('electron');

function setupClickThrough(model) {
	let isDragging = false;
	let lastMouseX = 0;
	let lastMouseY = 0;

	function getModelHit(x, y) {
		if (!model || !model.visible) return false;
		const bounds = model.getBounds();
		const padding = 10;
		return (
			x >= bounds.x - padding && x <= bounds.x + bounds.width + padding && y >= bounds.y - padding && y <= bounds.y + bounds.height + padding
		);
	}

	window.addEventListener('mousemove', (e) => {
		if (isDragging) {
			const deltaX = e.screenX - lastMouseX;
			const deltaY = e.screenY - lastMouseY;
			lastMouseX = e.screenX;
			lastMouseY = e.screenY;
			ipcRenderer.send('move-window', { x: deltaX, y: deltaY });
			return;
		}

		const isOverModel = getModelHit(e.clientX, e.clientY);
		ipcRenderer.send('set-ignore-mouse-events', !isOverModel, { forward: true });
	});

	window.addEventListener('mousedown', (e) => {
		if (getModelHit(e.clientX, e.clientY)) {
			isDragging = true;
			lastMouseX = e.screenX;
			lastMouseY = e.screenY;
			ipcRenderer.send('set-ignore-mouse-events', false);
		}
	});

	window.addEventListener('mouseup', () => {
		isDragging = false;
	});

	ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
}

module.exports = { setupClickThrough };

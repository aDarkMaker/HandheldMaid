const { ipcRenderer } = require('electron');

function setupClickThrough() {
	ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
}

function setInteractive(interactive) {
	ipcRenderer.send('set-ignore-mouse-events', !interactive, interactive ? {} : { forward: true });
}

module.exports = { setupClickThrough, setInteractive };

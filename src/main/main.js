const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { uIOhook: uiohook } = require('uiohook-napi');

let mainWindow = null;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 400,
		height: 400,
		transparent: true,
		frame: false,
		alwaysOnTop: true,
		resizable: false,
		skipTaskbar: true,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

	mainWindow.webContents.on('did-finish-load', () => {
		mainWindow.webContents.executeJavaScript(`
            if (typeof window !== 'undefined') {
                window.__appPath = ${JSON.stringify(app.getAppPath())};
            }
        `);
		mainWindow.setIgnoreMouseEvents(true, { forward: true });
	});

	ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
		if (mainWindow) {
			mainWindow.setIgnoreMouseEvents(ignore, options);
		}
	});

	ipcMain.on('move-window', (event, { x, y }) => {
		if (mainWindow) {
			const pos = mainWindow.getPosition();
			mainWindow.setPosition(pos[0] + Math.round(x), pos[1] + Math.round(y));
		}
	});

	// --- 全局监控实现 ---
	uiohook.on('keydown', (e) => {
		if (mainWindow) {
			mainWindow.webContents.send('global-input', { type: 'keydown', data: e });
		}
	});

	uiohook.on('click', (e) => {
		if (mainWindow) {
			mainWindow.webContents.send('global-input', { type: 'click', data: e });
		}
	});

	uiohook.start();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
	uiohook.stop();
	if (process.platform !== 'darwin') app.quit();
});

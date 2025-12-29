const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

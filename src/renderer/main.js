const { waitForAppPath, waitForLive2DSDK } = require('./utils/wait');
const { createPixiApp } = require('./core/pixi-app');
const { loadModel } = require('./core/model-loader');
const { setupModelLayout, setupModelInteraction } = require('./core/model-controller');
const { setupClickThrough } = require('./core/window-controller');

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
        setupClickThrough(model);
        
        model.visible = true;
        document.body.style.background = 'transparent';
    } catch (error) {
        console.error('Initialization failed:', error);
    }
}

init();

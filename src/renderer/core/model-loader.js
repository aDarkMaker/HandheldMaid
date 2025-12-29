const { Live2DModel } = require('pixi-live2d-display/cubism4');
const { getModelPath } = require('../utils/path');
const path = require('path');

async function loadModel() {
    const modelPath = getModelPath();
    
    try {
        const model = await Live2DModel.from(modelPath);
        
        model.visible = true;
        model.alpha = 1;
        
        return model;
    } catch (error) {
        console.error('Failed to load model:', error);
        throw error;
    }
}

module.exports = { loadModel };


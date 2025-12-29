function setupModelLayout(model) {
	function updateLayout() {
		const scale = Math.min(window.innerWidth / model.width, window.innerHeight / model.height) * 0.9;

		model.scale.set(scale);
		model.anchor.set(0.5, 0.5);
		model.x = window.innerWidth / 2;
		model.y = window.innerHeight / 2;
	}

	updateLayout();
	window.addEventListener('resize', updateLayout);
}

function setupModelInteraction(model) {
	model.interactive = true;
	model.on('pointertap', () => {
		model.motion('Tap');
	});
}

module.exports = { setupModelLayout, setupModelInteraction };

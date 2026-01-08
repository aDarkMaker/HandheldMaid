const { ipcRenderer } = require('electron');

class BehaviorManager {
	constructor(model) {
		this.model = model;
		this.rules = [];
		this.initListeners();
	}

	/**
	 * register a response rule
	 * @param {Object} rule
	 * @param {string} rule.name the name of the rule
	 * @param {string} rule.event the event type (keydown, click, interval)
	 * @param {number} rule.probability the probability of triggering (0-1)
	 * @param {Function} rule.action the callback after triggered
	 */
	registerRule(rule) {
		this.rules.push({
			probability: 1, // default 100% trigger
			...rule,
		});
	}

	initListeners() {
		ipcRenderer.on('global-input', (event, { type, data }) => {
			this.handleEvent(type, data);
		});

		window.addEventListener('keydown', (e) => this.handleEvent('keydown', e));
		window.addEventListener('click', (e) => this.handleEvent('click', e));
	}

	handleEvent(type, data) {
		const matchedRules = this.rules.filter((r) => r.event === type);

		matchedRules.forEach((rule) => {
			if (Math.random() <= rule.probability) {
				rule.action(this.model, data);
			}
		});
	}
}

module.exports = { BehaviorManager };

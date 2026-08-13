/** Settings window shell: the static HTML markup rendered into #app. */

const root = document.getElementById('app')!;

export function renderShell() {
	root.innerHTML = `
		<div class="toast" id="toast" role="status" aria-live="polite"></div>
		<main class="settings">
			<h1 class="settings__title">HandheldMaid</h1>
			<p class="settings__subtitle">Settings</p>

			<section class="section" id="model-section">
				<label class="section__label">Model</label>
				<p class="section__desc">Choose the Live2D model shown on the desktop. Drop a model folder or archive below to import it.</p>
				<div class="dropzone" id="model-dropzone" role="button" tabindex="0" aria-label="Drop a Live2D model folder or archive to import">
					<span class="dropzone__icon" aria-hidden="true">↓</span>
					<span class="dropzone__text">Drop a Live2D model folder or archive</span>
				</div>
				<div class="opt-group" id="model-list"></div>
			</section>

			<section class="section">
				<label class="section__label">Size</label>
				<p class="section__desc">Adjust the pet's on-screen size.</p>
				<div class="field-row">
					<span class="field-row__label">Scale</span>
					<div class="slider" id="size-slider-wrap">
						<input type="range" id="size-slider" min="200" max="1000" step="25" value="400" />
						<span class="slider__track"></span>
						<span class="slider__fill"></span>
						<span class="slider__thumb"></span>
					</div>
					<span class="slider__value" id="size-value">400px</span>
				</div>
			</section>

			<section class="section">
				<label class="section__label">Input Actions</label>
				<p class="section__desc">Random actions triggered by clicking or typing. Click always fires; typing fires rarely with a cooldown.</p>
				<div class="toggle-row">
					<span class="opt__name">Click triggers actions</span>
					<label class="toggle">
						<input type="checkbox" id="click-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
				<div class="toggle-row">
					<span class="opt__name">Keyboard triggers actions</span>
					<label class="toggle">
						<input type="checkbox" id="keyboard-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
				<div class="field-row">
					<span class="field-row__label">Cooldown</span>
					<div class="slider" id="cooldown-slider-wrap">
						<input type="range" id="cooldown-slider" min="0" max="120" step="5" value="30" />
						<span class="slider__track"></span>
						<span class="slider__fill"></span>
						<span class="slider__thumb"></span>
					</div>
					<span class="slider__value" id="cooldown-value">30s</span>
				</div>
			</section>

			<section class="section">
				<label class="section__label">Drag &amp; Drop</label>
				<p class="section__desc">Drop a folder to compress it, or an archive to extract it. Output is placed next to the source.</p>
				<div class="toggle-row">
					<span class="opt__name">Enable drag-drop archive</span>
					<label class="toggle">
						<input type="checkbox" id="archive-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
			</section>

			<section class="section">
				<label class="section__label">AI Mode</label>
				<p class="section__desc">Chat and tool use via an LLM (coming soon).</p>
				<div class="toggle-row">
					<span class="opt__name">Enable AI</span>
					<label class="toggle">
						<input type="checkbox" id="ai-toggle" />
						<span class="toggle__track"><span class="toggle__thumb"></span></span>
					</label>
				</div>
			</section>

			<section class="section about-section">
				<label class="section__label">Credits</label>
				<div class="about__credits">
					<div class="credit">
						<span class="credit__tag">wanko</span>
						<span class="credit__body">
							<span class="credit__source">Live2D official sample</span>
							<span class="credit__note">わんころもち PRO — Live2D Inc.</span>
						</span>
					</div>
					<div class="credit">
						<span class="credit__tag">miku</span>
						<span class="credit__body">
							<span class="credit__source">初音未来</span>
							<span class="credit__note">Art: 玄宝酱 · Modeling: 怂怂koe</span>
						</span>
					</div>
				</div>
				<p class="about__license">
					See <code>assets/README.md</code> for full credits &amp; licenses.<br />
					The miku model is non-commercial, no redistribution (不可二传二改).
				</p>
			</section>
		</main>
	`;
}

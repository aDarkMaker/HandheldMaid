import type { Rule, Subscription } from '@handheld-maid/shared';
import { IPC } from '@handheld-maid/shared';
import { safeInvoke } from './tauri';

/**
 * Register the default idle behavior. Pet-tap is handled by the input-action
 * system (random motion/expression via `hm://trigger-input-action`), so only
 * the idle timer rule is registered here.
 */
export async function registerDefaultBehavior() {
	// Idle tick (every 30s, 30% chance) emits "on_idle" -> play an Idle motion.
	const idleRule: Rule = { name: 'idle', event: 'interval', probability: 0.3, emit_event: 'on_idle' };
	const idleSub: Subscription = {
		id: 'idle_motion',
		event: 'on_idle',
		action: { category: 'model', motion: 'Idle' },
		weight: 1,
	};

	await safeInvoke(IPC.REGISTER_RULE, { rule: idleRule }).catch((e) => console.error('[HandheldMaid] register idle rule:', e));
	await safeInvoke(IPC.SUBSCRIBE, { subscription: idleSub }).catch((e) => console.error('[HandheldMaid] subscribe idle:', e));
}

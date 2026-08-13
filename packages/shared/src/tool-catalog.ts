/**
 * Static catalog of the pet's built-in tools, mirroring the Rust tool registry
 * (`crates/core/src/tools/*`). Kept in sync with the backend's
 * `ToolRegistry::list()` (IPC `list_tools`), which is the live source of truth —
 * this file is a concise, AI-readable reference: each tool's function, tags,
 * and how to call it.
 *
 * ## Calling a tool
 * All tools are invoked the same way (mirrors MCP `tools/call`):
 *
 *   invoke(IPC.INVOKE_TOOL, { name: '<tool name>', args: <input schema> })
 *
 * e.g. the current system time:
 *
 *   invoke(IPC.INVOKE_TOOL, { name: 'time', args: {} })
 *
 * The return is a JSON object specific to the tool (see each entry's `returns`).
 */

/** Tags classify a tool's domain so an agent can filter the catalog. */
export type ToolTag = 'system' | 'input' | 'filesystem' | 'time';

/** One catalog entry — a concise, AI-readable description of a built-in tool. */
export interface ToolCatalogEntry {
	/** Tool name (the `name` passed to `IPC.INVOKE_TOOL`). */
	name: string;
	/** One-line summary of what the tool does. */
	summary: string;
	/** Human-readable description (mirrors the backend `description`). */
	description: string;
	/** Domain tags for filtering. */
	readonly tags: readonly ToolTag[];
	/** The input arguments, as a JSON-Schema-ish object. */
	inputSchema: Record<string, unknown>;
	/** Shape of the returned JSON object (for AI comprehension). */
	returns: Record<string, string>;
}

/** The built-in tool catalog. Add a new entry here when you register a tool. */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
	{
		name: 'time',
		summary: 'Get the current system date and time.',
		description:
			'Get the current system date and time. Returns ISO-8601 (UTC), a local ' +
			'timestamp, the Unix epoch seconds/millis, and the local timezone offset.',
		tags: ['system', 'time'],
		inputSchema: { type: 'object', additionalProperties: false },
		returns: {
			iso_utc: 'string — ISO-8601 UTC timestamp (RFC 3339).',
			iso_local: 'string — ISO-8601 local timestamp (RFC 3339).',
			unix_seconds: 'number — Unix epoch seconds.',
			unix_millis: 'number — Unix epoch milliseconds.',
			timezone: 'string — local timezone offset (e.g. "+08:00").',
			offset: 'string — local timezone offset (e.g. "+08:00").',
		},
	},
	{
		name: 'system_control',
		summary: 'Simulate keyboard and mouse input.',
		description:
			'Simulate keyboard and mouse input: type text, press keys, move the ' +
			'mouse, click.',
		tags: ['system', 'input'],
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['type_text', 'move_mouse', 'click'] },
				text: { type: 'string' },
				x: { type: 'integer' },
				y: { type: 'integer' },
			},
			required: ['action'],
		},
		returns: {
			ok: 'boolean — true on success.',
			action: 'string — the action performed.',
		},
	},
	{
		name: 'archive',
		summary: 'Compress a folder or extract an archive.',
		description: 'Compress a folder into an archive, or extract an archive.',
		tags: ['filesystem'],
		inputSchema: { type: 'object' },
		returns: {
			ok: 'boolean — true on success.',
			action: 'string — compress | extract.',
			output: 'string — resulting file/folder path.',
		},
	},
] as const;

// ── Agent Resolution ────────────────────────────────────────────────────────
// Dynamic agent color, label, and description lookups from AgentMeta.

import type { AgentMeta } from "./types";

const DEFAULT_COLORS = ["#b07cf0", "#38bdf8", "#f0c040", "#4ade80", "#f472b6", "#fb923c", "#a78bfa", "#34d399"];

/** Deterministic hash-based fallback color for unknown agent IDs. */
function hashColor(agentId: string): string {
	let hash = 0;
	for (const ch of agentId) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
	return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

/** Pre-built Map keyed by lowercase agent ID for O(1) lookups.
 *  Build once with `useMemo(() => buildAgentMap(meta), [meta])` in components. */
export type AgentMap = Map<string, AgentMeta>;

export function buildAgentMap(meta?: AgentMeta[]): AgentMap {
	const map = new Map<string, AgentMeta>();
	if (meta) for (const m of meta) map.set(m.id.toLowerCase(), m);
	return map;
}

/** Look up an agent's metadata by ID from either a Map (O(1)) or array (O(n) fallback). */
function resolveAgent(agentId: string, meta?: AgentMeta[] | AgentMap): AgentMeta | undefined {
	const key = agentId.toLowerCase();
	return meta instanceof Map ? meta.get(key) : meta?.find((m) => m.id.toLowerCase() === key);
}

export function getAgentColor(agentId: string, meta?: AgentMeta[] | AgentMap): string {
	return resolveAgent(agentId, meta)?.color ?? hashColor(agentId.toLowerCase());
}

/** Prettify a raw agent ID into a readable label (fallback when meta is unavailable). */
function prettifyAgentId(agentId: string): string {
	return agentId
		.replace(/^agent_/, "")
		.replace(/_dd$/, "")
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getAgentLabel(agentId: string, meta?: AgentMeta[] | AgentMap): string {
	return resolveAgent(agentId, meta)?.label ?? prettifyAgentId(agentId);
}

export function getAgentDescription(agentId: string, meta?: AgentMeta[] | AgentMap): string {
	return resolveAgent(agentId, meta)?.description ?? `Research agent: ${agentId}`;
}

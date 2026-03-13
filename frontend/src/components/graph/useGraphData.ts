import { useCallback, useMemo } from "react";
import { buildAgentMap, getAgentColor } from "../../lib/agents";
import type { AgentMeta, Connection, Finding, InvestmentThesis } from "../../lib/types";

/** Compute dynamic agent positions evenly around a circle */
function computeAgentPositions(agentIds: string[]): Record<string, { x: number; y: number }> {
	const positions: Record<string, { x: number; y: number }> = {};
	const radius = 600;
	const n = agentIds.length;
	for (let i = 0; i < n; i++) {
		const angle = (2 * Math.PI * i) / n - Math.PI / 2;
		positions[agentIds[i]] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
	}
	return positions;
}

export function useGraphData(
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	agentMeta: AgentMeta[],
	hiddenAgents: Set<string>,
	connectedOnly: boolean,
) {
	const agentMap = useMemo(() => buildAgentMap(agentMeta), [agentMeta]);

	// Derive active agents dynamically from metadata + data
	const activeAgents = useMemo(() => {
		const ids = new Set(findings.map((f) => f.agent_id));
		return agentMeta.length > 0 ? agentMeta.map((m) => m.id).filter((id) => ids.has(id)) : [...ids];
	}, [findings, agentMeta]);

	const agentPositions = useMemo(() => computeAgentPositions(activeAgents), [activeAgents]);

	const agentColorFn = useCallback((agentId: string) => getAgentColor(agentId, agentMap), [agentMap]);

	// Build neighbors map + connected node IDs in a single pass
	const { neighbors, connectedNodeIds } = useMemo(() => {
		const neighborMap = new Map<string, Set<string>>();
		const connected = new Set<string>();

		for (const c of connections) {
			connected.add(c.from_finding_id);
			connected.add(c.to_finding_id);
			if (!neighborMap.has(c.from_finding_id)) neighborMap.set(c.from_finding_id, new Set());
			if (!neighborMap.has(c.to_finding_id)) neighborMap.set(c.to_finding_id, new Set());
			neighborMap.get(c.from_finding_id)?.add(c.to_finding_id);
			neighborMap.get(c.to_finding_id)?.add(c.from_finding_id);
		}

		for (const thesis of theses) {
			const thesisNodeId = `thesis:${thesis.id}`;
			if (!neighborMap.has(thesisNodeId)) neighborMap.set(thesisNodeId, new Set());
			for (const e of thesis.evidence) {
				connected.add(e.finding_id);
				neighborMap.get(thesisNodeId)?.add(e.finding_id);
				if (!neighborMap.has(e.finding_id)) neighborMap.set(e.finding_id, new Set());
				neighborMap.get(e.finding_id)?.add(thesisNodeId);
			}
		}

		return { neighbors: neighborMap, connectedNodeIds: connected };
	}, [connections, theses]);

	const visibleFindings = useMemo(() => {
		let filtered = connectedOnly ? findings.filter((f) => connectedNodeIds.has(f.id)) : findings;
		if (hiddenAgents.size > 0) {
			filtered = filtered.filter((f) => !hiddenAgents.has(f.agent_id));
		}
		return filtered;
	}, [findings, connectedOnly, connectedNodeIds, hiddenAgents]);

	// Fingerprint — cheap heuristic to detect data changes without full deep comparison.
	// Encodes counts, first+last IDs, and a lightweight content hash to catch mid-array changes.
	const fingerprintStr = useMemo(() => {
		const fLen = visibleFindings.length;
		const cLen = connections.length;
		const tLen = theses.length;
		const fFirst = fLen > 0 ? visibleFindings[0].id : "";
		const fLast = fLen > 0 ? visibleFindings[fLen - 1].id : "";
		const cFirst = cLen > 0 ? connections[0].id : "";
		const cLast = cLen > 0 ? connections[cLen - 1].id : "";
		const tFirst = tLen > 0 ? theses[0].id : "";
		const tLast = tLen > 0 ? theses[tLen - 1].id : "";
		// Lightweight content hash: sum of thesis vote counts + evidence counts detects votes/evidence changes
		let tHash = 0;
		for (const t of theses) tHash += t.evidence.length + (t.votes?.length ?? 0);
		return `${fLen}:${fFirst}:${fLast}|${cLen}:${cFirst}:${cLast}|${tLen}:${tFirst}:${tLast}:${tHash}`;
	}, [visibleFindings, connections, theses]);

	// Evidence sets for thesis hover highlighting
	const thesisEvidenceSets = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const thesis of theses) {
			map.set(`thesis:${thesis.id}`, new Set(thesis.evidence.map((e) => e.finding_id)));
		}
		return map;
	}, [theses]);

	const hiddenCount = useMemo(
		() =>
			connectedOnly ? findings.filter((f) => !connectedNodeIds.has(f.id) && !hiddenAgents.has(f.agent_id)).length : 0,
		[findings, connectedOnly, connectedNodeIds, hiddenAgents],
	);

	// ── Connection stats (relationship breakdown + cross-agent %) ────────────
	const connectionStats = useMemo(() => {
		const stats = { supports: 0, contradicts: 0, enables: 0, amplifies: 0, crossAgent: 0, total: 0 };
		const findingAgentMap = new Map<string, string>();
		for (const f of findings) findingAgentMap.set(f.id, f.agent_id);
		for (const c of connections) {
			stats.total++;
			const rel = c.relationship;
			if (rel === "supports") stats.supports++;
			else if (rel === "contradicts") stats.contradicts++;
			else if (rel === "enables") stats.enables++;
			else if (rel === "amplifies") stats.amplifies++;
			const fromAgent = findingAgentMap.get(c.from_finding_id);
			const toAgent = findingAgentMap.get(c.to_finding_id);
			if (fromAgent && toAgent && fromAgent !== toAgent) stats.crossAgent++;
		}
		return stats;
	}, [findings, connections]);

	return {
		agentMap,
		activeAgents,
		agentPositions,
		agentColorFn,
		neighbors,
		connectedNodeIds,
		visibleFindings,
		fingerprintStr,
		thesisEvidenceSets,
		hiddenCount,
		connectionStats,
	};
}

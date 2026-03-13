import type Graph from "graphology";
import { GRAPH_COLORS, RELATIONSHIP_COLORS } from "../../lib/constants";
import type { Connection, Finding, InvestmentThesis } from "../../lib/types";

// ── Layout constants (must match graphBuilder.ts) ────────────────────────────

const THESIS_RADIUS = 700;
const EVIDENCE_ORBIT = 200;
const PERIPHERY_RADIUS = 950;
const PERIPHERY_SPREAD = 80;

function circlePosition(
	index: number,
	total: number,
	cx: number,
	cy: number,
	radius: number,
	startAngle = -Math.PI / 2,
): { x: number; y: number } {
	const angle = startAngle + (2 * Math.PI * index) / Math.max(total, 1);
	return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

/**
 * Compute thesis-centric positions for all findings.
 * Mirrors the logic in graphBuilder.ts so merges produce the same layout.
 */
function computePositions(
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	findingMap: Map<string, Finding>,
): {
	thesisPositions: Map<string, { x: number; y: number }>;
	findingPositions: Map<string, { x: number; y: number }>;
} {
	// Thesis hub positions
	const thesisPositions = new Map<string, { x: number; y: number }>();
	for (let i = 0; i < theses.length; i++) {
		const pos = circlePosition(i, theses.length, 0, 0, theses.length === 1 ? 0 : THESIS_RADIUS);
		thesisPositions.set(theses[i].id, pos);
	}

	// Finding → thesis mapping
	const findingToTheses = new Map<string, string[]>();
	for (const thesis of theses) {
		for (const e of thesis.evidence) {
			const arr = findingToTheses.get(e.finding_id) ?? [];
			arr.push(thesis.id);
			findingToTheses.set(e.finding_id, arr);
		}
	}

	// Connection neighbors
	const connectionNeighbors = new Map<string, Set<string>>();
	for (const c of connections) {
		if (!findingMap.has(c.from_finding_id) || !findingMap.has(c.to_finding_id)) continue;
		if (!connectionNeighbors.has(c.from_finding_id)) connectionNeighbors.set(c.from_finding_id, new Set());
		if (!connectionNeighbors.has(c.to_finding_id)) connectionNeighbors.set(c.to_finding_id, new Set());
		connectionNeighbors.get(c.from_finding_id)!.add(c.to_finding_id);
		connectionNeighbors.get(c.to_finding_id)!.add(c.from_finding_id);
	}

	// Classify
	const groupA: Finding[] = [];
	const groupB: Finding[] = [];
	const groupC: Finding[] = [];
	for (const f of findings) {
		if (findingToTheses.has(f.id)) groupA.push(f);
		else if (connectionNeighbors.has(f.id)) groupB.push(f);
		else groupC.push(f);
	}

	const findingPositions = new Map<string, { x: number; y: number }>();
	const thesisEvidenceCount = new Map<string, number>();

	// Group A: evidence orbit
	for (const f of groupA) {
		const thesisIds = findingToTheses.get(f.id)!;
		if (thesisIds.length === 1) {
			const tId = thesisIds[0];
			const tPos = thesisPositions.get(tId)!;
			const idx = thesisEvidenceCount.get(tId) ?? 0;
			thesisEvidenceCount.set(tId, idx + 1);
			const goldenAngle = 2.399963;
			const angle = idx * goldenAngle - Math.PI / 2;
			const r = EVIDENCE_ORBIT + (idx > 5 ? (idx - 5) * 35 : 0);
			findingPositions.set(f.id, { x: tPos.x + Math.cos(angle) * r, y: tPos.y + Math.sin(angle) * r });
		} else {
			let cx = 0;
			let cy = 0;
			for (const tId of thesisIds) {
				const tPos = thesisPositions.get(tId)!;
				cx += tPos.x;
				cy += tPos.y;
			}
			cx /= thesisIds.length;
			cy /= thesisIds.length;
			const sharedIdx = groupA.filter(
				(g) => g.id !== f.id && (findingToTheses.get(g.id)?.length ?? 0) > 1,
			).indexOf(f);
			const jitter = (sharedIdx + 1) * 30;
			const jAngle = sharedIdx * 2.399963;
			findingPositions.set(f.id, { x: cx + Math.cos(jAngle) * jitter, y: cy + Math.sin(jAngle) * jitter });
		}
	}

	// Group B: near partners
	const groupBUnplaced: Finding[] = [];
	for (const f of groupB) {
		const neighbors = connectionNeighbors.get(f.id)!;
		let cx = 0;
		let cy = 0;
		let count = 0;
		for (const nId of neighbors) {
			const pos = findingPositions.get(nId);
			if (pos) { cx += pos.x; cy += pos.y; count++; }
		}
		if (count > 0) {
			cx /= count;
			cy /= count;
			const angle = Math.atan2(cy, cx) + Math.PI / 6;
			findingPositions.set(f.id, { x: cx + Math.cos(angle) * 60, y: cy + Math.sin(angle) * 60 });
		} else {
			groupBUnplaced.push(f);
		}
	}
	const midRadius = (THESIS_RADIUS + PERIPHERY_RADIUS) / 2;
	for (let i = 0; i < groupBUnplaced.length; i++) {
		findingPositions.set(groupBUnplaced[i].id, circlePosition(i, groupBUnplaced.length, 0, 0, midRadius));
	}

	// Group C: periphery
	const agentGroups = new Map<string, Finding[]>();
	for (const f of groupC) {
		const arr = agentGroups.get(f.agent_id) ?? [];
		arr.push(f);
		agentGroups.set(f.agent_id, arr);
	}
	const agentKeys = [...agentGroups.keys()];
	let peripheryIdx = 0;
	const totalPeriphery = groupC.length;
	for (let a = 0; a < agentKeys.length; a++) {
		for (const f of agentGroups.get(agentKeys[a])!) {
			const pos = circlePosition(peripheryIdx, totalPeriphery, 0, 0, PERIPHERY_RADIUS);
			const groupAngle = (a / agentKeys.length) * Math.PI * 2;
			findingPositions.set(f.id, {
				x: pos.x + Math.cos(groupAngle) * PERIPHERY_SPREAD,
				y: pos.y + Math.sin(groupAngle) * PERIPHERY_SPREAD,
			});
			peripheryIdx++;
		}
	}

	return { thesisPositions, findingPositions };
}

// ── Merge ────────────────────────────────────────────────────────────────────

export function mergeGraph(
	existing: Graph,
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	_agentPositions: Record<string, { x: number; y: number }>,
	agentColorFn: (agentId: string) => string,
): { added: string[]; removed: string[] } {
	const added: string[] = [];
	const removed: string[] = [];

	const findingMap = new Map<string, Finding>();
	for (const f of findings) findingMap.set(f.id, f);

	const expectedNodes = new Set<string>();
	for (const f of findings) expectedNodes.add(f.id);
	for (const t of theses) expectedNodes.add(`thesis:${t.id}`);

	const expectedEdges = new Set<string>();
	for (const c of connections) {
		if (findingMap.has(c.from_finding_id) && findingMap.has(c.to_finding_id)) {
			expectedEdges.add(`${c.from_finding_id}->${c.to_finding_id}`);
		}
	}
	for (const t of theses) {
		for (const e of t.evidence) {
			if (findingMap.has(e.finding_id)) expectedEdges.add(`${e.finding_id}->thesis:${t.id}`);
		}
	}

	// Remove stale nodes
	const nodesToRemove: string[] = [];
	existing.forEachNode((node) => {
		if (!expectedNodes.has(node)) nodesToRemove.push(node);
	});
	for (const node of nodesToRemove) {
		existing.dropNode(node);
		removed.push(node);
	}

	// Compute all positions
	const { thesisPositions, findingPositions } = computePositions(findings, connections, theses, findingMap);

	// Upsert finding nodes
	for (const f of findings) {
		const pos = findingPositions.get(f.id) ?? { x: 0, y: 0 };

		if (existing.hasNode(f.id)) {
			existing.mergeNodeAttributes(f.id, {
				x: pos.x,
				y: pos.y,
				size: Math.max(6, Math.min(6 + f.confidence * 10, 18)),
				color: agentColorFn(f.agent_id),
				label: f.title.length > 40 ? `${f.title.slice(0, 38)}...` : f.title,
				confidence: f.confidence,
				category: f.category,
				fullTitle: f.title,
				refCount: f.references.length,
				round: f.round,
				description: f.description,
				tags: f.tags,
			});
		} else {
			existing.addNode(f.id, {
				x: pos.x,
				y: pos.y,
				size: Math.max(6, Math.min(6 + f.confidence * 10, 18)),
				color: agentColorFn(f.agent_id),
				label: f.title.length > 40 ? `${f.title.slice(0, 38)}...` : f.title,
				type: "circle",
				nodeType: "finding",
				agentId: f.agent_id,
				confidence: f.confidence,
				category: f.category,
				fullTitle: f.title,
				refCount: f.references.length,
				round: f.round,
				description: f.description,
				tags: f.tags,
			});
			added.push(f.id);
		}
	}

	// Upsert thesis nodes
	for (let i = 0; i < theses.length; i++) {
		const thesis = theses[i];
		const thesisNodeId = `thesis:${thesis.id}`;

		const agents = new Set<string>();
		for (const e of thesis.evidence) {
			const f = findingMap.get(e.finding_id);
			if (f) agents.add(f.agent_id);
		}
		const emergence = agents.size;
		const isHighEmergence = emergence >= 3;

		const MIN_THESIS_SIZE = 12;
		const MAX_THESIS_SIZE = 32;
		const size = MIN_THESIS_SIZE + thesis.confidence * (MAX_THESIS_SIZE - MIN_THESIS_SIZE);

		let supportVotes = 0;
		let challengeVotes = 0;
		for (const v of thesis.votes) {
			if (v.vote === "support") supportVotes++;
			else challengeVotes++;
		}
		const evidenceAgentIds = [
			...new Set(thesis.evidence.map((e) => findingMap.get(e.finding_id)?.agent_id).filter(Boolean)),
		];

		const tPos = thesisPositions.get(thesis.id) ?? { x: 0, y: 0 };

		if (existing.hasNode(thesisNodeId)) {
			existing.mergeNodeAttributes(thesisNodeId, {
				x: tPos.x,
				y: tPos.y,
				size,
				color: isHighEmergence ? GRAPH_COLORS.thesisHighEmergence : GRAPH_COLORS.thesis,
				label: thesis.title.length > 45 ? `${thesis.title.slice(0, 43)}...` : thesis.title,
				emergence,
				confidence: thesis.confidence,
				fullTitle: thesis.title,
				evidenceCount: thesis.evidence.length,
				voteCount: thesis.votes.length,
				status: thesis.status,
				description: thesis.thesis,
				supportVotes,
				challengeVotes,
				evidenceAgentIds,
			});
		} else {
			existing.addNode(thesisNodeId, {
				x: tPos.x,
				y: tPos.y,
				size,
				color: isHighEmergence ? GRAPH_COLORS.thesisHighEmergence : GRAPH_COLORS.thesis,
				label: thesis.title.length > 45 ? `${thesis.title.slice(0, 43)}...` : thesis.title,
				type: "diamond",
				nodeType: "thesis",
				emergence,
				confidence: thesis.confidence,
				fullTitle: thesis.title,
				evidenceCount: thesis.evidence.length,
				voteCount: thesis.votes.length,
				status: thesis.status,
				description: thesis.thesis,
				supportVotes,
				challengeVotes,
				evidenceAgentIds,
			});
			added.push(thesisNodeId);
		}
	}

	// Remove stale edges
	const edgesToRemove: string[] = [];
	existing.forEachEdge((edge) => {
		if (!expectedEdges.has(edge)) edgesToRemove.push(edge);
	});
	for (const edge of edgesToRemove) existing.dropEdge(edge);

	// Upsert connection edges
	for (const c of connections) {
		if (!existing.hasNode(c.from_finding_id) || !existing.hasNode(c.to_finding_id)) continue;
		const edgeKey = `${c.from_finding_id}->${c.to_finding_id}`;
		if (existing.hasEdge(edgeKey)) continue;

		const isContradicts = c.relationship === "contradicts";
		const fromF = findingMap.get(c.from_finding_id);
		const toF = findingMap.get(c.to_finding_id);
		const isCrossAgent = !!(fromF && toF && fromF.agent_id !== toF.agent_id);
		const crossMultiplier = isCrossAgent ? 1.2 : 1;
		const baseSize = isContradicts ? Math.max(c.strength * 2, 1.2) : Math.max(c.strength * 1.2, 0.6);
		existing.addEdgeWithKey(edgeKey, c.from_finding_id, c.to_finding_id, {
			size: baseSize * crossMultiplier,
			color: RELATIONSHIP_COLORS[c.relationship] ?? GRAPH_COLORS.defaultNode,
			type: "arrow",
			isContradicts,
			isCrossAgent,
		});
	}

	// Upsert evidence edges
	for (const thesis of theses) {
		const thesisNodeId = `thesis:${thesis.id}`;
		if (!existing.hasNode(thesisNodeId)) continue;
		for (const e of thesis.evidence) {
			if (!existing.hasNode(e.finding_id)) continue;
			const edgeKey = `${e.finding_id}->thesis:${thesis.id}`;
			if (existing.hasEdge(edgeKey)) continue;

			const sourceFinding = findingMap.get(e.finding_id);
			const edgeColor = sourceFinding ? agentColorFn(sourceFinding.agent_id) : RELATIONSHIP_COLORS.supports;
			existing.addEdgeWithKey(edgeKey, e.finding_id, thesisNodeId, {
				size: 1.0,
				color: edgeColor,
				type: "arrow",
			});
		}
	}

	return { added, removed };
}

import Graph from "graphology";
import { GRAPH_COLORS, RELATIONSHIP_COLORS } from "../../lib/constants";
import type { Connection, Finding, InvestmentThesis } from "../../lib/types";

// ── Layout constants ─────────────────────────────────────────────────────────

const THESIS_RADIUS = 700; // how far apart thesis hubs are placed
const EVIDENCE_ORBIT = 200; // how far evidence findings sit from their thesis
const PERIPHERY_RADIUS = 950; // where unattached findings go
const PERIPHERY_SPREAD = 80; // jitter within periphery clusters

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Place N items evenly around a circle, returning { x, y } for each index */
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

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildGraph(
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	_agentPositions: Record<string, { x: number; y: number }>,
	agentColorFn: (agentId: string) => string,
): Graph {
	const graph = new Graph();
	const nodeIds = new Set<string>();
	const findingMap = new Map<string, Finding>();
	for (const f of findings) findingMap.set(f.id, f);

	// ── 1. Compute thesis positions (hubs) ─────────────────────────────────
	const thesisPositions = new Map<string, { x: number; y: number }>();
	for (let i = 0; i < theses.length; i++) {
		const pos = circlePosition(i, theses.length, 0, 0, theses.length === 1 ? 0 : THESIS_RADIUS);
		thesisPositions.set(theses[i].id, pos);
	}

	// ── 2. Map findings → which theses reference them ──────────────────────
	const findingToTheses = new Map<string, string[]>(); // finding_id → thesis_ids
	for (const thesis of theses) {
		for (const e of thesis.evidence) {
			const arr = findingToTheses.get(e.finding_id) ?? [];
			arr.push(thesis.id);
			findingToTheses.set(e.finding_id, arr);
		}
	}

	// ── 3. Build connection neighbor map for connected-but-no-thesis findings
	const connectionNeighbors = new Map<string, Set<string>>();
	for (const c of connections) {
		if (!findingMap.has(c.from_finding_id) || !findingMap.has(c.to_finding_id)) continue;
		if (!connectionNeighbors.has(c.from_finding_id)) connectionNeighbors.set(c.from_finding_id, new Set());
		if (!connectionNeighbors.has(c.to_finding_id)) connectionNeighbors.set(c.to_finding_id, new Set());
		connectionNeighbors.get(c.from_finding_id)!.add(c.to_finding_id);
		connectionNeighbors.get(c.to_finding_id)!.add(c.from_finding_id);
	}

	// ── 4. Classify findings ───────────────────────────────────────────────
	// Group A: evidence for thesis(es)
	// Group B: connected to other findings but not thesis evidence
	// Group C: isolated (no connections, no thesis)

	const groupA: Finding[] = []; // has thesis
	const groupB: Finding[] = []; // has connections but no thesis
	const groupC: Finding[] = []; // isolated

	for (const f of findings) {
		if (findingToTheses.has(f.id)) {
			groupA.push(f);
		} else if (connectionNeighbors.has(f.id)) {
			groupB.push(f);
		} else {
			groupC.push(f);
		}
	}

	// ── 5. Position Group A: evidence findings around their thesis hubs ────
	// Count how many findings per thesis for even distribution
	const thesisEvidenceCount = new Map<string, number>();
	const findingPositions = new Map<string, { x: number; y: number }>();

	for (const f of groupA) {
		const thesisIds = findingToTheses.get(f.id)!;

		if (thesisIds.length === 1) {
			// Single thesis → orbit around it
			const tId = thesisIds[0];
			const tPos = thesisPositions.get(tId)!;
			const idx = thesisEvidenceCount.get(tId) ?? 0;
			thesisEvidenceCount.set(tId, idx + 1);

			// We don't know total yet, so we'll use a golden-angle spiral
			const goldenAngle = 2.399963; // ~137.5°
			const angle = idx * goldenAngle - Math.PI / 2;
			const r = EVIDENCE_ORBIT + (idx > 5 ? (idx - 5) * 35 : 0);
			findingPositions.set(f.id, {
				x: tPos.x + Math.cos(angle) * r,
				y: tPos.y + Math.sin(angle) * r,
			});
		} else {
			// Multiple theses → position at centroid of those theses
			let cx = 0;
			let cy = 0;
			for (const tId of thesisIds) {
				const tPos = thesisPositions.get(tId)!;
				cx += tPos.x;
				cy += tPos.y;
			}
			cx /= thesisIds.length;
			cy /= thesisIds.length;

			// Add small offset to avoid stacking shared findings
			const sharedIdx = groupA.filter(
				(g) => g.id !== f.id && (findingToTheses.get(g.id)?.length ?? 0) > 1,
			).indexOf(f);
			const jitter = (sharedIdx + 1) * 30;
			const jAngle = sharedIdx * 2.399963;
			findingPositions.set(f.id, {
				x: cx + Math.cos(jAngle) * jitter,
				y: cy + Math.sin(jAngle) * jitter,
			});
		}
	}

	// ── 6. Position Group B: connected findings near their partners ────────
	// Place near the average position of their already-positioned neighbors,
	// or if none are positioned yet, place in a ring between theses and periphery
	const groupBUnplaced: Finding[] = [];

	for (const f of groupB) {
		const neighbors = connectionNeighbors.get(f.id)!;
		let cx = 0;
		let cy = 0;
		let count = 0;
		for (const nId of neighbors) {
			const pos = findingPositions.get(nId);
			if (pos) {
				cx += pos.x;
				cy += pos.y;
				count++;
			}
		}
		if (count > 0) {
			cx /= count;
			cy /= count;
			// Offset slightly so they don't stack on neighbors
			const angle = Math.atan2(cy, cx) + Math.PI / 6;
			findingPositions.set(f.id, {
				x: cx + Math.cos(angle) * 60,
				y: cy + Math.sin(angle) * 60,
			});
		} else {
			groupBUnplaced.push(f);
		}
	}

	// Place remaining group B in an intermediate ring
	const midRadius = (THESIS_RADIUS + PERIPHERY_RADIUS) / 2;
	for (let i = 0; i < groupBUnplaced.length; i++) {
		const f = groupBUnplaced[i];
		const pos = circlePosition(i, groupBUnplaced.length, 0, 0, midRadius);
		findingPositions.set(f.id, pos);
	}

	// ── 7. Position Group C: isolated findings on periphery by agent ───────
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
		const agentFindings = agentGroups.get(agentKeys[a])!;
		for (const f of agentFindings) {
			const pos = circlePosition(peripheryIdx, totalPeriphery, 0, 0, PERIPHERY_RADIUS);
			// Add small agent-group offset so same-agent nodes cluster slightly
			const groupAngle = (a / agentKeys.length) * Math.PI * 2;
			findingPositions.set(f.id, {
				x: pos.x + Math.cos(groupAngle) * PERIPHERY_SPREAD,
				y: pos.y + Math.sin(groupAngle) * PERIPHERY_SPREAD,
			});
			peripheryIdx++;
		}
	}

	// ── 8. Add all finding nodes to graph ──────────────────────────────────
	for (const f of findings) {
		const pos = findingPositions.get(f.id) ?? { x: 0, y: 0 };
		const findingSize = Math.max(6, Math.min(6 + f.confidence * 10, 18));

		graph.addNode(f.id, {
			x: pos.x,
			y: pos.y,
			size: findingSize,
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
		nodeIds.add(f.id);
	}

	// ── 9. Connection edges ────────────────────────────────────────────────
	for (const c of connections) {
		if (!nodeIds.has(c.from_finding_id) || !nodeIds.has(c.to_finding_id)) continue;
		const edgeKey = `${c.from_finding_id}->${c.to_finding_id}`;
		if (graph.hasEdge(edgeKey)) continue;

		const isContradicts = c.relationship === "contradicts";
		const fromF = findingMap.get(c.from_finding_id);
		const toF = findingMap.get(c.to_finding_id);
		const isCrossAgent = !!(fromF && toF && fromF.agent_id !== toF.agent_id);
		const crossMultiplier = isCrossAgent ? 1.2 : 1;
		const baseSize = isContradicts
			? Math.max(c.strength * 2, 1.2)
			: Math.max(c.strength * 1.2, 0.6);
		graph.addEdgeWithKey(edgeKey, c.from_finding_id, c.to_finding_id, {
			size: baseSize * crossMultiplier,
			color: RELATIONSHIP_COLORS[c.relationship] ?? GRAPH_COLORS.defaultNode,
			type: "arrow",
			isContradicts,
			isCrossAgent,
		});
	}

	// ── 10. Thesis nodes ───────────────────────────────────────────────────
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

		const tPos = thesisPositions.get(thesis.id) ?? { x: 0, y: 0 };

		const MIN_THESIS_SIZE = 12;
		const MAX_THESIS_SIZE = 32;
		const clampedConf = Math.max(0, Math.min(1, thesis.confidence));
		const size = MIN_THESIS_SIZE + clampedConf * (MAX_THESIS_SIZE - MIN_THESIS_SIZE);

		let supportVotes = 0;
		let challengeVotes = 0;
		for (const v of thesis.votes) {
			if (v.vote === "support") supportVotes++;
			else challengeVotes++;
		}
		const evidenceAgentIds = [
			...new Set(
				thesis.evidence.map((e) => findingMap.get(e.finding_id)?.agent_id).filter(Boolean),
			),
		];

		graph.addNode(thesisNodeId, {
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
		nodeIds.add(thesisNodeId);

		// Evidence edges
		for (const e of thesis.evidence) {
			if (!nodeIds.has(e.finding_id)) continue;
			const edgeKey = `${e.finding_id}->thesis:${thesis.id}`;
			if (graph.hasEdge(edgeKey)) continue;

			const sourceFinding = findingMap.get(e.finding_id);
			const edgeColor = sourceFinding
				? agentColorFn(sourceFinding.agent_id)
				: RELATIONSHIP_COLORS.supports;

			graph.addEdgeWithKey(edgeKey, e.finding_id, thesisNodeId, {
				size: 1.0,
				color: edgeColor,
				type: "arrow",
			});
		}
	}

	return graph;
}

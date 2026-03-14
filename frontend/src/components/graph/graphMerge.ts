import type Graph from "graphology";
import { GRAPH_COLORS, RELATIONSHIP_COLORS } from "../../lib/constants";
import type { Connection, Finding, InvestmentThesis } from "../../lib/types";

// ── Post-layout: push apart overlapping nodes (no global re-scaling) ────────

const MIN_NODE_DISTANCE = 250;
const SPREAD_PASSES = 8;

/**
 * Push apart any nodes closer than MIN_NODE_DISTANCE.
 * Unlike buildGraph's spreadLayout, this does NOT re-scale the entire layout —
 * existing positions are stable; only overlapping pairs get nudged.
 */
function pushApart(graph: Graph): void {
	const nodes: { id: string; x: number; y: number; isThesis: boolean }[] = [];
	graph.forEachNode((id, attrs) => {
		nodes.push({ id, x: attrs.x, y: attrs.y, isThesis: attrs.nodeType === "thesis" });
	});
	if (nodes.length < 2) return;

	for (let pass = 0; pass < SPREAD_PASSES; pass++) {
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const bothThesis = a.isThesis && b.isThesis;
				const minDist = bothThesis
					? MIN_NODE_DISTANCE * 3.5
					: (a.isThesis || b.isThesis)
						? MIN_NODE_DISTANCE * 2.5
						: MIN_NODE_DISTANCE;

				if (dist < minDist && dist > 0) {
					const push = minDist - dist;
					const nx = dx / dist;
					const ny = dy / dist;
					const aWeight = a.isThesis ? 0.15 : 0.5;
					const bWeight = b.isThesis ? 0.15 : 0.5;
					a.x -= nx * push * aWeight;
					a.y -= ny * push * aWeight;
					b.x += nx * push * bWeight;
					b.y += ny * push * bWeight;
				} else if (dist === 0) {
					const angle = Math.random() * Math.PI * 2;
					a.x += Math.cos(angle) * minDist;
					a.y += Math.sin(angle) * minDist;
				}
			}
		}
	}

	for (const n of nodes) {
		graph.setNodeAttribute(n.id, "x", n.x);
		graph.setNodeAttribute(n.id, "y", n.y);
	}
}

// ── Edge color helper ───────────────────────────────────────────────────────

function withAlpha(hex: string, alpha: number): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
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

	// Upsert finding nodes
	for (let fi = 0; fi < findings.length; fi++) {
		const f = findings[fi];
		const findingSize = Math.max(8, Math.min(8 + f.confidence * 14, 22));
		const findingLabel = String(fi + 1);

		if (existing.hasNode(f.id)) {
			existing.mergeNodeAttributes(f.id, {
				size: findingSize,
				color: agentColorFn(f.agent_id),
				label: findingLabel,
				confidence: f.confidence,
				category: f.category,
				fullTitle: f.title,
				refCount: f.references.length,
				round: f.round,
				description: f.description,
				tags: f.tags,
			});
		} else {
			// Place near a connected neighbor if one exists, otherwise near
			// same-agent peers, otherwise at a random orbit around the centroid
			let x = 0;
			let y = 0;
			let placed = false;

			// Try: place near a connected neighbor
			for (const c of connections) {
				const neighborId =
					c.from_finding_id === f.id ? c.to_finding_id :
					c.to_finding_id === f.id ? c.from_finding_id : null;
				if (neighborId && existing.hasNode(neighborId)) {
					const jitter = 300 + Math.random() * 300;
					const angle = Math.random() * Math.PI * 2;
					x = existing.getNodeAttribute(neighborId, "x") + Math.cos(angle) * jitter;
					y = existing.getNodeAttribute(neighborId, "y") + Math.sin(angle) * jitter;
					placed = true;
					break;
				}
			}

			// Fallback: place near same-agent peers
			if (!placed) {
				let cx = 0;
				let cy = 0;
				let peerCount = 0;
				existing.forEachNode((_n, attrs) => {
					if (attrs.agentId === f.agent_id) {
						cx += attrs.x;
						cy += attrs.y;
						peerCount++;
					}
				});
				if (peerCount > 0) {
					cx /= peerCount;
					cy /= peerCount;
					const jitter = 400 + Math.random() * 400;
					const angle = Math.random() * Math.PI * 2;
					x = cx + Math.cos(angle) * jitter;
					y = cy + Math.sin(angle) * jitter;
					placed = true;
				}
			}

			// Fallback: random position around graph centroid
			if (!placed) {
				let cx = 0;
				let cy = 0;
				let count = 0;
				existing.forEachNode((_n, attrs) => {
					cx += attrs.x;
					cy += attrs.y;
					count++;
				});
				if (count > 0) {
					cx /= count;
					cy /= count;
				}
				const r = 800 + Math.random() * 600;
				const angle = Math.random() * Math.PI * 2;
				x = cx + Math.cos(angle) * r;
				y = cy + Math.sin(angle) * r;
			}

			existing.addNode(f.id, {
				x,
				y,
				size: findingSize,
				color: agentColorFn(f.agent_id),
				label: findingLabel,
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

		const MIN_THESIS_SIZE = 20;
		const MAX_THESIS_SIZE = 42;
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

		const thesisLabel = `T${i + 1}`;

		if (existing.hasNode(thesisNodeId)) {
			existing.mergeNodeAttributes(thesisNodeId, {
				size,
				color: isHighEmergence ? GRAPH_COLORS.thesisHighEmergence : GRAPH_COLORS.thesis,
				label: thesisLabel,
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
			let x = 0;
			let y = 0;
			let count = 0;
			for (const e of thesis.evidence) {
				if (existing.hasNode(e.finding_id)) {
					x += existing.getNodeAttribute(e.finding_id, "x");
					y += existing.getNodeAttribute(e.finding_id, "y");
					count++;
				}
			}
			if (count > 0) { x /= count; y /= count; }

			existing.addNode(thesisNodeId, {
				x,
				y,
				size,
				color: isHighEmergence ? GRAPH_COLORS.thesisHighEmergence : GRAPH_COLORS.thesis,
				label: thesisLabel,
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

	// Upsert connection edges (semi-transparent)
	for (const c of connections) {
		if (!existing.hasNode(c.from_finding_id) || !existing.hasNode(c.to_finding_id)) continue;
		const edgeKey = `${c.from_finding_id}->${c.to_finding_id}`;
		if (existing.hasEdge(edgeKey)) continue;

		const isContradicts = c.relationship === "contradicts";
		const fromF = findingMap.get(c.from_finding_id);
		const toF = findingMap.get(c.to_finding_id);
		const isCrossAgent = !!(fromF && toF && fromF.agent_id !== toF.agent_id);
		const baseSize = isContradicts ? 1.5 : 0.8;
		const rawColor = RELATIONSHIP_COLORS[c.relationship] ?? GRAPH_COLORS.defaultNode;
		const edgeAlpha = isContradicts ? 0.7 : 0.4;

		existing.addEdgeWithKey(edgeKey, c.from_finding_id, c.to_finding_id, {
			size: baseSize,
			color: withAlpha(rawColor, edgeAlpha),
			type: "arrow",
			isContradicts,
			isCrossAgent,
			weight: isContradicts ? 0.2 : c.strength * 0.6,
		});
	}

	// Upsert evidence edges (semi-transparent)
	for (const thesis of theses) {
		const thesisNodeId = `thesis:${thesis.id}`;
		if (!existing.hasNode(thesisNodeId)) continue;
		for (const e of thesis.evidence) {
			if (!existing.hasNode(e.finding_id)) continue;
			const edgeKey = `${e.finding_id}->thesis:${thesis.id}`;
			if (existing.hasEdge(edgeKey)) continue;

			const sourceFinding = findingMap.get(e.finding_id);
			const rawColor = sourceFinding ? agentColorFn(sourceFinding.agent_id) : RELATIONSHIP_COLORS.supports;
			existing.addEdgeWithKey(edgeKey, e.finding_id, thesisNodeId, {
				size: 1.0,
				color: withAlpha(rawColor, 0.45),
				type: "arrow",
				weight: 1.5,
			});
		}
	}

	// Push apart overlapping nodes — no FA2 re-layout, just nudge overlaps
	if (added.length > 0 && existing.order > 1) {
		pushApart(existing);
	}

	return { added, removed };
}

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { GRAPH_COLORS, RELATIONSHIP_COLORS } from "../../lib/constants";
import type { Connection, Finding, InvestmentThesis } from "../../lib/types";

// ── ForceAtlas2 settings ────────────────────────────────────────────────────

const FA2_ITERATIONS = 800;
const FA2_SETTINGS = {
	gravity: 0.001,
	scalingRatio: 600,
	strongGravityMode: false,
	barnesHutOptimize: true,
	barnesHutTheta: 0.4,
	slowDown: 10,
	adjustSizes: true,
	linLogMode: true,
	outboundAttractionDistribution: true,
	edgeWeightInfluence: 1.5,
};

// ── Post-layout: minimum spacing ────────────────────────────────────────────

const LAYOUT_SCALE = 2.5; // uniform scale-up applied after FA2
const MIN_NODE_DISTANCE = 250; // minimum px between any two node centers (after scaling)
const SPREAD_PASSES = 12;

/**
 * 1. Scale the entire layout outward from centroid.
 * 2. Push apart any nodes closer than MIN_NODE_DISTANCE.
 */
function spreadLayout(graph: Graph): void {
	const nodes: { id: string; x: number; y: number; isThesis: boolean }[] = [];
	graph.forEachNode((id, attrs) => {
		nodes.push({ id, x: attrs.x, y: attrs.y, isThesis: attrs.nodeType === "thesis" });
	});
	if (nodes.length === 0) return;

	// Step 1: uniform scale-up from centroid
	let cx = 0;
	let cy = 0;
	for (const n of nodes) { cx += n.x; cy += n.y; }
	cx /= nodes.length;
	cy /= nodes.length;
	for (const n of nodes) {
		n.x = cx + (n.x - cx) * LAYOUT_SCALE;
		n.y = cy + (n.y - cy) * LAYOUT_SCALE;
	}

	// Step 2: push apart overlapping pairs
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
					// Push the full overlap distance each pass (not half)
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

	// Write back
	for (const n of nodes) {
		graph.setNodeAttribute(n.id, "x", n.x);
		graph.setNodeAttribute(n.id, "y", n.y);
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Place N items evenly around a circle */
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

/** Seed initial positions to give ForceAtlas2 a head start */
function seedPositions(
	graph: Graph,
	findings: Finding[],
	theses: InvestmentThesis[],
	findingMap: Map<string, Finding>,
): void {
	const findingToTheses = new Map<string, string[]>();
	for (const thesis of theses) {
		for (const e of thesis.evidence) {
			const arr = findingToTheses.get(e.finding_id) ?? [];
			arr.push(`thesis:${thesis.id}`);
			findingToTheses.set(e.finding_id, arr);
		}
	}

	const THESIS_SPREAD = 2000;
	const thesisPositions = new Map<string, { x: number; y: number }>();
	for (let i = 0; i < theses.length; i++) {
		const nodeId = `thesis:${theses[i].id}`;
		const pos = circlePosition(i, theses.length, 0, 0, theses.length === 1 ? 0 : THESIS_SPREAD);
		thesisPositions.set(nodeId, pos);
		if (graph.hasNode(nodeId)) {
			graph.setNodeAttribute(nodeId, "x", pos.x);
			graph.setNodeAttribute(nodeId, "y", pos.y);
		}
	}

	for (const f of findings) {
		if (!graph.hasNode(f.id)) continue;
		const linkedTheses = findingToTheses.get(f.id);
		if (linkedTheses && linkedTheses.length > 0) {
			let cx = 0;
			let cy = 0;
			for (const tId of linkedTheses) {
				const tp = thesisPositions.get(tId) ?? { x: 0, y: 0 };
				cx += tp.x;
				cy += tp.y;
			}
			cx /= linkedTheses.length;
			cy /= linkedTheses.length;
			const jitter = 450 + Math.random() * 500;
			const angle = Math.random() * Math.PI * 2;
			graph.setNodeAttribute(f.id, "x", cx + Math.cos(angle) * jitter);
			graph.setNodeAttribute(f.id, "y", cy + Math.sin(angle) * jitter);
		} else {
			const angle = Math.random() * Math.PI * 2;
			const r = 1800 + Math.random() * 800;
			graph.setNodeAttribute(f.id, "x", Math.cos(angle) * r);
			graph.setNodeAttribute(f.id, "y", Math.sin(angle) * r);
		}
	}
}

// ── Edge color helpers ──────────────────────────────────────────────────────

/** Make a hex color semi-transparent by returning an rgba string */
function withAlpha(hex: string, alpha: number): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

// ── Main builder ────────────────────────────────────────────────────────────

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

	// ── 1. Add all finding nodes ────────────────────────────────────────────
	let nodeIndex = 1;
	for (const f of findings) {
		const findingSize = Math.max(8, Math.min(8 + f.confidence * 14, 22));

		graph.addNode(f.id, {
			x: 0,
			y: 0,
			size: findingSize,
			color: agentColorFn(f.agent_id),
			label: String(nodeIndex++),
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

	// ── 2. Connection edges (semi-transparent to reduce visual noise) ───────
	for (const c of connections) {
		if (!nodeIds.has(c.from_finding_id) || !nodeIds.has(c.to_finding_id)) continue;
		const edgeKey = `${c.from_finding_id}->${c.to_finding_id}`;
		if (graph.hasEdge(edgeKey)) continue;

		const isContradicts = c.relationship === "contradicts";
		const fromF = findingMap.get(c.from_finding_id);
		const toF = findingMap.get(c.to_finding_id);
		const isCrossAgent = !!(fromF && toF && fromF.agent_id !== toF.agent_id);
		const baseSize = isContradicts ? 1.5 : 0.8;
		const rawColor = RELATIONSHIP_COLORS[c.relationship] ?? GRAPH_COLORS.defaultNode;
		const edgeAlpha = isContradicts ? 0.7 : 0.4;

		graph.addEdgeWithKey(edgeKey, c.from_finding_id, c.to_finding_id, {
			size: baseSize,
			color: withAlpha(rawColor, edgeAlpha),
			type: "arrow",
			isContradicts,
			isCrossAgent,
			weight: isContradicts ? 0.2 : c.strength * 0.6,
		});
	}

	// ── 3. Thesis nodes ─────────────────────────────────────────────────────
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
			x: 0,
			y: 0,
			size,
			color: isHighEmergence ? GRAPH_COLORS.thesisHighEmergence : GRAPH_COLORS.thesis,
			label: `T${i + 1}`,
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

		// Evidence edges — semi-transparent, weighted to keep clusters together
		for (const e of thesis.evidence) {
			if (!nodeIds.has(e.finding_id)) continue;
			const edgeKey = `${e.finding_id}->thesis:${thesis.id}`;
			if (graph.hasEdge(edgeKey)) continue;

			const sourceFinding = findingMap.get(e.finding_id);
			const rawColor = sourceFinding
				? agentColorFn(sourceFinding.agent_id)
				: RELATIONSHIP_COLORS.supports;

			graph.addEdgeWithKey(edgeKey, e.finding_id, thesisNodeId, {
				size: 1.0,
				color: withAlpha(rawColor, 0.45),
				type: "arrow",
				weight: 1.5,
			});
		}
	}

	// ── 4. Layout: seed → ForceAtlas2 → enforce minimum spacing ─────────────
	if (graph.order > 0) {
		seedPositions(graph, findings, theses, findingMap);
		forceAtlas2.assign(graph, { iterations: FA2_ITERATIONS, settings: FA2_SETTINGS });
		spreadLayout(graph);
	}

	return graph;
}

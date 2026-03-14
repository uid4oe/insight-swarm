import type Graph from "graphology";
import { useCallback, useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import { NodeCircleProgram } from "sigma/rendering";
import { GRAPH_COLORS } from "../../lib/constants";
import type { AgentId, Connection, Finding, InvestmentThesis } from "../../lib/types";
import { NodeDiamondProgram } from "./diamondNodeProgram";
import { buildGraph } from "./graphBuilder";
import { mergeGraph } from "./graphMerge";
import { createEdgeReducer, createNodeReducer } from "./highlightReducers";
import { drawLabel as drawLabelBase } from "./labelRenderer";

const ANIMATION_INTERVAL_MS = 80; // ~12fps for pulse ring — enough for subtle animation

// ── Tooltip data type ─────────────────────────────────────────────────────────

export interface TooltipData {
	x: number;
	y: number;
	nodeType: "finding" | "thesis";
	title: string;
	agent?: AgentId;
	confidence: number;
	category?: string;
	emergence?: number;
	evidenceCount?: number;
	voteCount?: number;
	status?: string;
	neighborCount: number;
	refCount?: number;
	round?: number;
	description?: string;
	tags?: string[];
	supportVotes?: number;
	challengeVotes?: number;
	evidenceAgentIds?: string[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseSigmaParams {
	containerRef: React.RefObject<HTMLDivElement | null>;
	visibleFindings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	agentPositions: Record<string, { x: number; y: number }>;
	agentColorFn: (agentId: string) => string;
	neighbors: Map<string, Set<string>>;
	thesisEvidenceSets: Map<string, Set<string>>;
	fingerprintStr: string;
	onOpenThesis: (thesisId: string) => void;
	onOpenFinding: (findingId: string) => void;
	externalHighlight?: string | null;
	summaryMode?: boolean;
}

export function useSigmaInstance({
	containerRef,
	visibleFindings,
	connections,
	theses,
	agentPositions,
	agentColorFn,
	neighbors,
	thesisEvidenceSets,
	fingerprintStr,
	onOpenThesis,
	onOpenFinding,
	externalHighlight,
	summaryMode = false,
}: UseSigmaParams) {
	const sigmaRef = useRef<Sigma | null>(null);
	const graphRef = useRef<Graph | null>(null);
	const prevDataRef = useRef<string | null>(null);
	const animFrameRef = useRef<number | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const onOpenThesisRef = useRef(onOpenThesis);
	onOpenThesisRef.current = onOpenThesis;
	const onOpenFindingRef = useRef(onOpenFinding);
	onOpenFindingRef.current = onOpenFinding;

	const [hoveredNode, setHoveredNode] = useState<string | null>(null);
	const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);

	const latestDataRef = useRef({
		visibleFindings,
		connections,
		theses,
		agentPositions,
		agentColorFn,
		neighbors,
	});
	latestDataRef.current = { visibleFindings, connections, theses, agentPositions, agentColorFn, neighbors };

	// Track whether we have high-emergence theses for animation
	const hasHighEmergenceRef = useRef(false);

	const summaryModeRef = useRef(summaryMode);
	summaryModeRef.current = summaryMode;

	// Animation loop function — only runs when high-emergence theses exist
	const startAnimationLoop = useCallback(() => {
		let lastRefresh = 0;
		const animate = (time: number) => {
			if (!sigmaRef.current) return;
			if (time - lastRefresh > ANIMATION_INTERVAL_MS) {
				sigmaRef.current.refresh();
				lastRefresh = time;
			}
			animFrameRef.current = requestAnimationFrame(animate);
		};
		animFrameRef.current = requestAnimationFrame(animate);
	}, []);

	// Incremental merge
	useEffect(() => {
		if (!sigmaRef.current || !graphRef.current || !prevDataRef.current) return;
		if (prevDataRef.current === fingerprintStr) return;

		const {
			visibleFindings: vf,
			connections: cn,
			theses: th,
			agentPositions: ap,
			agentColorFn: acf,
		} = latestDataRef.current;
		const graph = graphRef.current;
		const { added } = mergeGraph(graph, vf, cn, th, ap, acf);

		// Check for high-emergence theses to drive animation
		let hasHigh = false;
		graph.forEachNode((_node, attrs) => {
			if (attrs.nodeType === "thesis" && (attrs.emergence ?? 0) >= 3) hasHigh = true;
		});
		const hadHigh = hasHighEmergenceRef.current;
		hasHighEmergenceRef.current = hasHigh;

		// Start animation loop if we now have high-emergence and didn't before
		if (hasHigh && !hadHigh && !animFrameRef.current) {
			startAnimationLoop();
		}
		// Stop animation if no longer needed
		if (!hasHigh && animFrameRef.current) {
			cancelAnimationFrame(animFrameRef.current);
			animFrameRef.current = null;
		}

		prevDataRef.current = fingerprintStr;
		sigmaRef.current.refresh();

		// Re-fit camera when nodes are added so graph fills the viewport
		if (added.length > 0 && sigmaRef.current) {
			sigmaRef.current.getCamera().animatedReset({ duration: 300 });
		}
	}, [fingerprintStr, startAnimationLoop]);

	// One-time Sigma init
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		if (sigmaRef.current) return;
		if (latestDataRef.current.visibleFindings.length === 0 && latestDataRef.current.theses.length === 0) return;

		let cancelled = false;

		function init() {
			if (cancelled || !container) return;
			if (container.clientHeight === 0 || container.clientWidth === 0) {
				requestAnimationFrame(init);
				return;
			}

			const d = latestDataRef.current;
			const graph = buildGraph(d.visibleFindings, d.connections, d.theses, d.agentPositions, d.agentColorFn);
			graphRef.current = graph;

			const sigma = new Sigma(graph, container, {
				allowInvalidContainer: true,
				nodeProgramClasses: {
					circle: NodeCircleProgram,
					diamond: NodeDiamondProgram,
				},
				defaultNodeColor: GRAPH_COLORS.defaultNode,
				defaultNodeType: "circle",
				defaultEdgeColor: GRAPH_COLORS.defaultEdge,
				defaultEdgeType: "arrow",
				labelFont: '"Geist Mono", "SF Mono", Menlo, monospace',
				labelSize: 12,
				labelWeight: "500",
				labelColor: { color: "#888" },
				labelDensity: 0.7,
				labelGridCellSize: 200,
				labelRenderedSizeThreshold: 3,
				renderLabels: true,
				renderEdgeLabels: false,
				stagePadding: 80,
				minEdgeThickness: 0.8,
				zIndex: true,
				defaultDrawNodeLabel: (context, data, settings) => {
					if (summaryModeRef.current && data.nodeType !== "thesis" && !data.forceLabel) return;
					drawLabelBase(context, data, settings);
				},
				defaultDrawNodeHover: () => {},
				nodeReducer: (_node, data) => data,
				edgeReducer: (_edge, data) => data,
			});

			// ResizeObserver — debounced to avoid excessive refreshes
			resizeObserverRef.current?.disconnect();
			const resizeObserver = new ResizeObserver(() => {
				if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
				resizeTimerRef.current = setTimeout(() => {
					resizeTimerRef.current = null;
					if (container.clientWidth > 0 && container.clientHeight > 0 && sigmaRef.current) {
						sigmaRef.current.refresh();
					}
				}, 100);
			});
			resizeObserver.observe(container);
			resizeObserverRef.current = resizeObserver;

			// Auto-fit camera to graph bounds, then settle at 1.8 ratio for breathing room
		setTimeout(() => {
			if (sigmaRef.current) {
				sigmaRef.current.getCamera().setState({ ratio: 1.95, x: 0.5, y: 0.5 });
			}
		}, 50);

			sigma.on("enterNode", ({ node }) => {
				setHoveredNode(node);
				const attrs = graph.getNodeAttributes(node);
				const viewportPos = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
				const containerRect = container.getBoundingClientRect();
				setTooltipData({
					x: containerRect.left + viewportPos.x,
					y: containerRect.top + viewportPos.y,
					nodeType: attrs.nodeType as "finding" | "thesis",
					title: attrs.fullTitle || attrs.label || "",
					agent: attrs.agentId,
					confidence: attrs.confidence ?? 0,
					category: attrs.category,
					emergence: attrs.emergence,
					evidenceCount: attrs.evidenceCount,
					voteCount: attrs.voteCount,
					status: attrs.status,
					neighborCount: latestDataRef.current.neighbors.get(node)?.size ?? 0,
					refCount: attrs.refCount,
					round: attrs.round,
					description: attrs.description,
					tags: attrs.tags,
					supportVotes: attrs.supportVotes,
					challengeVotes: attrs.challengeVotes,
					evidenceAgentIds: attrs.evidenceAgentIds,
				});
			});
			sigma.on("leaveNode", () => {
				setHoveredNode(null);
				setTooltipData(null);
			});
			sigma.on("clickNode", ({ node }) => {
				if (node.startsWith("thesis:")) {
					onOpenThesisRef.current(node.slice(7));
				} else {
					onOpenFindingRef.current(node);
				}
			});

			sigmaRef.current = sigma;
			prevDataRef.current = fingerprintStr;

			// Check for high-emergence thesis nodes for animation
			let hasHigh = false;
			graph.forEachNode((_node, attrs) => {
				if (attrs.nodeType === "thesis" && (attrs.emergence ?? 0) >= 3) hasHigh = true;
			});
			hasHighEmergenceRef.current = hasHigh;
			if (hasHigh) {
				startAnimationLoop();
			}
		}

		requestAnimationFrame(init);

		return () => {
			cancelled = true;
		};
	}, [fingerprintStr, containerRef, startAnimationLoop]);

	// Tear down on unmount
	useEffect(() => {
		return () => {
			if (animFrameRef.current) {
				cancelAnimationFrame(animFrameRef.current);
				animFrameRef.current = null;
			}
			if (resizeTimerRef.current) {
				clearTimeout(resizeTimerRef.current);
				resizeTimerRef.current = null;
			}
			resizeObserverRef.current?.disconnect();
			resizeObserverRef.current = null;
			if (sigmaRef.current) {
				sigmaRef.current.kill();
				sigmaRef.current = null;
				graphRef.current = null;
				prevDataRef.current = null;
			}
		};
	}, []);

	// Hover highlighting reducers
	useEffect(() => {
		const sigma = sigmaRef.current;
		const graph = graphRef.current;
		if (!sigma || !graph) return;

		const effectiveHover = hoveredNode ?? externalHighlight ?? null;
		sigma.setSetting("nodeReducer", createNodeReducer(effectiveHover, neighbors, thesisEvidenceSets));
		sigma.setSetting("edgeReducer", createEdgeReducer(effectiveHover, graph, thesisEvidenceSets));
		sigma.refresh();
	}, [hoveredNode, externalHighlight, neighbors, thesisEvidenceSets]);

	const zoomIn = useCallback(() => sigmaRef.current?.getCamera().animatedZoom({ duration: 200 }), []);
	const zoomOut = useCallback(() => sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 }), []);
	const fitToGraph = useCallback(() => sigmaRef.current?.getCamera().animatedReset({ duration: 300 }), []);

	return { hoveredNode, tooltipData, zoomIn, zoomOut, fitToGraph };
}

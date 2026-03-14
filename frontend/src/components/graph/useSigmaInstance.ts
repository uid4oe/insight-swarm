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
	persistentHighlight?: boolean;
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
	persistentHighlight = false,
}: UseSigmaParams) {
	const sigmaRef = useRef<Sigma | null>(null);
	const graphRef = useRef<Graph | null>(null);
	const prevDataRef = useRef<string | null>(null);
	const animFrameRef = useRef<number | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedPositionsRef = useRef<Map<string, { x: number; y: number }> | null>(null);

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
		const { added, removed } = mergeGraph(graph, vf, cn, th, ap, acf);

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

		// Re-fit camera when the graph changes so it fills the viewport.
		// Reset camera state synchronously BEFORE refresh to avoid the
		// flash of the graph rendered at the old camera position.
		if ((added.length > 0 || removed.length > 0) && sigmaRef.current) {
			sigmaRef.current.getCamera().setState({ ratio: 1.2, x: 0.5, y: 0.5 });
		}

		sigmaRef.current.refresh();
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

			// Hide the container while Sigma initialises so the constructor's
			// first render (which uses the default camera) is never visible.
			container.style.visibility = "hidden";

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
				labelDensity: 1,
				labelGridCellSize: 60,
				labelRenderedSizeThreshold: 2,
				renderLabels: true,
				renderEdgeLabels: false,
				stagePadding: 80,
				minEdgeThickness: 0.8,
				zIndex: true,
				defaultDrawNodeLabel: drawLabelBase,
				defaultDrawNodeHover: () => {},
				nodeReducer: (_node, data) => data,
				edgeReducer: (_edge, data) => data,
			});

			// Set camera BEFORE the first visible paint
			sigma.getCamera().setState({ ratio: 1.2, x: 0.5, y: 0.5 });
			sigma.refresh();

			// Reveal on the next frame — the correct camera state is now painted
			requestAnimationFrame(() => {
				if (!cancelled && container) {
					container.style.visibility = "";
				}
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

			// Hide Sigma's hover WebGL + canvas layers so the hover node shape
			// doesn't paint on top of our centered labels.  Sigma's internal hover
			// detection still works (enterNode / leaveNode fire correctly).
			// biome-ignore lint/suspicious/noExplicitAny: accessing internal sigma layers
			const sigmaAny = sigma as any;
			if (sigmaAny.webGLContexts?.hoverNodes?.canvas) {
				sigmaAny.webGLContexts.hoverNodes.canvas.style.display = "none";
			}
			if (sigmaAny.canvasContexts?.hovers?.canvas) {
				sigmaAny.canvasContexts.hovers.canvas.style.display = "none";
			}

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
			savedPositionsRef.current = null;
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

		// When a thesis is persistently selected, always use it as the focus —
		// hovering nodes within the selection shouldn't reveal unrelated nodes
		const effectiveHover =
			persistentHighlight && externalHighlight ? externalHighlight : (hoveredNode ?? externalHighlight ?? null);
		const isPersistent = persistentHighlight && !!externalHighlight;
		sigma.setSetting("nodeReducer", createNodeReducer(effectiveHover, neighbors, thesisEvidenceSets, isPersistent));
		sigma.setSetting("edgeReducer", createEdgeReducer(effectiveHover, graph, thesisEvidenceSets));
		sigma.refresh();
	}, [hoveredNode, externalHighlight, persistentHighlight, neighbors, thesisEvidenceSets]);

	// Camera focus + radial layout: reposition visible nodes when persistent selection is active
	const prevPersistentRef = useRef(false);
	useEffect(() => {
		const sigma = sigmaRef.current;
		const graph = graphRef.current;
		if (!sigma || !graph) return;

		const wasPersistent = prevPersistentRef.current;
		const isPersistent = persistentHighlight && !!externalHighlight;
		prevPersistentRef.current = isPersistent;

		if (isPersistent && externalHighlight) {
			const evidenceSet = thesisEvidenceSets.get(externalHighlight);
			if (!evidenceSet) return;

			// Save original positions on first selection; restore them before re-laying out
			// so bounding box is always computed from the original layout
			if (!savedPositionsRef.current) {
				const saved = new Map<string, { x: number; y: number }>();
				graph.forEachNode((node, attrs) => {
					saved.set(node, { x: attrs.x, y: attrs.y });
				});
				savedPositionsRef.current = saved;
			} else {
				// Switching theses — restore originals before computing new radial
				for (const [node, pos] of savedPositionsRef.current) {
					if (graph.hasNode(node)) {
						graph.setNodeAttribute(node, "x", pos.x);
						graph.setNodeAttribute(node, "y", pos.y);
					}
				}
			}

			// Compute bounding box from original positions
			let gMinX = Number.POSITIVE_INFINITY;
			let gMaxX = Number.NEGATIVE_INFINITY;
			let gMinY = Number.POSITIVE_INFINITY;
			let gMaxY = Number.NEGATIVE_INFINITY;
			graph.forEachNode((_n, attrs) => {
				gMinX = Math.min(gMinX, attrs.x);
				gMaxX = Math.max(gMaxX, attrs.x);
				gMinY = Math.min(gMinY, attrs.y);
				gMaxY = Math.max(gMaxY, attrs.y);
			});
			const centerX = (gMinX + gMaxX) / 2;
			const centerY = (gMinY + gMaxY) / 2;
			const gRangeX = gMaxX - gMinX || 1;
			const gRangeY = gMaxY - gMinY || 1;
			const gRange = Math.max(gRangeX, gRangeY);

			// Place thesis at center, evidence findings in a ring
			const evidenceArr = [...evidenceSet].filter((id) => graph.hasNode(id));
			const ringRadius = gRange * 0.25;
			const n = evidenceArr.length;

			if (graph.hasNode(externalHighlight)) {
				graph.setNodeAttribute(externalHighlight, "x", centerX);
				graph.setNodeAttribute(externalHighlight, "y", centerY);
			}
			for (let i = 0; i < n; i++) {
				const angle = (2 * Math.PI * i) / n - Math.PI / 2;
				graph.setNodeAttribute(evidenceArr[i], "x", centerX + Math.cos(angle) * ringRadius);
				graph.setNodeAttribute(evidenceArr[i], "y", centerY + Math.sin(angle) * ringRadius);
			}

			// Camera: center on the thesis node's actual position after layout
			sigma.refresh();

			// Recompute bounding box after repositioning so camera targets the right spot
			let postMinX = Number.POSITIVE_INFINITY;
			let postMaxX = Number.NEGATIVE_INFINITY;
			let postMinY = Number.POSITIVE_INFINITY;
			let postMaxY = Number.NEGATIVE_INFINITY;
			graph.forEachNode((_n, attrs) => {
				postMinX = Math.min(postMinX, attrs.x);
				postMaxX = Math.max(postMaxX, attrs.x);
				postMinY = Math.min(postMinY, attrs.y);
				postMaxY = Math.max(postMaxY, attrs.y);
			});
			const postRangeX = postMaxX - postMinX || 1;
			const postRangeY = postMaxY - postMinY || 1;
			const normX = (centerX - postMinX) / postRangeX;
			const normY = (centerY - postMinY) / postRangeY;

			const ringFrac = (ringRadius * 2) / gRange;
			const ratio = Math.max(ringFrac * 1.4, 0.12);
			sigma.getCamera().animate({ x: normX, y: normY, ratio }, { duration: 400 });
		} else if (wasPersistent && !isPersistent) {
			// Restore original positions
			if (savedPositionsRef.current) {
				for (const [node, pos] of savedPositionsRef.current) {
					if (graph.hasNode(node)) {
						graph.setNodeAttribute(node, "x", pos.x);
						graph.setNodeAttribute(node, "y", pos.y);
					}
				}
				savedPositionsRef.current = null;
				sigma.refresh();
			}
			sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1.2 }, { duration: 400 });
		}
	}, [persistentHighlight, externalHighlight, thesisEvidenceSets]);

	const zoomIn = useCallback(() => sigmaRef.current?.getCamera().animatedZoom({ duration: 200 }), []);
	const zoomOut = useCallback(() => sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 }), []);
	const fitToGraph = useCallback(() => sigmaRef.current?.getCamera().animatedReset({ duration: 300 }), []);

	return { hoveredNode, tooltipData, zoomIn, zoomOut, fitToGraph };
}

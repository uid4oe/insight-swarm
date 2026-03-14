import { memo, useMemo, useRef, useState } from "react";
import type { AgentMap } from "../../lib/agents";
import { getAgentColor, getAgentLabel } from "../../lib/agents";
import { RELATIONSHIP_COLORS } from "../../lib/constants";
import { useAppStore } from "../../lib/store";
import type { AgentId, AgentMeta, Connection, Finding, InvestmentThesis } from "../../lib/types";
import { useGraphData } from "./useGraphData";
import type { TooltipData } from "./useSigmaInstance";
import { useSigmaInstance } from "./useSigmaInstance";

interface Props {
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	agentMeta: AgentMeta[];
	hiddenAgents?: Set<string>;
	onOpenThesis: (thesisId: string) => void;
	onOpenFinding: (findingId: string) => void;
	onOpenAgent?: (agentId: AgentId) => void;
	onToggleAgent?: (agentId: AgentId) => void;
	summaryMode?: boolean;
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_MARGIN = 14;

const NodeTooltip = memo(function NodeTooltip({ data, agentMap }: { data: TooltipData; agentMap: AgentMap }) {
	const isThesis = data.nodeType === "thesis";
	const descSnippet = data.description
		? data.description.length > 80
			? `${data.description.slice(0, 78)}...`
			: data.description
		: null;

	const winW = window.innerWidth;
	const winH = window.innerHeight;
	let left = data.x + TOOLTIP_MARGIN;
	let top = data.y - 10;
	if (left + TOOLTIP_WIDTH > winW - 10) left = data.x - TOOLTIP_WIDTH - TOOLTIP_MARGIN;
	if (top + 150 > winH) top = winH - 160;
	if (top < 10) top = 10;

	return (
		<div
			className="pointer-events-none fixed z-50 max-w-[320px] animate-fade-in rounded-md border border-border bg-panel px-4 py-3.5 shadow-[--shadow-popup]"
			style={{ left, top }}
		>
			<div className="mb-1 flex items-center gap-1.5 text-meta font-semibold leading-tight text-text-primary">
				{isThesis && <span className="text-thesis">★</span>}
				{data.round != null && <span className="chip text-micro shrink-0">R{data.round}</span>}
				<span>{data.title}</span>
			</div>

			{descSnippet && <div className="mb-1.5 text-micro leading-relaxed text-text-tertiary">{descSnippet}</div>}

			<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-micro text-muted">
				{data.agent && (
					<span className="flex items-center gap-1">
						<span className="status-dot" style={{ color: getAgentColor(data.agent, agentMap) }} />
						{getAgentLabel(data.agent, agentMap)}
					</span>
				)}
				<span>
					conf <span className="text-text-secondary">{Math.round(data.confidence * 100)}%</span>
				</span>
				{data.category && <span className="text-text-tertiary">{data.category}</span>}
				{data.emergence != null && data.emergence > 0 && (
					<span>
						emergence{" "}
						<span className={data.emergence >= 3 ? "text-emergence-high" : "text-text-secondary"}>
							{data.emergence}
						</span>
					</span>
				)}
				{isThesis && (data.supportVotes ?? 0) + (data.challengeVotes ?? 0) > 0 && (
					<span className="flex items-center gap-1.5">
						{(data.supportVotes ?? 0) > 0 && <span className="text-success">{data.supportVotes}▲</span>}
						{(data.challengeVotes ?? 0) > 0 && <span className="text-error">{data.challengeVotes}▼</span>}
					</span>
				)}
				{data.evidenceCount != null && (
					<span>
						evidence <span className="text-text-secondary">{data.evidenceCount}</span>
					</span>
				)}
				{data.status && (
					<span
						className={
							data.status === "validated"
								? "text-success"
								: data.status === "refined"
									? "text-rel-enables"
									: "text-text-tertiary"
						}
					>
						{data.status}
					</span>
				)}
				{data.refCount != null && data.refCount > 0 && (
					<span>
						refs <span className="text-accent">{data.refCount}</span>
					</span>
				)}
				{data.neighborCount > 0 && (
					<span>
						links <span className="text-text-secondary">{data.neighborCount}</span>
					</span>
				)}
			</div>

			{isThesis && data.evidenceAgentIds && data.evidenceAgentIds.length > 0 && (
				<div className="mt-1 flex items-center gap-1 text-micro text-dim">
					<span>Evidence from</span>
					{data.evidenceAgentIds.map((id) => (
						<span key={id} className="font-bold uppercase" style={{ color: getAgentColor(id, agentMap) }}>
							{getAgentLabel(id, agentMap)}
						</span>
					))}
				</div>
			)}

			{!isThesis && data.tags && data.tags.length > 0 && (
				<div className="mt-1 flex flex-wrap gap-1">
					{data.tags.slice(0, 5).map((tag) => (
						<span key={tag} className="rounded-sm bg-surface px-1.5 py-0.5 text-micro text-dim">
							{tag}
						</span>
					))}
				</div>
			)}

			<div className="mt-1 text-micro text-dim">click to inspect</div>
		</div>
	);
});

const EMPTY_HIDDEN: Set<string> = new Set();

const REL_LEGEND = [
	{ key: "supports" as const, label: "Supports", color: RELATIONSHIP_COLORS.supports },
	{ key: "contradicts" as const, label: "Contradicts", color: RELATIONSHIP_COLORS.contradicts },
	{ key: "enables" as const, label: "Enables", color: RELATIONSHIP_COLORS.enables },
	{ key: "amplifies" as const, label: "Amplifies", color: RELATIONSHIP_COLORS.amplifies },
];

export function KnowledgeGraph({
	findings,
	connections,
	theses,
	agentMeta,
	hiddenAgents = EMPTY_HIDDEN,
	onOpenThesis,
	onOpenFinding,
	onOpenAgent,
	onToggleAgent,
	summaryMode = false,
}: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [connectedOnly, setConnectedOnly] = useState(true);
	const highlightedThesisId = useAppStore((s) => s.highlightedThesisId);

	// Filter by hidden agents
	const filteredFindings = useMemo(() => {
		if (hiddenAgents.size === 0) return findings;
		return findings.filter((f) => !hiddenAgents.has(f.agent_id));
	}, [findings, hiddenAgents]);

	const filteredConnections = useMemo(() => {
		const ids = new Set(filteredFindings.map((f) => f.id));
		return connections.filter((c) => ids.has(c.from_finding_id) && ids.has(c.to_finding_id));
	}, [connections, filteredFindings]);

	const filteredTheses = useMemo(() => theses, [theses]);

	const {
		agentMap,
		activeAgents,
		agentPositions,
		agentColorFn,
		neighbors,
		visibleFindings,
		fingerprintStr,
		thesisEvidenceSets,
		hiddenCount,
		connectionStats,
	} = useGraphData(filteredFindings, filteredConnections, filteredTheses, agentMeta, hiddenAgents, connectedOnly);

	const { hoveredNode, tooltipData, zoomIn, zoomOut, fitToGraph } = useSigmaInstance({
		containerRef,
		visibleFindings,
		connections: filteredConnections,
		theses: filteredTheses,
		agentPositions,
		agentColorFn,
		neighbors,
		thesisEvidenceSets,
		fingerprintStr,
		onOpenThesis,
		onOpenFinding,
		externalHighlight: highlightedThesisId ? `thesis:${highlightedThesisId}` : null,
		summaryMode,
	});

	if (findings.length === 0) return null;

	const showIntegratedAgents = !!onOpenAgent && !!onToggleAgent;

	return (
		<div className="flex h-full flex-col">
			{/* ── Legend bar — single row, evenly distributed ── */}
			<div className="flex items-center border-b border-border/60 px-2 py-1.5">
				{/* Finding */}
				<div className="flex flex-1 items-center justify-center gap-1.5">
					<svg width="8" height="8" viewBox="0 0 10 10">
						<title>Finding</title>
						<circle cx="5" cy="5" r="4" fill="var(--color-muted)" />
					</svg>
					<span className="text-[11px] text-dim">Finding</span>
					<span className="text-[11px] tabular-nums text-text-secondary">{visibleFindings.length}</span>
				</div>

				{/* Thesis */}
				<div className="flex flex-1 items-center justify-center gap-1.5">
					<svg width="8" height="8" viewBox="0 0 10 10">
						<title>Thesis</title>
						<polygon points="5,0.5 9.5,5 5,9.5 0.5,5" fill="var(--color-thesis)" />
					</svg>
					<span className="text-[11px] text-dim">Thesis</span>
					{filteredTheses.length > 0 && (
						<span className="text-[11px] tabular-nums text-text-secondary">{filteredTheses.length}</span>
					)}
				</div>

				{/* Relationship types — always visible as legend */}
				{REL_LEGEND.map((rel) => {
					const count = connectionStats[rel.key];
					return (
						<div key={rel.key} className="flex flex-1 items-center justify-center gap-1.5">
							<span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: rel.color }} />
							<span className="text-[11px]" style={{ color: rel.color }}>
								{rel.label}
							</span>
							{count > 0 && <span className="text-[11px] tabular-nums text-text-secondary">{count}</span>}
						</div>
					);
				})}

				{/* Linked toggle */}
				<div className="flex flex-1 items-center justify-center">
					<button
						type="button"
						onClick={() => setConnectedOnly((v) => !v)}
						className={`shrink-0 cursor-pointer rounded-md border bg-transparent px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
							connectedOnly
								? "border-accent-strong/50 text-accent-strong"
								: "border-border-light text-dim hover:border-border-light hover:text-muted"
						}`}
					>
						Linked
						{connectedOnly && hiddenCount > 0 && <span className="ml-1 text-dim">+{hiddenCount}</span>}
					</button>
				</div>
			</div>

			{/* ── Integrated agent bar (completed view) — full-width evenly distributed ── */}
			{showIntegratedAgents && activeAgents.length > 0 && (
				<div className="flex items-center border-b border-border/60 px-2 py-1">
					{activeAgents.map((id) => {
						const color = getAgentColor(id, agentMap);
						const label = getAgentLabel(id, agentMap);
						const isHidden = hiddenAgents.has(id);
						return (
							<button
								key={id}
								type="button"
								className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-0.5 cursor-pointer text-[11px] transition-colors hover:bg-surface/60"
								style={{ opacity: isHidden ? 0.35 : 1 }}
								onClick={() => onOpenAgent(id)}
								onContextMenu={(e) => {
									e.preventDefault();
									onToggleAgent(id);
								}}
								title={`${label}${isHidden ? " (hidden)" : ""} · Right-click to toggle`}
							>
								<span
									className="inline-block h-2 w-2 rounded-full shrink-0"
									style={{ backgroundColor: isHidden ? "var(--color-text-tertiary)" : color }}
								/>
								<span
									className="font-medium truncate"
									style={{ color: isHidden ? "var(--color-text-tertiary)" : color }}
								>
									{label}
								</span>
							</button>
						);
					})}
				</div>
			)}

			{/* ── Canvas ── */}
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<div
					ref={containerRef}
					className="absolute inset-0 rounded-md bg-graph-bg"
					style={{ cursor: hoveredNode ? "pointer" : "grab" }}
				/>

				{connectedOnly && visibleFindings.length === 0 && filteredTheses.length === 0 && (
					<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
						<div className="flex items-center gap-2">
							{activeAgents.map((agent) => (
								<span
									key={agent}
									className="inline-block h-2 w-2 rounded-full opacity-50"
									style={{ backgroundColor: getAgentColor(agent, agentMap) }}
								/>
							))}
						</div>
						<span className="text-[13px] text-text-tertiary">No connected findings yet</span>
						<span className="text-[12px] text-text-quaternary">
							Connections will appear as agents discover relationships
						</span>
						<button
							type="button"
							onClick={() => setConnectedOnly(false)}
							className="pointer-events-auto cursor-pointer rounded-md border border-border/40 bg-transparent px-3 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:border-border hover:text-text-secondary"
						>
							Show all {filteredFindings.length} findings
						</button>
					</div>
				)}

				{/* Zoom controls */}
				<div className="absolute bottom-3 left-3 z-20 flex flex-col gap-1">
					<button type="button" onClick={zoomIn} className="btn-icon" title="Zoom in (+)" aria-label="Zoom in">
						+
					</button>
					<button type="button" onClick={zoomOut} className="btn-icon" title="Zoom out (-)" aria-label="Zoom out">
						-
					</button>
					<button
						type="button"
						onClick={fitToGraph}
						className="btn-icon text-[11px]"
						title="Fit to graph (0)"
						aria-label="Fit graph to view"
					>
						◎
					</button>
				</div>

				{/* Tooltip */}
				{tooltipData && <NodeTooltip data={tooltipData} agentMap={agentMap} />}
			</div>
		</div>
	);
}

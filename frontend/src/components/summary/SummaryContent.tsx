import { useCallback, useMemo, useState } from "react";
import { buildAgentMap, getAgentColor, getAgentLabel } from "../../lib/agents";
import { useAppStore } from "../../lib/store";
import type { AgentMeta, InvestmentThesis, StructuredSummary } from "../../lib/types";
import { AgentDots } from "./AgentDots";
import { CollapsibleSection } from "./CollapsibleSection";
import { ConfidenceBar } from "./ConfidenceBar";
import { DebateHealth } from "./DebateHealth";
import { NarrativeTimeline } from "./NarrativeTimeline";

const PRIORITY_COLORS = {
	high: "pill-error",
	medium: "pill-warning",
	low: "text-text-tertiary bg-surface",
} as const;

const CONSENSUS_COLORS = {
	strong: "pill-success",
	mixed: "pill-warning",
	contested: "pill-error",
} as const;

interface Props {
	summary: StructuredSummary;
	agentMeta?: AgentMeta[];
	theses?: InvestmentThesis[];
	onOpenThesis?: (thesisId: string) => void;
}

function summaryToText(s: StructuredSummary): string {
	const lines: string[] = [];
	lines.push(s.headline, "", s.overview, "");
	lines.push(
		`Stats: ${s.stats.findings} findings, ${s.stats.connections} connections, ${s.stats.theses} theses, ${s.stats.agentsActive} agents`,
		"",
	);
	if (s.theses.length > 0) {
		lines.push("## Theses");
		for (const t of s.theses)
			lines.push(`- ${t.title} (${Math.round(t.confidence * 100)}%, ${t.consensus}): ${t.oneLiner}`);
		lines.push("");
	}
	if (s.recommendations.length > 0) {
		lines.push("## Next Steps");
		for (const r of s.recommendations)
			lines.push(`- [${r.priority}] ${r.action}${r.reasoning ? ` — ${r.reasoning}` : ""}`);
		lines.push("");
	}
	if (s.riskMatrix.length > 0) {
		lines.push("## Risks");
		for (const r of s.riskMatrix) lines.push(`- [${r.severity}] ${r.title}: ${r.description}`);
		lines.push("");
	}
	if (s.keyDebates?.length) {
		lines.push("## Key Debates");
		for (const d of s.keyDebates) lines.push(`- ${d.topic} (${d.resolution.replace("_", " ")}): ${d.summary}`);
		lines.push("");
	}
	return lines.join("\n");
}

export function SummaryContent({ summary, agentMeta, theses: realTheses, onOpenThesis }: Props) {
	const agentMap = useMemo(() => buildAgentMap(agentMeta), [agentMeta]);
	const setHighlight = useAppStore((s) => s.setHighlightedThesis);
	const setSelectedGraphThesis = useAppStore((s) => s.setSelectedGraphThesis);
	const selectedGraphThesisId = useAppStore((s) => s.selectedGraphThesisId);
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(summaryToText(summary)).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}, [summary]);

	const thesisIdByTitle = useMemo(() => {
		const map = new Map<string, string>();
		for (const t of summary.theses) {
			if (t.id) map.set(t.title, t.id);
		}
		if (realTheses) {
			for (const t of realTheses) {
				if (!map.has(t.title)) map.set(t.title, t.id);
			}
		}
		return map;
	}, [summary.theses, realTheses]);

	// Map thesis ID → graph label (T1, T2, ...) matching graphBuilder order
	const thesisGraphLabel = useMemo(() => {
		const map = new Map<string, string>();
		if (realTheses) {
			for (let i = 0; i < realTheses.length; i++) {
				map.set(realTheses[i].id, `T${i + 1}`);
			}
		}
		return map;
	}, [realTheses]);

	const getThesisId = (title: string): string | undefined => thesisIdByTitle.get(title);

	const handleThesisClick = (title: string) => {
		const thesisId = thesisIdByTitle.get(title);
		if (thesisId) setSelectedGraphThesis(thesisId);
	};

	const handleThesisDetailClick = (e: React.MouseEvent, title: string) => {
		e.stopPropagation();
		if (!onOpenThesis) return;
		const thesisId = thesisIdByTitle.get(title);
		if (thesisId) onOpenThesis(thesisId);
	};

	return (
		<div className="space-y-5">
			{/* ── Headline + Overview ──────────────────────────────────── */}
			<div>
				<div className="flex items-start justify-between gap-2">
					<h3 className="text-[22px] font-semibold leading-snug tracking-tight text-text-primary">
						{summary.headline}
					</h3>
					<button
						type="button"
						onClick={handleCopy}
						className="shrink-0 mt-1 cursor-pointer border-none bg-transparent text-dim hover:text-text-secondary transition-colors"
						title="Copy summary as text"
						aria-label={copied ? "Copied" : "Copy summary as text"}
					>
						{copied ? "✓" : "⎘"}
					</button>
				</div>
				<p className="mt-2 text-body text-text-secondary leading-relaxed">{summary.overview}</p>
			</div>

			{/* ── Stats (compact inline) ───────────────────────────────── */}
			<div className="text-meta whitespace-nowrap">
				<span className="tabular-nums text-text-tertiary">{summary.stats.findings}</span>f
				<span className="mx-1 text-dim">·</span>
				<span className="tabular-nums text-text-tertiary">{summary.stats.connections}</span>c
				<span className="mx-1 text-dim">·</span>
				<span className="tabular-nums text-text-tertiary">{summary.stats.theses}</span> theses
				<span className="mx-1 text-dim">·</span>
				<span className="tabular-nums text-text-tertiary">{summary.stats.agentsActive}</span> agents
			</div>

			{/* ── Theses ──────────────────────────────────────────────── */}
			{summary.theses.length > 0 && (
				<CollapsibleSection title="Theses" count={summary.theses.length} defaultOpen>
					<div className="space-y-px">
						{summary.theses.map((o) => {
							const consensusColor = CONSENSUS_COLORS[o.consensus];
							const realThesis = realTheses?.find((rt) => rt.title === o.title || rt.id === o.id);
							const challengeCount = realThesis?.votes.filter((v) => v.vote === "challenge").length ?? 0;
							const thesisId = getThesisId(o.title);
							const isSelected = thesisId != null && thesisId === selectedGraphThesisId;
							return (
								<button
									type="button"
									key={o.id ?? o.title}
									className={`w-full text-left rounded-md px-3 py-2.5 cursor-pointer transition-colors ${
										isSelected
											? "bg-accent-strong/10 border border-accent-strong/30"
											: "hover:bg-surface/60 border border-transparent"
									}`}
									onClick={() => handleThesisClick(o.title)}
									onMouseEnter={() => {
										if (thesisId && !selectedGraphThesisId) setHighlight(thesisId);
									}}
									onMouseLeave={() => {
										if (!selectedGraphThesisId) setHighlight(null);
									}}
								>
									<div className="flex items-start gap-2">
										{thesisId && thesisGraphLabel.get(thesisId) && (
											<span className="shrink-0 mt-0.5 rounded bg-thesis/20 px-2 py-1 font-mono text-[13px] font-bold text-thesis">
												{thesisGraphLabel.get(thesisId)}
											</span>
										)}
										<div className="min-w-0 flex-1">
											<div className="flex items-start justify-between gap-2">
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-1.5 flex-wrap">
														<span className="text-[13px] font-medium text-text-primary leading-snug">{o.title}</span>
														<span className={`pill text-[10px] font-semibold ${consensusColor}`}>{o.consensus}</span>
														{challengeCount > 0 && (
															<span className="pill text-[10px] font-semibold pill-error">
																⚡ {challengeCount} {challengeCount === 1 ? "challenge" : "challenges"}
															</span>
														)}
														{isSelected && (
															<button
																type="button"
																className="pill text-[10px] font-semibold text-accent-strong bg-accent-strong/15 cursor-pointer hover:bg-accent-strong/25 border-none"
																onClick={(e) => handleThesisDetailClick(e, o.title)}
															>
																view details
															</button>
														)}
													</div>
													<div className="mt-0.5 text-body text-text-tertiary leading-snug">{o.oneLiner}</div>
												</div>
												<ConfidenceBar value={o.confidence} />
											</div>
										</div>
									</div>
								</button>
							);
						})}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Recommendations ─────────────────────────────────────── */}
			{summary.recommendations.length > 0 && (
				<CollapsibleSection title="Next Steps" count={summary.recommendations.length} defaultOpen>
					<div className="space-y-1">
						{summary.recommendations.map((r) => (
							<div key={r.action} className="flex items-start gap-2.5 px-1 py-2">
								<span className={`pill text-[10px] font-semibold shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority]}`}>
									{r.priority}
								</span>
								<div className="min-w-0 flex-1">
									<span className="text-body leading-snug">{r.action}</span>
									{r.reasoning && <div className="mt-0.5 text-body text-text-tertiary leading-snug">{r.reasoning}</div>}
								</div>
							</div>
						))}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Risks & Challenges ─────────────────────────────────── */}
			{summary.riskMatrix.length > 0 && (
				<CollapsibleSection title="Risks & Challenges" count={summary.riskMatrix.length} defaultOpen>
					<div className="space-y-1">
						{summary.riskMatrix.map((r) => {
							const sevColor =
								r.severity === "high"
									? "pill-error"
									: r.severity === "medium"
										? "pill-warning"
										: "text-text-tertiary bg-surface";
							return (
								<div key={r.title} className="flex items-start gap-2.5 px-1 py-2">
									<span className={`pill text-[10px] font-semibold shrink-0 mt-0.5 ${sevColor}`}>{r.severity}</span>
									<div className="min-w-0 flex-1">
										<span className="text-body leading-snug">{r.title}</span>
										<div className="mt-0.5 text-body text-text-tertiary leading-snug">{r.description}</div>
									</div>
								</div>
							);
						})}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Key Debates ─────────────────────────────────────────── */}
			{summary.keyDebates && summary.keyDebates.length > 0 && (
				<CollapsibleSection title="Key Debates" count={summary.keyDebates.length} defaultOpen>
					<div className="space-y-2">
						{summary.keyDebates.map((d) => {
							const resColor =
								d.resolution === "resolved"
									? "pill-success"
									: d.resolution === "unresolved"
										? "pill-error"
										: "pill-warning";
							return (
								<div key={d.topic} className="flex items-start justify-between gap-2 px-1 py-1.5">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5 flex-wrap">
											<span className="text-[13px] font-medium text-text-primary leading-snug">{d.topic}</span>
											<span className={`pill text-[10px] font-semibold ${resColor}`}>
												{d.resolution.replace("_", " ")}
											</span>
										</div>
										<div className="mt-0.5 text-body text-text-tertiary leading-relaxed">{d.summary}</div>
									</div>
									<AgentDots agents={d.agents} agentMap={agentMap} />
								</div>
							);
						})}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Evidence Chains ─────────────────────────────────────── */}
			{summary.evidenceChains.length > 0 && (
				<CollapsibleSection title="Evidence Chains" count={summary.evidenceChains.length} defaultOpen={false}>
					<div className="space-y-3">
						{summary.evidenceChains.map((ec) => {
							const consensusColor = CONSENSUS_COLORS[ec.consensus];
							return (
								<div key={ec.thesisId}>
									<div className="flex items-center justify-between gap-2 mb-1.5 px-1">
										<button
											type="button"
											className="text-[13px] font-medium text-text-secondary leading-snug cursor-pointer hover:text-text-primary transition-colors text-left"
											onClick={() => onOpenThesis?.(ec.thesisId)}
											onMouseEnter={() => setHighlight(ec.thesisId)}
											onMouseLeave={() => setHighlight(null)}
										>
											{ec.thesisTitle}
										</button>
										<div className="flex items-center gap-1.5 shrink-0">
											<span className={`pill text-[10px] font-semibold ${consensusColor}`}>{ec.consensus}</span>
											<ConfidenceBar value={ec.confidence} />
										</div>
									</div>

									<div className="relative ml-2 border-l border-border/40 pl-3 space-y-1">
										{ec.chain.map((link) => {
											const linkColor = getAgentColor(link.agent, agentMap);
											const roleLabel = link.role === "primary" ? "●" : link.role === "supporting" ? "○" : "·";
											return (
												<div key={link.findingId} className="relative flex items-start gap-1.5">
													<span
														className="shrink-0 mt-1 text-[10px] leading-none"
														style={{ color: linkColor }}
														title={link.role}
													>
														{roleLabel}
													</span>
													<div className="min-w-0 flex-1">
														<div className="flex items-baseline gap-1 flex-wrap">
															<span className="text-agent-inline font-medium" style={{ color: linkColor }}>
																{getAgentLabel(link.agent, agentMap)}
															</span>
															<span className="text-body text-text-tertiary leading-snug">{link.findingTitle}</span>
														</div>
														{link.connectionTo && (
															<span className="text-meta text-dim">
																→ {link.connectionTo.relationship} ({(link.connectionTo.strength * 100).toFixed(0)}%)
															</span>
														)}
													</div>
													<span className="text-meta tabular-nums shrink-0">{Math.round(link.confidence * 100)}%</span>
												</div>
											);
										})}
									</div>

									{ec.challengeVotes.length > 0 && (
										<div className="mt-1.5 pt-1.5 border-t border-border/30 pl-1">
											{ec.challengeVotes.map((cv) => (
												<div key={`${ec.thesisId}-${cv.agent}`} className="flex items-start gap-1.5 text-body">
													<span className="text-error text-[10px] mt-0.5 shrink-0">⚡</span>
													<span
														className="text-agent-inline font-medium shrink-0"
														style={{ color: getAgentColor(cv.agent, agentMap) }}
													>
														{getAgentLabel(cv.agent, agentMap)}
													</span>
													<span className="text-text-tertiary leading-snug">{cv.reasoning}</span>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Themes ─────────────────────────────────────────────── */}
			{summary.themes.length > 0 && (
				<CollapsibleSection title="Themes" count={summary.themes.length} defaultOpen={false}>
					<div className="space-y-1">
						{summary.themes.map((t) => (
							<div key={t.name} className="flex items-start justify-between gap-2 px-1 py-2">
								<div className="min-w-0 flex-1">
									<div className="text-[13px] font-medium text-text-primary leading-snug">{t.name}</div>
									<div className="mt-0.5 text-body text-text-tertiary leading-snug">{t.description}</div>
								</div>
								<AgentDots agents={t.agents} agentMap={agentMap} />
							</div>
						))}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Debate Health ───────────────────────────────────────── */}
			<CollapsibleSection title="Debate Health" defaultOpen>
				<DebateHealth
					score={summary.disagreementScore}
					confidenceDist={summary.confidenceDistribution}
					keyDebates={summary.keyDebates}
				/>
			</CollapsibleSection>

			{/* ── Tensions ───────────────────────────────────────────── */}
			{summary.tensionMap.length > 0 && (
				<CollapsibleSection title="Tensions & Contradictions" count={summary.tensionMap.length} defaultOpen={false}>
					<div className="space-y-2">
						{summary.tensionMap.map((t) => (
							<div key={t.id} className="flex items-start gap-2 px-1 py-1.5">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="var(--color-warning)"
									strokeWidth="2"
									className="shrink-0 mt-0.5"
								>
									<title>Tension</title>
									<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
									<line x1="12" y1="9" x2="12" y2="13" />
									<line x1="12" y1="17" x2="12.01" y2="17" />
								</svg>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1.5 flex-wrap text-body leading-snug">
										<span
											className="text-agent-inline font-medium"
											style={{ color: getAgentColor(t.findingA.agent, agentMap) }}
										>
											{getAgentLabel(t.findingA.agent, agentMap)}
										</span>
										<span className="text-dim">vs</span>
										<span
											className="text-agent-inline font-medium"
											style={{ color: getAgentColor(t.findingB.agent, agentMap) }}
										>
											{getAgentLabel(t.findingB.agent, agentMap)}
										</span>
									</div>
									<div className="mt-0.5 text-body text-text-tertiary leading-snug">{t.reasoning}</div>
								</div>
							</div>
						))}
					</div>
				</CollapsibleSection>
			)}

			{/* ── Narrative Timeline ─────────────────────────────────── */}
			{summary.narrative.length > 0 && (
				<CollapsibleSection title="Collaboration Timeline" count={summary.narrative.length} defaultOpen={false}>
					<NarrativeTimeline events={summary.narrative} agentMap={agentMap} />
				</CollapsibleSection>
			)}
		</div>
	);
}

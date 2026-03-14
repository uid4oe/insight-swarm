import { useMemo } from "react";
import type { AgentMeta, Connection, EvidenceItem, Finding } from "../../lib/types";
import { ConnectionEdge } from "./ConnectionEdge";
import { FindingNode } from "./FindingNode";

interface Props {
	findings: Finding[];
	connections: Connection[];
	reactionChains: Record<string, Finding[]>;
	evidenceItems: EvidenceItem[];
	agentMeta?: AgentMeta[];
}

const RELEVANCE_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
	primary: {
		label: "Primary Evidence",
		color: "var(--color-relevance-primary)",
		bg: "bg-relevance-primary/[0.06]",
		border: "border-[var(--color-relevance-primary-border)]",
	},
	supporting: {
		label: "Supporting Evidence",
		color: "var(--color-relevance-supporting)",
		bg: "bg-relevance-supporting/[0.04]",
		border: "border-[var(--color-relevance-supporting-border)]",
	},
	contextual: {
		label: "Context",
		color: "var(--color-relevance-contextual)",
		bg: "bg-relevance-contextual/[0.05]",
		border: "border-[var(--color-relevance-contextual-border)]",
	},
};

export function EvidenceChain({ findings, connections, reactionChains, evidenceItems, agentMeta = [] }: Props) {
	const findingIds = useMemo(() => new Set(findings.map((f) => f.id)), [findings]);

	const evidenceMap = useMemo(() => {
		const map = new Map<string, EvidenceItem>();
		for (const item of evidenceItems) {
			map.set(item.finding_id, item);
		}
		return map;
	}, [evidenceItems]);

	const grouped = useMemo(() => {
		const groups: Record<string, Finding[]> = {
			primary: [],
			supporting: [],
			contextual: [],
		};
		for (const finding of findings) {
			const ev = evidenceMap.get(finding.id);
			const tier = ev?.relevance ?? "supporting";
			groups[tier].push(finding);
		}
		return groups;
	}, [findings, evidenceMap]);

	if (findings.length === 0) return null;

	const tiers = ["primary", "supporting", "contextual"].filter((t) => grouped[t].length > 0);

	return (
		<div className="flex flex-col gap-4">
			{tiers.map((tier) => {
				const style = RELEVANCE_STYLES[tier];
				return (
					<div key={tier}>
						<div className="mb-1.5 flex items-center gap-2">
							<span className="text-[12px] font-semibold" style={{ color: style.color }}>
								{style.label}
							</span>
							<span className="font-mono text-[11px] tabular-nums text-text-quaternary">{grouped[tier].length}</span>
						</div>
						<div className="flex flex-col gap-2">
							{grouped[tier].map((finding) => {
								const ev = evidenceMap.get(finding.id);
								const relatedConns = connections.filter(
									(c) =>
										(c.from_finding_id === finding.id && findingIds.has(c.to_finding_id)) ||
										(c.to_finding_id === finding.id && findingIds.has(c.from_finding_id)),
								);
								const ancestors = reactionChains[finding.id] ?? [];

								return (
									<div
										key={finding.id}
										className={`flex flex-col gap-1.5 rounded-md border ${style.border} ${style.bg} p-2.5`}
									>
										<FindingNode finding={finding} agentMeta={agentMeta} />

										{ev?.reasoning && (
											<div className="ml-3 border-l-2 border-border/30 pl-2 text-[12px] italic text-text-secondary leading-relaxed">
												{ev.reasoning}
											</div>
										)}

										{ancestors.length > 0 && (
											<div className="ml-1.5 border-l border-border/30 pl-3">
												<div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-quaternary">
													Reaction chain:
												</div>
												{ancestors.map((ancestor) => (
													<div key={ancestor.id} className="mb-0.5">
														<FindingNode finding={ancestor} compact agentMeta={agentMeta} />
													</div>
												))}
											</div>
										)}

										{relatedConns.length > 0 && (
											<div className="flex flex-wrap gap-1 pl-3">
												{relatedConns.map((conn) => (
													<ConnectionEdge key={conn.id} connection={conn} agentMeta={agentMeta} />
												))}
											</div>
										)}
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}

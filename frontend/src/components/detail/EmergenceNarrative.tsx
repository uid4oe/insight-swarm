import { useMemo } from "react";
import { buildAgentMap, getAgentColor } from "../../lib/agents";
import { RELATIONSHIP_COLORS } from "../../lib/constants";
import type { AgentId, AgentMeta, Connection, EvidenceItem, Finding } from "../../lib/types";
import { AgentMention } from "../summary/AgentMention";

interface Props {
	findings: Finding[];
	connections: Connection[];
	emergenceScore: number;
	evidenceItems: EvidenceItem[];
	agentMeta?: AgentMeta[];
}

export function EmergenceNarrative({ findings, connections, emergenceScore, evidenceItems, agentMeta = [] }: Props) {
	const agentMap = useMemo(() => buildAgentMap(agentMeta), [agentMeta]);
	const sorted = useMemo(
		() => [...findings].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
		[findings],
	);

	const agents = useMemo(() => {
		const set = new Set<AgentId>();
		for (const f of findings) set.add(f.agent_id);
		return [...set];
	}, [findings]);

	const evidenceReasoningMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const item of evidenceItems) {
			if (item.reasoning) map.set(item.finding_id, item.reasoning);
		}
		return map;
	}, [evidenceItems]);

	const findingIds = useMemo(() => new Set(findings.map((f) => f.id)), [findings]);
	const interConnections = useMemo(
		() => connections.filter((c) => findingIds.has(c.from_finding_id) && findingIds.has(c.to_finding_id)),
		[connections, findingIds],
	);

	return (
		<div>
			<div className="mb-2 flex items-center gap-2">
				<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
					How This Emerged
				</span>
				<span
					className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${emergenceScore >= 3 ? "emergence-badge-high" : "pill-info"}`}
				>
					{emergenceScore} agents converged
				</span>
				<span className="flex-1 border-b border-border/20" />
			</div>

			{/* Timeline */}
			<div className="relative ml-2 border-l border-border/30 pl-4">
				{sorted.map((finding) => {
					const color = getAgentColor(finding.agent_id, agentMeta);
					const incomingConns = interConnections.filter(
						(c) =>
							(c.to_finding_id === finding.id && findingIds.has(c.from_finding_id)) ||
							(c.from_finding_id === finding.id && findingIds.has(c.to_finding_id)),
					);

					return (
						<div key={finding.id} className="relative mb-3 last:mb-0">
							<span
								className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-current opacity-80"
								style={{ color }}
							/>

							<div className="flex items-center gap-1.5 text-[12px]">
								<AgentMention agent={finding.agent_id} agentMap={agentMap} />
								<span className="font-mono text-[10px] text-text-quaternary">R{finding.round}</span>
							</div>

							<p className="mt-0.5 text-[13px] leading-snug text-text-secondary">{finding.title}</p>

							{evidenceReasoningMap.get(finding.id) && (
								<p className="mt-0.5 text-[12px] italic text-text-tertiary leading-snug">
									{evidenceReasoningMap.get(finding.id)}
								</p>
							)}

							{incomingConns.length > 0 && (
								<div className="mt-1 flex flex-wrap gap-1">
									{incomingConns.map((conn) => {
										const other =
											conn.from_finding_id === finding.id
												? findings.find((f) => f.id === conn.to_finding_id)
												: findings.find((f) => f.id === conn.from_finding_id);
										if (!other) return null;
										const relColor = RELATIONSHIP_COLORS[conn.relationship] ?? "var(--color-dim)";
										return (
											<span
												key={conn.id}
												className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
												style={{
													background: `color-mix(in srgb, ${relColor} 8%, transparent)`,
													color: relColor,
													border: `1px solid color-mix(in srgb, ${relColor} 15%, transparent)`,
												}}
											>
												<span>{conn.relationship}</span>
												<AgentMention agent={other.agent_id} agentMap={agentMap} />
											</span>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Convergence summary */}
			<div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md border border-border/30 bg-white/[0.015] px-3 py-2.5 text-[12px] text-text-secondary">
				{agents.map((a, i) => (
					<span key={a}>
						{i > 0 && <span className="text-text-quaternary">{i === agents.length - 1 ? " & " : ", "}</span>}
						<AgentMention agent={a} agentMap={agentMap} />
					</span>
				))}
				<span className="text-text-tertiary">
					contributed independently, then connected through {interConnections.length} cross-agent link
					{interConnections.length !== 1 ? "s" : ""}
				</span>
			</div>
		</div>
	);
}

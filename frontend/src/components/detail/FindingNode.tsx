import { getAgentColor, getAgentLabel } from "../../lib/agents";
import type { AgentMeta, Finding } from "../../lib/types";

interface Props {
	finding: Finding;
	compact?: boolean;
	agentMeta?: AgentMeta[];
}

export function FindingNode({ finding, compact, agentMeta = [] }: Props) {
	const color = getAgentColor(finding.agent_id, agentMeta);

	if (compact) {
		return (
			<div className="rounded-md bg-white/[0.015] py-1 pl-3 pr-2" style={{ borderLeft: `2px solid ${color}` }}>
				<span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
					{getAgentLabel(finding.agent_id, agentMeta)}
				</span>{" "}
				<span className="text-[12px] text-text-secondary">{finding.title}</span>
			</div>
		);
	}

	return (
		<div className="rounded-md bg-white/[0.015] px-3.5 py-2.5" style={{ borderLeft: `3px solid ${color}` }}>
			<div className="mb-0.5 flex items-center justify-between">
				<span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
					{getAgentLabel(finding.agent_id, agentMeta)}
				</span>
				<span className="font-mono text-[11px] tabular-nums text-text-quaternary">
					{Math.round(finding.confidence * 100)}%
				</span>
			</div>
			<div className="text-[13px] font-medium text-text-primary leading-snug">{finding.title}</div>
			{finding.description && (
				<div className="mt-0.5 text-[12px] leading-relaxed text-text-tertiary">{finding.description}</div>
			)}
			{(finding.tags.length > 0 || finding.references.length > 0) && (
				<div className="mt-1.5 flex flex-wrap gap-1">
					{finding.references.length > 0 && (
						<span className="rounded-md bg-accent/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-accent">
							{finding.references.length} ref{finding.references.length !== 1 ? "s" : ""}
						</span>
					)}
					{finding.tags.map((tag) => (
						<span key={tag} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-text-quaternary">
							{tag}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

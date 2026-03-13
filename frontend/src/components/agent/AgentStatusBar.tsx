import { useMemo } from "react";
import { getAgentColor, getAgentLabel } from "../../lib/agents";
import type { AgentId, AgentMeta, AgentStatus, Finding } from "../../lib/types";

interface Props {
	agents: AgentStatus[];
	findings: Finding[];
	agentMeta: AgentMeta[];
	hiddenAgents: Set<string>;
	onOpenAgent: (agentId: AgentId) => void;
	onToggleAgent: (agentId: AgentId) => void;
}

function StatusDot({ status, color }: { status: string; color: string }) {
	if (status === "thinking" || status === "tool_use") {
		return (
			<span
				className="inline-block h-2 w-2 shrink-0 rounded-full border border-current animate-spin-fast"
				style={{ color, borderTopColor: "transparent" }}
			/>
		);
	}
	if (status === "round_ready") {
		return <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-success" />;
	}
	if (status === "dead") {
		return <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-error" />;
	}
	return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

export function AgentStatusBar({ agents, findings, agentMeta, hiddenAgents, onOpenAgent, onToggleAgent }: Props) {
	const agentIds = useMemo(() => {
		if (agentMeta.length > 0) return agentMeta.map((m) => m.id);
		return [...new Set(agents.map((a) => a.agent_id))];
	}, [agents, agentMeta]);

	const findingCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const id of agentIds) counts[id] = 0;
		for (const f of findings) counts[f.agent_id] = (counts[f.agent_id] ?? 0) + 1;
		return counts;
	}, [findings, agentIds]);

	if (agentIds.length === 0) return null;

	return (
		<div className="flex items-center border-b border-border/60 px-2 py-1.5">
			{agentIds.map((id) => {
				const agent = agents.find((a) => a.agent_id === id);
				const status = agent?.status ?? "idle";
				const color = getAgentColor(id, agentMeta);
				const label = getAgentLabel(id, agentMeta);
				const isDead = status === "dead";
				const isHidden = hiddenAgents.has(id);
				const count = findingCounts[id] ?? 0;

				return (
					<button
						type="button"
						key={id}
						className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 cursor-pointer transition-all hover:bg-surface/60"
						style={{ opacity: isDead ? 0.35 : isHidden ? 0.45 : 1 }}
						onClick={() => onOpenAgent(id)}
						title={`Click to view details. Right-click to toggle visibility.`}
						onContextMenu={(e) => {
							e.preventDefault();
							onToggleAgent(id);
						}}
					>
						<StatusDot status={status} color={isDead ? "var(--color-dim)" : color} />
						<span className="text-[11px] font-medium" style={{ color: isDead ? "var(--color-dim)" : color }}>
							{label}
						</span>
						{agent?.current_round && <span className="text-[10px] text-dim">R{agent.current_round}</span>}
						<span className="text-[10px] tabular-nums text-dim">{count}f</span>
					</button>
				);
			})}
		</div>
	);
}

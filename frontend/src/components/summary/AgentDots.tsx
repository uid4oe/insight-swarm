import type { AgentMap } from "../../lib/agents";
import { getAgentColor, getAgentLabel } from "../../lib/agents";
import type { AgentId } from "../../lib/types";

export function AgentDots({ agents, agentMap }: { agents: AgentId[]; agentMap: AgentMap }) {
	return (
		<div className="flex items-center gap-1">
			{agents.map((a) => (
				<span
					key={a}
					className="status-dot"
					style={{ color: getAgentColor(a, agentMap) }}
					title={getAgentLabel(a, agentMap)}
				/>
			))}
		</div>
	);
}

import type { AgentMap } from "../../lib/agents";
import { getAgentColor, getAgentLabel } from "../../lib/agents";
import type { AgentId } from "../../lib/types";

/**
 * Lightweight inline agent name — colored text, no background, no uppercase.
 * Use this in prose/summary contexts. For interactive badges use AgentChip instead.
 */
export function AgentMention({ agent, agentMap }: { agent: AgentId; agentMap?: AgentMap }) {
	const color = getAgentColor(agent, agentMap);
	return (
		<span className="text-agent-inline" style={{ color }}>
			{getAgentLabel(agent, agentMap)}
		</span>
	);
}

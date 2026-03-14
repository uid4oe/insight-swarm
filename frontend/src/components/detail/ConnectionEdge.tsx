import { getAgentColor, getAgentLabel } from "../../lib/agents";
import { RELATIONSHIP_COLORS, RELATIONSHIP_ICONS, RELATIONSHIP_TEXT_COLORS } from "../../lib/constants";
import type { AgentMeta, Connection } from "../../lib/types";

interface Props {
	connection: Connection;
	agentMeta?: AgentMeta[];
}

export function ConnectionEdge({ connection, agentMeta = [] }: Props) {
	const relColor = RELATIONSHIP_COLORS[connection.relationship] ?? "#666";
	const agentColor = getAgentColor(connection.created_by, agentMeta);

	return (
		<span
			className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${RELATIONSHIP_TEXT_COLORS[connection.relationship] ?? "text-text-quaternary"}`}
			style={{
				background: `color-mix(in srgb, ${relColor} 8%, transparent)`,
				border: `1px solid color-mix(in srgb, ${relColor} 15%, transparent)`,
			}}
		>
			<span>{RELATIONSHIP_ICONS[connection.relationship] ?? "~"}</span>
			<span>{connection.relationship}</span>
			<span className="font-mono tabular-nums opacity-60">({Math.round(connection.strength * 100)}%)</span>
			<span className="font-bold uppercase tracking-wide" style={{ color: agentColor }}>
				{getAgentLabel(connection.created_by, agentMeta)}
			</span>
		</span>
	);
}

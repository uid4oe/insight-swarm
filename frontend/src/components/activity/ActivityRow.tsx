import { memo } from "react";
import type { AgentMap } from "../../lib/agents";
import { getAgentColor, getAgentLabel } from "../../lib/agents";
import { timeAgo } from "../../lib/format";
import type { ActivityEntry } from "../../lib/types";
import { cleanSummary, getActionMeta } from "./activity-utils";

interface Props {
	entry: ActivityEntry;
	agentMap: AgentMap;
	isLatest: boolean;
}

export const ActivityRow = memo(function ActivityRow({ entry, agentMap, isLatest }: Props) {
	const meta = getActionMeta(entry.action);
	const color = getAgentColor(entry.agent_id, agentMap);
	const label = getAgentLabel(entry.agent_id, agentMap);
	const summary = cleanSummary(entry.summary);

	// Lifecycle events — minimal muted row
	if (meta.category === "lifecycle") {
		return (
			<div className={`flex items-center gap-1.5 px-3 py-1 opacity-30 ${isLatest ? "animate-slide-in-left" : ""}`}>
				<span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
				<span className="text-[10px] font-medium" style={{ color }}>
					{label}
				</span>
				<span className={`text-[10px] ${meta.accent}`}>{meta.verb.toLowerCase()}</span>
				<span className="flex-1" />
				<span className="font-mono text-[10px] tabular-nums text-text-quaternary">{timeAgo(entry.created_at)}</span>
			</div>
		);
	}

	// Knowledge, synthesis, collaboration, research
	const hasSummary = summary && meta.category !== "collaboration";

	return (
		<div
			className={`group flex items-start gap-2 border-b border-white/[0.03] px-3 py-2 transition-colors hover:bg-white/[0.02] ${
				isLatest ? "animate-slide-in-left" : ""
			}`}
		>
			{/* Agent color dot */}
			<span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />

			{/* Content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className={`text-[10px] leading-none ${meta.accent}`}>{meta.icon}</span>
					<span className={`text-[10px] font-semibold ${meta.accent}`}>{meta.verb}</span>
					<span className="text-[10px] text-text-quaternary">·</span>
					<span className="text-[10px] font-medium truncate" style={{ color }}>
						{label}
					</span>
					<span className="flex-1" />
					<span className="font-mono text-[10px] tabular-nums text-text-quaternary opacity-0 transition-opacity group-hover:opacity-100">
						{timeAgo(entry.created_at)}
					</span>
				</div>
				{hasSummary && (
					<p className="mt-0.5 text-[11px] leading-snug text-text-tertiary line-clamp-2" title={entry.summary}>
						{summary}
					</p>
				)}
			</div>
		</div>
	);
});

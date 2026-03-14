import { useEffect, useMemo, useRef, useState } from "react";
import { buildAgentMap } from "../../lib/agents";
import type { ActivityEntry, AgentMeta } from "../../lib/types";
import { ActivityRow } from "./ActivityRow";
import { computeRoundStats, NOISE_ACTIONS } from "./activity-utils";

interface Props {
	activity: ActivityEntry[];
	agentMeta?: AgentMeta[];
	className?: string;
	compact?: boolean;
}

export function ActivityLog({ activity, agentMeta = [], className = "", compact = false }: Props) {
	const feedRef = useRef<HTMLDivElement>(null);
	const agentMap = useMemo(() => buildAgentMap(agentMeta), [agentMeta]);

	// Refresh relative timestamps every 5 seconds
	const [, setTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), 5000);
		return () => clearInterval(t);
	}, []);

	const feed = useMemo(() => {
		return activity.filter((a) => !NOISE_ACTIONS.has(a.action)).slice(0, 80);
	}, [activity]);

	const roundGroups = useMemo(() => {
		// Group entries by round
		const byRound = new Map<number, ActivityEntry[]>();
		for (const entry of feed) {
			const arr = byRound.get(entry.round);
			if (arr) arr.push(entry);
			else byRound.set(entry.round, [entry]);
		}

		// Sort rounds descending (newest round first)
		const rounds = [...byRound.keys()].sort((a, b) => b - a);

		return rounds.map((round) => {
			const entries = byRound.get(round)!;
			// Sort entries within each round chronologically (oldest first)
			entries.sort((a, b) => {
				const timeA = new Date(a.created_at).getTime();
				const timeB = new Date(b.created_at).getTime();
				if (timeA !== timeB) return timeA - timeB;
				return (a.id ?? 0) - (b.id ?? 0);
			});
			return { round, entries };
		});
	}, [feed]);

	const totals = useMemo(() => {
		let findings = 0;
		let connections = 0;
		let theses = 0;
		for (const a of activity) {
			if (a.action === "write_finding") findings++;
			else if (a.action === "create_connection") connections++;
			else if (a.action === "create_thesis") theses++;
		}
		return { findings, connections, theses };
	}, [activity]);

	// ── Compact mode (collapsed panel) ──
	if (compact) {
		return (
			<div className={`border-t border-white/[0.04] ${className}`}>
				<div className="flex items-center gap-3 px-4 py-2">
					<span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary shrink-0">
						Activity
					</span>
					<div className="flex items-center gap-2 font-mono text-[10px] tabular-nums">
						{totals.findings > 0 && <span className="text-action-finding">◆ {totals.findings}</span>}
						{totals.connections > 0 && <span className="text-action-connection">━ {totals.connections}</span>}
						{totals.theses > 0 && <span className="text-action-thesis">★ {totals.theses}</span>}
					</div>
				</div>
			</div>
		);
	}

	// ── Full mode ──
	return (
		<div className={`flex flex-col ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2.5">
				<span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">Activity</span>
				<div className="flex items-center gap-2.5 font-mono text-[10px] tabular-nums text-text-quaternary">
					{totals.findings > 0 && (
						<span className="flex items-center gap-1">
							<span className="text-action-finding">◆</span> {totals.findings}
						</span>
					)}
					{totals.connections > 0 && (
						<span className="flex items-center gap-1">
							<span className="text-action-connection">━</span> {totals.connections}
						</span>
					)}
					{totals.theses > 0 && (
						<span className="flex items-center gap-1">
							<span className="text-action-thesis">★</span> {totals.theses}
						</span>
					)}
				</div>
			</div>

			{/* Feed */}
			{feed.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-3 py-8">
					<span className="text-[11px] text-text-quaternary">Waiting for activity...</span>
				</div>
			) : (
				<div ref={feedRef} className="scrollbar-thin flex-1 overflow-y-auto">
					{roundGroups.map((group) => {
						const stats = computeRoundStats(group.entries);
						return (
							<div key={group.round}>
								{/* Round divider */}
								<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/[0.03] bg-bg/95 px-3 py-1 backdrop-blur-sm">
									<span className="font-mono text-[10px] font-semibold tabular-nums text-text-quaternary">
										R{group.round}
									</span>
									<span className="h-px flex-1 bg-white/[0.04]" />
									<div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-text-quaternary">
										{stats.findings > 0 && <span>{stats.findings}f</span>}
										{stats.connections > 0 && <span>{stats.connections}c</span>}
										{stats.reactions > 0 && <span>{stats.reactions}r</span>}
										{stats.theses > 0 && <span>{stats.theses}t</span>}
									</div>
								</div>

								{group.entries.map((entry, i) => (
									<ActivityRow
										key={entry.id ?? `${entry.agent_id}-${entry.created_at}-${i}`}
										entry={entry}
										agentMap={agentMap}
										isLatest={group === roundGroups[0] && i === 0}
									/>
								))}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

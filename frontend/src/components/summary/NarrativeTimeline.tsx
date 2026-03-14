import type { AgentMap } from "../../lib/agents";
import { getAgentColor, getAgentLabel } from "../../lib/agents";
import type { NarrativeEvent } from "../../lib/types";

function groupByRound(events: NarrativeEvent[]): Map<number, NarrativeEvent[]> {
	const map = new Map<number, NarrativeEvent[]>();
	for (const e of events) {
		const arr = map.get(e.round) || [];
		arr.push(e);
		map.set(e.round, arr);
	}
	return map;
}

export function NarrativeTimeline({ events, agentMap }: { events: NarrativeEvent[]; agentMap: AgentMap }) {
	if (events.length === 0) return null;
	const byRound = groupByRound(events);
	const rounds = [...byRound.keys()].sort((a, b) => a - b);

	return (
		<div className="relative space-y-1">
			<div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/50" />

			{rounds.map((round) => {
				const roundEvents = byRound.get(round) ?? [];
				return (
					<div key={round} className="relative">
						<div className="relative flex items-center gap-2 py-1.5 pl-4">
							<div className="absolute left-0 h-[9px] w-[9px] rounded-full border border-border bg-surface-hover" />
							<span className="text-meta font-semibold text-text-tertiary">Round {round}</span>
						</div>

						<div className="ml-4 border-l border-border/40 pl-3 pb-1">
							{roundEvents.map((evt, i) => {
								const agentColor = getAgentColor(evt.agent, agentMap);
								const hasRelated = evt.relatedAgents && evt.relatedAgents.length > 0;
								return (
									<div key={`${evt.agent}-${evt.round}-${i}`} className="relative flex items-start gap-2 py-1">
										<div className="mt-1.5 status-dot shrink-0" style={{ color: agentColor }} />
										<div className="min-w-0 flex-1">
											<div className="flex items-baseline gap-1 flex-wrap">
												<span className="text-agent-inline font-medium" style={{ color: agentColor }}>
													{getAgentLabel(evt.agent, agentMap)}
												</span>
												<span className="text-body text-muted">{evt.action}</span>
												{hasRelated && (
													<span className="flex items-center gap-0.5">
														<span className="text-meta text-dim">→</span>
														{evt.relatedAgents?.map((ra) => (
															<span
																key={ra}
																className="text-agent-inline"
																style={{ color: getAgentColor(ra, agentMap) }}
															>
																{getAgentLabel(ra, agentMap)}
															</span>
														))}
													</span>
												)}
											</div>
											<p className="text-body text-text-tertiary leading-snug mt-0.5">{evt.detail}</p>
										</div>
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

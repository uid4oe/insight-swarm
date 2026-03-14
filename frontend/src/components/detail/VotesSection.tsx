import { useMemo } from "react";
import { buildAgentMap, getAgentColor } from "../../lib/agents";
import type { AgentMeta, Finding, ThesisVote } from "../../lib/types";
import { AgentMention } from "../summary/AgentMention";

interface Props {
	votes: ThesisVote[];
	evidenceFindings?: Finding[];
	agentMeta?: AgentMeta[];
}

export function VotesSection({ votes, evidenceFindings = [], agentMeta = [] }: Props) {
	const agentMap = useMemo(() => buildAgentMap(agentMeta), [agentMeta]);
	const findingMap = new Map(evidenceFindings.map((f) => [f.id, f]));

	return (
		<div className="flex flex-col gap-2">
			{votes.map((v) => {
				const color = getAgentColor(v.agent_id, agentMap);
				return (
					<div
						key={`${v.agent_id}-${v.vote}`}
						className="rounded-md bg-white/[0.015] px-4 py-3"
						style={{ borderLeft: `3px solid ${color}` }}
					>
						<div className="mb-1.5 flex items-center justify-between">
							<AgentMention agent={v.agent_id} agentMap={agentMap} />
							<span
								className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${v.vote === "support" ? "pill-success" : v.vote === "challenge" ? "pill-warning" : "pill-error"}`}
							>
								{v.vote}
							</span>
						</div>
						<p className="text-[13px] leading-relaxed text-text-secondary">{v.reasoning}</p>
						{v.supporting_evidence && v.supporting_evidence.length > 0 && (
							<div className="mt-2 flex flex-wrap items-center gap-1.5">
								<span className="text-[10px] font-mono text-text-quaternary shrink-0">Based on:</span>
								{v.supporting_evidence.map((fid) => {
									const f = findingMap.get(fid);
									return (
										<span
											key={fid}
											className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px]"
											title={f ? `${f.title} (${f.agent_id})` : fid}
										>
											{f ? (
												<>
													<AgentMention agent={f.agent_id} agentMap={agentMap} />
													<span className="max-w-[160px] truncate text-text-quaternary">{f.title}</span>
												</>
											) : (
												<span className="font-mono text-text-quaternary">{fid.slice(0, 8)}</span>
											)}
										</span>
									);
								})}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

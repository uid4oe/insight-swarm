import { useEffect, useState } from "react";
import type { AgentMeta, AgentStatus, RoundState } from "../../lib/types";

interface Props {
	prompt: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	agentMeta: AgentMeta[];
	agents: AgentStatus[];
	roundState: RoundState | null;
	startedAt: string | null;
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
	const [elapsed, setElapsed] = useState("0:00");
	useEffect(() => {
		const tick = () => {
			const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
			setElapsed(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [startedAt]);
	return <span>{elapsed}</span>;
}

export function TaskLaunchView({ prompt, status, agentMeta, agents, roundState, startedAt }: Props) {
	const isQueued = status === "queued";
	const hasAgents = agentMeta.length > 0 || agents.length > 0;
	const currentRound = roundState?.round_number ?? 1;

	return (
		<div className="flex h-full flex-col items-center justify-center animate-fade-in">
			<div className="flex w-full max-w-lg flex-col items-center gap-8 px-6">
				{/* Prompt */}
				<p className="text-center text-[20px] font-light tracking-[-0.01em] leading-relaxed text-text-primary">
					{prompt}
				</p>

				{/* Agent dots — minimal colored circles, no labels */}
				{hasAgents ? (
					<div className="flex items-center justify-center gap-3">
						{agentMeta.map((m) => {
							const agent = agents.find((a) => a.agent_id === m.id);
							const isActive =
								agent?.status === "thinking" ||
								agent?.status === "tool_use" ||
								agent?.status === "writing" ||
								agent?.status === "reacting";
							return (
								<span
									key={m.id}
									className={`inline-block h-2.5 w-2.5 rounded-full transition-opacity duration-300 ${isActive ? "animate-pulse" : ""}`}
									style={{
										backgroundColor: m.color,
										opacity: agent?.status === "dead" ? 0.25 : agent ? 1 : 0.4,
									}}
									title={m.label}
								/>
							);
						})}
					</div>
				) : (
					<div className="flex items-center gap-3">
						{[0, 1, 2].map((i) => (
							<span
								key={i}
								className="inline-block h-2.5 w-2.5 rounded-full bg-text-quaternary/30 animate-pulse"
								style={{ animationDelay: `${i * 200}ms` }}
							/>
						))}
					</div>
				)}

				{/* Status line */}
				<div className="flex flex-col items-center gap-1.5 text-[12px] text-text-tertiary">
					<span>{isQueued ? "Initializing…" : hasAgents ? "Preparing agents…" : "Setting up…"}</span>
					{!isQueued && (
						<span className="text-[11px] text-text-quaternary">
							Round {currentRound}/4
							{startedAt && (
								<>
									{" · "}
									<ElapsedTimer startedAt={startedAt} />
								</>
							)}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

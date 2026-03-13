import { useEffect, useRef, useState } from "react";
import { cancelTask } from "../../lib/api";
import { TASK_STATUS_COLORS } from "../../lib/constants";
import type { AgentStatus, RoundState } from "../../lib/types";

interface Props {
	title: string;
	prompt?: string;
	roundState: RoundState | null;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	startedAt: string | null;
	connected?: boolean;
	taskId: string;
	findingsCount?: number;
	connectionsCount?: number;
	thesesCount?: number;
	agents?: AgentStatus[];
	lastRoundAdvanced?: number | null;
}

function formatElapsed(startedAt: string | null): string {
	if (!startedAt) return "0:00";
	const ms = Date.now() - new Date(startedAt).getTime();
	const seconds = Math.floor(ms / 1000);
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${String(secs).padStart(2, "0")}`;
}

function inferPhase(agents: AgentStatus[]): string | null {
	if (agents.length === 0) return null;
	if (agents.some((a) => a.status === "reacting")) return "Reacting";
	if (agents.some((a) => a.status === "writing")) return "Writing";
	if (agents.some((a) => a.status === "thinking" || a.status === "tool_use")) return "Analyzing";
	if (agents.every((a) => a.status === "waiting" || a.status === "round_ready" || a.status === "dead"))
		return "Synchronizing";
	return null;
}

export function TaskHeader({
	title,
	prompt,
	roundState,
	status,
	startedAt,
	connected,
	taskId,
	findingsCount = 0,
	connectionsCount = 0,
	thesesCount = 0,
	agents = [],
	lastRoundAdvanced,
}: Props) {
	const maxRounds = 4; // default MAX_ROUNDS from backend config
	const currentRound = roundState?.round_number ?? 1;
	const [elapsed, setElapsed] = useState(formatElapsed(startedAt));
	const [cancelling, setCancelling] = useState(false);
	const [roundFlash, setRoundFlash] = useState<number | null>(null);

	useEffect(() => {
		if (status !== "running" && status !== "queued") {
			setElapsed(formatElapsed(startedAt));
			return;
		}
		const interval = setInterval(() => {
			setElapsed(formatElapsed(startedAt));
		}, 1000);
		return () => clearInterval(interval);
	}, [status, startedAt]);

	// Round transition flash
	useEffect(() => {
		if (!lastRoundAdvanced) return;
		setRoundFlash(currentRound);
		const timer = setTimeout(() => setRoundFlash(null), 2000);
		return () => clearTimeout(timer);
	}, [lastRoundAdvanced, currentRound]);

	const handleCancel = async () => {
		if (!confirm("Cancel this insight? All agents will be stopped.")) return;
		setCancelling(true);
		try {
			await cancelTask(taskId);
		} catch {
			// Task may already be stopped
		}
		setCancelling(false);
	};

	const phase = status === "running" ? inferPhase(agents) : null;
	const [displayPhase, setDisplayPhase] = useState<string | null>(null);
	const [phaseTransition, setPhaseTransition] = useState(false);
	const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (phase !== displayPhase) {
			if (displayPhase !== null) {
				setPhaseTransition(true);
				phaseTimerRef.current = setTimeout(() => {
					phaseTimerRef.current = null;
					setDisplayPhase(phase);
					setPhaseTransition(false);
				}, 150);
				return () => {
					if (phaseTimerRef.current) {
						clearTimeout(phaseTimerRef.current);
						phaseTimerRef.current = null;
					}
				};
			}
			setDisplayPhase(phase);
		}
	}, [phase, displayPhase]);

	return (
		<div className="flex items-center justify-between border-b border-border/60 px-6 py-3.5">
			<div className="min-w-0 flex-1 mr-4">
				<h2 className="text-[15px] font-medium tracking-tight text-text-primary truncate">{title}</h2>
				{prompt && prompt !== title && (
					<p className="text-meta mt-0.5 max-w-2xl truncate opacity-60" title={prompt}>
						{prompt}
					</p>
				)}
			</div>
			<div className="flex items-center gap-3">
				{(status === "running" || status === "queued") && (
					<>
						{connected === false && status === "running" && (
							<span className="flex items-center gap-1.5 text-stat text-warning">
								<span className="status-dot-sm animate-pulse-slow" />
								reconnecting
							</span>
						)}
						<div className="flex items-center gap-2">
							<div className="h-[3px] w-24 overflow-hidden rounded-full bg-surface-hover">
								<div
									className="h-full rounded-full bg-text-tertiary/50 transition-all duration-700"
									style={{ width: `${Math.round((currentRound / maxRounds) * 100)}%` }}
								/>
							</div>
							<span className="text-stat tabular-nums text-text-tertiary">
								{currentRound}/{maxRounds}
								{displayPhase && (
									<span
										className="ml-1 text-dim font-normal normal-case tracking-normal transition-opacity duration-150"
										style={{ opacity: phaseTransition ? 0 : 1 }}
									>
										· {displayPhase}
									</span>
								)}
							</span>
						</div>
						{roundFlash !== null && (
							<span className="text-stat text-accent-strong animate-fade-in">Round {roundFlash}</span>
						)}
						{findingsCount > 0 && (
							<span className="flex items-center gap-1.5 text-meta tabular-nums">
								<span className="text-action-finding">◆ {findingsCount}</span>
								<span className="text-action-connection">━ {connectionsCount}</span>
								{thesesCount > 0 && <span className="text-action-thesis">★ {thesesCount}</span>}
							</span>
						)}
						<span className="text-stat tabular-nums">{elapsed}</span>
						<button
							type="button"
							onClick={handleCancel}
							disabled={cancelling}
							className="btn-danger"
							title="Cancel insight"
						>
							{cancelling ? "..." : "Cancel"}
						</button>
					</>
				)}
				<span
					className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${TASK_STATUS_COLORS[status]}`}
				>
					{(status === "running" || status === "queued") && <span className="status-dot-sm animate-pulse-slow" />}
					{status}
				</span>
			</div>
		</div>
	);
}

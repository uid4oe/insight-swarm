import { useCallback, useEffect, useRef, useState } from "react";
import { useTaskSSE } from "../../hooks/useTaskSSE";
import { useAppStore } from "../../lib/store";
import type {
	ActivityEntry,
	AgentId,
	AgentMeta,
	AgentStatus,
	Connection,
	Finding,
	InvestmentThesis,
	RoundState,
	TaskState,
} from "../../lib/types";
import { ActivityLog } from "../activity/ActivityLog";
import { AgentDetail } from "../agent/AgentDetail";
import { AgentStatusBar } from "../agent/AgentStatusBar";
import { FollowupChat } from "../followup/FollowupChat";
import { KnowledgeGraph } from "../graph/KnowledgeGraph";
import { TaskSummary } from "../summary/TaskSummary";
import { TaskHeader } from "./TaskHeader";
import { TaskLaunchView } from "./TaskLaunchOverlay";

const EMPTY_AGENTS: AgentMeta[] = [];

// ── Shared state derived from SSE or archived snapshot ─────────────────────
interface DerivedState {
	roundState: RoundState | null;
	agents: AgentStatus[];
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	activity: ActivityEntry[];
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	agentMeta: AgentMeta[];
}

// ── Failed Task (no findings) ──────────────────────────────────────────────
function FailedEmptyView() {
	return (
		<div className="flex flex-1 items-center justify-center p-16 animate-fade-in">
			<div className="flex max-w-sm flex-col items-center gap-4 text-center">
				<div className="icon-circle-error animate-scale-in">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<title>Error icon</title>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</div>
				<div>
					<h3 className="text-[14px] font-medium text-error">Insight Failed</h3>
					<p className="mt-1.5 text-[13px] text-text-tertiary">
						This task encountered an error before producing results. Check the server logs for details.
					</p>
				</div>
			</div>
		</div>
	);
}

// ── Completed Task View ────────────────────────────────────────────────────
interface CompletedViewProps {
	taskId: string;
	justCompleted: boolean;
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	agentMeta: AgentMeta[];
	hiddenAgents: Set<string>;
	onOpenThesis: (thesisId: string) => void;
	onOpenFindingById: (findingId: string) => void;
	onOpenAgent: (agentId: AgentId) => void;
	onToggleAgent: (agentId: AgentId) => void;
	bodyRef: React.RefObject<HTMLDivElement | null>;
}

function CompletedView({
	taskId,
	justCompleted,
	findings,
	connections,
	theses,
	agentMeta,
	hiddenAgents,
	onOpenThesis,
	onOpenFindingById,
	onOpenAgent,
	onToggleAgent,
	bodyRef,
}: CompletedViewProps) {
	return (
		<div key="completed" className={`flex min-h-0 flex-1 ${justCompleted ? "animate-layout-enter" : ""}`}>
			{/* Summary + Follow-up — left 40% */}
			<div
				className={`flex w-2/5 shrink-0 flex-col border-r border-border ${justCompleted ? "animate-slide-in-bottom" : ""}`}
			>
				<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-5">
					<TaskSummary
						taskId={taskId}
						status="completed"
						agentMeta={agentMeta}
						theses={theses}
						onOpenThesis={onOpenThesis}
					/>
				</div>
				<FollowupChat taskId={taskId} />
			</div>
			{/* Graph — right 60% with integrated agent bar */}
			<div className="min-h-0 w-3/5 overflow-hidden px-5 py-4" ref={bodyRef}>
				<KnowledgeGraph
					key={taskId}
					findings={findings}
					connections={connections}
					theses={theses}
					agentMeta={agentMeta}
					hiddenAgents={hiddenAgents}
					onOpenThesis={onOpenThesis}
					onOpenFinding={onOpenFindingById}
					onOpenAgent={onOpenAgent}
					onToggleAgent={onToggleAgent}
				/>
			</div>
		</div>
	);
}

// ── Running Task View ──────────────────────────────────────────────────────
interface RunningViewProps {
	taskId: string;
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	activity: ActivityEntry[];
	agents: AgentStatus[];
	agentMeta: AgentMeta[];
	hiddenAgents: Set<string>;
	onOpenThesis: (thesisId: string) => void;
	onOpenFindingById: (findingId: string) => void;
	onOpenAgent: (agentId: AgentId) => void;
	onToggleAgent: (agentId: AgentId) => void;
	bodyRef: React.RefObject<HTMLDivElement | null>;
}

function RunningView({
	taskId,
	findings,
	connections,
	theses,
	activity,
	agents,
	agentMeta,
	hiddenAgents,
	onOpenThesis,
	onOpenFindingById,
	onOpenAgent,
	onToggleAgent,
	bodyRef,
}: RunningViewProps) {
	return (
		<div className="flex min-h-0 flex-1 animate-fade-in">
			{/* Graph + agent bar — fills remaining space */}
			<div className="flex min-h-0 flex-1 flex-col">
				<AgentStatusBar
					agents={agents}
					findings={findings}
					agentMeta={agentMeta}
					hiddenAgents={hiddenAgents}
					onOpenAgent={onOpenAgent}
					onToggleAgent={onToggleAgent}
				/>
				<div className="relative min-h-0 flex-1 px-5 py-4" ref={bodyRef}>
					<KnowledgeGraph
						key={taskId}
						findings={findings}
						connections={connections}
						theses={theses}
						agentMeta={agentMeta}
						hiddenAgents={hiddenAgents}
						onOpenThesis={onOpenThesis}
						onOpenFinding={onOpenFindingById}
					/>
				</div>
			</div>
			{/* Sidebar — theses + activity */}
			<div className="flex w-72 shrink-0 flex-col border-l border-white/[0.04]">
				{theses.length > 0 && (
					<div className="flex flex-col gap-1 border-b border-white/[0.04] px-3 py-3">
						<div className="mb-1 flex items-center justify-between">
							<span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">Theses</span>
							<span className="font-mono text-[10px] tabular-nums text-text-quaternary">{theses.length}</span>
						</div>
						{theses.map((thesis) => {
							const conf = Math.round(thesis.confidence * 100);
							const votes = thesis.votes?.length ?? 0;
							return (
								<button
									key={thesis.id}
									type="button"
									className="group w-full rounded-md border border-white/[0.04] bg-white/[0.015] px-3 py-2 text-left cursor-pointer transition-all hover:border-white/[0.08] hover:bg-white/[0.03]"
									onClick={() => onOpenThesis(thesis.id)}
									style={{ borderLeft: "2px solid #fbbf24" }}
								>
									<div className="text-[12px] font-medium text-text-secondary leading-tight line-clamp-2 group-hover:text-text-primary transition-colors">
										{thesis.title}
									</div>
									<div className="mt-1.5 flex items-center gap-2">
										<span className="font-mono text-[10px] tabular-nums text-text-quaternary">{conf}%</span>
										{votes > 0 && (
											<span className="font-mono text-[10px] tabular-nums text-text-quaternary">
												{votes} vote{votes !== 1 ? "s" : ""}
											</span>
										)}
									</div>
								</button>
							);
						})}
					</div>
				)}
				<ActivityLog activity={activity} agentMeta={agentMeta} className="min-h-0 flex-1" />
			</div>
		</div>
	);
}

// ── Main TaskView ──────────────────────────────────────────────────────────

interface Props {
	taskId: string;
	title: string;
	prompt: string;
	isRunning: boolean;
	archivedState: TaskState | null;
	startedAt: string | null;
	onOpenThesis: (thesisId: string) => void;
	onOpenFinding: (finding: Finding, allFindings: Finding[], allConnections: Connection[]) => void;
}

export function TaskView({
	taskId,
	title,
	prompt,
	isRunning,
	archivedState,
	startedAt,
	onOpenThesis,
	onOpenFinding,
}: Props) {
	const sseState = useTaskSSE(taskId, isRunning);
	const bodyRef = useRef<HTMLDivElement>(null);
	const prevFindingsCount = useRef(0);
	const [agentOverlay, setAgentOverlay] = useState<AgentId | null>(null);
	const [hiddenAgents, setHiddenAgents] = useState<Set<string>>(new Set());

	// Derive unified state from either live SSE or archived snapshot
	const src = isRunning ? sseState : archivedState;
	const derived: DerivedState = {
		roundState: src?.roundState ?? null,
		agents: src?.agents ?? [],
		findings: src?.findings ?? [],
		connections: src?.connections ?? [],
		theses: src?.theses ?? [],
		activity: src?.activity ?? [],
		status: isRunning ? sseState.status : (archivedState?.status ?? "failed"),
		agentMeta: src?.agentMeta ?? EMPTY_AGENTS,
	};

	const setAgentMetaInStore = useAppStore((s) => s.setAgentMeta);
	useEffect(() => {
		setAgentMetaInStore(derived.agentMeta);
	}, [derived.agentMeta, setAgentMetaInStore]);

	useEffect(() => {
		if (isRunning && derived.findings.length > prevFindingsCount.current && bodyRef.current) {
			bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
		}
		prevFindingsCount.current = derived.findings.length;
	}, [derived.findings.length, isRunning]);

	const handleOpenAgent = useCallback((agentId: AgentId) => {
		setAgentOverlay(agentId);
	}, []);

	const handleToggleAgent = useCallback((agentId: AgentId) => {
		setHiddenAgents((prev) => {
			const next = new Set(prev);
			if (next.has(agentId)) next.delete(agentId);
			else next.add(agentId);
			return next;
		});
	}, []);

	const handleAgentOpenFinding = useCallback(
		(finding: Finding) => {
			setAgentOverlay(null);
			onOpenFinding(finding, derived.findings, derived.connections);
		},
		[derived.findings, derived.connections, onOpenFinding],
	);

	const handleOpenFindingById = useCallback(
		(findingId: string) => {
			const f = derived.findings.find((x) => x.id === findingId);
			if (f) onOpenFinding(f, derived.findings, derived.connections);
		},
		[derived.findings, derived.connections, onOpenFinding],
	);

	// Track when task just completed for transition animation
	const [justCompleted, setJustCompleted] = useState(false);
	const prevStatus = useRef(derived.status);

	// Reset local state when switching tasks (no key prop, so component stays mounted)
	// biome-ignore lint/correctness/useExhaustiveDependencies: taskId is the intentional trigger; derived.status is only assigned to a ref
	useEffect(() => {
		setAgentOverlay(null);
		setHiddenAgents(new Set());
		setJustCompleted(false);
		prevFindingsCount.current = 0;
		prevStatus.current = derived.status;
	}, [taskId]);

	useEffect(() => {
		if (prevStatus.current === "running" && derived.status === "completed") {
			setJustCompleted(true);
			const timer = setTimeout(() => setJustCompleted(false), 1200);
			return () => clearTimeout(timer);
		}
		prevStatus.current = derived.status;
	}, [derived.status]);

	// ── Launch phase: queued/running with no findings yet ──
	const isLaunchPhase = (derived.status === "queued" || derived.status === "running") && derived.findings.length === 0;

	if (isLaunchPhase) {
		return (
			<div className="flex h-full flex-col">
				<TaskLaunchView
					prompt={prompt}
					status={derived.status}
					agentMeta={derived.agentMeta}
					agents={derived.agents}
					roundState={derived.roundState}
					startedAt={startedAt}
				/>
			</div>
		);
	}

	// ── Determine body content based on status ──
	let bodyContent: React.ReactNode;
	if (derived.status === "failed" && derived.findings.length === 0) {
		bodyContent = <FailedEmptyView />;
	} else if (derived.status === "completed") {
		bodyContent = (
			<CompletedView
				taskId={taskId}
				justCompleted={justCompleted}
				findings={derived.findings}
				connections={derived.connections}
				theses={derived.theses}
				agentMeta={derived.agentMeta}
				hiddenAgents={hiddenAgents}
				onOpenThesis={onOpenThesis}
				onOpenFindingById={handleOpenFindingById}
				onOpenAgent={handleOpenAgent}
				onToggleAgent={handleToggleAgent}
				bodyRef={bodyRef}
			/>
		);
	} else {
		bodyContent = (
			<RunningView
				taskId={taskId}
				findings={derived.findings}
				connections={derived.connections}
				theses={derived.theses}
				activity={derived.activity}
				agents={derived.agents}
				agentMeta={derived.agentMeta}
				hiddenAgents={hiddenAgents}
				onOpenThesis={onOpenThesis}
				onOpenFindingById={handleOpenFindingById}
				onOpenAgent={handleOpenAgent}
				onToggleAgent={handleToggleAgent}
				bodyRef={bodyRef}
			/>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<TaskHeader
				title={title}
				prompt={prompt}
				roundState={derived.roundState}
				status={derived.status}
				startedAt={startedAt}
				connected={isRunning ? sseState.connected : undefined}
				taskId={taskId}
				findingsCount={derived.findings.length}
				connectionsCount={derived.connections.length}
				thesesCount={derived.theses.length}
				agents={derived.agents}
				lastRoundAdvanced={isRunning ? sseState.lastRoundAdvanced : undefined}
			/>
			{bodyContent}
			{agentOverlay && (
				<AgentDetail
					agentId={agentOverlay}
					agent={derived.agents.find((a) => a.agent_id === agentOverlay) ?? null}
					findings={derived.findings}
					connections={derived.connections}
					theses={derived.theses}
					activity={derived.activity}
					agentMeta={derived.agentMeta}
					onClose={() => setAgentOverlay(null)}
					onOpenFinding={handleAgentOpenFinding}
				/>
			)}
		</div>
	);
}

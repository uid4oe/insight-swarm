import { useMemo, useState } from "react";
import { getAgentColor, getAgentDescription, getAgentLabel } from "../../lib/agents";
import { STATUS_LABELS } from "../../lib/constants";
import { roundName, timeAgo } from "../../lib/format";
import type {
	ActivityEntry,
	AgentId,
	AgentMeta,
	AgentStatus,
	Connection,
	Finding,
	InvestmentThesis,
} from "../../lib/types";
import { ConfidenceMeter } from "../common/ConfidenceMeter";
import { Drawer } from "../common/Drawer";

interface Props {
	agentId: AgentId;
	agent: AgentStatus | null;
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	activity: ActivityEntry[];
	agentMeta: AgentMeta[];
	onClose: () => void;
	onOpenFinding: (finding: Finding) => void;
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
	return (
		<div className="flex flex-col items-center">
			<span
				className="text-[18px] font-semibold tabular-nums leading-none"
				style={{ color: color ?? "var(--color-text-tertiary)" }}
			>
				{value}
			</span>
			<span className="mt-1 text-[9px] uppercase tracking-widest text-text-quaternary">{label}</span>
		</div>
	);
}

export function AgentDetail({
	agentId,
	agent,
	findings,
	connections,
	theses,
	agentMeta,
	onClose,
	onOpenFinding,
}: Props) {
	const color = getAgentColor(agentId, agentMeta);
	const label = getAgentLabel(agentId, agentMeta);
	const description = getAgentDescription(agentId, agentMeta);
	const status = agent?.status ?? "idle";
	const isDead = status === "dead";
	const isActive = status === "thinking" || status === "tool_use" || status === "writing" || status === "reacting";

	const agentFindings = useMemo(() => findings.filter((f) => f.agent_id === agentId), [findings, agentId]);
	const originalFindings = useMemo(() => agentFindings.filter((f) => !f.parent_finding_id), [agentFindings]);
	const reactions = useMemo(() => agentFindings.filter((f) => f.parent_finding_id), [agentFindings]);
	const agentConnections = useMemo(() => connections.filter((c) => c.created_by === agentId), [connections, agentId]);

	const agentTheses = useMemo(() => {
		const agentFindingIds = new Set(agentFindings.map((f) => f.id));
		return theses.filter(
			(t) =>
				t.created_by === agentId ||
				t.evidence.some((e) => agentFindingIds.has(e.finding_id)) ||
				t.votes.some((v) => v.agent_id === agentId),
		);
	}, [theses, agentFindings, agentId]);

	const [showAllFindings, setShowAllFindings] = useState(false);
	const displayFindings = showAllFindings ? agentFindings : agentFindings.slice(0, 8);

	// ── Hero ─────────────────────────────────────────────────────────────
	const hero = (
		<div className="relative px-6 pb-5 pt-6">
			{/* Agent identity */}
			<div className="flex items-center gap-4">
				{/* Status orb */}
				<div className="relative">
					<div
						className="flex h-12 w-12 items-center justify-center rounded-2xl"
						style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
					>
						<span className="text-[22px] font-bold uppercase" style={{ color }}>
							{label.charAt(0)}
						</span>
					</div>
					{/* Live pulse */}
					{isActive && (
						<span
							className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#12121a] animate-pulse-slow"
							style={{ background: color }}
						/>
					)}
					{isDead && (
						<span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#12121a] bg-error" />
					)}
				</div>

				<div className="min-w-0 flex-1">
					<h2 className="text-[16px] font-semibold uppercase tracking-wide" style={{ color }}>
						{label}
					</h2>
					<div className="mt-0.5 flex items-center gap-2 text-[12px]">
						<span
							className={`font-medium ${isDead ? "text-error" : isActive ? "" : "text-text-tertiary"}`}
							style={isActive ? { color } : undefined}
						>
							{STATUS_LABELS[status]}
						</span>
						{agent?.last_heartbeat && <span className="text-text-quaternary">{timeAgo(agent.last_heartbeat)}</span>}
						{agent?.current_round && <span className="text-text-quaternary">{roundName(agent.current_round)}</span>}
					</div>
				</div>
			</div>

			{/* Description */}
			<p className="mt-3 text-[13px] leading-[1.6] text-text-tertiary">{description}</p>

			{/* Current task */}
			{agent?.current_task && !isDead && (
				<div
					className="mt-3 rounded-md px-3.5 py-2.5 text-[12.5px] text-text-secondary"
					style={{
						background: `color-mix(in srgb, ${color} 5%, transparent)`,
						borderLeft: `3px solid ${color}`,
					}}
				>
					{agent.current_task}
				</div>
			)}

			{/* Stats row */}
			<div className="mt-4 flex items-center justify-around rounded-md bg-white/[0.02] py-3">
				<MiniStat label="Findings" value={originalFindings.length} color={color} />
				<div className="h-6 w-px bg-border/20" />
				<MiniStat label="Reactions" value={reactions.length} />
				<div className="h-6 w-px bg-border/20" />
				<MiniStat label="Links" value={agentConnections.length} />
				<div className="h-6 w-px bg-border/20" />
				<MiniStat label="Theses" value={agentTheses.length} />
			</div>
		</div>
	);

	return (
		<Drawer onClose={onClose} hero={hero} accent={color}>
			<div className="flex flex-col gap-1">
				{/* ── Theses ────────────────────────────────────────────── */}
				{agentTheses.length > 0 && (
					<div className="mb-3">
						<div className="mb-2 flex items-center gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Theses</span>
							<span className="text-[11px] font-mono tabular-nums text-text-quaternary">{agentTheses.length}</span>
							<span className="flex-1 border-b border-border/20" />
						</div>
						<div className="flex flex-col gap-2">
							{agentTheses.map((thesis) => {
								const vote = thesis.votes.find((v) => v.agent_id === agentId);
								const isCreator = thesis.created_by === agentId;
								return (
									<div key={thesis.id} className="rounded-md border border-border/30 bg-white/[0.015] px-4 py-3">
										<div className="flex items-start justify-between gap-3 mb-2">
											<p className="text-[13px] font-medium leading-snug text-text-secondary flex-1 min-w-0">
												{thesis.title}
											</p>
										</div>
										<ConfidenceMeter value={thesis.confidence} color="var(--color-thesis)" />
										<div className="mt-2 flex items-center gap-2">
											{isCreator && (
												<span
													className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
													style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
												>
													Creator
												</span>
											)}
											{vote && (
												<span
													className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${vote.vote === "support" ? "pill-success" : "pill-error"}`}
												>
													{vote.vote === "support" ? "\u25B2 Supports" : "\u25BC Challenges"}
												</span>
											)}
										</div>
										{vote?.reasoning && (
											<p className="mt-2 text-[12px] leading-relaxed text-text-quaternary italic">
												&ldquo;{vote.reasoning}&rdquo;
											</p>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* ── Findings ──────────────────────────────────────────── */}
				{agentFindings.length > 0 && (
					<div>
						<div className="mb-2 flex items-center gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Findings</span>
							<span className="text-[11px] font-mono tabular-nums text-text-quaternary">{agentFindings.length}</span>
							<span className="flex-1 border-b border-border/20" />
						</div>
						<div className="flex flex-col gap-1.5">
							{displayFindings.map((f) => (
								<button
									type="button"
									key={f.id}
									className="w-full rounded-md border border-transparent bg-white/[0.015] px-4 py-2.5 text-left transition-all hover:border-border/40 hover:bg-white/[0.04]"
									style={{
										borderLeftWidth: 3,
										borderLeftColor: f.parent_finding_id ? "var(--color-border-light)" : color,
									}}
									onClick={() => onOpenFinding(f)}
								>
									<div className="flex items-center justify-between mb-0.5">
										<div className="flex items-center gap-1.5">
											{f.parent_finding_id && <span className="text-[10px] text-text-quaternary">{"\u21BB"}</span>}
											<span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-text-quaternary">
												{roundName(f.round)}
											</span>
										</div>
										<span className="font-mono text-[11px] tabular-nums text-text-quaternary">
											{Math.round(f.confidence * 100)}%
										</span>
									</div>
									<p className="text-[13px] leading-snug text-text-secondary">{f.title}</p>
								</button>
							))}
						</div>
						{agentFindings.length > 8 && !showAllFindings && (
							<button
								type="button"
								className="mt-2 flex items-center gap-1 text-[11px] text-text-quaternary transition-colors hover:text-text-secondary"
								onClick={() => setShowAllFindings(true)}
							>
								<span>Show all {agentFindings.length}</span>
								<span className="text-[9px]">&#9660;</span>
							</button>
						)}
					</div>
				)}

				{/* ── Empty state ────────────────────────────────────── */}
				{agentFindings.length === 0 && agentTheses.length === 0 && (
					<div className="py-16 text-center">
						<div
							className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
							style={{ background: `color-mix(in srgb, ${color} 8%, transparent)` }}
						>
							<span className="text-2xl" style={{ color: `color-mix(in srgb, ${color} 40%, transparent)` }}>
								{isDead ? "\u2717" : "\u25CB"}
							</span>
						</div>
						<p className="text-[13px] text-text-quaternary">
							{isDead
								? "This agent went offline before producing any output."
								: "This agent hasn't produced any findings yet."}
						</p>
					</div>
				)}
			</div>
		</Drawer>
	);
}

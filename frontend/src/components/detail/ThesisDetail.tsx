import { useEffect, useState } from "react";
import { fetchThesisDetail } from "../../lib/api";
import { useAppStore } from "../../lib/store";
import type { ThesisDetail as ThesisDetailType } from "../../lib/types";
import { ConfidenceRing } from "../common/ConfidenceMeter";
import { Drawer } from "../common/Drawer";
import { EmergenceNarrative } from "./EmergenceNarrative";
import { EvidenceChain } from "./EvidenceChain";
import { VotesSection } from "./VotesSection";

interface Props {
	taskId: string;
	thesisId: string;
	onClose: () => void;
}

const STATUS_STYLE: Record<string, string> = {
	proposed: "pill-info",
	validated: "pill-success",
	refined: "pill-warning",
};

export function ThesisDetailView({ taskId, thesisId, onClose }: Props) {
	const agentMeta = useAppStore((s) => s.agentMeta);
	const [data, setData] = useState<ThesisDetailType | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setData(null);
		setError(null);
		const controller = new AbortController();
		fetchThesisDetail(taskId, thesisId, controller.signal)
			.then((result) => {
				if (!cancelled) setData(result);
			})
			.catch((e) => {
				if (cancelled) return;
				if (e instanceof DOMException && e.name === "AbortError") return;
				setError("Failed to load thesis details");
			});
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [taskId, thesisId]);

	const thesisColor = "var(--color-thesis)";

	// ── Hero (only when data loaded) ─────────────────────────────────
	const hero = data ? (
		<div className="relative px-6 pb-5 pt-6">
			{/* Status + convergence badges */}
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<span className={`pill font-semibold text-[11px] ${STATUS_STYLE[data.thesis.status] ?? ""}`}>
					{data.thesis.status}
				</span>
				{data.emergence_score >= 2 && (
					<span
						className={`pill text-[11px] font-semibold ${data.emergence_score >= 3 ? "emergence-badge-high" : "emergence-badge-low"}`}
					>
						{data.emergence_score}-agent convergence
					</span>
				)}
				{data.thesis.market_size && (
					<span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-quaternary">
						{data.thesis.market_size}
					</span>
				)}
				{data.thesis.timing && (
					<span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-quaternary">
						{data.thesis.timing}
					</span>
				)}
			</div>

			{/* Title + confidence ring */}
			<div className="flex items-start gap-4">
				<div className="min-w-0 flex-1">
					<h2 className="text-[17px] font-semibold leading-snug text-text-primary">{data.thesis.title}</h2>
				</div>
				<ConfidenceRing value={data.thesis.confidence} color={thesisColor} />
			</div>
		</div>
	) : null;

	return (
		<Drawer onClose={onClose} hero={hero ?? undefined} accent={thesisColor}>
			{error && (
				<div className="flex flex-col items-center gap-3 py-12">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-error/[0.08]">
						<span className="text-lg text-error">!</span>
					</div>
					<p className="text-[13px] text-error">{error}</p>
				</div>
			)}

			{!data && !error && (
				<div className="flex flex-col items-center gap-3 py-20">
					<span className="spinner-lg" />
					<span className="text-[12px] text-text-quaternary">Loading thesis details...</span>
				</div>
			)}

			{data && (
				<div className="flex flex-col gap-5">
					{/* ── Thesis statement ─────────────────────────────── */}
					<div>
						<p className="text-[13.5px] leading-[1.75] text-text-secondary">{data.thesis.thesis}</p>
					</div>

					{/* ── Emergence ────────────────────────────────────── */}
					{data.emergence_score >= 2 && (
						<EmergenceNarrative
							findings={data.evidenceFindings}
							connections={data.allRelevantConnections}
							emergenceScore={data.emergence_score}
							evidenceItems={data.thesis.evidence}
							agentMeta={agentMeta}
						/>
					)}

					{/* ── Evidence ──────────────────────────────────────── */}
					{data.evidenceFindings.length > 0 && (
						<div>
							<div className="mb-2 flex items-center gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
									Evidence
								</span>
								<span className="text-[11px] font-mono tabular-nums text-text-quaternary">
									{data.evidenceFindings.length}
								</span>
								<span className="flex-1 border-b border-border/20" />
							</div>
							<EvidenceChain
								findings={data.evidenceFindings}
								connections={data.allRelevantConnections}
								reactionChains={data.reactionChains}
								evidenceItems={data.thesis.evidence}
								agentMeta={agentMeta}
							/>
						</div>
					)}

					{/* ── Votes ────────────────────────────────────────── */}
					{data.thesis.votes.length > 0 && (
						<div>
							<div className="mb-2 flex items-center gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Votes</span>
								<span className="text-[11px] font-mono tabular-nums text-text-quaternary">
									{data.thesis.votes.length}
								</span>
								<span className="flex-1 border-b border-border/20" />
							</div>
							<VotesSection votes={data.thesis.votes} evidenceFindings={data.evidenceFindings} agentMeta={agentMeta} />
						</div>
					)}

					{/* ── Risks ────────────────────────────────────────── */}
					{data.thesis.risks.length > 0 && (
						<div>
							<div className="mb-2 flex items-center gap-2">
								<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Risks</span>
								<span className="flex-1 border-b border-border/20" />
							</div>
							<ul className="list-none space-y-2 p-0">
								{data.thesis.risks.map((r) => (
									<li key={r} className="flex items-start gap-2.5 text-[13px] leading-[1.65] text-text-secondary">
										<span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-error/[0.08] text-[9px] font-bold text-error">
											!
										</span>
										{r}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</Drawer>
	);
}

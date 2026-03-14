import { useMemo } from "react";
import type { StructuredSummary } from "../../lib/types";

export function DebateHealth({
	score,
	confidenceDist,
	keyDebates,
}: {
	score: StructuredSummary["disagreementScore"];
	confidenceDist: StructuredSummary["confidenceDistribution"];
	keyDebates?: StructuredSummary["keyDebates"];
}) {
	const challengePct = Math.round(score.challengeVoteRatio * 100);
	const agreementPct = Math.round(confidenceDist.agentAgreement * 100);

	const rating =
		challengePct >= 15 && challengePct <= 50 ? "Healthy" : challengePct < 15 ? "Low contention" : "Highly contested";
	const ratingColor =
		challengePct >= 15 && challengePct <= 50 ? "text-success" : challengePct < 15 ? "text-warning" : "text-error";

	const resolutionCounts = useMemo(() => {
		if (!keyDebates?.length) return null;
		let resolved = 0;
		let partial = 0;
		let unresolved = 0;
		for (const d of keyDebates) {
			if (d.resolution === "resolved") resolved++;
			else if (d.resolution === "unresolved") unresolved++;
			else partial++;
		}
		return { resolved, partial, unresolved };
	}, [keyDebates]);

	return (
		<div className="space-y-2 px-1">
			<div className="flex items-center justify-between">
				<span className="text-body">Debate quality</span>
				<span className={`text-agent font-semibold ${ratingColor}`}>{rating}</span>
			</div>
			<div className="grid grid-cols-3 gap-2">
				<div className="rounded-md bg-surface/60 px-2.5 py-2 text-center">
					<div className="text-heading tabular-nums text-text-primary">{challengePct}%</div>
					<div className="text-meta text-dim">Challenge rate</div>
				</div>
				<div className="rounded-md bg-surface/60 px-2.5 py-2 text-center">
					<div className="text-heading tabular-nums text-text-primary">{score.tensionCount}</div>
					<div className="text-meta text-dim">Tensions</div>
				</div>
				<div className="rounded-md bg-surface/60 px-2.5 py-2 text-center">
					<div className="text-heading tabular-nums text-text-primary">{score.unresolvedTensions}</div>
					<div className="text-meta text-dim">Unresolved</div>
				</div>
			</div>
			<div className="flex items-center gap-3 text-meta">
				<span>Confidence:</span>
				<span className="text-success tabular-nums">{confidenceDist.high} high</span>
				<span className="text-warning tabular-nums">{confidenceDist.medium} med</span>
				<span className="text-error tabular-nums">{confidenceDist.low} low</span>
				<span className="text-dim">·</span>
				<span className="tabular-nums">{agreementPct}% agreement</span>
			</div>
			{resolutionCounts && (
				<div className="flex items-center gap-2 text-meta pt-1 border-t border-border/30">
					<span className="text-dim">Debates:</span>
					{resolutionCounts.resolved > 0 && (
						<span className="text-success tabular-nums">{resolutionCounts.resolved} resolved</span>
					)}
					{resolutionCounts.partial > 0 && (
						<span className="text-warning tabular-nums">{resolutionCounts.partial} partial</span>
					)}
					{resolutionCounts.unresolved > 0 && (
						<span className="text-error tabular-nums">{resolutionCounts.unresolved} unresolved</span>
					)}
				</div>
			)}
		</div>
	);
}

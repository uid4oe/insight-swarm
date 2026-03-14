import { useEffect, useRef, useState } from "react";
import { fetchTaskSummary, requestTaskSummary } from "../../lib/api";
import type { AgentMeta, InvestmentThesis, StructuredSummary } from "../../lib/types";
import { SummaryContent } from "./SummaryContent";

interface Props {
	taskId: string;
	status: "queued" | "running" | "completed" | "failed";
	agentMeta?: AgentMeta[];
	theses?: InvestmentThesis[];
	onOpenThesis?: (thesisId: string) => void;
}

export function TaskSummary({ taskId, status, agentMeta = [], theses = [], onOpenThesis }: Props) {
	const [summary, setSummary] = useState<StructuredSummary | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [checked, setChecked] = useState(false);
	const retryControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		if (status !== "completed") return;
		setSummary(null);
		setError(null);
		setChecked(false);
		setLoading(true);

		let pollTimer: ReturnType<typeof setInterval> | null = null;
		let cancelled = false;
		let checking = false;
		const controller = new AbortController();

		const stopPolling = () => {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
		};

		const checkSummary = async () => {
			if (checking) return; // Prevent concurrent checks
			checking = true;
			try {
				const data = await fetchTaskSummary(taskId, controller.signal);
				if (cancelled) return;

				if ("summary" in data) {
					setSummary(data.summary);
					setLoading(false);
					setChecked(true);
					stopPolling();
				} else if (data.status === "generating") {
					setChecked(true);
				} else {
					setChecked(true);
					stopPolling();
					try {
						const result = await requestTaskSummary(taskId, controller.signal);
						if (!cancelled) {
							setSummary(result.summary);
							setLoading(false);
						}
					} catch (e) {
						if (e instanceof DOMException && e.name === "AbortError") return;
						if (!cancelled) {
							setError("Failed to generate summary");
							setLoading(false);
						}
					}
				}
			} catch (e) {
				if (e instanceof DOMException && e.name === "AbortError") return;
				if (!cancelled) {
					setChecked(true);
					setError("Failed to fetch summary");
					setLoading(false);
					stopPolling();
				}
			} finally {
				checking = false;
			}
		};

		checkSummary().then(() => {
			if (!cancelled) pollTimer = setInterval(checkSummary, 3000);
		});

		return () => {
			cancelled = true;
			controller.abort();
			retryControllerRef.current?.abort();
			stopPolling();
		};
	}, [taskId, status]);

	if (status !== "completed") return null;
	if (!checked && !summary) return null;

	return (
		<div className="flex flex-col">
			{loading && (
				<div className="flex flex-col gap-5 py-4 animate-fade-in">
					{/* Header */}
					<div className="flex items-center gap-2.5">
						<span className="spinner" />
						<span className="text-[13px] font-medium text-text-secondary">Generating insight summary</span>
					</div>

					{/* Skeleton content blocks */}
					<div className="flex flex-col gap-4 mt-1">
						{/* Title skeleton */}
						<div className="h-4 w-3/4 rounded animate-shimmer" />
						{/* Verdict skeleton */}
						<div className="rounded-md border border-border/60 p-3 flex flex-col gap-2">
							<div className="h-3 w-1/3 rounded animate-shimmer" />
							<div className="h-3 w-full rounded animate-shimmer" style={{ animationDelay: "0.1s" }} />
							<div className="h-3 w-5/6 rounded animate-shimmer" style={{ animationDelay: "0.2s" }} />
						</div>
						{/* Section skeletons */}
						{[0, 1, 2].map((i) => (
							<div key={i} className="flex flex-col gap-2">
								<div className="h-3 w-1/4 rounded animate-shimmer" style={{ animationDelay: `${0.1 * i}s` }} />
								<div className="h-3 w-full rounded animate-shimmer" style={{ animationDelay: `${0.1 * i + 0.05}s` }} />
								<div className="h-3 w-4/5 rounded animate-shimmer" style={{ animationDelay: `${0.1 * i + 0.1}s` }} />
							</div>
						))}
					</div>
				</div>
			)}

			{error && !loading && (
				<div className="flex items-center justify-between py-2 text-body text-error">
					{error}
					<button
						type="button"
						onClick={() => {
							retryControllerRef.current?.abort();
							const ctrl = new AbortController();
							retryControllerRef.current = ctrl;
							setLoading(true);
							setError(null);
							requestTaskSummary(taskId, ctrl.signal)
								.then((r) => setSummary(r.summary))
								.catch((e) => {
									if (e instanceof DOMException && e.name === "AbortError") return;
									setError("Failed to generate summary");
								})
								.finally(() => setLoading(false));
						}}
						className="btn-ghost"
					>
						Retry
					</button>
				</div>
			)}

			{summary && (
				<div className="animate-fade-in">
					<SummaryContent summary={summary} agentMeta={agentMeta} theses={theses} onOpenThesis={onOpenThesis} />
				</div>
			)}
		</div>
	);
}

import { useMemo } from "react";
import type { TaskSummary } from "../../lib/types";
import { TaskItem } from "../task/TaskItem";

interface Props {
	tasks: TaskSummary[];
	selectedTaskId: string | null;
	collapsed: boolean;
	onToggle: () => void;
	onSelectTask: (taskId: string) => void;
	onGoHome: () => void;
}

export function Sidebar({ tasks, selectedTaskId, collapsed, onToggle, onSelectTask, onGoHome }: Props) {
	const sorted = useMemo(
		() =>
			[...tasks].sort((a, b) => {
				const isActiveA = a.status === "running" || a.status === "queued";
				const isActiveB = b.status === "running" || b.status === "queued";
				if (isActiveA && !isActiveB) return -1;
				if (isActiveB && !isActiveA) return 1;
				return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
			}),
		[tasks],
	);

	const activeCount = tasks.filter((t) => t.status === "running" || t.status === "queued").length;

	if (collapsed) {
		return (
			<aside className="flex w-12 flex-col items-center border-r border-border/60 bg-panel py-3 gap-2">
				{/* Expand button */}
				<button
					type="button"
					onClick={onToggle}
					className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface hover:text-text-primary cursor-pointer"
					title="Expand sidebar"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<title>Expand</title>
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</button>
				{/* New analysis */}
				<button
					type="button"
					onClick={onGoHome}
					className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface hover:text-text-primary cursor-pointer"
					title="New analysis"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<title>New</title>
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
				</button>
				{activeCount > 0 && (
					<span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 font-mono text-[10px] text-accent">
						{activeCount}
					</span>
				)}
			</aside>
		);
	}

	return (
		<aside className="flex w-60 flex-col border-r border-border/60 bg-panel">
			{/* Header with collapse button */}
			<div className="shrink-0 p-3 flex items-center gap-2">
				<button
					type="button"
					onClick={onGoHome}
					className="flex flex-1 items-center gap-2 rounded-lg border border-border/80 bg-surface/40 px-3 py-2 text-[13px] font-medium text-text-secondary transition-all hover:border-border-light hover:bg-surface/70 hover:text-text-primary cursor-pointer"
				>
					<svg
						className="shrink-0"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					>
						<title>New</title>
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
					New analysis
					{activeCount > 0 && (
						<span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] text-accent">
							<span className="status-dot-sm animate-pulse-slow text-accent" />
							{activeCount}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={onToggle}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface hover:text-text-primary cursor-pointer"
					title="Collapse sidebar"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<title>Collapse</title>
						<polyline points="15 18 9 12 15 6" />
					</svg>
				</button>
			</div>

			{/* Task list */}
			<div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
				{tasks.length === 0 ? (
					<p className="px-3 py-8 text-center text-[12px] text-text-quaternary">No analyses yet</p>
				) : (
					sorted.map((t) => (
						<TaskItem
							key={t.taskId}
							task={t}
							isSelected={t.taskId === selectedTaskId}
							onClick={() => onSelectTask(t.taskId)}
						/>
					))
				)}
			</div>
		</aside>
	);
}

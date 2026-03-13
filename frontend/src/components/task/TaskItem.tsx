import type { TaskSummary } from "../../lib/types";

interface Props {
	task: TaskSummary;
	isSelected: boolean;
	onClick: () => void;
}

export function TaskItem({ task, isSelected, onClick }: Props) {
	const isActive = task.status === "running" || task.status === "queued";

	return (
		<button
			type="button"
			className={`mb-px flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left font-sans transition-all ${
				isSelected
					? "bg-surface/80 text-text-primary ring-1 ring-inset ring-accent/25"
					: "text-text-tertiary hover:bg-surface/40 hover:text-text-secondary"
			}`}
			onClick={onClick}
		>
			<span className="min-w-0 flex-1 truncate text-[13px] leading-snug" title={task.title}>
				{task.title}
			</span>
			{isActive && (
				<span
					className="status-dot-sm animate-pulse-slow shrink-0"
					style={{ color: task.status === "running" ? "var(--color-accent)" : "var(--color-warning)" }}
				/>
			)}
			{!isActive && task.status === "failed" && <span className="text-[10px] text-error shrink-0">✗</span>}
		</button>
	);
}

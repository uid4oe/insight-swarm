export function ConfidenceBar({ value }: { value: number }) {
	const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
	const barColor = pct >= 75 ? "bg-success/60" : pct >= 50 ? "bg-warning/50" : "bg-error/40";
	return (
		<div className="flex items-center gap-1.5 shrink-0">
			<div className="h-1 w-20 overflow-hidden rounded-full bg-surface-hover">
				<div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
			</div>
			<span className="w-7 text-right text-meta tabular-nums">{pct}%</span>
		</div>
	);
}

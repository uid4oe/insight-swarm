/** Linear confidence bar with gradient fill. */
export function ConfidenceMeter({ value, color }: { value: number; color: string }) {
	const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
	return (
		<div className="flex items-center gap-3">
			<div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
				<div
					className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
					style={{
						width: `${pct}%`,
						background: `linear-gradient(90deg, color-mix(in srgb, ${color} 50%, transparent), ${color})`,
						boxShadow: `0 0 12px color-mix(in srgb, ${color} 25%, transparent)`,
					}}
				/>
			</div>
			<span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums" style={{ color }}>
				{pct}%
			</span>
		</div>
	);
}

/** Radial ring confidence indicator — used in hero headers. */
export function ConfidenceRing({
	value,
	color,
	size = 56,
	strokeWidth = 3.5,
}: {
	value: number;
	color: string;
	size?: number;
	strokeWidth?: number;
}) {
	const pct = Math.min(1, Math.max(0, value));
	const r = (size - strokeWidth) / 2;
	const circ = 2 * Math.PI * r;
	const offset = circ * (1 - pct);
	const displayPct = Math.round(pct * 100);

	return (
		<div className="relative" style={{ width: size, height: size }}>
			<svg width={size} height={size} className="block -rotate-90" aria-label={`Confidence: ${displayPct}%`}>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					stroke="currentColor"
					strokeWidth={strokeWidth}
					className="text-white/[0.06]"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					stroke={color}
					strokeWidth={strokeWidth}
					strokeDasharray={circ}
					strokeDashoffset={offset}
					strokeLinecap="round"
					className="transition-all duration-700 ease-out"
					style={{ filter: `drop-shadow(0 0 4px color-mix(in srgb, ${color} 40%, transparent))` }}
				/>
			</svg>
			<span
				className="absolute inset-0 flex items-center justify-center font-mono text-[13px] font-bold tabular-nums"
				style={{ color }}
			>
				{displayPct}
			</span>
		</div>
	);
}

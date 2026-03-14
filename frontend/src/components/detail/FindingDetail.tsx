import { useMemo, useState } from "react";
import { buildAgentMap, getAgentColor, getAgentLabel } from "../../lib/agents";
import { RELATIONSHIP_COLORS, RELATIONSHIP_ICONS, RELATIONSHIP_TEXT_COLORS } from "../../lib/constants";
import { roundName } from "../../lib/format";
import { useAppStore } from "../../lib/store";
import type { Connection, Finding } from "../../lib/types";
import { ConfidenceRing } from "../common/ConfidenceMeter";
import { Drawer } from "../common/Drawer";

interface Props {
	finding: Finding;
	allFindings: Finding[];
	allConnections: Connection[];
	onClose: () => void;
	onOpenFinding: (findingId: string) => void;
	canGoBack?: boolean;
	onGoBack?: () => void;
}

/** Collapsible section wrapper */
function Section({
	title,
	count,
	defaultOpen = true,
	children,
}: {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div>
			<button type="button" className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setOpen(!open)}>
				<span
					className="flex h-4 w-4 items-center justify-center text-[10px] text-text-quaternary transition-transform duration-200"
					style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
				>
					&#9654;
				</span>
				<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{title}</span>
				{count !== undefined && (
					<span className="text-[11px] font-mono tabular-nums text-text-quaternary">{count}</span>
				)}
				<span className="flex-1 border-b border-border/20" />
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-250 ease-out"
				style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
			>
				<div className="overflow-hidden">{children}</div>
			</div>
		</div>
	);
}

export function FindingDetail({
	finding,
	allFindings,
	allConnections,
	onClose,
	onOpenFinding,
	canGoBack,
	onGoBack,
}: Props) {
	const agentMeta = useAppStore((s) => s.agentMeta);
	const agentMap = useMemo(() => buildAgentMap(agentMeta), [agentMeta]);
	const relatedConnections = useMemo(() => {
		return allConnections.filter((c) => c.from_finding_id === finding.id || c.to_finding_id === finding.id);
	}, [allConnections, finding.id]);

	const findingsMap = useMemo(() => {
		const map = new Map<string, Finding>();
		for (const f of allFindings) map.set(f.id, f);
		return map;
	}, [allFindings]);

	const parentFinding = finding.parent_finding_id ? (findingsMap.get(finding.parent_finding_id) ?? null) : null;

	const childFindings = useMemo(() => {
		return allFindings.filter((f) => f.parent_finding_id === finding.id);
	}, [allFindings, finding.id]);

	const agentColor = getAgentColor(finding.agent_id, agentMap);
	const agentLabel = getAgentLabel(finding.agent_id, agentMap);

	// ── Hero ─────────────────────────────────────────────────────────────
	const hero = (
		<div className="relative px-6 pb-5 pt-5">
			{/* Back button */}
			{canGoBack && (
				<button
					type="button"
					className="mb-3 flex items-center gap-1 text-[12px] text-text-quaternary transition-colors hover:text-text-secondary"
					onClick={onGoBack}
				>
					<span className="text-[14px]">&larr;</span> Back
				</button>
			)}

			{/* Agent + meta chips */}
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<span
					className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
					style={{
						color: agentColor,
						background: `color-mix(in srgb, ${agentColor} 10%, transparent)`,
					}}
				>
					<span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: agentColor }} />
					{agentLabel}
				</span>
				<span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-tertiary">
					{roundName(finding.round)}
				</span>
				{finding.category && (
					<span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-quaternary">
						{finding.category}
					</span>
				)}
			</div>

			{/* Title + confidence ring */}
			<div className="flex items-start gap-4">
				<div className="min-w-0 flex-1">
					<h2 className="text-[17px] font-semibold leading-snug text-text-primary">{finding.title}</h2>
					{finding.tags.length > 0 && (
						<div className="mt-2 flex flex-wrap gap-1.5">
							{finding.tags.slice(0, 5).map((tag) => (
								<span
									key={tag}
									className="rounded-md border border-border/30 bg-white/[0.02] px-2 py-0.5 text-[10px] text-text-quaternary"
								>
									{tag}
								</span>
							))}
						</div>
					)}
				</div>
				<ConfidenceRing value={finding.confidence} color={agentColor} />
			</div>
		</div>
	);

	return (
		<Drawer onClose={onClose} hero={hero} accent={agentColor}>
			<div className="flex flex-col gap-1">
				{/* ── Description ─────────────────────────────────────── */}
				{finding.description && (
					<div className="mb-2">
						<p className="text-[13.5px] leading-[1.75] text-text-secondary">{finding.description}</p>
					</div>
				)}

				{/* ── References ──────────────────────────────────────── */}
				{finding.references.length > 0 && (
					<Section title="References" count={finding.references.length}>
						<div className="flex flex-col gap-1.5 pb-2">
							{finding.references.map((ref, i) => {
								let hostname = "";
								try {
									hostname = ref.url ? new URL(ref.url).hostname.replace(/^www\./, "") : "";
								} catch {
									hostname = ref.url ?? "";
								}
								return (
									<div
										key={`${ref.title}-${i}`}
										className="group flex items-start gap-3 rounded-md border border-transparent bg-white/[0.02] px-3.5 py-2.5 transition-all hover:border-border/40 hover:bg-white/[0.04]"
									>
										{hostname && (
											<div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[11px] font-bold uppercase text-text-quaternary">
												{hostname.charAt(0)}
											</div>
										)}
										<div className="min-w-0 flex-1">
											{ref.url ? (
												<a
													href={ref.url}
													target="_blank"
													rel="noopener noreferrer"
													className="text-[13px] font-medium text-accent hover:underline"
												>
													{ref.title}
													<span className="ml-1 text-[10px] text-dim opacity-0 transition-opacity group-hover:opacity-100">
														&#8599;
													</span>
												</a>
											) : (
												<span className="text-[13px] font-medium text-text-primary">{ref.title}</span>
											)}
											{ref.snippet && (
												<p className="mt-0.5 text-[11.5px] leading-relaxed text-text-quaternary line-clamp-2">
													{ref.snippet}
												</p>
											)}
											{hostname && <span className="mt-0.5 block text-[10px] text-dim">{hostname}</span>}
										</div>
									</div>
								);
							})}
						</div>
					</Section>
				)}

				{/* ── Parent finding (if reaction) ───────────────────── */}
				{parentFinding && (
					<Section title="Reacting to">
						<div className="pb-2">
							<button
								type="button"
								className="w-full rounded-md border border-border/40 bg-white/[0.02] px-4 py-3 text-left transition-all hover:border-border/60 hover:bg-white/[0.04]"
								style={{ borderLeftWidth: 3, borderLeftColor: getAgentColor(parentFinding.agent_id, agentMap) }}
								onClick={() => onOpenFinding(parentFinding.id)}
							>
								<div className="flex items-center justify-between">
									<span
										className="text-[11px] font-bold uppercase tracking-wide"
										style={{ color: getAgentColor(parentFinding.agent_id, agentMap) }}
									>
										{getAgentLabel(parentFinding.agent_id, agentMap)}
									</span>
									<span className="font-mono text-[11px] tabular-nums text-text-quaternary">
										{Math.round(parentFinding.confidence * 100)}%
									</span>
								</div>
								<p className="mt-1 text-[13px] leading-snug text-text-secondary">{parentFinding.title}</p>
							</button>
						</div>
					</Section>
				)}

				{/* ── Connections ─────────────────────────────────────── */}
				{relatedConnections.length > 0 && (
					<Section title="Connections" count={relatedConnections.length}>
						<div className="flex flex-col gap-2 pb-2">
							{relatedConnections.map((conn) => {
								const isSource = conn.from_finding_id === finding.id;
								const otherId = isSource ? conn.to_finding_id : conn.from_finding_id;
								const otherFinding = findingsMap.get(otherId);
								const otherColor = otherFinding
									? getAgentColor(otherFinding.agent_id, agentMap)
									: "var(--color-border-light)";
								const relColor = RELATIONSHIP_COLORS[conn.relationship] ?? "#666";

								return (
									<button
										type="button"
										key={conn.id}
										className="group w-full rounded-md border border-border/30 bg-white/[0.015] px-4 py-3 text-left transition-all hover:border-border/50 hover:bg-white/[0.035]"
										style={{ borderLeftWidth: 3, borderLeftColor: otherColor }}
										onClick={() => {
											if (otherFinding) onOpenFinding(otherId);
										}}
									>
										<div className="mb-1.5 flex items-center justify-between">
											<div className="flex items-center gap-2">
												<span
													className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RELATIONSHIP_TEXT_COLORS[conn.relationship] ?? "text-muted"}`}
													style={{
														background: `color-mix(in srgb, ${relColor} 10%, transparent)`,
														border: `1px solid color-mix(in srgb, ${relColor} 18%, transparent)`,
													}}
												>
													{RELATIONSHIP_ICONS[conn.relationship]} {conn.relationship}
												</span>
												<span className="text-[10px] text-text-quaternary">{isSource ? "\u2192" : "\u2190"}</span>
												{otherFinding && (
													<span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: otherColor }}>
														{getAgentLabel(otherFinding.agent_id, agentMap)}
													</span>
												)}
											</div>
											<span className="font-mono text-[11px] font-semibold tabular-nums text-text-quaternary">
												{Math.round(conn.strength * 100)}%
											</span>
										</div>
										{otherFinding && (
											<p className="text-[13px] leading-snug text-text-secondary">{otherFinding.title}</p>
										)}
										{conn.reasoning && (
											<p className="mt-1 text-[12px] leading-relaxed text-text-quaternary">{conn.reasoning}</p>
										)}
									</button>
								);
							})}
						</div>
					</Section>
				)}

				{/* ── Reactions (child findings) ─────────────────────── */}
				{childFindings.length > 0 && (
					<Section title="Reactions" count={childFindings.length}>
						<div className="flex flex-col gap-1.5 pb-2">
							{childFindings.map((child) => {
								const childColor = getAgentColor(child.agent_id, agentMap);
								return (
									<button
										type="button"
										key={child.id}
										className="w-full rounded-md border border-border/30 bg-white/[0.015] px-4 py-2.5 text-left transition-all hover:border-border/50 hover:bg-white/[0.035]"
										style={{ borderLeftWidth: 3, borderLeftColor: childColor }}
										onClick={() => onOpenFinding(child.id)}
									>
										<div className="flex items-center justify-between">
											<span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: childColor }}>
												{getAgentLabel(child.agent_id, agentMap)}
											</span>
											<span className="font-mono text-[11px] tabular-nums text-text-quaternary">
												R{child.round} · {Math.round(child.confidence * 100)}%
											</span>
										</div>
										<p className="mt-0.5 text-[13px] leading-snug text-text-secondary">{child.title}</p>
									</button>
								);
							})}
						</div>
					</Section>
				)}
			</div>
		</Drawer>
	);
}

import type { ActivityEntry } from "../../lib/types";

// ── Action categories for visual grouping ────────────────────────────────────

export type ActionCategory = "knowledge" | "synthesis" | "collaboration" | "research" | "lifecycle";

export interface ActionMeta {
	icon: string;
	verb: string;
	category: ActionCategory;
	accent: string;
}

const ACTION_META: Record<string, ActionMeta> = {
	write_finding: { icon: "◆", verb: "Finding", category: "knowledge", accent: "text-action-finding" },
	create_connection: { icon: "━", verb: "Link", category: "knowledge", accent: "text-action-connection" },
	react_to_finding: { icon: "↩", verb: "Reaction", category: "knowledge", accent: "text-action-reaction" },
	skip_reaction: { icon: "·", verb: "Skip", category: "knowledge", accent: "text-dim" },
	create_thesis: { icon: "★", verb: "Thesis", category: "synthesis", accent: "text-action-thesis" },
	vote_on_thesis: { icon: "▲", verb: "Vote", category: "synthesis", accent: "text-action-vote" },
	mark_round_ready: { icon: "✓", verb: "Ready", category: "collaboration", accent: "text-action-ready" },
	post_question: { icon: "?", verb: "Question", category: "collaboration", accent: "text-action-question" },
	query_findings_by_tags: { icon: "⊞", verb: "Query", category: "research", accent: "text-text-quaternary" },
	traverse_connections: { icon: "⊞", verb: "Traverse", category: "research", accent: "text-text-quaternary" },
	web_search: { icon: "⌕", verb: "Search", category: "research", accent: "text-text-quaternary" },
	web_read: { icon: "⊞", verb: "Read", category: "research", accent: "text-text-quaternary" },
	started: { icon: "▸", verb: "Online", category: "lifecycle", accent: "text-success/70" },
	killed: { icon: "✗", verb: "Offline", category: "lifecycle", accent: "text-error/70" },
	agent_died: { icon: "✗", verb: "Died", category: "lifecycle", accent: "text-error/70" },
};

export function getActionMeta(action: string): ActionMeta {
	return (
		ACTION_META[action] ?? {
			icon: "·",
			verb: action.replace(/_/g, " "),
			category: "lifecycle" as ActionCategory,
			accent: "text-dim",
		}
	);
}

export function cleanSummary(summary: string): string {
	let s = summary
		.replace(/^[A-Z][A-Z0-9 _-]*:\s*/, "")
		.replace(/\s*\([^)]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^)]*\)/gi, "")
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
		.replace(/^Reacted to finding\s*(and\s*)?/i, "")
		.replace(/^Created follow-up:\s*/i, "")
		.replace(/^(Wrote|Created|Added)\s+(a\s+)?(new\s+)?finding:\s*/i, "")
		.replace(/^(Created|Added)\s+(a\s+)?(new\s+)?connection:\s*/i, "")
		.replace(/^(Created|Proposed)\s+(a\s+)?(new\s+)?thesis:\s*/i, "")
		.replace(/^Connected findings:\s*/i, "")
		.replace(/→/g, "to")
		.replace(/\s*\[[a-z_-]+\]/gi, "")
		.replace(/\s*\(strength:?\s*[\d.]+\)/gi, "")
		.replace(/\s*\(confidence:?\s*[\d.]+\)/gi, "")
		.replace(/^Voted support on:\s*/i, "Supported: ")
		.replace(/^Voted challenge on:\s*/i, "Challenged: ")
		.replace(/^Marked round ready\b.*/i, "")
		.replace(/\s{2,}/g, " ")
		.replace(/^[\s,;:·]+/, "")
		.trim();

	if (s.length > 0 && s[0] >= "a" && s[0] <= "z") {
		s = s[0].toUpperCase() + s.slice(1);
	}

	return s.slice(0, 120);
}

// ── Round stats ──────────────────────────────────────────────────────────────

export interface RoundStats {
	findings: number;
	connections: number;
	reactions: number;
	theses: number;
}

export function computeRoundStats(entries: ActivityEntry[]): RoundStats {
	const stats: RoundStats = { findings: 0, connections: 0, reactions: 0, theses: 0 };
	for (const e of entries) {
		switch (e.action) {
			case "write_finding":
				stats.findings++;
				break;
			case "create_connection":
				stats.connections++;
				break;
			case "react_to_finding":
				stats.reactions++;
				break;
			case "create_thesis":
				stats.theses++;
				break;
		}
	}
	return stats;
}

export const NOISE_ACTIONS = new Set([
	"conversation_history",
	"query_findings_by_tags",
	"traverse_connections",
	"skip_reaction",
]);

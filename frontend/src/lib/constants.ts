// ── Display Constants ───────────────────────────────────────────────────────
// Status icons/labels, relationship colors, and task status styling.

import type { AgentStatusType, ConnectionRelationship, TaskState } from "./types";

export const STATUS_ICONS: Record<AgentStatusType, string> = {
	idle: "○",
	thinking: "◉",
	tool_use: "⚙",
	writing: "✎",
	reacting: "↻",
	waiting: "◌",
	dead: "✗",
	round_ready: "✓",
};

export const STATUS_LABELS: Record<AgentStatusType, string> = {
	idle: "Idle",
	thinking: "Thinking",
	tool_use: "Using tools",
	writing: "Writing finding",
	reacting: "Reacting",
	waiting: "Waiting",
	dead: "Offline",
	round_ready: "Round complete",
};

/** Hex values for canvas/Sigma rendering (keep in sync with --color-rel-* CSS tokens) */
export const RELATIONSHIP_COLORS: Record<ConnectionRelationship, string> = {
	supports: "#4ade80", // sync: --color-rel-supports
	contradicts: "#f87171", // sync: --color-rel-contradicts
	enables: "#60a5fa", // sync: --color-rel-enables
	amplifies: "#fbbf24", // sync: --color-rel-amplifies
};

export const RELATIONSHIP_ICONS: Record<ConnectionRelationship, string> = {
	supports: "+",
	contradicts: "!",
	enables: "\u2192",
	amplifies: "++",
};

export const TASK_STATUS_COLORS: Record<TaskState["status"], string> = {
	queued: "text-warning",
	running: "text-accent-strong",
	completed: "text-success",
	failed: "text-error",
	cancelled: "text-meta",
};

export const RELATIONSHIP_TEXT_COLORS: Record<ConnectionRelationship, string> = {
	supports: "text-rel-supports",
	contradicts: "text-rel-contradicts",
	enables: "text-rel-enables",
	amplifies: "text-rel-amplifies",
};

/** Graph canvas colors — keep in sync with CSS tokens */
export const GRAPH_COLORS = {
	thesis: "#fbbf24", // sync: --color-thesis
	thesisHighEmergence: "#f59e0b", // sync: --color-thesis-high
	defaultNode: "#555",
	defaultEdge: "#2a2a3a",
} as const;

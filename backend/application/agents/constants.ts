// ── Agent Constants ──────────────────────────────────────────────────────────
// Shared timing, sizing, and tuning constants for the agent layer.
//
// These thresholds were empirically tuned across ~50 swarm runs (Feb-Mar 2026).
// Each value includes reasoning for WHY it's set where it is and what happens
// if you change it. Adjust with care — these interact with each other.

// ── Timing & Sizing ────────────────────────────────────────────────────────

/** Max heartbeat staleness before marking an agent dead (5 minutes).
 * Too short: agents die during long LLM calls or rate-limit backoffs.
 * Too long: dead agents block round advancement for minutes. */
export const STALE_HEARTBEAT_MS = 300_000;

/** Grace period for eventBus closure after task completion (3 seconds).
 * Allows final SSE events to flush to connected clients before the
 * RabbitMQ exchange is torn down. */
export const EVENT_BUS_CLOSE_DELAY_MS = 3_000;

/** Maximum characters for the LLM knowledge context block (~8k tokens).
 * This is the per-round context window budget for findings/connections/theses
 * injected into the agent's system prompt. Gemini 2.0 Flash has 1M context,
 * but larger contexts slow responses and increase cost.
 * Too low: agents lose awareness of peer work. Too high: slower + costlier turns. */
export const MAX_CONTEXT_CHARS = 30_000;

// ── Dynamics Thresholds ──────────────────────────────────────────────────

/** Minimum challenge vote ratio per agent (30% of theses).
 * Each agent must challenge at least this fraction of theses to prevent
 * rubber-stamping. Lower → weaker adversarial pressure. Higher → agents
 * challenge everything regardless of merit. */
export const MIN_CHALLENGE_RATIO = 0.3;

/** Contradiction-to-total-connection ratio below which TENSION DEFICIT warning fires.
 * Ensures agents are identifying disagreements, not just building supporting evidence.
 * 15% means at least 1 in 7 connections should be a contradiction.
 * Lower → allows too-harmonious analysis. Higher → forces artificial disagreement. */
export const TENSION_DEFICIT_THRESHOLD = 0.15;

/** Cosine similarity threshold for blocking same-agent "contradicts" connections.
 * Prevents an agent from marking two of its own very similar findings as
 * contradicting each other (usually a confused LLM). Cross-agent contradictions
 * are always allowed. Set at 0.65 (moderate similarity) to block only obvious
 * near-duplicates being flagged as contradictions. */
export const SAME_AGENT_CONTRADICTS_SIM_THRESHOLD = 0.65;

// ── Deduplication Thresholds ────────────────────────────────────────────

/** Cosine similarity above which a new finding is considered a duplicate.
 * Set high (0.85) because findings are short descriptions — even moderately
 * different findings can have ~0.75 similarity. Lowering below 0.80 causes
 * false positives (blocking legitimately different findings).
 * Raising above 0.90 allows near-identical findings through. */
export const FINDING_DEDUP_SIM_THRESHOLD = 0.85;

/** Cosine similarity above which a new thesis is considered a duplicate.
 * Lower than findings (0.72 vs 0.85) because theses are longer and more
 * structurally similar — two theses about "strong revenue growth" can have
 * different evidence and conclusions but high embedding similarity.
 * Below 0.65: blocks theses that are merely related. Above 0.80: too permissive. */
export const THESIS_DEDUP_SIM_THRESHOLD = 0.72;

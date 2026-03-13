// ── Application Configuration Port ──────────────────────────────────────────
// Business-only configuration subset. Infrastructure config (DATABASE_URL,
// RABBITMQ_URL, etc.) stays entirely in the infrastructure layer.

export interface SwarmConfig {
	maxFindingsPerRound: number;
	maxReactionsPerRound: number;
	maxTurnsPerRound: number;
	maxRounds: number;
	thesisThreshold: number;
	/** Hard cap on total theses per task (prevents unbounded creation). */
	maxTheses: number;
	geminiModel: string;
	/** Enable ADK LoggingPlugin — dumps all LLM calls, tool calls, and events to console */
	adkDebug: boolean;
	/** Enable Google Search (grounding) for agents */
	googleSearchEnabled: boolean;
	/** Max Google Search invocations per agent per round (cost control) */
	googleSearchMaxPerRound: number;
	/** Timeout for a single ADK session run (ms). Defaults to 180_000. */
	adkRunTimeoutMs: number;
}

// ── Rate Limiter Port ───────────────────────────────────────────────────────
// Defines the rate-limiting contract for the application layer.
// Implementation lives in infrastructure/resilience/rate-limiter.ts.

export interface RateLimiter {
	acquire(agentId?: string): Promise<void>;
	/** Back off the global bucket for the given duration. */
	backoffMs(durationMs: number): void;
	/** Back off a specific agent's bucket (+ global) for the given duration. */
	backoffAgent(agentId: string, durationMs: number): void;
	/** Update per-agent RPM after agent count is known. No-op for flat limiters. */
	setAgentCount?(count: number): void;
}

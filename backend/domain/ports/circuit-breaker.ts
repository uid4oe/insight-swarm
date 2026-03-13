// ── Circuit Breaker Port ────────────────────────────────────────────────────
// Defines the circuit-breaker contract for the application layer.
// Implementation lives in infrastructure/resilience/circuit-breaker.ts.

/** Thrown by CircuitBreakerPort.check() when the circuit is open. */
export class CircuitOpenError extends Error {
	readonly retryAfterMs: number;

	constructor(retryAfterMs: number) {
		super(`Circuit breaker is open — Gemini API unavailable (retry in ${Math.ceil(retryAfterMs / 1000)}s)`);
		this.name = 'CircuitOpenError';
		this.retryAfterMs = retryAfterMs;
	}
}

export interface CircuitBreakerPort {
	/** Throws CircuitOpenError if the circuit is open and no probe is allowed. */
	check(): void;
	recordSuccess(): void;
	recordFailure(): void;
	readonly isOpen: boolean;
	readonly currentState: string;
}

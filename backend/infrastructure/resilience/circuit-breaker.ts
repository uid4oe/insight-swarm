// ── Circuit Breaker ─────────────────────────────────────────────────────────
// Concrete implementation + interface. Shared across all agents to prevent
// cascading retries when the Gemini API is down. Uses a closed/open/half-open
// state machine with multi-probe recovery and exponential backoff on the
// reset timeout.

import { type CircuitBreakerPort, CircuitOpenError } from '../../domain/ports/circuit-breaker.js';

export { CircuitOpenError };
export type { CircuitBreakerPort };

// ── Implementation ──────────────────────────────────────────────────────────

/** Max number of successful probes required to close from half-open state. */
const HALF_OPEN_PROBES_REQUIRED = 2;
/** Max reset timeout after repeated failures (10 minutes). */
const MAX_RESET_TIMEOUT_MS = 600_000;

export class CircuitBreaker implements CircuitBreakerPort {
	private state: 'closed' | 'open' | 'half-open' = 'closed';
	private failures = 0;
	private halfOpenSuccesses = 0;
	private lastFailure = 0;
	private consecutiveOpens = 0;
	private readonly threshold: number;
	private readonly baseResetTimeout: number;

	constructor(threshold = 5, resetTimeout = 60_000) {
		this.threshold = threshold;
		this.baseResetTimeout = resetTimeout;
	}

	/** Current reset timeout with exponential backoff for repeated failures. */
	private get resetTimeout(): number {
		return Math.min(MAX_RESET_TIMEOUT_MS, this.baseResetTimeout * 2 ** this.consecutiveOpens);
	}

	/** Throws if circuit is open. In half-open, allows limited probes through. */
	check(): void {
		if (this.state === 'closed') return;

		if (this.state === 'half-open') {
			// Allow probes through in half-open state (up to HALF_OPEN_PROBES_REQUIRED)
			return;
		}

		// state === 'open'
		if (Date.now() - this.lastFailure > this.resetTimeout) {
			this.state = 'half-open';
			this.halfOpenSuccesses = 0;
			return; // allow probe requests
		}
		throw new CircuitOpenError(this.resetTimeout - (Date.now() - this.lastFailure));
	}

	recordSuccess(): void {
		if (this.state === 'half-open') {
			this.halfOpenSuccesses++;
			if (this.halfOpenSuccesses >= HALF_OPEN_PROBES_REQUIRED) {
				// Enough successful probes — fully close the circuit
				this.failures = 0;
				this.consecutiveOpens = 0;
				this.state = 'closed';
			}
			return;
		}
		this.failures = 0;
		this.consecutiveOpens = 0;
		this.state = 'closed';
	}

	recordFailure(): void {
		this.failures++;
		this.lastFailure = Date.now();
		if (this.state === 'half-open') {
			// Half-open probe failed — reset success counter, re-open with increased backoff
			this.halfOpenSuccesses = 0;
			this.consecutiveOpens++;
			this.state = 'open';
		} else if (this.failures >= this.threshold) {
			this.consecutiveOpens++;
			this.state = 'open';
		}
	}

	get isOpen(): boolean {
		return this.state === 'open';
	}

	get currentState(): string {
		return this.state;
	}
}

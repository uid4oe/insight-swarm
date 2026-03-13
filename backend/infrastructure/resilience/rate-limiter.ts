// ── Rate Limiter Implementations ─────────────────────────────────────────────
// Concrete token-bucket rate limiters.

import type { RateLimiter } from '../../domain/ports/rate-limiter.js';

export type { RateLimiter };

// ── Shared Token-Bucket Rate Limiter ────────────────────────────────────────
// Coordinates LLM API access across all agents to prevent cascading 429s.
// Uses a token bucket with a serialized queue to ensure fair, evenly-paced access.

export class SharedRateLimiter implements RateLimiter {
	private tokens: number;
	private maxTokens: number;
	private refillRate: number; // tokens per millisecond
	private lastRefill: number;
	/** Timestamp until which refills are suppressed (backoff window). */
	private backoffExpiresAt = 0;
	private queue: Array<() => void> = [];
	private drainScheduled = false;

	/**
	 * @param requestsPerMinute  Maximum requests per minute across all agents
	 * @param burstSize          Maximum burst size (defaults to RPM / 2)
	 */
	constructor(requestsPerMinute: number, burstSize?: number) {
		this.maxTokens = burstSize ?? Math.max(Math.ceil(requestsPerMinute / 2), 1);
		this.tokens = this.maxTokens;
		this.refillRate = requestsPerMinute / 60_000; // tokens per ms
		this.lastRefill = Date.now();
	}

	private refill(): void {
		const now = Date.now();
		// Suppress refills during backoff window
		if (now < this.backoffExpiresAt) return;
		const elapsed = now - this.lastRefill;
		if (elapsed > 0) {
			this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
			this.lastRefill = now;
		}
	}

	/** Acquire a token, waiting if necessary. Returns when the request can proceed. */
	async acquire(_agentId?: string): Promise<void> {
		this.refill();

		if (this.tokens >= 1) {
			this.tokens -= 1;
			return;
		}

		// Wait for a token to become available
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
			this.scheduleDrain();
		});
	}

	private scheduleDrain(): void {
		if (this.drainScheduled) return;
		this.drainScheduled = true;

		// Calculate when the next token will be available
		this.refill();
		const deficit = 1 - this.tokens;
		const waitMs = deficit > 0 ? Math.ceil(deficit / this.refillRate) : 0;

		setTimeout(
			() => {
				this.drainScheduled = false;
				this.drainQueue();
			},
			Math.max(waitMs, 100),
		); // At least 100ms to avoid tight loops
	}

	private drainQueue(): void {
		this.refill();
		while (this.queue.length > 0 && this.tokens >= 1) {
			this.tokens -= 1;
			this.queue.shift()?.();
		}
		// If there are still waiters, schedule another drain
		if (this.queue.length > 0) {
			this.scheduleDrain();
		}
	}

	/** Signal that a 429 was received — back off the entire bucket for durationMs. */
	backoffMs(durationMs: number): void {
		const expiresAt = Date.now() + durationMs;
		// Use Math.max so concurrent calls never shorten the window
		this.backoffExpiresAt = Math.max(this.backoffExpiresAt, expiresAt);
		this.tokens = 0;
		this.lastRefill = this.backoffExpiresAt;
		// Reschedule drain for after the backoff period
		if (this.queue.length > 0) {
			const remaining = this.backoffExpiresAt - Date.now();
			this.drainScheduled = false;
			setTimeout(() => {
				this.drainScheduled = false;
				this.drainQueue();
			}, remaining + 100);
		}
	}

	/** SharedRateLimiter has no per-agent concept — delegates to backoffMs. */
	backoffAgent(_agentId: string, durationMs: number): void {
		this.backoffMs(durationMs);
	}
}

// ── Hierarchical Rate Limiter ───────────────────────────────────────────────
// Composes a global bucket with per-agent buckets so a runaway agent can't
// starve the others. Each agent gets a fair share + 50% burst headroom.

export class HierarchicalRateLimiter implements RateLimiter {
	private global: SharedRateLimiter;
	private perAgent = new Map<string, { limiter: SharedRateLimiter; lastUsed: number }>();
	private globalRpm: number;
	private perAgentRpm: number;
	/** Evict per-agent buckets not used in the last 10 minutes. */
	private static readonly BUCKET_TTL_MS = 600_000;

	constructor(globalRpm: number, agentCount = 1) {
		this.globalRpm = globalRpm;
		this.global = new SharedRateLimiter(globalRpm);
		this.perAgentRpm = this.calcPerAgentRpm(globalRpm, agentCount);
	}

	private calcPerAgentRpm(globalRpm: number, agentCount: number): number {
		return Math.max(Math.ceil((globalRpm / Math.max(agentCount, 1)) * 1.5), 5);
	}

	/** Recalculate per-agent RPM when agent count changes.
	 * Does NOT clear existing per-agent buckets — concurrent tasks share the limiter
	 * and clearing would orphan waiters from other running tasks. */
	setAgentCount(count: number): void {
		this.perAgentRpm = this.calcPerAgentRpm(this.globalRpm, count);
	}

	async acquire(agentId?: string): Promise<void> {
		if (!agentId) {
			await this.global.acquire();
			return;
		}
		let entry = this.perAgent.get(agentId);
		if (!entry) {
			entry = { limiter: new SharedRateLimiter(this.perAgentRpm), lastUsed: Date.now() };
			this.perAgent.set(agentId, entry);
			// Periodically evict stale buckets to prevent unbounded memory growth
			this.evictStaleBuckets();
		}
		entry.lastUsed = Date.now();
		await Promise.all([this.global.acquire(), entry.limiter.acquire()]);
	}

	backoffMs(durationMs: number): void {
		this.global.backoffMs(durationMs);
	}

	backoffAgent(agentId: string, durationMs: number): void {
		this.global.backoffMs(durationMs);
		this.perAgent.get(agentId)?.limiter.backoffMs(durationMs);
	}

	/** Remove per-agent buckets that haven't been used recently. */
	private evictStaleBuckets(): void {
		const now = Date.now();
		for (const [id, entry] of this.perAgent) {
			if (now - entry.lastUsed > HierarchicalRateLimiter.BUCKET_TTL_MS) {
				this.perAgent.delete(id);
			}
		}
	}
}

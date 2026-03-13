// ── Agent-Layer Types ───────────────────────────────────────────────────────
// ADK runner config and swarm agent deps.

import type { CircuitBreakerPort } from '../../domain/ports/circuit-breaker.js';
import type { SwarmConfig } from '../../domain/ports/config.js';
import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import type { SwarmEventBus } from '../../domain/ports/event-bus.js';
import type { KnowledgeGraphDB } from '../../domain/ports/knowledge-graph.js';
import type { Logger } from '../../domain/ports/logger.js';
import type { RateLimiter } from '../../domain/ports/rate-limiter.js';
import type { AgentId } from '../../domain/types.js';

// ── ADK Runner ──────────────────────────────────────────────────────────────

export interface AdkRunnerConfig {
	agentId: AgentId;
	model: string;
	systemPrompt: string;
	maxTurnsPerRound: number;
	db: KnowledgeGraphDB;
	eventBus: SwarmEventBus;
	rateLimiter: RateLimiter;
	logger: Logger;
	/** Enable ADK LoggingPlugin for verbose console debugging (all LLM calls, tool calls, events) */
	enableDebug?: boolean;
	/** Timeout for a single ADK session run (ms). Defaults to 180_000 (3 min). */
	runTimeoutMs?: number;
	/** Shared circuit breaker for the Gemini API. */
	circuitBreaker?: CircuitBreakerPort;
}

// ── Swarm Agent ─────────────────────────────────────────────────────────────

export interface SwarmAgentDeps {
	swarmConfig: SwarmConfig;
	rateLimiter: RateLimiter;
	circuitBreaker: CircuitBreakerPort;
	logger: Logger;
	embeddingService: EmbeddingPort;
}

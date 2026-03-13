// ── Application Container ────────────────────────────────────────────────────
// Typed dependency container for the application. Holds all ports and shared
// services needed by the application layer. Created by infrastructure/bootstrap.ts.

import type { AgentMeta } from '../domain/agents.js';
import type { CircuitBreakerPort } from '../domain/ports/circuit-breaker.js';
import type { SwarmConfig } from '../domain/ports/config.js';
import type { EmbeddingPort } from '../domain/ports/embedding.js';
import type { SwarmEventBus } from '../domain/ports/event-bus.js';
import type { KnowledgeGraphDB } from '../domain/ports/knowledge-graph.js';
import type { Logger } from '../domain/ports/logger.js';
import type { RateLimiter } from '../domain/ports/rate-limiter.js';

export interface AppContainer {
	config: SwarmConfig;
	createLogger: (name: string) => Logger;
	rateLimiter: RateLimiter;
	circuitBreaker: CircuitBreakerPort;
	embeddingService: EmbeddingPort;

	// Factories for per-task resources
	createKnowledgeGraph(taskId: string, prompt: string): Promise<KnowledgeGraphDB>;
	openKnowledgeGraph(taskId: string): KnowledgeGraphDB;
	createEventBus(taskId: string): Promise<SwarmEventBus>;

	// Persist task status transitions and metadata to the DB
	updateTaskStatus(
		taskId: string,
		status: 'running' | 'completed' | 'failed' | 'cancelled',
		completedAt?: Date,
	): Promise<void>;
	saveAgentMeta(taskId: string, meta: AgentMeta[]): Promise<void>;

	// Lifecycle
	shutdown(): Promise<void>;
}

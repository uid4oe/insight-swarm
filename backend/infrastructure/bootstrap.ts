// ── Application Bootstrap ────────────────────────────────────────────────────
// Creates and wires all infrastructure implementations into the AppContainer.
// This is the only place where concrete adapters are instantiated.

import type { AppContainer } from '../application/container.js';
import { EmbeddingService } from './ai/embeddings.js';
import { initializeDatabase } from './db/pg-init.js';
import { PostgresKnowledgeGraph } from './db/pg-knowledge-graph.js';
import { closePool, getPool } from './db/pool.js';
import { validateEnv } from './env.js';
import { RabbitMQEventBus } from './messaging/event-bus.js';
import { CircuitBreaker } from './resilience/circuit-breaker.js';
import { createLogger } from './resilience/logger.js';
import { HierarchicalRateLimiter } from './resilience/rate-limiter.js';

export async function createAppContainer(): Promise<AppContainer> {
	const env = validateEnv();
	await initializeDatabase();
	const pool = getPool();

	// Set GOOGLE_API_KEY for ADK (ADK reads this env var for Gemini calls)
	process.env.GOOGLE_API_KEY = env.GEMINI_API_KEY;

	// Hierarchical rate limiter (global + per-agent buckets).
	// Initialized with agentCount=5 (max: 3 built-in + up to 2 custom agents).
	const rateLimiter = new HierarchicalRateLimiter(env.LLM_RATE_LIMIT_RPM, 5);

	// Circuit breaker for Gemini API (shared across all agents)
	const circuitBreaker = new CircuitBreaker();

	// Embedding service (shared, stateless)
	const embeddingService = new EmbeddingService();

	// Map Env → SwarmConfig (business-only subset)
	const config = {
		maxFindingsPerRound: env.MAX_FINDINGS_PER_ROUND,
		maxReactionsPerRound: env.MAX_REACTIONS_PER_ROUND,
		maxTurnsPerRound: env.MAX_TURNS_PER_ROUND,
		maxRounds: env.MAX_ROUNDS,
		thesisThreshold: env.THESIS_THRESHOLD,
		maxTheses: env.MAX_THESES,
		geminiModel: env.GEMINI_MODEL,
		adkDebug: env.ADK_DEBUG,
		googleSearchEnabled: env.GOOGLE_SEARCH_ENABLED,
		googleSearchMaxPerRound: env.GOOGLE_SEARCH_MAX_PER_ROUND,
		adkRunTimeoutMs: env.ADK_RUN_TIMEOUT_MS,
	};

	return {
		config,
		createLogger,
		rateLimiter,
		circuitBreaker,
		embeddingService,

		createKnowledgeGraph: (taskId, prompt) => PostgresKnowledgeGraph.create(pool, taskId, prompt),
		openKnowledgeGraph: (taskId) => PostgresKnowledgeGraph.forExistingTask(pool, taskId),
		createEventBus: (taskId) => RabbitMQEventBus.create(env.RABBITMQ_URL, taskId),

		updateTaskStatus: async (taskId, status, completedAt) => {
			if (completedAt) {
				await pool.query(`UPDATE tasks SET status = $1, completed_at = $2 WHERE task_id = $3`, [
					status,
					completedAt,
					taskId,
				]);
			} else {
				await pool.query(`UPDATE tasks SET status = $1 WHERE task_id = $2`, [status, taskId]);
			}
		},

		saveAgentMeta: async (taskId, meta) => {
			await pool.query(`UPDATE tasks SET agent_meta = $1::jsonb WHERE task_id = $2`, [JSON.stringify(meta), taskId]);
		},

		shutdown: async () => {
			await closePool();
		},
	};
}

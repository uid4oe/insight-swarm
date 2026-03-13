// ── Shared Tool Types ───────────────────────────────────────────────────────

import type { EmbeddingPort } from '../../../domain/ports/embedding.js';
import type { SwarmEventBus } from '../../../domain/ports/event-bus.js';
import type { KnowledgeGraphDB } from '../../../domain/ports/knowledge-graph.js';
import type { Logger } from '../../../domain/ports/logger.js';
import type { RateLimiter } from '../../../domain/ports/rate-limiter.js';
import type { AgentId } from '../../../domain/types.js';
import type { WebSearchBudget } from './google-search-limited.js';

/** Context injected into every tool via closure. */
export interface SwarmToolContext {
	agentId: AgentId;
	db: KnowledgeGraphDB;
	eventBus: SwarmEventBus;
	prompt: string;
	currentRound: number;
	agentTagMap: Record<string, string[]>;
	config: {
		maxFindingsPerRound: number;
		maxRounds: number;
		maxTheses: number;
		googleSearchEnabled: boolean;
		googleSearchMaxPerRound: number;
		geminiModel: string;
	};
	rateLimiter: RateLimiter;
	logger: Logger;
	webSearchBudget: WebSearchBudget;
	/** True when the thesis threshold has been met and the agent is winding down (voting only). */
	shuttingDown: boolean;
	/** Set to true when an ADK run times out — prevents post-timeout DB writes from leaking through. */
	timedOut: boolean;
	embeddingService: EmbeddingPort;
}

/** Options for creating the agent tool set. */
export interface CreateToolsOptions {
	ctx: SwarmToolContext;
	/** Called when mark_round_ready succeeds (agent marked ready). */
	onRoundReady: () => void;
}

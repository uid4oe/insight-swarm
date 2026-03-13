// ── Tool Factory ────────────────────────────────────────────────────────────
// Composes all tool groups into a single array for an ADK LlmAgent.
// Google Search runs as a FunctionTool (web_search) that delegates to a
// separate search-only LLM agent, avoiding the Gemini 400 error when mixing
// googleSearch grounding with function calling in the same request.

import type { BaseTool } from '@google/adk';
import { createCollaborationTools } from './collaboration-tools.js';
import { createWebSearchTool, getSearchBudgetForRound } from './google-search-limited.js';
import { createKnowledgeTools } from './knowledge-tools.js';
import type { CreateToolsOptions } from './types.js';

export function createAgentTools({ ctx, onRoundReady }: CreateToolsOptions): BaseTool[] {
	const tools: BaseTool[] = [...createKnowledgeTools(ctx), ...createCollaborationTools(ctx, onRoundReady)];

	if (ctx.config.googleSearchEnabled) {
		const roundBudget = getSearchBudgetForRound(ctx.currentRound, ctx.config.googleSearchMaxPerRound);
		tools.push(
			createWebSearchTool({
				model: ctx.config.geminiModel,
				maxCallsPerRound: roundBudget,
				rateLimiter: ctx.rateLimiter,
				logger: ctx.logger,
				round: ctx.currentRound,
				budget: ctx.webSearchBudget,
			}),
		);
	}

	return tools;
}

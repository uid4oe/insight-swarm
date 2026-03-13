// ── Agent Utilities ──────────────────────────────────────────────────────────
// Shared helpers used by the agent loop and agent tools.

import type { InvestmentThesis } from '../../domain/types.js';

/**
 * Returns theses that the given agent has not yet voted on
 * (excluding theses the agent created itself).
 */
export function getUnvotedTheses(agentId: string, theses: InvestmentThesis[]): InvestmentThesis[] {
	return theses.filter((t) => t.created_by !== agentId && !t.votes.some((v) => v.agent_id === agentId));
}

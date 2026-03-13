import type { SwarmEventBus } from '../ports/event-bus.js';
import type { KnowledgeGraphDB } from '../ports/knowledge-graph.js';
import type { AgentId } from '../types.js';

// ── Minimal context required by logAndEmit ─────────────────────────────────

interface LogAndEmitContext {
	agentId: AgentId;
	db: KnowledgeGraphDB;
	eventBus: SwarmEventBus;
	currentRound: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Log activity to DB and emit as real-time event for the frontend.
 *  Errors are caught so that a logging failure never crashes the calling tool. */
export async function logAndEmit(context: LogAndEmitContext, action: string, summary: string): Promise<void> {
	try {
		await context.db.logActivity(context.agentId, context.currentRound, action, summary);
	} catch {
		// DB logging is best-effort — don't let it break the tool chain
	}
	try {
		context.eventBus.emit('activity:logged', {
			agent_id: context.agentId,
			round: context.currentRound,
			action,
			summary,
			created_at: new Date().toISOString(),
		});
	} catch {
		// Event emission is best-effort
	}
}

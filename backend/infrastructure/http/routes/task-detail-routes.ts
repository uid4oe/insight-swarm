// ── Task Detail Routes ───────────────────────────────────────────────────────
// GET /api/tasks/:id — full task state (live or archived)
// GET /api/tasks/:id/theses/:thesisId — thesis backtracking detail

import type { Hono } from 'hono';
import type { KnowledgeGraphDB } from '../../../domain/ports/knowledge-graph.js';
import { PostgresKnowledgeGraph } from '../../db/pg-knowledge-graph.js';
import type { RouteDeps } from '../types.js';

interface DbForTaskResult {
	db: KnowledgeGraphDB;
	manifest: NonNullable<Awaited<ReturnType<RouteDeps['taskRegistry']['getManifestEntry']>>>;
}

async function getDbForTask(deps: RouteDeps, taskId: string): Promise<KnowledgeGraphDB | null>;
async function getDbForTask(deps: RouteDeps, taskId: string, withManifest: true): Promise<DbForTaskResult | null>;
async function getDbForTask(
	deps: RouteDeps,
	taskId: string,
	withManifest?: boolean,
): Promise<KnowledgeGraphDB | DbForTaskResult | null> {
	const { taskRegistry, pool } = deps;

	// 1. Check live handles first (task is running)
	const live = taskRegistry.get(taskId);
	if (live) {
		if (withManifest) {
			const manifest = await taskRegistry.getManifestEntry(taskId);
			return manifest ? { db: live.db, manifest } : null;
		}
		return live.db;
	}

	// 2. Check if task exists in DB
	const entry = await taskRegistry.getManifestEntry(taskId);
	if (!entry) return null;

	// 3. Return a lightweight handle for the existing task
	const db = PostgresKnowledgeGraph.forExistingTask(pool, taskId);
	return withManifest ? { db, manifest: entry } : db;
}

export function registerTaskDetailRoutes(app: Hono, deps: RouteDeps): void {
	const { taskRegistry } = deps;

	// GET /api/tasks/:id — full task state (live or archived)
	app.get('/api/tasks/:id', async (c) => {
		const taskId = c.req.param('id');
		const result = await getDbForTask(deps, taskId, true);
		if (!result) return c.json({ error: 'Task not found' }, 404);

		const { db, manifest } = result;

		const [findings, connections, theses, agents, roundState, activity, toolUsageStats, agentMeta] = await Promise.all([
			db.queryFindings({ limit: 200 }),
			db.getConnections(),
			db.getTheses(),
			db.getAgentStatuses(),
			db.getRoundState(),
			db.getRecentActivity(30),
			db.getToolUsageStats(),
			taskRegistry.getAgentMeta(taskId),
		]);

		return c.json({
			taskId,
			prompt: manifest.prompt,
			title: manifest.title,
			status: manifest.status,
			startedAt: manifest.startedAt,
			completedAt: manifest.completedAt,
			roundState,
			agents,
			findings,
			connections,
			theses,
			activity,
			agentMeta,
			toolUsageStats,
		});
	});

	// GET /api/tasks/:id/theses/:thesisId — backtracking detail
	app.get('/api/tasks/:id/theses/:thesisId', async (c) => {
		const db = await getDbForTask(deps, c.req.param('id'));
		if (!db) return c.json({ error: 'Task not found' }, 404);

		const thesis = await db.getThesis(c.req.param('thesisId'));
		if (!thesis) return c.json({ error: 'Thesis not found' }, 404);

		const evidenceIds = thesis.evidence.map((e) => e.finding_id);
		const [evidenceFindings, connectionsUsed] = await Promise.all([
			db.queryFindingsByIds(evidenceIds),
			db.queryConnectionsByIds(thesis.connections_used),
		]);

		// Build reaction chains for all evidence findings in a single query
		const chainsMap = await db.getReactionChains(evidenceFindings.map((f) => f.id));
		const reactionChains: Record<string, Awaited<ReturnType<typeof db.getReactionChain>>> = {};
		for (const [id, chain] of chainsMap) {
			if (chain.length > 0) reactionChains[id] = chain;
		}

		// Get connections touching evidence findings via DB query
		const evidenceIdList = evidenceFindings.map((f) => f.id);
		const allRelevantConnections = await db.getConnectionsForFindings(evidenceIdList);

		// Compute emergence score: distinct agents in the evidence chain
		const evidenceAgents = new Set(evidenceFindings.map((f) => f.agent_id));
		const emergence_score = evidenceAgents.size;

		return c.json({
			thesis,
			evidenceFindings,
			connectionsUsed,
			reactionChains,
			allRelevantConnections,
			emergence_score,
		});
	});
}

// Re-export the helper for use in summary routes
export { getDbForTask };

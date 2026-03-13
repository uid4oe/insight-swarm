// ── Summary Routes ───────────────────────────────────────────────────────────
// GET  /api/tasks/:id/summary — get persisted summary
// POST /api/tasks/:id/summary — trigger summary generation

import type { Hono } from 'hono';
import type { AgentDefinition } from '../../../../shared/agent-definitions.js';
import { AGENT_DEFINITION_MAP } from '../../../../shared/agent-definitions.js';
import { generateAndSaveSummary, getSavedSummary, isSummaryInProgress } from '../../../application/summary-service.js';
import type { RouteDeps } from '../types.js';
import { getDbForTask } from './task-detail-routes.js';

export function registerSummaryRoutes(app: Hono, deps: RouteDeps): void {
	const { taskRegistry, container } = deps;
	const logger = container.createLogger('SummaryRoutes');

	// GET /api/tasks/:id/summary — get summary (from DB)
	app.get('/api/tasks/:id/summary', async (c) => {
		const taskId = c.req.param('id');
		const db = await getDbForTask(deps, taskId);
		if (!db) {
			return c.json({ status: 'not_generated' }, 404);
		}
		const saved = await getSavedSummary(db, taskId);
		if (saved) {
			return c.json({ summary: saved });
		}
		if (isSummaryInProgress(taskId)) {
			return c.json({ status: 'generating' }, 202);
		}
		return c.json({ status: 'not_generated' }, 404);
	});

	// POST /api/tasks/:id/summary — trigger summary generation
	app.post('/api/tasks/:id/summary', async (c) => {
		const taskId = c.req.param('id');

		const db = await getDbForTask(deps, taskId);
		if (!db) {
			return c.json({ error: 'Task not found' }, 404);
		}

		const saved = await getSavedSummary(db, taskId);
		if (saved) {
			return c.json({ summary: saved });
		}
		if (isSummaryInProgress(taskId)) {
			return c.json({ status: 'generating' }, 202);
		}

		const manifest = await taskRegistry.getManifestEntry(taskId);
		if (manifest?.status === 'running' || manifest?.status === 'queued') {
			return c.json({ error: 'Task still running' }, 400);
		}

		const prompt = manifest?.prompt ?? 'unknown';

		// Build agent definition map including any custom agents stored with the task
		const agentMeta = await taskRegistry.getAgentMeta(taskId);
		let agentDefMap: Map<string, AgentDefinition> | undefined;
		if (agentMeta) {
			const hasCustom = agentMeta.some((m) => !AGENT_DEFINITION_MAP.has(m.id));
			if (hasCustom) {
				agentDefMap = new Map(AGENT_DEFINITION_MAP);
				for (const m of agentMeta) {
					if (!agentDefMap.has(m.id)) {
						agentDefMap.set(m.id, {
							id: m.id,
							label: m.label,
							shortLabel: m.label,
							color: m.color,
							description: m.description,
							perspective: m.perspective ?? m.description,
						});
					}
				}
			}
		}

		const summary = await generateAndSaveSummary(db, container.config.geminiModel, prompt, logger, taskId, agentDefMap);
		if (!summary) {
			return c.json({ error: 'Summary generation failed' }, 500);
		}
		return c.json({ summary });
	});
}

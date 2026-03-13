// ── Follow-up Routes ─────────────────────────────────────────────────────────
// POST /api/tasks/:id/followup — ask a follow-up question about a completed task

import type { Hono } from 'hono';
import { answerFollowup } from '../../../application/followup-service.js';
import type { RouteDeps } from '../types.js';
import { getDbForTask } from './task-detail-routes.js';

export function registerFollowupRoutes(app: Hono, deps: RouteDeps): void {
	const { taskRegistry, container } = deps;
	const logger = container.createLogger('FollowupRoutes');

	app.post('/api/tasks/:id/followup', async (c) => {
		const taskId = c.req.param('id');

		let body: { question?: string };
		try {
			body = await c.req.json<{ question: string }>();
		} catch {
			return c.json({ error: 'Invalid JSON body' }, 400);
		}

		const question = body.question?.trim();
		if (!question || question.length > 1000) {
			return c.json({ error: 'question is required (max 1000 characters)' }, 400);
		}

		const manifest = await taskRegistry.getManifestEntry(taskId);
		if (!manifest) {
			return c.json({ error: 'Task not found' }, 404);
		}
		if (manifest.status !== 'completed' && manifest.status !== 'failed') {
			return c.json({ error: 'Task not yet completed' }, 400);
		}

		const db = await getDbForTask(deps, taskId);
		if (!db) {
			return c.json({ error: 'Task not found' }, 404);
		}

		try {
			const answer = await answerFollowup(db, container.config.geminiModel, taskId, question, manifest.prompt);
			return c.json({ answer });
		} catch (err) {
			logger.error('Follow-up question failed', err, { taskId });
			return c.json({ error: 'Failed to generate answer' }, 500);
		}
	});
}

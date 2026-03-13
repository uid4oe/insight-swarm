// ── Global SSE Routes ────────────────────────────────────────────────────────
// GET /api/events — Server-Sent Events stream for task list updates.
// Replaces frontend polling of GET /api/tasks.

import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RouteDeps } from '../types.js';

export function registerGlobalSSERoutes(app: Hono, deps: RouteDeps): void {
	const { taskRegistry } = deps;

	app.get('/api/events', (c) => {
		return streamSSE(c, async (stream) => {
			let closed = false;
			stream.onAbort(() => {
				closed = true;
			});

			// Send initial task list snapshot
			const tasks = await taskRegistry.getAllSummaries();
			if (closed) return;
			await stream.writeSSE({ event: 'tasks', data: JSON.stringify(tasks) });

			// Listen for task list changes
			const onChange = async () => {
				if (closed) return;
				try {
					const updated = await taskRegistry.getAllSummaries();
					if (closed) return;
					await stream.writeSSE({ event: 'tasks', data: JSON.stringify(updated) });
				} catch {
					// Query failed — skip this update, next change will retry
				}
			};

			taskRegistry.events.on('task:changed', onChange);

			// Heartbeat to keep connection alive
			const heartbeat = setInterval(() => {
				if (closed) return;
				stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
					closed = true;
				});
			}, 15_000);

			// Keep the stream open until client disconnects
			await new Promise<void>((resolve) => {
				stream.onAbort(() => resolve());
			});

			clearInterval(heartbeat);
			taskRegistry.events.off('task:changed', onChange);
		});
	});
}

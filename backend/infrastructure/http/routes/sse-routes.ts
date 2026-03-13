// ── SSE Routes ───────────────────────────────────────────────────────────────
// GET /api/tasks/:id/events — Server-Sent Events stream for live task updates

import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { SwarmTask } from '../../../application/types.js';
import type { SwarmEvents } from '../../../domain/events.js';
import type { RouteDeps } from '../types.js';

type SSEStream = Parameters<Parameters<typeof streamSSE>[1]>[0];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Poll `check` every `intervalMs` until it returns true, task finishes, or stream aborts. */
async function pollUntil(
	stream: SSEStream,
	check: () => Promise<boolean>,
	opts: { intervalMs: number; maxMs: number; taskPromise?: Promise<unknown> },
): Promise<'matched' | 'timeout' | 'aborted' | 'task_done'> {
	let aborted = false;
	stream.onAbort(() => {
		aborted = true;
	});

	let taskDone = false;
	opts.taskPromise?.then(
		() => {
			taskDone = true;
		},
		() => {
			taskDone = true;
		},
	);

	let elapsed = 0;
	while (elapsed < opts.maxMs && !aborted && !taskDone) {
		await new Promise((r) => setTimeout(r, opts.intervalMs));
		elapsed += opts.intervalMs;
		if (aborted) return 'aborted';
		if (taskDone) return 'task_done';
		if (await check()) return 'matched';
		await stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
			aborted = true;
		});
	}
	return aborted ? 'aborted' : taskDone ? 'task_done' : 'timeout';
}

/** Send the current DB state as an initial snapshot event. */
async function sendSnapshot(stream: SSEStream, task: SwarmTask, deps: RouteDeps): Promise<void> {
	const agentMeta = await deps.taskRegistry.getAgentMeta(task.taskId);
	const manifest = await deps.taskRegistry.getManifestEntry(task.taskId);
	const initialState = {
		roundState: await task.db.getRoundState(),
		agents: await task.db.getAgentStatuses(),
		findings: await task.db.queryFindings({ limit: 200 }),
		connections: await task.db.getConnections(),
		theses: await task.db.getTheses(),
		activity: await task.db.getRecentActivity(30),
		status: manifest?.status ?? 'running',
		agentMeta: agentMeta ?? [],
	};
	await stream.writeSSE({
		event: 'snapshot',
		data: JSON.stringify(initialState),
	});
}

// ── Streaming Modes ──────────────────────────────────────────────────────────

/**
 * Stream live task events via the RabbitMQ event bus.
 * Used when the event bus is healthy.
 */
async function streamViaEventBus(stream: SSEStream, task: SwarmTask): Promise<'completed' | 'failed'> {
	const allEvents: (keyof SwarmEvents)[] = [
		'finding:created',
		'connection:created',
		'reaction:completed',
		'thesis:created',
		'thesis:voted',
		'round:advanced',
		'agent:status',
		'agent:died',
		'activity:logged',
		'agents:planned',
	];

	let cleanedUp = false;
	let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
	const handlers: Array<{
		event: keyof SwarmEvents;
		handler: (data: SwarmEvents[keyof SwarmEvents]) => void;
	}> = [];

	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		if (heartbeatInterval) clearInterval(heartbeatInterval);
		for (const { event, handler } of handlers) {
			task.eventBus.off(event, handler as never);
		}
	};

	// Register abort handler FIRST so cleanup fires even if subscription setup is slow
	stream.onAbort(() => cleanup());

	const subscriptionPromises: Promise<void>[] = [];
	for (const eventName of allEvents) {
		const handler = (data: SwarmEvents[keyof SwarmEvents]) => {
			if (cleanedUp) return;
			stream.writeSSE({ event: eventName, data: JSON.stringify(data) }).catch(() => cleanup());
		};
		const result = task.eventBus.on(eventName, handler as never);
		if (result instanceof Promise) subscriptionPromises.push(result);
		handlers.push({ event: eventName, handler });
	}

	await Promise.all(subscriptionPromises);

	heartbeatInterval = setInterval(() => {
		if (cleanedUp) return;
		stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => cleanup());
	}, 15_000);

	let outcome: 'completed' | 'failed';
	try {
		await task.promise;
		outcome = 'completed';
	} catch {
		outcome = 'failed';
	}

	cleanup();
	return outcome;
}

/**
 * Fallback: poll the DB periodically and send snapshots when data changes.
 * Used when the RabbitMQ event bus is closed.
 */
async function streamViaPolling(stream: SSEStream, task: SwarmTask, deps: RouteDeps): Promise<'completed' | 'failed'> {
	let lastHash = '';

	const pollResult = await pollUntil(
		stream,
		async () => {
			const counts = await task.db.getCounts().catch(() => null);
			if (!counts) return false;

			const hash = `${counts.findings}-${counts.connections}-${counts.theses}`;
			if (hash !== lastHash) {
				lastHash = hash;
				await sendSnapshot(stream, task, deps);
			}
			return false; // never "matched" — we run until task finishes
		},
		{ intervalMs: 2_000, maxMs: 1_800_000, taskPromise: task.promise },
	);

	// Send final snapshot on task completion
	if (pollResult === 'task_done') {
		await sendSnapshot(stream, task, deps).catch(() => {});
	}

	// Determine outcome by awaiting the promise directly — avoids the race
	// where the poll loop exits before the promise outcome listener fires
	try {
		await task.promise;
		return 'completed';
	} catch {
		return 'failed';
	}
}

/** Subscribe to a live task's events and stream them as SSE. */
async function streamLiveTaskEvents(stream: SSEStream, task: SwarmTask, deps: RouteDeps): Promise<void> {
	await sendSnapshot(stream, task, deps);

	const manifest = await deps.taskRegistry.getManifestEntry(task.taskId);
	const currentStatus = manifest?.status;

	// If task already done, send completion and return
	if (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled') {
		await stream.writeSSE({
			event: currentStatus === 'completed' ? 'task:completed' : 'task:failed',
			data: JSON.stringify({ taskId: task.taskId }),
		});
		return;
	}

	// Use event bus if healthy, otherwise fall back to DB polling
	const outcome = task.eventBus.isClosed
		? await streamViaPolling(stream, task, deps)
		: await streamViaEventBus(stream, task);

	await stream
		.writeSSE({
			event: outcome === 'completed' ? 'task:completed' : 'task:failed',
			data: JSON.stringify({ taskId: task.taskId }),
		})
		.catch(() => {});
}

// ── Route Registration ───────────────────────────────────────────────────────

export function registerSSERoutes(app: Hono, deps: RouteDeps): void {
	const { taskRegistry } = deps;

	app.get('/api/tasks/:id/events', async (c) => {
		const taskId = c.req.param('id');
		const task = taskRegistry.get(taskId);

		// Task is already live — stream directly
		if (task) {
			return streamSSE(c, (stream) => streamLiveTaskEvents(stream, task, deps));
		}

		// Check if task exists in DB
		const manifest = await taskRegistry.getManifestEntry(taskId);
		if (!manifest) return c.json({ error: 'Task not found' }, 404);

		// Task is queued — wait for consumer to pick it up, then stream
		if (manifest.status === 'queued') {
			return streamSSE(c, async (stream) => {
				await stream.writeSSE({
					event: 'task:queued',
					data: JSON.stringify({ taskId, status: 'queued' }),
				});

				const result = await pollUntil(
					stream,
					async () => {
						const liveTask = taskRegistry.get(taskId);
						if (liveTask) return true;

						// Check if task was cancelled/failed while queued
						const current = await taskRegistry.getManifestEntry(taskId);
						if (current && (current.status === 'failed' || current.status === 'cancelled')) {
							await stream.writeSSE({
								event: 'task:failed',
								data: JSON.stringify({ taskId }),
							});
							return true; // stop polling
						}
						return false;
					},
					{ intervalMs: 5_000, maxMs: 300_000 },
				);

				// If we found a live task, stream it
				if (result === 'matched') {
					const liveTask = taskRegistry.get(taskId);
					if (liveTask) {
						await streamLiveTaskEvents(stream, liveTask, deps);
						return;
					}
				}

				if (result === 'timeout') {
					await stream
						.writeSSE({
							event: 'task:failed',
							data: JSON.stringify({ taskId, message: 'Task did not start within timeout' }),
						})
						.catch(() => {});
				}
			});
		}

		// Task already finished — not streamable
		return c.json({ error: 'Task already finished', status: manifest.status }, 400);
	});
}

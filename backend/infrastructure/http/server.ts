// ── HTTP Server ──────────────────────────────────────────────────────────────
// Hono application setup, CORS middleware, route registration, and bootstrap.
// This is the infrastructure entry point for the API server mode.

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AgentDefinition } from '../../../shared/agent-definitions.js';
import { AGENT_DEFINITION_MAP, customToAgentDefinition } from '../../../shared/agent-definitions.js';
import type { AppContainer } from '../../application/container.js';
import { generateAndSaveSummary } from '../../application/summary-service.js';
import { startSwarmRun } from '../../application/swarm-runner.js';
import { PostgresKnowledgeGraph } from '../db/pg-knowledge-graph.js';
import { getPool } from '../db/pool.js';
import { getEnv } from '../env.js';
import { RabbitMQConnection } from '../messaging/connection.js';
import { TaskQueue } from '../messaging/task-queue.js';
import { registerFollowupRoutes } from './routes/followup-routes.js';
import { registerGlobalSSERoutes } from './routes/global-sse-routes.js';
import { registerSSERoutes } from './routes/sse-routes.js';
import { registerSummaryRoutes } from './routes/summary-routes.js';
import { registerTaskDetailRoutes } from './routes/task-detail-routes.js';
import { registerTaskRoutes } from './routes/task-routes.js';
import { createTaskRegistry } from './task-registry.js';
import type { RouteDeps, ServerHandle } from './types.js';

export async function startServer(container: AppContainer): Promise<ServerHandle> {
	const logger = container.createLogger('APIServer');
	const env = getEnv();
	const pool = getPool();

	// Task registry — tracks live + persisted tasks
	const taskRegistry = await createTaskRegistry(pool, container.createLogger('TaskRegistry'));

	// Task queue — shared RabbitMQ connection + publisher + consumer
	const rabbitConn = await RabbitMQConnection.connect(env.RABBITMQ_URL, container.createLogger('RabbitMQ'));
	const taskQueue = await TaskQueue.create(rabbitConn);

	const deps: RouteDeps = { container, taskRegistry, taskQueue, pool };

	// Start consuming tasks from the queue.
	// All application orchestration lives here — TaskQueue is a pure infra adapter.
	//
	// The handler awaits task.promise so that the RabbitMQ message stays unacked
	// while the task is running. Combined with channel prefetch, this naturally
	// limits the number of concurrent tasks without a separate semaphore.
	// If the process crashes, RabbitMQ re-delivers unacked messages.
	let activeTasks = 0;
	await taskQueue.startConsuming(
		async (msg, retryCount) => {
			// Skip tasks that were cancelled/completed while queued
			const manifest = await taskRegistry.getManifestEntry(msg.taskId);
			if (manifest && (manifest.status === 'failed' || manifest.status === 'completed')) {
				logger.info('Task already finished/cancelled, skipping', { taskId: msg.taskId, status: manifest.status });
				return;
			}

			activeTasks++;
			logger.info('Starting task execution', { taskId: msg.taskId, retryCount, activeTasks });

			const task = await startSwarmRun(container, msg.taskId, msg.prompt, {
				selectedAgents: msg.selectedAgents,
				modelOverrides: msg.modelOverrides,
				customAgents: msg.customAgents,
			});
			taskRegistry.add(task);
			taskRegistry.notifyChange();

			// Build combined agent definition map for summary generation (built-in + custom)
			let agentDefMap: Map<string, AgentDefinition> | undefined;
			if (msg.customAgents && msg.customAgents.length > 0) {
				agentDefMap = new Map(AGENT_DEFINITION_MAP);
				for (const ca of msg.customAgents) {
					agentDefMap.set(ca.id, customToAgentDefinition(ca));
				}
			}

			// Auto-generate summary on completion (fire-and-forget)
			task.promise
				.then(
					() => {
						const db = PostgresKnowledgeGraph.forExistingTask(pool, msg.taskId);
						return generateAndSaveSummary(
							db,
							container.config.geminiModel,
							task.prompt,
							logger,
							msg.taskId,
							agentDefMap,
						);
					},
					() => {}, // swarm failure — logged by swarm-runner
				)
				.catch((err) =>
					logger.warn('Auto-summary generation failed', {
						taskId: msg.taskId,
						error: err instanceof Error ? err.message : String(err),
					}),
				);

			// Wait for the task to finish before returning. The TaskQueue acks the
			// message when the handler returns, so prefetch limits concurrent tasks.
			// Errors are handled by swarm-runner (DB status set to 'failed');
			// we catch here to prevent the TaskQueue from treating it as a handler
			// failure (which would trigger DLX retry for an already-running task).
			await task.promise.catch(() => {});
			activeTasks--;
			taskRegistry.notifyChange();
			logger.info('Task finished, acking queue message', { taskId: msg.taskId, activeTasks });
		},
		{
			onRetry: (taskId, retryCount) => taskRegistry.updateTaskForRetry(taskId, retryCount),
			onDeadLetter: (taskId, retryCount) => taskRegistry.markTaskFailed(taskId, retryCount),
		},
	);

	// Hono app
	const app = new Hono();

	// CORS middleware
	const corsOrigin = env.CORS_ORIGIN;
	app.use(
		'/*',
		cors({
			origin: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : '*',
		}),
	);

	// Register all route groups
	registerTaskRoutes(app, deps);
	registerTaskDetailRoutes(app, deps);
	registerSummaryRoutes(app, deps);
	registerFollowupRoutes(app, deps);
	registerSSERoutes(app, deps);
	registerGlobalSSERoutes(app, deps);

	// Frontend static files (production only — in dev, Vite serves the frontend on port 5173)
	if (env.NODE_ENV !== 'development') {
		app.use('/*', serveStatic({ root: './frontend/dist' }));
		app.use('/*', serveStatic({ root: './frontend/dist', path: 'index.html' })); // SPA fallback
	}

	serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
		logger.info(`API server running on http://localhost:${info.port}`);
	});

	return { taskQueue };
}

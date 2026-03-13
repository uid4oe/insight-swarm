// ── Task Registry ────────────────────────────────────────────────────────────
// Tracks live SwarmTask runtime handles (db, eventBus, agents, promise).
// All status/timestamp/metadata reads are authoritative from Postgres.

import { EventEmitter } from 'node:events';
import type pg from 'pg';
import type { SwarmTask } from '../../application/types.js';
import type { AgentMeta } from '../../domain/agents.js';
import type { Logger } from '../../domain/ports/logger.js';
import type { TaskSummary } from './types.js';

export class TaskRegistry {
	private pool: pg.Pool;
	private logger: Logger;
	// Runtime handles only — no status, no timestamps, no agentMeta
	private liveHandles = new Map<string, SwarmTask>();

	/** Global event emitter for task list changes. Subscribers (e.g. global SSE) listen for 'task:changed'. */
	readonly events = new EventEmitter();

	constructor(pool: pg.Pool, logger: Logger) {
		this.pool = pool;
		this.logger = logger;
	}

	/** Mark any tasks that were "running" at crash time as "failed". */
	async initialize(): Promise<void> {
		await this.pool.query(`UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE status = 'running'`);
	}

	add(task: SwarmTask): void {
		this.liveHandles.set(task.taskId, task);

		task.promise
			.catch((err) => {
				this.logger.error(`Task ${task.taskId} failed`, err);
			})
			.finally(() => {
				// Remove from live handles after a delay so SSE/API can still access db/eventBus
				setTimeout(() => this.liveHandles.delete(task.taskId), 60_000);
			});
	}

	get(taskId: string): SwarmTask | undefined {
		return this.liveHandles.get(taskId);
	}

	async getManifestEntry(taskId: string): Promise<TaskSummary | undefined> {
		const { rows } = await this.pool.query(
			`SELECT task_id, prompt, title, selected_agents, status, started_at, completed_at FROM tasks WHERE task_id = $1`,
			[taskId],
		);
		if (rows.length === 0) return undefined;
		const r = rows[0];
		return {
			taskId: r.task_id,
			prompt: r.prompt as string,
			title: r.title as string,
			selectedAgents: (r.selected_agents as string[]) ?? [],
			status: r.status,
			startedAt: (r.started_at as Date).toISOString(),
			completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
		};
	}

	/** Notify all global SSE subscribers that the task list changed. */
	notifyChange(): void {
		this.events.emit('task:changed');
	}

	async updateTaskForRetry(taskId: string, retryCount: number): Promise<void> {
		await this.pool.query('UPDATE tasks SET status = $1, retry_count = $2 WHERE task_id = $3', [
			'queued',
			retryCount,
			taskId,
		]);
		this.notifyChange();
	}

	async markTaskFailed(taskId: string, retryCount: number): Promise<void> {
		await this.pool.query('UPDATE tasks SET status = $1, completed_at = NOW(), retry_count = $2 WHERE task_id = $3', [
			'failed',
			retryCount,
			taskId,
		]);
		this.notifyChange();
	}

	async getAgentMeta(taskId: string): Promise<AgentMeta[] | null> {
		const { rows } = await this.pool.query('SELECT agent_meta FROM tasks WHERE task_id = $1', [taskId]);
		if (rows.length === 0 || rows[0].agent_meta == null) return null;
		return rows[0].agent_meta as AgentMeta[];
	}

	async getAllSummaries(): Promise<TaskSummary[]> {
		const { rows } = await this.pool.query(
			`SELECT task_id, prompt, title, selected_agents, status, started_at, completed_at FROM tasks ORDER BY started_at DESC`,
		);
		return rows.map((r: Record<string, unknown>) => ({
			taskId: r.task_id as string,
			prompt: r.prompt as string,
			title: r.title as string,
			selectedAgents: (r.selected_agents as string[]) ?? [],
			status: r.status as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
			startedAt: (r.started_at as Date).toISOString(),
			completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
		}));
	}
}

export async function createTaskRegistry(pool: pg.Pool, logger: Logger): Promise<TaskRegistry> {
	const registry = new TaskRegistry(pool, logger);
	await registry.initialize();
	return registry;
}

// ── HTTP Infrastructure Types ───────────────────────────────────────────────
// Grouped: task registry DTOs, server handle, route deps.

import type pg from 'pg';
import type { AppContainer } from '../../application/container.js';
import type { TaskQueue } from '../messaging/task-queue.js';
import type { TaskRegistry } from './task-registry.js';

// ── Task Registry ───────────────────────────────────────────────────────────

import type { TaskSummary } from '../../../shared/types.js';
export type { TaskSummary };

// ── Server ──────────────────────────────────────────────────────────────────

export interface ServerHandle {
	taskQueue: TaskQueue;
}

// ── Route Dependencies ──────────────────────────────────────────────────────

export interface RouteDeps {
	container: AppContainer;
	taskRegistry: TaskRegistry;
	taskQueue: TaskQueue;
	pool: pg.Pool;
}

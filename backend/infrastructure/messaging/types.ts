// ── Task Queue Types ────────────────────────────────────────────────────────

import type { CustomAgentDefinition } from '../../../shared/agent-definitions.js';

export interface TaskMessage {
	taskId: string;
	prompt: string;
	title: string;
	selectedAgents?: string[];
	modelOverrides?: Record<string, string>;
	/** User-defined custom agents (stored alongside built-in agents). */
	customAgents?: CustomAgentDefinition[];
}

/**
 * Handler for incoming task messages.
 * Throw to trigger retry/dead-letter. Return normally to ack.
 */
export type TaskMessageHandler = (msg: TaskMessage, retryCount: number) => Promise<void>;

/** Called by the queue when a message fails and needs retry or is dead-lettered. */
export interface TaskQueueFailureHooks {
	onRetry?: (taskId: string, retryCount: number) => Promise<void>;
	onDeadLetter?: (taskId: string, retryCount: number) => Promise<void>;
}

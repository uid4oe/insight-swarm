import type { AgentConfig, AgentMeta } from '../domain/agents.js';
import type { SwarmEventBus } from '../domain/ports/event-bus.js';
import type { KnowledgeGraphDB } from '../domain/ports/knowledge-graph.js';
import type { Logger } from '../domain/ports/logger.js';
import { ALL_AGENT_IDS, buildAgentConfigs } from './agents/agent-definitions.js';
import { EVENT_BUS_CLOSE_DELAY_MS } from './agents/constants.js';
import { SwarmAgent } from './agents/index.js';
import type { AppContainer } from './container.js';
import type { SwarmResult, SwarmRunOptions, SwarmTask } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveAgentConfigs(container: AppContainer, logger: Logger, options?: SwarmRunOptions): AgentConfig[] {
	if (options?.agentConfigs) {
		return options.agentConfigs;
	}

	const customAgents = options?.customAgents;
	const selectedIds = options?.selectedAgents?.length
		? [...options.selectedAgents, ...(customAgents?.map((a) => a.id) ?? [])]
		: [...ALL_AGENT_IDS, ...(customAgents?.map((a) => a.id) ?? [])];

	logger.info('Building agent configs', { agents: selectedIds });

	return buildAgentConfigs(selectedIds, container.config.geminiModel, container.config.maxTurnsPerRound, customAgents);
}

/** Derive frontend metadata and tag-based reaction routing map from configs. */
function buildAgentContext(configs: AgentConfig[]): {
	agentMeta: AgentMeta[];
	agentTagMap: Record<string, string[]>;
} {
	const agentMeta: AgentMeta[] = configs.map((c) => ({
		id: c.id,
		label: c.label,
		color: c.color,
		description: c.description,
		perspective: c.perspective,
	}));
	const agentTagMap: Record<string, string[]> = {};
	for (const config of configs) {
		agentTagMap[config.id] = config.relevantTags;
	}
	return { agentMeta, agentTagMap };
}

/** Launch all agents concurrently and await completion. */
async function launchAgents(
	agents: SwarmAgent[],
	logger: Logger,
	db: KnowledgeGraphDB,
	eventBus: SwarmEventBus,
	taskId: string,
): Promise<void> {
	const agentPromises = agents.map(async (agent) => {
		try {
			await agent.run();
		} catch (err) {
			logger.error('Agent run failed', err, { agentId: agent.config.id, taskId });
		}
		// Mark agent dead after exit (graceful or error) so peers detect it
		// during health checks and skip orphaned reactions.
		try {
			await db.markAgentDead(agent.config.id);
			eventBus.emit('agent:died', { agent_id: agent.config.id });
		} catch (cleanupErr) {
			logger.warn('Failed to mark agent dead during cleanup', {
				agentId: agent.config.id,
				taskId,
				error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
			});
		}
	});

	await Promise.allSettled(agentPromises);
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function startSwarmRun(
	container: AppContainer,
	taskId: string,
	prompt: string,
	options?: SwarmRunOptions,
): Promise<SwarmTask> {
	const logger = container.createLogger('SwarmRunner');
	const db = await container.createKnowledgeGraph(taskId, prompt);
	const eventBus = await container.createEventBus(taskId);

	let configs: AgentConfig[];
	try {
		configs = resolveAgentConfigs(container, logger, options);
	} catch (err) {
		// Clean up resources allocated before config resolution
		await eventBus.close().catch((e) => logger.warn('EventBus cleanup failed', { error: String(e) }));
		await db.close().catch((e) => logger.warn('DB cleanup failed', { error: String(e) }));
		throw err;
	}

	const { agentMeta, agentTagMap } = buildAgentContext(configs);

	// Update rate limiter with actual agent count (bootstrap defaults to 5)
	container.rateLimiter.setAgentCount?.(configs.length);

	// Persist agent metadata immediately so it's available even if the process restarts
	await container
		.saveAgentMeta(taskId, agentMeta)
		.catch((err) =>
			logger.warn('Failed to persist agentMeta', { taskId, error: err instanceof Error ? err.message : String(err) }),
		);

	eventBus.emit('agents:planned', { agents: agentMeta });

	const agents = configs.map(
		(config) =>
			new SwarmAgent(config, db, eventBus, prompt, agentTagMap, {
				swarmConfig: container.config,
				rateLimiter: container.rateLimiter,
				circuitBreaker: container.circuitBreaker,
				logger: container.createLogger(`Agent:${config.id.toUpperCase()}`),
				embeddingService: container.embeddingService,
			}),
	);

	for (const config of configs) {
		await db.updateAgentStatus(config.id, 'idle', 'Initializing');
	}

	await container.updateTaskStatus(taskId, 'running');
	const startedAt = Date.now();

	const promise = (async (): Promise<SwarmResult> => {
		await launchAgents(agents, logger, db, eventBus, taskId);

		const findings = await db.queryFindings({ limit: 200 });
		const connections = await db.getConnections();
		const theses = await db.getTheses();

		return { taskId, prompt, findings, connections, theses, durationMs: Date.now() - startedAt };
	})();

	const task: SwarmTask = {
		taskId,
		prompt,
		db,
		eventBus,
		agents,
		promise,
	};

	promise
		.then(() => container.updateTaskStatus(taskId, 'completed', new Date()))
		.catch(async (err) => {
			logger.error('Swarm task failed', err, { taskId });
			await container
				.updateTaskStatus(taskId, 'failed', new Date())
				.catch((dbErr) => logger.error('Failed to mark task failed in DB', dbErr, { taskId }));
		})
		.finally(() => {
			// Delay closing the RabbitMQ connection so SSE streams and other
			// consumers have time to receive final events and clean up.
			setTimeout(
				() =>
					eventBus.close().catch((err) =>
						logger.warn('EventBus close error after task completion', {
							taskId,
							error: err instanceof Error ? err.message : String(err),
						}),
					),
				EVENT_BUS_CLOSE_DELAY_MS,
			);
		});

	return task;
}

/** Cancel an entire task — stop all agents gracefully. */
export async function cancelSwarmTask(task: SwarmTask, container: AppContainer, logger?: Logger): Promise<void> {
	for (const agent of task.agents) {
		await agent.kill().catch((err) =>
			logger?.warn('Agent kill failed during cancel', {
				agentId: agent.config.id,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}

	await container
		.updateTaskStatus(task.taskId, 'cancelled', new Date())
		.catch((err) => logger?.error('Failed to mark task cancelled in DB', err));
}

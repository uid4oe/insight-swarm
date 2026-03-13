// ── ADK Runner ──────────────────────────────────────────────────────────────
// Encapsulates ADK LlmAgent creation, session management, execution with
// retry/backoff, and event processing. Used by SwarmAgent for each LLM turn.

import type { BaseTool, Event } from '@google/adk';
import { InMemorySessionService, LlmAgent, LoggingPlugin, Runner } from '@google/adk';
import { CircuitOpenError } from '../../domain/ports/circuit-breaker.js';
import type { KnowledgeGraphDB } from '../../domain/ports/knowledge-graph.js';
import type { AgentId, AgentStatusType } from '../../domain/types.js';
import { PERMISSIVE_SAFETY } from './safety.js';
import type { AdkRunnerConfig } from './types.js';

/** Sleep for `ms` milliseconds, sending DB heartbeats every 15 s to keep the agent alive. */
async function sleepWithHeartbeat(ms: number, db: KnowledgeGraphDB, agentId: AgentId): Promise<void> {
	let remaining = ms;
	while (remaining > 0) {
		const sleepTime = Math.min(remaining, 15_000);
		await new Promise((resolve) => setTimeout(resolve, sleepTime));
		remaining -= sleepTime;
		if (remaining > 0) await db.heartbeat(agentId);
	}
}

/** Extract an ADK error event's code and message, or return null for normal events. */
function extractAdkError(event: Event): { code: string; message: string } | null {
	const eventAny = event as unknown as Record<string, unknown>;
	if (!eventAny.errorCode) return null;
	return {
		code: String(eventAny.errorCode),
		message: String(eventAny.errorMessage ?? 'no message'),
	};
}

/** Typed error thrown when an ADK run exceeds its timeout. */
export class AdkTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`ADK run timed out after ${Math.ceil(timeoutMs / 1000)}s`);
		this.name = 'AdkTimeoutError';
	}
}

// Error codes that ADK emits as events (not thrown), which we should retry.
const RETRYABLE_ERROR_CODES = new Set(['UNKNOWN_ERROR', 'MALFORMED_FUNCTION_CALL', 'INTERNAL', '503', '500']);
const RATE_LIMIT_ERROR_CODES = new Set(['429', 'RESOURCE_EXHAUSTED']);
// ADK finish reasons that are NOT errors — do not retry or log as failures.
const NORMAL_FINISH_CODES = new Set(['STOP', 'MAX_TOKENS']);

// Retry limits
const MAX_NON_429_RETRIES = 3;
const MAX_429_RETRIES = 8;
const MAX_BACKOFF_MS = 30_000;

export class AdkRunner {
	private sessionService = new InMemorySessionService();
	private sessionCounter = 0;
	private config: AdkRunnerConfig;
	/** Set during event processing when an error event is detected. */
	private lastStreamError: { code: string; message: string } | null = null;

	constructor(config: AdkRunnerConfig) {
		this.config = config;
	}

	/**
	 * Run the ADK agent with the given message and tools.
	 * Returns when the agent finishes, roundReady fires, or retries are exhausted.
	 */
	async run(
		userMessage: string,
		round: number,
		tools: BaseTool[],
		callbacks: {
			isRoundReady: () => boolean;
			isRunning: () => boolean;
			onTimeout?: () => void;
		},
	): Promise<void> {
		const { agentId, model, systemPrompt, maxTurnsPerRound, db, rateLimiter, logger } = this.config;

		let turnCount = 0;

		// ADK requires valid identifier names (letters, digits, underscores)
		const safeName = `${agentId}_r${round}`.replace(/[^a-zA-Z0-9_]/g, '_');

		const agent = new LlmAgent({
			name: safeName,
			model,
			instruction: systemPrompt,
			tools,
			generateContentConfig: { maxOutputTokens: 4096, safetySettings: PERMISSIVE_SAFETY },
			beforeModelCallback: async () => {
				turnCount++;
				if (turnCount > maxTurnsPerRound) {
					logger.info(`Max turns (${maxTurnsPerRound}) reached, stopping agent`);
					return {
						content: {
							role: 'model' as const,
							parts: [{ text: `[Turn limit reached (${maxTurnsPerRound}). Ending this round's work.]` }],
						},
					};
				}
				await rateLimiter.acquire(agentId);
				return undefined;
			},
		});

		const appName = 'insight-swarm';
		let consecutiveErrors = 0;

		const backoffMs = (attempt: number) => Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1));

		while (callbacks.isRunning() && !callbacks.isRoundReady()) {
			// Circuit breaker: if Gemini is down, sleep instead of burning retries
			if (this.config.circuitBreaker) {
				try {
					this.config.circuitBreaker.check();
				} catch (err) {
					if (err instanceof CircuitOpenError) {
						logger.warn(`Circuit breaker open, sleeping ${Math.ceil(err.retryAfterMs / 1000)}s`);
						await new Promise((resolve) => setTimeout(resolve, err.retryAfterMs));
						await db.heartbeat(agentId);
						continue;
					}
					throw err;
				}
			}

			const sessionId = `${agentId}_r${round}_${++this.sessionCounter}`;

			const runner = new Runner({
				appName,
				agent,
				sessionService: this.sessionService,
				...(this.config.enableDebug ? { plugins: [new LoggingPlugin()] } : {}),
			});

			await this.sessionService.createSession({
				appName,
				userId: agentId,
				sessionId,
			});

			const adkRunTimeout = this.config.runTimeoutMs ?? 180_000;
			let timedOut = false;
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanupSession = async () => {
				try {
					await this.sessionService.deleteSession({ appName, userId: agentId, sessionId });
				} catch {
					// Session cleanup is best-effort; InMemorySessionService may not support delete.
				}
			};

			try {
				this.lastStreamError = null;

				const timeoutPromise = new Promise<never>((_, reject) => {
					timeoutId = setTimeout(() => {
						timedOut = true;
						callbacks.onTimeout?.();
						reject(new AdkTimeoutError(adkRunTimeout));
					}, adkRunTimeout);
					// Do NOT unref — unref'd timers let Node exit the process prematurely
					// when no other active handles exist, killing all running agents.
				});
				// Prevent unhandled rejection if the main promise wins the race
				timeoutPromise.catch(() => {});

				await Promise.race([
					(async () => {
						for await (const event of runner.runAsync({
							userId: agentId,
							sessionId,
							newMessage: {
								role: 'user',
								parts: [{ text: userMessage }],
							},
							// +2 buffer: 1 for the initial system prompt call, 1 for mark_round_ready finalisation
							runConfig: { maxLlmCalls: maxTurnsPerRound + 2 },
						})) {
							// Break early if timeout fired while awaiting next event.
							// Note: ADK's runAsync has no abort/cancel API, so after a
							// timeout the generator may still be awaiting one last LLM
							// response. This is best-effort — the loop exits on the next
							// yield, and the InMemorySession is GC'd with the runner.
							if (timedOut) {
								logger.info('Timeout detected inside for-await loop, breaking');
								break;
							}

							await db.heartbeat(agentId);
							this.processEvent(event);

							if (callbacks.isRoundReady()) {
								logger.info(`mark_round_ready called, exiting ADK run for round ${round}`);
								break;
							}
						}
					})(),
					timeoutPromise,
				]);

				// Clear the timeout timer since the run completed normally
				clearTimeout(timeoutId);

				// Check if the stream ended due to an ADK error event (these are
				// yielded as events, not thrown). Treat them like caught exceptions
				// so the agent retries instead of silently producing no work.
				if (this.lastStreamError) {
					const { code, message } = this.lastStreamError;
					this.lastStreamError = null;
					const is429 = RATE_LIMIT_ERROR_CODES.has(code);
					const isRetryable = is429 || RETRYABLE_ERROR_CODES.has(code);

					if (isRetryable) {
						consecutiveErrors++;
						const maxRetries = is429 ? MAX_429_RETRIES : MAX_NON_429_RETRIES;
						logger.warn(`ADK stream error event (attempt ${consecutiveErrors}/${maxRetries}): ${code} - ${message}`);

						if (is429) {
							rateLimiter.backoffAgent(agentId, backoffMs(consecutiveErrors));
							this.config.circuitBreaker?.recordFailure();
						}

						if (consecutiveErrors >= maxRetries) {
							logger.warn(`Max retries (${maxRetries}) exceeded after stream error, giving up round ${round}`);
							break;
						}

						const baseDelay = backoffMs(consecutiveErrors);
						const jitter = Math.random() * baseDelay * 0.3;
						await sleepWithHeartbeat(baseDelay + jitter, db, agentId);
						continue; // retry the ADK run
					}
					// Non-retryable error event: log and move on (still a failure for the circuit breaker)
					logger.warn(`Non-retryable ADK error event: ${code} - ${message}, skipping retry`);
					this.config.circuitBreaker?.recordFailure();
					break;
				}

				// Successful run — reset circuit breaker and clean up session
				this.config.circuitBreaker?.recordSuccess();
				await cleanupSession();
				break;
			} catch (err) {
				clearTimeout(timeoutId);
				await cleanupSession();
				consecutiveErrors++;
				const errStr = String(err);
				const is429 = errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('429');
				const isTimeout = err instanceof AdkTimeoutError;
				const maxRetries = is429 ? MAX_429_RETRIES : MAX_NON_429_RETRIES;
				logger.info(`ADK agent error (attempt ${consecutiveErrors}/${maxRetries}): ${is429 ? '429 rate limit' : err}`);

				// Record failure for circuit breaker on API errors and timeouts
				if (is429 || isTimeout) {
					this.config.circuitBreaker?.recordFailure();
				}

				if (is429) {
					rateLimiter.backoffAgent(agentId, backoffMs(consecutiveErrors));
				}

				if (consecutiveErrors >= maxRetries) {
					logger.info(`Max retries (${maxRetries}) exceeded, giving up ADK run for round ${round}`);
					break;
				}

				const baseDelay = backoffMs(consecutiveErrors);
				const jitter = Math.random() * baseDelay * 0.3;
				await sleepWithHeartbeat(baseDelay + jitter, db, agentId);
			}
		}
	}

	// ── Event Processing ──────────────────────────────────────────────────

	private processEvent(event: Event): void {
		const { agentId, eventBus, logger } = this.config;

		// Detect ADK-level errors (e.g. API 400s, quota exhaustion, malformed calls)
		// that are yielded as events rather than thrown. Record the last one so
		// the run() loop can decide whether to retry.
		const adkError = extractAdkError(event);
		if (adkError) {
			// STOP and MAX_TOKENS are normal finish reasons, not errors
			if (NORMAL_FINISH_CODES.has(adkError.code)) return;
			logger.error(`ADK error event: ${adkError.code} - ${adkError.message}`);
			this.lastStreamError = adkError;
		}

		if (!event.content?.parts) return;

		for (const part of event.content.parts) {
			if ('text' in part && part.text) {
				eventBus.emit('agent:status', {
					agent_id: agentId,
					status: 'thinking' as AgentStatusType,
					task: String(part.text).slice(0, 100),
				});
			}
			if ('functionCall' in part && part.functionCall) {
				const fc = part.functionCall as { name: string; args?: Record<string, unknown> };
				const isSearch = fc.name === 'web_search';
				const searchQuery = isSearch && fc.args?.query ? ` -> "${fc.args.query}"` : '';
				void this.config.db.updateAgentStatus(agentId, 'tool_use', fc.name).catch((err) => {
					logger.warn(`Failed to update agent status for tool_use (health check may be stale): ${err}`);
				});
				eventBus.emit('agent:status', { agent_id: agentId, status: 'tool_use' as AgentStatusType, task: fc.name });
				logger.info(isSearch ? `Tool: ${fc.name}${searchQuery}` : `Tool: ${fc.name}`);
			}
		}
	}
}

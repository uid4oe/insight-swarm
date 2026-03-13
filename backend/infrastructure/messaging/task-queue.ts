import type amqp from 'amqplib';
import type { Logger } from '../../domain/ports/logger.js';
import { getEnv } from '../env.js';
import { createLogger } from '../resilience/logger.js';
import type { RabbitMQConnection } from './connection.js';
import type { TaskMessage, TaskMessageHandler, TaskQueueFailureHooks } from './types.js';

// Queue / exchange names
const WORK_EXCHANGE = 'swarm.tasks.exchange';
const RETRY_EXCHANGE = 'swarm.tasks.retry-exchange';
const DEAD_EXCHANGE = 'swarm.tasks.dead-exchange';
const WORK_QUEUE = 'swarm.tasks.work';
const RETRY_QUEUE = 'swarm.tasks.retry';
const DEAD_QUEUE = 'swarm.tasks.dead';

/**
 * Assert the full 3-queue DLX topology on a channel.
 *
 *   work  ──(nack/republish)──▶  retry (per-message TTL)  ──(TTL expires)──▶  work
 *                                                                              │
 *                                 dead  ◀──────(max retries exceeded)──────────┘
 */
async function assertTopology(ch: amqp.Channel | amqp.ConfirmChannel): Promise<void> {
	// 1. Dead-letter exchange + queue (permanent failures)
	await ch.assertExchange(DEAD_EXCHANGE, 'direct', { durable: true });
	await ch.assertQueue(DEAD_QUEUE, { durable: true });
	await ch.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, 'dead');

	// 2. Work exchange + queue
	await ch.assertExchange(WORK_EXCHANGE, 'direct', { durable: true });
	await ch.assertQueue(WORK_QUEUE, {
		durable: true,
		arguments: {
			'x-dead-letter-exchange': DEAD_EXCHANGE,
			'x-dead-letter-routing-key': 'dead',
		},
	});
	await ch.bindQueue(WORK_QUEUE, WORK_EXCHANGE, 'task');

	// 3. Retry exchange + queue (holds messages with per-message TTL, then re-routes to work)
	await ch.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
	await ch.assertQueue(RETRY_QUEUE, {
		durable: true,
		arguments: {
			'x-dead-letter-exchange': WORK_EXCHANGE,
			'x-dead-letter-routing-key': 'task',
		},
	});
	await ch.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, 'retry');
}

/**
 * Durable RabbitMQ task queue with DLX-based retry.
 *
 * Pure infrastructure — knows nothing about application logic.
 * Uses publisher confirms to guarantee message delivery.
 * Channel recovery is delegated to the shared RabbitMQConnection.
 */
export class TaskQueue {
	private conn: RabbitMQConnection;
	private logger: Logger;

	// Consumer state for re-binding after channel recovery
	private handler: TaskMessageHandler | null = null;
	private failureHooks: TaskQueueFailureHooks = {};

	private constructor(conn: RabbitMQConnection, logger: Logger) {
		this.conn = conn;
		this.logger = logger;
	}

	private get pubChannel(): amqp.ConfirmChannel {
		return this.conn.getChannel('taskqueue:pub') as amqp.ConfirmChannel;
	}

	private get consChannel(): amqp.Channel {
		return this.conn.getChannel('taskqueue:cons') as amqp.Channel;
	}

	// ── Factory ──────────────────────────────────────────────────────────────

	static async create(conn: RabbitMQConnection): Promise<TaskQueue> {
		const log = createLogger('TaskQueue');
		const queue = new TaskQueue(conn, log);

		await conn.createChannel('taskqueue:pub', {
			confirm: true,
			setup: assertTopology,
		});

		await conn.createChannel('taskqueue:cons', {
			setup: assertTopology,
			onRecovered: async () => {
				if (queue.handler) {
					await queue.bindConsumer(queue.handler);
					log.info('TaskQueue consumer re-bound after channel recovery');
				}
			},
		});

		return queue;
	}

	// ── Publisher ──────────────────────────────────────────────────────────────

	async publish(msg: TaskMessage): Promise<void> {
		const payload = Buffer.from(JSON.stringify(msg));
		this.pubChannel.publish(WORK_EXCHANGE, 'task', payload, {
			persistent: true,
			headers: { 'x-retry-count': 0 },
		});
		await this.pubChannel.waitForConfirms();
	}

	// ── Consumer ──────────────────────────────────────────────────────────────

	/**
	 * Start consuming messages. The handler receives parsed messages and retry counts.
	 * If the handler throws, the message is retried (with exponential backoff) or dead-lettered.
	 * If the handler returns normally, the message is acked.
	 */
	async startConsuming(handler: TaskMessageHandler, hooks?: TaskQueueFailureHooks): Promise<void> {
		this.handler = handler;
		this.failureHooks = hooks ?? {};
		await this.bindConsumer(handler);
	}

	private async bindConsumer(handler: TaskMessageHandler): Promise<void> {
		const env = getEnv();
		await this.consChannel.prefetch(env.TASK_QUEUE_PREFETCH);

		await this.consChannel.consume(
			WORK_QUEUE,
			async (msg) => {
				if (!msg) return;

				let content: TaskMessage;
				try {
					content = JSON.parse(msg.content.toString()) as TaskMessage;
				} catch {
					this.logger.error('Failed to parse task message, acking to discard');
					this.consChannel.ack(msg);
					return;
				}

				const headers = (msg.properties.headers ?? {}) as Record<string, unknown>;
				const rawRetry = headers['x-retry-count'];
				const retryCount = typeof rawRetry === 'number' ? rawRetry : Number(rawRetry) || 0;

				try {
					await handler(content, retryCount);
					this.consChannel.ack(msg);
				} catch (err) {
					this.logger.error('Task handler failed', err, { taskId: content.taskId, retryCount });
					await this.handleFailure(msg, content, retryCount, err);
				}
			},
			{ noAck: false },
		);

		this.logger.info('TaskQueue consumer started', { prefetch: env.TASK_QUEUE_PREFETCH });
	}

	private async handleFailure(
		msg: amqp.ConsumeMessage,
		content: TaskMessage,
		retryCount: number,
		err: unknown,
	): Promise<void> {
		const env = getEnv();
		const maxRetries = env.TASK_QUEUE_MAX_RETRIES;

		if (retryCount < maxRetries) {
			const delay = this.getRetryDelay(retryCount);
			this.logger.info(`Scheduling retry ${retryCount + 1}/${maxRetries} in ${delay}ms`, {
				taskId: content.taskId,
			});

			await this.failureHooks.onRetry?.(content.taskId, retryCount + 1);

			// Publish to retry queue with per-message TTL for backoff.
			// Only ack the original after confirms succeed; nack on failure so
			// RabbitMQ redelivers instead of silently losing the message.
			try {
				this.pubChannel.publish(RETRY_EXCHANGE, 'retry', msg.content, {
					persistent: true,
					headers: { 'x-retry-count': retryCount + 1 },
					expiration: String(delay),
				});
				await this.pubChannel.waitForConfirms();
				this.consChannel.ack(msg);
			} catch (publishErr) {
				this.logger.error('Failed to publish retry, nacking for redelivery', publishErr, {
					taskId: content.taskId,
				});
				this.consChannel.nack(msg, false, true);
			}
		} else {
			this.logger.error('Max retries exceeded, sending to dead queue', undefined, {
				taskId: content.taskId,
				retryCount,
			});

			await this.failureHooks.onDeadLetter?.(content.taskId, retryCount);

			try {
				this.pubChannel.publish(DEAD_EXCHANGE, 'dead', msg.content, {
					persistent: true,
					headers: {
						'x-retry-count': retryCount,
						'x-final-error': err instanceof Error ? err.message : String(err),
					},
				});
				await this.pubChannel.waitForConfirms();
				this.consChannel.ack(msg);
			} catch (publishErr) {
				this.logger.error('Failed to publish to dead queue, nacking for redelivery', publishErr, {
					taskId: content.taskId,
				});
				this.consChannel.nack(msg, false, true);
			}
		}
	}

	private getRetryDelay(retryCount: number): number {
		const delays = getEnv().TASK_QUEUE_RETRY_DELAYS;
		return delays[Math.min(retryCount, delays.length - 1)];
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	async close(): Promise<void> {
		await this.conn.close();
	}
}

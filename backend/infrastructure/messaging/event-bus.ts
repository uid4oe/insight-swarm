import type amqp from 'amqplib';
import type { SwarmEvents } from '../../domain/events.js';
import type { SwarmEventBus } from '../../domain/ports/event-bus.js';
import { createLogger } from '../resilience/logger.js';
import { RabbitMQConnection } from './connection.js';

const logger = createLogger('RabbitMQEventBus');

/**
 * RabbitMQ-backed event bus.
 *
 * Uses a topic exchange per task so each swarm run is isolated.
 * Every subscriber (agent, SSE stream, etc.) gets its own exclusive
 * auto-delete queue, meaning events fan out to all listeners in real-time.
 *
 * Channel recovery is delegated to a per-task RabbitMQConnection.
 */
export class RabbitMQEventBus implements SwarmEventBus {
	private conn: RabbitMQConnection;
	private exchange: string;
	private closed = false;

	get isClosed(): boolean {
		return this.closed || this.conn.isClosed;
	}

	// Track handlers so off() can remove them
	private handlers = new Map<
		string, // handler identity key (event + handler ref)
		{ queue: string; consumerTag: string }
	>();
	private handlerId = 0;
	private handlerRefMap = new WeakMap<object, number>();

	private constructor(conn: RabbitMQConnection, exchange: string) {
		this.conn = conn;
		this.exchange = exchange;
	}

	private get pubChannel(): amqp.ConfirmChannel {
		return this.conn.getChannel('eventbus:pub') as amqp.ConfirmChannel;
	}

	private get subChannel(): amqp.Channel {
		return this.conn.getChannel('eventbus:sub') as amqp.Channel;
	}

	// ── Factory ──────────────────────────────────────────────────────────────

	/**
	 * Connect to RabbitMQ and create the exchange for this task.
	 * Each task gets its own RabbitMQConnection (lightweight — task-scoped lifecycle).
	 */
	static async create(url: string, taskId: string): Promise<RabbitMQEventBus> {
		const exchange = `swarm.${taskId}`;
		const conn = await RabbitMQConnection.connect(url, logger);

		const assertExchange = async (ch: amqp.Channel | amqp.ConfirmChannel) => {
			await ch.assertExchange(exchange, 'topic', { durable: false, autoDelete: true });
		};

		await conn.createChannel('eventbus:pub', {
			confirm: true,
			setup: assertExchange,
		});

		const bus = new RabbitMQEventBus(conn, exchange);

		await conn.createChannel('eventbus:sub', {
			onRecovered: () => {
				// Existing subscriptions are lost on channel recovery — clear stale entries.
				// Subscribers (SSE streams, agents) must reconnect to receive events again.
				const lostCount = bus.handlers.size;
				bus.handlers.clear();
				if (lostCount > 0) {
					logger.warn(`EventBus sub channel recovered — ${lostCount} subscription(s) lost, clients must reconnect`);
				}
			},
		});

		return bus;
	}

	// ── Pub/Sub ──────────────────────────────────────────────────────────────

	emit<K extends keyof SwarmEvents>(event: K, data: SwarmEvents[K]): void {
		if (this.isClosed) return;
		try {
			const payload = Buffer.from(JSON.stringify(data));
			this.pubChannel.publish(this.exchange, event as string, payload);
			// Fire-and-forget: this is an ephemeral event bus (non-durable exchange,
			// auto-delete queues), so message loss is tolerable. ConfirmChannel is
			// used to detect hard broker errors (channel-level nacks surface as
			// channel 'error' events), but we do NOT call waitForConfirms() per
			// publish — doing so batches all pending confirms, causing false warnings
			// under concurrent emits.
		} catch (err) {
			logger.warn('Failed to emit event (channel may be closed)', {
				event: event as string,
				exchange: this.exchange,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async on<K extends keyof SwarmEvents>(event: K, handler: (data: SwarmEvents[K]) => void): Promise<void> {
		if (this.isClosed) return;

		// Assign a stable id to this handler so we can find it in off()
		let id = this.handlerRefMap.get(handler);
		if (id === undefined) {
			id = this.handlerId++;
			this.handlerRefMap.set(handler, id);
		}
		const key = `${event as string}::${id}`;

		try {
			const { queue } = await this.subChannel.assertQueue('', {
				exclusive: true,
				autoDelete: true,
			});
			await this.subChannel.bindQueue(queue, this.exchange, event as string);

			const { consumerTag } = await this.subChannel.consume(
				queue,
				(msg) => {
					if (!msg) return;
					try {
						const parsed = JSON.parse(msg.content.toString());
						handler(parsed);
					} catch (parseErr) {
						logger.warn('Failed to parse event message', {
							event: event as string,
							error: parseErr instanceof Error ? parseErr.message : String(parseErr),
						});
					}
				},
				{ noAck: true },
			);

			this.handlers.set(key, { queue, consumerTag });
		} catch (err) {
			// Exchange may have been deleted (404) if the task already completed.
			// This is expected when SSE reconnects to a finished task.
			logger.warn('Failed to set up event subscription (exchange may be gone)', {
				event: event as string,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	off<K extends keyof SwarmEvents>(event: K, handler: (data: SwarmEvents[K]) => void): void {
		const id = this.handlerRefMap.get(handler);
		if (id === undefined) return;

		const key = `${event as string}::${id}`;
		const entry = this.handlers.get(key);
		if (!entry) return;

		this.handlers.delete(key);
		if (this.isClosed) return;
		void this.subChannel.cancel(entry.consumerTag).catch((err) =>
			logger.warn('Failed to cancel consumer during off()', {
				event: event as string,
				consumerTag: entry.consumerTag,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}

	/** Gracefully shut down channels and connection. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;

		// Cancel all consumers in parallel
		await Promise.allSettled(
			Array.from(this.handlers.entries()).map(([key, { consumerTag }]) =>
				this.subChannel.cancel(consumerTag).catch((err) =>
					logger.warn('Cleanup: failed to cancel consumer', {
						key,
						error: err instanceof Error ? err.message : String(err),
					}),
				),
			),
		);
		this.handlers.clear();

		// Exchange is autoDelete: true — it will be removed by the broker when
		// the last queue unbinds (which happens after consumer cancel above).
		// Explicit deleteExchange is unnecessary and can 404 in a race.

		await this.conn.close();
	}
}

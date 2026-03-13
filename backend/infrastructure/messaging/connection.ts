// ── Shared RabbitMQ Connection Manager ──────────────────────────────────────
// Single connection with auto-recovering channels. Used by both TaskQueue and
// RabbitMQEventBus to eliminate duplicated recovery boilerplate.

import amqp from 'amqplib';
import type { Logger } from '../../domain/ports/logger.js';

export interface ManagedChannel {
	channel: amqp.Channel | amqp.ConfirmChannel;
	/** Replace the stored channel reference after recovery. */
	replace(ch: amqp.Channel | amqp.ConfirmChannel): void;
}

/**
 * Manages a single RabbitMQ connection with automatic channel recovery.
 *
 * Channels created via `createChannel()` are monitored for unexpected closure.
 * On close, the manager recreates the channel (with exponential backoff) and
 * calls the optional `onRecovered` callback so the consumer can re-bind.
 *
 * On full connection loss, all channels are recreated after reconnecting.
 */
export class RabbitMQConnection {
	private connection: amqp.ChannelModel;
	private url: string;
	private logger: Logger;
	private closed = false;

	private managedChannels: Array<{
		name: string;
		confirm: boolean;
		channel: amqp.Channel | amqp.ConfirmChannel;
		onRecovered?: (ch: amqp.Channel | amqp.ConfirmChannel) => void | Promise<void>;
		setup?: (ch: amqp.Channel | amqp.ConfirmChannel) => Promise<void>;
	}> = [];

	private constructor(connection: amqp.ChannelModel, url: string, logger: Logger) {
		this.connection = connection;
		this.url = url;
		this.logger = logger;
		this.attachConnectionHandlers(connection);
	}

	get isClosed(): boolean {
		return this.closed;
	}

	// ── Factory ──────────────────────────────────────────────────────────────

	static async connect(url: string, logger: Logger, maxRetries = 5): Promise<RabbitMQConnection> {
		const baseDelay = 1000;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const connection = await amqp.connect(url);
				if (attempt > 1) {
					logger.info(`Connected to RabbitMQ after ${attempt} attempts`);
				}
				return new RabbitMQConnection(connection, url, logger);
			} catch (err) {
				lastError = err;
				if (attempt < maxRetries) {
					const delay = baseDelay * 2 ** (attempt - 1);
					logger.warn(`RabbitMQ connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`, {
						error: err instanceof Error ? err.message : String(err),
					});
					await new Promise((r) => setTimeout(r, delay));
				}
			}
		}

		logger.error('Failed to connect to RabbitMQ after all retries', lastError);
		throw lastError;
	}

	// ── Channel Creation ─────────────────────────────────────────────────────

	/**
	 * Create a managed channel that auto-recovers on unexpected closure.
	 *
	 * @param name   - Human-readable label for logging
	 * @param opts.confirm - Use publisher confirms (ConfirmChannel)
	 * @param opts.setup   - Called after channel creation (and re-creation).
	 *                       Use for exchange/queue assertions.
	 * @param opts.onRecovered - Called after a channel is recreated.
	 *                           Use to re-bind consumers.
	 */
	async createChannel(
		name: string,
		opts?: {
			confirm?: boolean;
			setup?: (ch: amqp.Channel | amqp.ConfirmChannel) => Promise<void>;
			onRecovered?: (ch: amqp.Channel | amqp.ConfirmChannel) => void | Promise<void>;
		},
	): Promise<amqp.Channel | amqp.ConfirmChannel> {
		const confirm = opts?.confirm ?? false;
		const ch = confirm ? await this.connection.createConfirmChannel() : await this.connection.createChannel();

		if (opts?.setup) {
			await opts.setup(ch);
		}

		const entry = {
			name,
			confirm,
			channel: ch,
			onRecovered: opts?.onRecovered,
			setup: opts?.setup,
		};
		this.managedChannels.push(entry);
		this.attachChannelHandlers(entry);

		return ch;
	}

	/** Get the current channel instance by name (may change after recovery). */
	getChannel(name: string): (amqp.Channel | amqp.ConfirmChannel) | undefined {
		return this.managedChannels.find((e) => e.name === name)?.channel;
	}

	// ── Error Handling ───────────────────────────────────────────────────────

	private attachConnectionHandlers(connection: amqp.ChannelModel): void {
		connection.on('error', (err) => {
			this.logger.warn('RabbitMQ connection error', {
				error: err instanceof Error ? err.message : String(err),
			});
		});
		connection.on('close', () => {
			if (!this.closed) {
				this.logger.warn('RabbitMQ connection closed unexpectedly, reconnecting');
				void this.reconnect();
			}
		});
	}

	private attachChannelHandlers(entry: (typeof this.managedChannels)[number]): void {
		entry.channel.on('error', (err) => {
			this.logger.warn(`RabbitMQ channel [${entry.name}] error`, {
				error: err instanceof Error ? err.message : String(err),
			});
		});
		entry.channel.on('close', () => {
			if (!this.closed) {
				this.logger.warn(`RabbitMQ channel [${entry.name}] closed, recovering`);
				void this.recoverChannel(entry);
			}
		});
	}

	// ── Recovery ─────────────────────────────────────────────────────────────

	private async recoverChannel(entry: (typeof this.managedChannels)[number]): Promise<void> {
		const maxRetries = 5;
		const baseDelay = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			if (this.closed) return;
			try {
				const ch = entry.confirm ? await this.connection.createConfirmChannel() : await this.connection.createChannel();

				if (entry.setup) await entry.setup(ch);

				entry.channel = ch;
				this.attachChannelHandlers(entry);
				this.logger.info(`RabbitMQ channel [${entry.name}] recovered`);

				if (entry.onRecovered) await entry.onRecovered(ch);
				return;
			} catch (err) {
				if (attempt < maxRetries) {
					const delay = baseDelay * 2 ** (attempt - 1);
					this.logger.warn(
						`Channel [${entry.name}] recovery attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`,
						{ error: err instanceof Error ? err.message : String(err) },
					);
					await new Promise((r) => setTimeout(r, delay));
				}
			}
		}

		this.logger.error(`Failed to recover channel [${entry.name}] after all retries`);
	}

	private async reconnect(): Promise<void> {
		const maxRetries = 5;
		const baseDelay = 2000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const connection = await amqp.connect(this.url);

				// Detach old handlers
				this.connection.removeAllListeners('error');
				this.connection.removeAllListeners('close');

				this.connection = connection;
				this.attachConnectionHandlers(connection);

				// Recreate all managed channels
				for (const entry of this.managedChannels) {
					const ch = entry.confirm ? await connection.createConfirmChannel() : await connection.createChannel();

					if (entry.setup) await entry.setup(ch);

					entry.channel = ch;
					this.attachChannelHandlers(entry);

					if (entry.onRecovered) await entry.onRecovered(ch);
				}

				this.logger.info(
					`RabbitMQ reconnected after ${attempt} attempt(s), ${this.managedChannels.length} channels restored`,
				);
				return;
			} catch (err) {
				if (attempt < maxRetries) {
					const delay = baseDelay * 2 ** (attempt - 1);
					this.logger.warn(`Reconnect attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`, {
						error: err instanceof Error ? err.message : String(err),
					});
					await new Promise((r) => setTimeout(r, delay));
				}
			}
		}

		this.logger.error('RabbitMQ failed to reconnect after all retries');
		this.closed = true;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;

		for (const entry of this.managedChannels) {
			await entry.channel.close().catch((err) =>
				this.logger.warn(`Failed to close channel [${entry.name}]`, {
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		}
		this.managedChannels = [];

		await this.connection.close().catch((err) =>
			this.logger.warn('Failed to close RabbitMQ connection', {
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}
}

import type { SwarmEvents } from '../events.js';

export interface SwarmEventBus {
	/** True when the bus can no longer deliver events (channels/connection closed). */
	readonly isClosed: boolean;
	emit<K extends keyof SwarmEvents>(event: K, data: SwarmEvents[K]): void;
	on<K extends keyof SwarmEvents>(event: K, handler: (data: SwarmEvents[K]) => void): void | Promise<void>;
	off<K extends keyof SwarmEvents>(event: K, handler: (data: SwarmEvents[K]) => void): void;
	close(): Promise<void>;
}

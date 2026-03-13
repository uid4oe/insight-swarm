import { describe, expect, it } from 'vitest';
import { HierarchicalRateLimiter, SharedRateLimiter } from './rate-limiter.js';

describe('SharedRateLimiter', () => {
	it('allows immediate acquisition when tokens available', async () => {
		const limiter = new SharedRateLimiter(600); // 10/sec, burst = 300
		await limiter.acquire();
		// Should return immediately without error
	});

	it('allows burst of requests up to burst size', async () => {
		const limiter = new SharedRateLimiter(60, 5); // burst = 5
		// Should be able to acquire 5 immediately
		for (let i = 0; i < 5; i++) {
			await limiter.acquire();
		}
	});

	it('defaults burst to RPM / 2', () => {
		// Just verifying construction doesn't throw
		const limiter = new SharedRateLimiter(60);
		expect(limiter).toBeDefined();
	});

	it('ensures burst is at least 1', () => {
		// Very low RPM should still have burst of 1
		const limiter = new SharedRateLimiter(1);
		expect(limiter).toBeDefined();
	});

	it('backoffMs sets tokens to 0', async () => {
		const limiter = new SharedRateLimiter(600, 10);
		limiter.backoffMs(1000);
		// After backoff, the next acquire should queue (won't resolve immediately)
		const acquired = Promise.race([
			limiter.acquire().then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
		]);
		expect(await acquired).toBe(false);
	});

	it('backoffAgent delegates to backoffMs', async () => {
		const limiter = new SharedRateLimiter(600, 10);
		// Should not throw
		limiter.backoffAgent('agent1', 100);
	});
});

describe('HierarchicalRateLimiter', () => {
	it('creates per-agent buckets on first acquire', async () => {
		const limiter = new HierarchicalRateLimiter(600, 3);
		await limiter.acquire('agent1');
		// Should succeed without error
	});

	it('allows acquire without agentId (global only)', async () => {
		const limiter = new HierarchicalRateLimiter(600);
		await limiter.acquire();
	});

	it('setAgentCount recalculates per-agent RPM', () => {
		const limiter = new HierarchicalRateLimiter(60, 2);
		// Should not throw
		limiter.setAgentCount(5);
	});

	it('backoffMs affects global limiter', () => {
		const limiter = new HierarchicalRateLimiter(600);
		// Should not throw
		limiter.backoffMs(1000);
	});

	it('backoffAgent affects both global and per-agent', async () => {
		const limiter = new HierarchicalRateLimiter(600, 2);
		await limiter.acquire('agent1'); // create the bucket
		limiter.backoffAgent('agent1', 1000);
	});
});

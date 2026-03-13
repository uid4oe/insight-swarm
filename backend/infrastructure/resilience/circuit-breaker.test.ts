import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';
import { CircuitOpenError } from '../../domain/ports/circuit-breaker.js';

describe('CircuitBreaker', () => {
	let now: number;

	beforeEach(() => {
		now = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const advance = (ms: number) => {
		now += ms;
	};

	it('starts in closed state', () => {
		const cb = new CircuitBreaker();
		expect(cb.currentState).toBe('closed');
		expect(cb.isOpen).toBe(false);
	});

	it('allows requests when closed', () => {
		const cb = new CircuitBreaker();
		expect(() => cb.check()).not.toThrow();
	});

	it('opens after threshold failures', () => {
		const cb = new CircuitBreaker(3);
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.isOpen).toBe(false);
		cb.recordFailure();
		expect(cb.isOpen).toBe(true);
		expect(cb.currentState).toBe('open');
	});

	it('throws CircuitOpenError when open', () => {
		const cb = new CircuitBreaker(1);
		cb.recordFailure();
		expect(() => cb.check()).toThrow(CircuitOpenError);
	});

	it('resets failure count on success', () => {
		const cb = new CircuitBreaker(3);
		cb.recordFailure();
		cb.recordFailure();
		cb.recordSuccess();
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.isOpen).toBe(false);
	});

	it('transitions to half-open after reset timeout', () => {
		// threshold=1, base=1000 → first open: consecutiveOpens=1, timeout=2000ms
		const cb = new CircuitBreaker(1, 1000);
		cb.recordFailure();
		expect(cb.isOpen).toBe(true);

		advance(2001); // past 2000ms timeout

		expect(() => cb.check()).not.toThrow();
		expect(cb.currentState).toBe('half-open');
	});

	it('requires 2 successful probes to close from half-open', () => {
		const cb = new CircuitBreaker(1, 1000);
		cb.recordFailure(); // consecutiveOpens=1, timeout=2000ms

		advance(2001);
		cb.check(); // transitions to half-open

		cb.recordSuccess(); // 1st probe
		expect(cb.currentState).toBe('half-open');

		cb.recordSuccess(); // 2nd probe
		expect(cb.currentState).toBe('closed');
	});

	it('re-opens on failure in half-open state', () => {
		const cb = new CircuitBreaker(1, 1000);
		cb.recordFailure(); // consecutiveOpens=1, timeout=2000ms

		advance(2001);
		cb.check(); // half-open

		cb.recordFailure(); // re-opens, consecutiveOpens=2
		expect(cb.isOpen).toBe(true);
		expect(cb.currentState).toBe('open');
	});

	it('uses exponential backoff on consecutive opens', () => {
		const cb = new CircuitBreaker(1, 1000);

		// First open: consecutiveOpens=1, timeout=2000ms
		cb.recordFailure();
		expect(cb.isOpen).toBe(true);

		// Wait past first timeout (2000ms)
		advance(2001);
		cb.check(); // half-open

		// Fail again — consecutiveOpens=2, timeout=4000ms
		cb.recordFailure();
		expect(cb.isOpen).toBe(true);

		// Advance 3000ms — should still be open (timeout is 4000ms)
		advance(3000);
		expect(() => cb.check()).toThrow(CircuitOpenError);

		// Advance past 4000ms total from last failure
		advance(1100);
		expect(() => cb.check()).not.toThrow();
		expect(cb.currentState).toBe('half-open');
	});
});

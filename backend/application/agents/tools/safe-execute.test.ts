import { describe, expect, it } from 'vitest';
import { safeExecute } from './safe-execute.js';

describe('safeExecute', () => {
	it('returns the result when fn succeeds', async () => {
		const fn = async () => 'success';
		const wrapped = safeExecute(fn);
		expect(await wrapped({})).toBe('success');
	});

	it('catches errors and returns error string', async () => {
		const fn = async () => {
			throw new Error('something broke');
		};
		const wrapped = safeExecute(fn);
		const result = await wrapped({});
		expect(result).toContain('Error: Tool execution failed');
		expect(result).toContain('something broke');
	});

	it('handles non-Error throws', async () => {
		const fn = async () => {
			throw 'string error';
		};
		const wrapped = safeExecute(fn);
		const result = await wrapped({});
		expect(result).toContain('Error: Tool execution failed');
		expect(result).toContain('string error');
	});

	it('passes input to the wrapped function', async () => {
		const fn = async (input: Record<string, unknown>) => `got ${input.name}`;
		const wrapped = safeExecute(fn);
		expect(await wrapped({ name: 'test' })).toBe('got test');
	});
});

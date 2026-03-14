import { describe, expect, it } from 'vitest';
import { extractDollarAmounts, formatDollarAmount, isValueGrounded } from './numeric-utils.js';

describe('extractDollarAmounts', () => {
	it('extracts simple dollar amounts', () => {
		expect(extractDollarAmounts('Revenue was $8.30')).toEqual([8.3]);
		expect(extractDollarAmounts('Price: $34')).toEqual([34]);
	});

	it('extracts amounts with magnitude suffixes', () => {
		expect(extractDollarAmounts('$69.5 billion')).toEqual([69_500_000_000]);
		expect(extractDollarAmounts('$5bn')).toEqual([5_000_000_000]);
		expect(extractDollarAmounts('$392 million')).toEqual([392_000_000]);
		expect(extractDollarAmounts('$5k')).toEqual([5_000]);
	});

	it('extracts single-letter suffixes', () => {
		expect(extractDollarAmounts('$5B')).toEqual([5_000_000_000]);
		expect(extractDollarAmounts('$5M')).toEqual([5_000_000]);
		expect(extractDollarAmounts('$5T')).toEqual([5_000_000_000_000]);
		expect(extractDollarAmounts('$5K')).toEqual([5_000]);
	});

	it('extracts amounts with commas', () => {
		expect(extractDollarAmounts('$1,000,000')).toEqual([1_000_000]);
	});

	it('extracts ranges', () => {
		const result = extractDollarAmounts('$40-$41 billion');
		expect(result).toContain(40_000_000_000);
		expect(result).toContain(41_000_000_000);
	});

	it('extracts multiple amounts from text', () => {
		const result = extractDollarAmounts('Revenue was $5M with costs of $3M');
		expect(result).toContain(5_000_000);
		expect(result).toContain(3_000_000);
	});

	it('returns empty array when no amounts found', () => {
		expect(extractDollarAmounts('no dollar amounts here')).toEqual([]);
	});

	it('deduplicates amounts', () => {
		const result = extractDollarAmounts('$5M... again $5M');
		expect(result).toEqual([5_000_000]);
	});
});

describe('formatDollarAmount', () => {
	it('formats billions', () => {
		expect(formatDollarAmount(5_000_000_000)).toBe('$5.0B');
		expect(formatDollarAmount(1_200_000_000)).toBe('$1.2B');
	});

	it('formats millions', () => {
		expect(formatDollarAmount(5_000_000)).toBe('$5.0M');
		expect(formatDollarAmount(392_000_000)).toBe('$392.0M');
	});

	it('formats thousands', () => {
		expect(formatDollarAmount(5_000)).toBe('$5.0K');
		expect(formatDollarAmount(1_500)).toBe('$1.5K');
	});

	it('formats small amounts', () => {
		expect(formatDollarAmount(42)).toBe('$42');
		expect(formatDollarAmount(0)).toBe('$0');
	});
});

describe('isValueGrounded', () => {
	it('returns true when value is within tolerance', () => {
		expect(isValueGrounded(100, [100])).toBe(true);
		expect(isValueGrounded(110, [100])).toBe(true); // 10% diff, within 15%
		expect(isValueGrounded(90, [100])).toBe(true);
	});

	it('returns false when value is outside tolerance', () => {
		expect(isValueGrounded(120, [100])).toBe(false); // 20% diff
		expect(isValueGrounded(80, [100])).toBe(false);
	});

	it('handles zero values', () => {
		expect(isValueGrounded(0, [0])).toBe(true);
		expect(isValueGrounded(0, [100])).toBe(false);
		expect(isValueGrounded(100, [0])).toBe(false);
	});

	it('checks against multiple reference values', () => {
		expect(isValueGrounded(50, [10, 20, 50])).toBe(true);
		expect(isValueGrounded(50, [10, 20, 30])).toBe(false);
	});

	it('respects custom tolerance', () => {
		expect(isValueGrounded(110, [100], 0.05)).toBe(false); // 10% diff, 5% tolerance
		expect(isValueGrounded(103, [100], 0.05)).toBe(true);
	});
});

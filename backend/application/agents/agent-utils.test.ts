import { describe, expect, it } from 'vitest';
import { getUnvotedTheses } from './agent-utils.js';
import type { InvestmentThesis } from '../../domain/types.js';

const makeThesis = (overrides: Partial<InvestmentThesis> = {}): InvestmentThesis => ({
	id: 't-1',
	title: 'Test thesis',
	thesis: 'Test',
	evidence: [],
	connections_used: [],
	confidence: 0.8,
	market_size: null,
	timing: null,
	risks: [],
	votes: [],
	status: 'proposed',
	created_by: 'financial',
	created_at: '2026-01-01T00:00:00Z',
	...overrides,
});

describe('getUnvotedTheses', () => {
	it('returns theses not created by or voted on by the agent', () => {
		const theses = [
			makeThesis({ id: 't-1', created_by: 'financial' }),
			makeThesis({ id: 't-2', created_by: 'operational' }),
			makeThesis({ id: 't-3', created_by: 'legal' }),
		];
		const result = getUnvotedTheses('market', theses);
		expect(result).toHaveLength(3);
	});

	it('excludes theses created by the agent', () => {
		const theses = [
			makeThesis({ id: 't-1', created_by: 'financial' }),
			makeThesis({ id: 't-2', created_by: 'financial' }),
		];
		const result = getUnvotedTheses('financial', theses);
		expect(result).toHaveLength(0);
	});

	it('excludes theses already voted on by the agent', () => {
		const theses = [
			makeThesis({
				id: 't-1',
				created_by: 'operational',
				votes: [{ agent_id: 'financial', vote: 'support', reasoning: 'Agree' }],
			}),
			makeThesis({ id: 't-2', created_by: 'legal' }),
		];
		const result = getUnvotedTheses('financial', theses);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('t-2');
	});
});

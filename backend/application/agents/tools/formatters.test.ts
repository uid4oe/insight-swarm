import { describe, expect, it } from 'vitest';
import { formatConnection, formatFinding, formatThesis } from './formatters.js';
import type { Finding } from '../../../domain/types.js';

const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
	id: 'f-1',
	agent_id: 'financial',
	round: 1,
	category: 'revenue',
	title: 'Strong revenue growth',
	description: 'Revenue grew 40% YoY',
	confidence: 0.85,
	tags: ['revenue', 'growth'],
	references: [],
	parent_finding_id: null,
	created_at: '2026-01-01T00:00:00Z',
	...overrides,
});

describe('formatFinding', () => {
	it('includes id, agent, round, category, title, description, confidence', () => {
		const result = formatFinding(makeFinding());
		expect(result).toContain('[f-1]');
		expect(result).toContain('Agent: financial');
		expect(result).toContain('Round: 1');
		expect(result).toContain('Category: revenue');
		expect(result).toContain('Strong revenue growth');
		expect(result).toContain('Revenue grew 40% YoY');
		expect(result).toContain('85%');
		expect(result).toContain('revenue, growth');
	});

	it('includes references when present', () => {
		const result = formatFinding(
			makeFinding({
				references: [{ title: 'SEC Filing', url: 'https://sec.gov/filing', snippet: 'Revenue data' }],
			}),
		);
		expect(result).toContain('SEC Filing');
		expect(result).toContain('https://sec.gov/filing');
		expect(result).toContain('Revenue data');
	});

	it('includes parent finding id when present', () => {
		const result = formatFinding(makeFinding({ parent_finding_id: 'f-parent' }));
		expect(result).toContain('Parent: f-parent');
	});

	it('shows (none) for empty tags', () => {
		const result = formatFinding(makeFinding({ tags: [] }));
		expect(result).toContain('(none)');
	});
});

describe('formatConnection', () => {
	it('formats connection with all fields', () => {
		const result = formatConnection({
			id: 'c-1',
			from_finding_id: 'f-1',
			to_finding_id: 'f-2',
			relationship: 'supports',
			strength: 0.9,
			created_by: 'financial',
			round: 1,
			reasoning: 'Both point to growth',
		});
		expect(result).toContain('[c-1]');
		expect(result).toContain('f-1 --supports--> f-2');
		expect(result).toContain('90%');
		expect(result).toContain('By: financial');
		expect(result).toContain('Both point to growth');
	});
});

describe('formatThesis', () => {
	it('formats thesis with votes and evidence', () => {
		const result = formatThesis({
			id: 't-1',
			title: 'Stripe is undervalued',
			status: 'proposed',
			confidence: 0.8,
			created_by: 'financial',
			thesis: 'Strong fundamentals suggest undervaluation',
			evidence: [{ finding_id: 'f-1', relevance: 'primary', reasoning: 'Revenue growth' }],
			market_size: '$500B',
			timing: '12-18 months',
			risks: ['Regulatory risk'],
			votes: [{ agent_id: 'operational', vote: 'support', reasoning: 'Agree' }],
		});
		expect(result).toContain('[t-1] Stripe is undervalued');
		expect(result).toContain('80%');
		expect(result).toContain('financial');
		expect(result).toContain('[f-1]');
		expect(result).toContain('$500B');
		expect(result).toContain('12-18 months');
		expect(result).toContain('Regulatory risk');
		expect(result).toContain('operational: support');
	});

	it('shows "No votes yet" when empty', () => {
		const result = formatThesis({
			id: 't-1',
			title: 'Test',
			status: 'proposed',
			confidence: 0.5,
			created_by: 'market',
			thesis: 'Test thesis',
			evidence: [],
			risks: [],
			votes: [],
		});
		expect(result).toContain('No votes yet');
	});
});

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/types.js';
import { buildDynamicPrompt, buildKnowledgeContext, buildRoundSummary } from './prompt-builder.js';

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

describe('buildKnowledgeContext', () => {
	it('returns placeholder when no findings', () => {
		expect(buildKnowledgeContext([], [], [], [])).toBe('(No findings yet)');
	});

	it('includes finding details', () => {
		const findings = [makeFinding()];
		const context = buildKnowledgeContext(findings, [], [], []);
		expect(context).toContain('[f-1]');
		expect(context).toContain('financial');
		expect(context).toContain('Strong revenue growth');
	});

	it('groups findings by round', () => {
		const findings = [
			makeFinding({ id: 'f-1', round: 1 }),
			makeFinding({ id: 'f-2', round: 2 }),
		];
		const context = buildKnowledgeContext(findings, [], [], []);
		expect(context).toContain('Round 1');
		expect(context).toContain('Round 2');
	});

	it('includes theses section', () => {
		const findings = [makeFinding()];
		const theses = [{ id: 't-1', title: 'Growth thesis', confidence: 0.8, created_by: 'financial', votes: [] }];
		const context = buildKnowledgeContext(findings, [], [], theses);
		expect(context).toContain('Theses');
		expect(context).toContain('Growth thesis');
	});

	it('annotates reaction findings', () => {
		const findings = [makeFinding({ parent_finding_id: 'f-parent' })];
		const context = buildKnowledgeContext(findings, [], [], []);
		expect(context).toContain('[reaction to f-parent]');
	});
});

describe('buildDynamicPrompt', () => {
	it('includes situation assessment header', () => {
		const prompt = buildDynamicPrompt('financial', [], [], [], 1, 4);
		expect(prompt).toContain('SITUATION ASSESSMENT');
		expect(prompt).toContain('round 1/4');
	});

	it('signals early graph when few findings', () => {
		const findings = [makeFinding()];
		const prompt = buildDynamicPrompt('financial', findings, [], [], 1, 4);
		expect(prompt).toContain('thin');
	});

	it('signals need for theses when cross-agent connections exist but no theses', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial' }),
			makeFinding({ id: 'f-2', agent_id: 'operational' }),
			makeFinding({ id: 'f-3', agent_id: 'legal' }),
			makeFinding({ id: 'f-4', agent_id: 'market' }),
		];
		const connections = [
			{
				id: 'c-1',
				from_finding_id: 'f-1',
				to_finding_id: 'f-2',
				relationship: 'supports',
				strength: 0.8,
				reasoning: '',
				created_by: 'financial',
				round: 1,
			},
			{
				id: 'c-2',
				from_finding_id: 'f-3',
				to_finding_id: 'f-4',
				relationship: 'supports',
				strength: 0.7,
				reasoning: '',
				created_by: 'legal',
				round: 1,
			},
		];
		const prompt = buildDynamicPrompt('financial', findings, connections, [], 2, 4);
		expect(prompt).toContain('create_thesis');
	});

	it('includes late-game urgency in final round', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial' }),
			makeFinding({ id: 'f-2', agent_id: 'operational' }),
		];
		const prompt = buildDynamicPrompt('financial', findings, [], [], 4, 4);
		expect(prompt).toContain('FINAL ROUND');
	});

	it('shows voting reminder when unvoted theses exist', () => {
		const findings = [makeFinding()];
		const theses = [
			{
				id: 't-1',
				title: 'Test',
				confidence: 0.8,
				created_by: 'operational',
				votes: [],
			},
		];
		const prompt = buildDynamicPrompt('financial', findings, [], theses, 2, 4);
		expect(prompt).toContain('vote');
	});
});

describe('buildRoundSummary', () => {
	it('returns empty string when no findings in round', () => {
		expect(buildRoundSummary(1, [], [], [])).toBe('');
	});

	it('includes round header and agent summaries', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial', round: 1, confidence: 0.9 }),
			makeFinding({ id: 'f-2', agent_id: 'operational', round: 1, confidence: 0.7 }),
		];
		const summary = buildRoundSummary(1, findings, [], []);
		expect(summary).toContain('ROUND 1 RECAP');
		expect(summary).toContain('financial');
		expect(summary).toContain('operational');
	});

	it('shows cross-agent connections', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial', round: 1 }),
			makeFinding({ id: 'f-2', agent_id: 'operational', round: 1 }),
		];
		const connections = [
			{
				id: 'c-1',
				from_finding_id: 'f-1',
				to_finding_id: 'f-2',
				relationship: 'supports',
				strength: 0.8,
				reasoning: '',
				created_by: 'financial',
				round: 1,
			},
		];
		const summary = buildRoundSummary(1, findings, connections, []);
		expect(summary).toContain('Cross-agent connections');
	});

	it('shows thesis recap', () => {
		const findings = [makeFinding({ round: 1 })];
		const theses = [
			{
				id: 't-1',
				title: 'Growth thesis',
				confidence: 0.8,
				created_by: 'financial',
				votes: [{ agent_id: 'operational', vote: 'support' }],
			},
		];
		const summary = buildRoundSummary(1, findings, [], theses);
		expect(summary).toContain('Growth thesis');
		expect(summary).toContain('1 support');
	});
});

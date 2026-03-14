import { describe, expect, it } from 'vitest';
import type { Connection, Finding, InvestmentThesis, TensionEntry } from '../domain/types.js';
import {
	buildAgentBreakdown,
	buildConfidenceDistribution,
	buildConversationThreads,
	buildDisagreementScore,
	buildEvidenceChains,
	buildRiskMatrix,
	buildSources,
	buildTagOverlap,
	buildTensionMap,
} from './summary-analytics.js';

// ── Factories ────────────────────────────────────────────────────────────

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

const makeConnection = (overrides: Partial<Connection> = {}): Connection => ({
	id: 'c-1',
	from_finding_id: 'f-1',
	to_finding_id: 'f-2',
	relationship: 'supports',
	strength: 0.8,
	reasoning: 'Related findings',
	created_by: 'financial',
	round: 1,
	created_at: '2026-01-01T00:00:00Z',
	...overrides,
});

const makeThesis = (overrides: Partial<InvestmentThesis> = {}): InvestmentThesis => ({
	id: 't-1',
	title: 'Strong investment thesis',
	thesis: 'The company is well positioned',
	evidence: [{ finding_id: 'f-1', reasoning: 'Revenue data', relevance: 'primary' }],
	connections_used: ['c-1'],
	confidence: 0.8,
	market_size: '$100B',
	timing: '12 months',
	risks: ['Competition'],
	votes: [{ agent_id: 'operational', vote: 'support', reasoning: 'Agree' }],
	status: 'proposed',
	created_by: 'financial',
	created_at: '2026-01-01T00:00:00Z',
	...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('buildEvidenceChains', () => {
	it('builds a chain for each thesis', () => {
		const findings = [makeFinding({ id: 'f-1' }), makeFinding({ id: 'f-2', agent_id: 'operational' })];
		const connections = [makeConnection()];
		const theses = [makeThesis()];

		const chains = buildEvidenceChains(findings, connections, theses);
		expect(chains).toHaveLength(1);
		expect(chains[0].thesisId).toBe('t-1');
		expect(chains[0].chain).toHaveLength(1);
	});

	it('determines consensus based on vote ratio', () => {
		const findings = [makeFinding()];
		const strong = makeThesis({
			votes: [
				{ agent_id: 'a', vote: 'support', reasoning: '' },
				{ agent_id: 'b', vote: 'support', reasoning: '' },
				{ agent_id: 'c', vote: 'support', reasoning: '' },
				{ agent_id: 'd', vote: 'support', reasoning: '' },
			],
		});
		const contested = makeThesis({
			id: 't-2',
			votes: [
				{ agent_id: 'a', vote: 'challenge', reasoning: '' },
				{ agent_id: 'b', vote: 'challenge', reasoning: '' },
				{ agent_id: 'c', vote: 'challenge', reasoning: '' },
				{ agent_id: 'd', vote: 'challenge', reasoning: '' },
			],
		});

		const chains = buildEvidenceChains(findings, [], [strong, contested]);
		expect(chains[0].consensus).toBe('strong');
		expect(chains[1].consensus).toBe('contested');
	});

	it('collects challenge votes', () => {
		const findings = [makeFinding()];
		const thesis = makeThesis({
			votes: [{ agent_id: 'legal', vote: 'challenge', reasoning: 'Regulatory risk' }],
		});
		const chains = buildEvidenceChains(findings, [], [thesis]);
		expect(chains[0].challengeVotes).toHaveLength(1);
		expect(chains[0].challengeVotes[0].reasoning).toBe('Regulatory risk');
	});
});

describe('buildTensionMap', () => {
	it('finds cross-agent contradictions', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial' }),
			makeFinding({ id: 'f-2', agent_id: 'legal' }),
		];
		const connections = [
			makeConnection({
				from_finding_id: 'f-1',
				to_finding_id: 'f-2',
				relationship: 'contradicts',
			}),
		];
		const tensions = buildTensionMap(connections, findings);
		expect(tensions).toHaveLength(1);
		expect(tensions[0].findingA.agent).toBe('financial');
		expect(tensions[0].findingB.agent).toBe('legal');
	});

	it('ignores same-agent contradictions', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial' }),
			makeFinding({ id: 'f-2', agent_id: 'financial' }),
		];
		const connections = [
			makeConnection({
				from_finding_id: 'f-1',
				to_finding_id: 'f-2',
				relationship: 'contradicts',
			}),
		];
		expect(buildTensionMap(connections, findings)).toHaveLength(0);
	});

	it('ignores non-contradicts relationships', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial' }),
			makeFinding({ id: 'f-2', agent_id: 'legal' }),
		];
		const connections = [makeConnection({ from_finding_id: 'f-1', to_finding_id: 'f-2', relationship: 'supports' })];
		expect(buildTensionMap(connections, findings)).toHaveLength(0);
	});
});

describe('buildRiskMatrix', () => {
	it('creates risk from challenge votes', () => {
		const thesis = makeThesis({
			votes: [
				{ agent_id: 'a', vote: 'challenge', reasoning: 'Weak evidence' },
				{ agent_id: 'b', vote: 'support', reasoning: 'OK' },
			],
		});
		const risks = buildRiskMatrix([], [thesis], []);
		expect(risks.some((r) => r.source === 'challenge_vote')).toBe(true);
	});

	it('creates risk from unresolved tensions', () => {
		const tension: TensionEntry = {
			id: 'ten-1',
			findingA: { id: 'f-1', title: 'A', agent: 'financial', confidence: 0.8 },
			findingB: { id: 'f-2', title: 'B', agent: 'legal', confidence: 0.7 },
			relationship: 'contradicts',
			reasoning: 'Disagree',
		};
		const risks = buildRiskMatrix([], [], [tension]);
		expect(risks.some((r) => r.source === 'unresolved_tension')).toBe(true);
	});

	it('creates risk from low-confidence primary evidence', () => {
		const finding = makeFinding({ id: 'f-weak', confidence: 0.3 });
		const thesis = makeThesis({
			evidence: [{ finding_id: 'f-weak', reasoning: 'Key data', relevance: 'primary' }],
			votes: [],
		});
		const risks = buildRiskMatrix([finding], [thesis], []);
		expect(risks.some((r) => r.source === 'low_confidence')).toBe(true);
	});

	it('sorts by severity (high first)', () => {
		const finding = makeFinding({ id: 'f-weak', confidence: 0.2 });
		const thesis = makeThesis({
			evidence: [{ finding_id: 'f-weak', reasoning: 'Key', relevance: 'primary' }],
			votes: [{ agent_id: 'a', vote: 'challenge', reasoning: 'Bad' }],
		});
		const tension: TensionEntry = {
			id: 'ten-1',
			findingA: { id: 'f-1', title: 'A', agent: 'financial', confidence: 0.8 },
			findingB: { id: 'f-2', title: 'B', agent: 'legal', confidence: 0.7 },
			relationship: 'contradicts',
			reasoning: 'Disagree',
		};
		const risks = buildRiskMatrix([finding], [thesis], [tension]);
		expect(risks.length).toBeGreaterThan(0);
		// Verify sorted: severity decreases or stays same
		const severityOrder = { high: 0, medium: 1, low: 2 };
		for (let i = 1; i < risks.length; i++) {
			expect(severityOrder[risks[i].severity]).toBeGreaterThanOrEqual(severityOrder[risks[i - 1].severity]);
		}
	});
});

describe('buildConfidenceDistribution', () => {
	it('buckets findings by confidence', () => {
		const findings = [
			makeFinding({ confidence: 0.9 }),
			makeFinding({ id: 'f-2', confidence: 0.5 }),
			makeFinding({ id: 'f-3', confidence: 0.2 }),
		];
		const dist = buildConfidenceDistribution(findings, []);
		expect(dist.high).toBe(1);
		expect(dist.medium).toBe(1);
		expect(dist.low).toBe(1);
	});

	it('computes average confidence', () => {
		const findings = [makeFinding({ confidence: 0.6 }), makeFinding({ id: 'f-2', confidence: 0.8 })];
		const dist = buildConfidenceDistribution(findings, []);
		expect(dist.averageConfidence).toBeCloseTo(0.7);
	});

	it('computes agent agreement from thesis votes', () => {
		const theses = [
			makeThesis({
				votes: [
					{ agent_id: 'a', vote: 'support', reasoning: '' },
					{ agent_id: 'b', vote: 'support', reasoning: '' },
				],
			}),
		];
		const dist = buildConfidenceDistribution([], theses);
		expect(dist.agentAgreement).toBe(1); // 100% support
	});

	it('returns 0 agreement when no theses have votes', () => {
		const dist = buildConfidenceDistribution([], [makeThesis({ votes: [] })]);
		expect(dist.agentAgreement).toBe(0);
	});
});

describe('buildDisagreementScore', () => {
	it('computes challenge vote ratio', () => {
		const theses = [
			makeThesis({
				votes: [
					{ agent_id: 'a', vote: 'challenge', reasoning: '' },
					{ agent_id: 'b', vote: 'support', reasoning: '' },
				],
			}),
		];
		const score = buildDisagreementScore(theses, []);
		expect(score.challengeVoteRatio).toBeCloseTo(0.5);
	});

	it('counts tensions', () => {
		const tensions: TensionEntry[] = [
			{
				id: 't-1',
				findingA: { id: 'f-1', title: 'A', agent: 'a', confidence: 0.8 },
				findingB: { id: 'f-2', title: 'B', agent: 'b', confidence: 0.7 },
				relationship: 'contradicts',
				reasoning: 'Disagree',
			},
			{
				id: 't-2',
				findingA: { id: 'f-3', title: 'C', agent: 'a', confidence: 0.6 },
				findingB: { id: 'f-4', title: 'D', agent: 'c', confidence: 0.5 },
				relationship: 'contradicts',
				reasoning: 'Also disagree',
				resolution: 'Resolved',
			},
		];
		const score = buildDisagreementScore([], tensions);
		expect(score.tensionCount).toBe(2);
		expect(score.unresolvedTensions).toBe(1);
	});
});

describe('buildAgentBreakdown', () => {
	it('breaks down contributions per agent', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial' }),
			makeFinding({ id: 'f-2', agent_id: 'financial' }),
			makeFinding({ id: 'f-3', agent_id: 'operational' }),
		];
		const connections = [makeConnection({ created_by: 'financial' })];
		const theses = [makeThesis({ created_by: 'financial' })];

		const agentDef = new Map([
			['financial', { id: 'financial', label: 'FINANCIAL', shortLabel: 'Financial', color: '#c084fc', description: '', perspective: '' }],
			['operational', { id: 'operational', label: 'OPERATIONAL', shortLabel: 'Operational', color: '#22d3ee', description: '', perspective: '' }],
		]);

		const breakdown = buildAgentBreakdown(findings, connections, theses, agentDef);
		expect(breakdown).toHaveLength(2);

		const financial = breakdown.find((b) => b.agentId === 'financial')!;
		expect(financial.findingsCount).toBe(2);
		expect(financial.connectionsCount).toBe(1);
		expect(financial.thesesCreated).toBe(1);
		expect(financial.role).toBe('financial');
	});
});

describe('buildSources', () => {
	it('deduplicates and aggregates references', () => {
		const findings = [
			makeFinding({
				id: 'f-1',
				agent_id: 'financial',
				references: [{ url: 'https://example.com', title: 'Source 1' }],
			}),
			makeFinding({
				id: 'f-2',
				agent_id: 'operational',
				references: [{ url: 'https://example.com', title: 'Source 1' }],
			}),
			makeFinding({
				id: 'f-3',
				agent_id: 'legal',
				references: [{ url: 'https://other.com', title: 'Source 2' }],
			}),
		];
		const sources = buildSources(findings);
		expect(sources).toHaveLength(2);
		const deduped = sources.find((s) => s.url === 'https://example.com')!;
		expect(deduped.citedBy).toContain('financial');
		expect(deduped.citedBy).toContain('operational');
	});

	it('skips references without URLs', () => {
		const findings = [makeFinding({ references: [{ title: 'No URL' }] })];
		expect(buildSources(findings)).toHaveLength(0);
	});
});

describe('buildConversationThreads', () => {
	it('builds threads from parent-child chains', () => {
		const findings = [
			makeFinding({ id: 'root', agent_id: 'financial' }),
			makeFinding({ id: 'reply-1', agent_id: 'operational', parent_finding_id: 'root', round: 2 }),
			makeFinding({ id: 'reply-2', agent_id: 'legal', parent_finding_id: 'root', round: 2 }),
		];
		const threads = buildConversationThreads(findings);
		expect(threads).toHaveLength(1);
		expect(threads[0].rootFindingId).toBe('root');
		expect(threads[0].replies).toHaveLength(2);
		expect(threads[0].agentCount).toBe(3);
	});

	it('requires at least 2 agents for a thread', () => {
		const findings = [
			makeFinding({ id: 'root', agent_id: 'financial' }),
			makeFinding({ id: 'reply', agent_id: 'financial', parent_finding_id: 'root' }),
		];
		expect(buildConversationThreads(findings)).toHaveLength(0);
	});
});

describe('buildTagOverlap', () => {
	it('identifies shared tags across agents', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'financial', tags: ['growth', 'revenue'] }),
			makeFinding({ id: 'f-2', agent_id: 'operational', tags: ['growth', 'scaling'] }),
		];
		const overlap = buildTagOverlap(findings);
		expect(overlap.sharedTags.some((t) => t.tag === 'growth')).toBe(true);
	});

	it('identifies blind spot tags (single agent, 2+ findings)', () => {
		const findings = [
			makeFinding({ id: 'f-1', agent_id: 'legal', tags: ['compliance'] }),
			makeFinding({ id: 'f-2', agent_id: 'legal', tags: ['compliance'] }),
		];
		const overlap = buildTagOverlap(findings);
		expect(overlap.blindSpotTags.some((t) => t.tag === 'compliance')).toBe(true);
	});

	it('excludes questions and zero-confidence findings', () => {
		const findings = [
			makeFinding({ id: 'f-1', category: 'question', tags: ['test'] }),
			makeFinding({ id: 'f-2', confidence: 0, tags: ['test'] }),
		];
		const overlap = buildTagOverlap(findings);
		expect(overlap.sharedTags).toHaveLength(0);
		expect(overlap.blindSpotTags).toHaveLength(0);
	});
});

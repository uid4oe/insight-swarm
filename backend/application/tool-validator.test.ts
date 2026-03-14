import { describe, expect, it } from 'vitest';
import { schemas } from './tool-validator.js';

describe('tool-validator schemas', () => {
	describe('write_finding', () => {
		it('accepts valid input', () => {
			const result = schemas.write_finding.safeParse({
				category: 'revenue',
				title: 'Strong growth',
				description: 'Revenue grew 40% YoY',
				confidence: 0.85,
				tags: ['revenue', 'growth'],
			});
			expect(result.success).toBe(true);
		});

		it('rejects confidence > 1', () => {
			const result = schemas.write_finding.safeParse({
				category: 'revenue',
				title: 'Test',
				description: 'Test',
				confidence: 1.5,
				tags: [],
			});
			expect(result.success).toBe(false);
		});

		it('rejects confidence < 0', () => {
			const result = schemas.write_finding.safeParse({
				category: 'revenue',
				title: 'Test',
				description: 'Test',
				confidence: -0.1,
				tags: [],
			});
			expect(result.success).toBe(false);
		});

		it('rejects missing required fields', () => {
			const result = schemas.write_finding.safeParse({
				category: 'revenue',
			});
			expect(result.success).toBe(false);
		});

		it('accepts optional references', () => {
			const result = schemas.write_finding.safeParse({
				category: 'revenue',
				title: 'Test',
				description: 'Test',
				confidence: 0.5,
				tags: [],
				references: [{ title: 'Source', url: 'https://example.com' }],
			});
			expect(result.success).toBe(true);
		});
	});

	describe('create_connection', () => {
		it('accepts valid relationship types', () => {
			for (const rel of ['supports', 'contradicts', 'enables', 'amplifies']) {
				const result = schemas.create_connection.safeParse({
					from_finding_id: 'f-1',
					to_finding_id: 'f-2',
					relationship: rel,
					strength: 0.8,
					reasoning: 'Test reasoning',
				});
				expect(result.success).toBe(true);
			}
		});

		it('rejects invalid relationship type', () => {
			const result = schemas.create_connection.safeParse({
				from_finding_id: 'f-1',
				to_finding_id: 'f-2',
				relationship: 'invalidType',
				strength: 0.8,
				reasoning: 'Test',
			});
			expect(result.success).toBe(false);
		});

		it('rejects strength > 1', () => {
			const result = schemas.create_connection.safeParse({
				from_finding_id: 'f-1',
				to_finding_id: 'f-2',
				relationship: 'supports',
				strength: 1.5,
				reasoning: 'Test',
			});
			expect(result.success).toBe(false);
		});
	});

	describe('create_thesis', () => {
		it('requires at least 1 evidence finding', () => {
			const result = schemas.create_thesis.safeParse({
				title: 'Test thesis',
				thesis: 'Test',
				evidence_finding_ids: [],
				confidence: 0.8,
			});
			expect(result.success).toBe(false);
		});

		it('accepts valid thesis', () => {
			const result = schemas.create_thesis.safeParse({
				title: 'Test thesis',
				thesis: 'Test thesis body',
				evidence_finding_ids: ['f-1', 'f-2'],
				confidence: 0.8,
				risks: ['Market risk'],
			});
			expect(result.success).toBe(true);
		});
	});

	describe('vote_on_thesis', () => {
		it('accepts support vote', () => {
			const result = schemas.vote_on_thesis.safeParse({
				thesis_id: 't-1',
				vote: 'support',
				reasoning: 'Strong evidence',
			});
			expect(result.success).toBe(true);
		});

		it('accepts challenge vote', () => {
			const result = schemas.vote_on_thesis.safeParse({
				thesis_id: 't-1',
				vote: 'challenge',
				reasoning: 'Weak evidence',
			});
			expect(result.success).toBe(true);
		});

		it('rejects invalid vote type', () => {
			const result = schemas.vote_on_thesis.safeParse({
				thesis_id: 't-1',
				vote: 'abstain',
				reasoning: 'No opinion',
			});
			expect(result.success).toBe(false);
		});
	});

	describe('find_tensions', () => {
		it('accepts empty object', () => {
			expect(schemas.find_tensions.safeParse({}).success).toBe(true);
		});

		it('accepts limit within range', () => {
			expect(schemas.find_tensions.safeParse({ limit: 5 }).success).toBe(true);
		});

		it('rejects limit > 10', () => {
			expect(schemas.find_tensions.safeParse({ limit: 11 }).success).toBe(false);
		});

		it('rejects limit < 1', () => {
			expect(schemas.find_tensions.safeParse({ limit: 0 }).success).toBe(false);
		});
	});
});

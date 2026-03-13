import { z } from 'zod';

// ── Tool Input Schemas ──────────────────────────────────────────────────────
// Zod schemas for validating LLM-provided tool arguments at runtime.
// Prevents silent failures from malformed/missing arguments.

export const schemas = {
	read_findings: z.object({
		agent_id: z.string().optional(),
		round: z.number().optional(),
		category: z.string().optional(),
		tags: z.array(z.string()).optional(),
		limit: z.number().optional(),
	}),

	write_finding: z.object({
		category: z.string().max(200),
		title: z.string().max(500),
		description: z.string().max(5000),
		confidence: z.number().min(0).max(1),
		tags: z.array(z.string().max(100)),
		references: z
			.array(
				z.object({
					url: z.string().max(2000).optional(),
					title: z.string().max(500),
					snippet: z.string().max(1000).optional(),
				}),
			)
			.optional(),
		parent_finding_id: z.string().optional(),
	}),

	create_connection: z.object({
		from_finding_id: z.string(),
		to_finding_id: z.string(),
		relationship: z.enum(['supports', 'contradicts', 'enables', 'amplifies']),
		strength: z.number().min(0).max(1),
		reasoning: z.string().max(2000),
	}),

	read_connections: z.object({
		finding_id: z.string().optional(),
	}),

	react_to_finding: z.object({
		reaction_id: z.string(),
		reaction_text: z.string().max(3000),
		create_followup_finding: z.boolean().optional(),
		followup: z
			.object({
				category: z.string().max(200),
				title: z.string().max(500),
				description: z.string().max(5000),
				confidence: z.number().min(0).max(1),
				tags: z.array(z.string().max(100)),
			})
			.optional(),
	}),

	mark_round_ready: z.object({}),

	post_question: z.object({
		question: z.string().max(2000),
		target_agents: z.array(z.string()),
	}),

	find_tensions: z.object({
		limit: z.number().min(1).max(10).optional(),
	}),

	create_thesis: z.object({
		title: z.string().max(500),
		thesis: z.string().max(5000),
		evidence_finding_ids: z.array(z.string()).min(1),
		evidence_quotes: z
			.array(
				z.object({
					finding_id: z.string(),
					quote: z.string().max(1000),
				}),
			)
			.optional(),
		confidence: z.number().min(0).max(1),
		connections_used: z.array(z.string()).optional(),
		market_size: z.string().max(500).optional(),
		timing: z.string().max(500).optional(),
		risks: z.array(z.string().max(500)).optional(),
		contradicts_thesis_id: z.string().optional(),
	}),

	vote_on_thesis: z.object({
		thesis_id: z.string(),
		vote: z.enum(['support', 'challenge']),
		reasoning: z.string().max(3000),
		supporting_finding_ids: z.array(z.string()).optional(),
	}),

	get_theses: z.object({}),

	traverse_connections: z.object({
		start_finding_id: z.string(),
		max_depth: z.number().optional(),
		min_strength: z.number().optional(),
	}),
} as const;

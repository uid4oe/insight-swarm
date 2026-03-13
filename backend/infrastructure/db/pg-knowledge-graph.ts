import { randomUUID as uuid } from 'node:crypto';
import type pg from 'pg';
import type { KnowledgeGraphDB } from '../../domain/ports/knowledge-graph.js';
import type {
	ActivityEntry,
	AgentId,
	AgentStatus,
	AgentStatusType,
	Connection,
	ConnectionRelationship,
	EvidenceItem,
	Finding,
	InvestmentThesis,
	Reaction,
	Reference,
	RoundState,
	StructuredSummary,
	ThesisVote,
	ToolUsageStat,
} from '../../domain/types.js';
import type { ConnectionRow, FindingRow, ReactionRow, RoundStateRow, ThesisRow } from './types.js';

// ── Row → Domain converters ─────────────────────────────────────────────────
// pg driver returns JSONB as parsed JS objects and TIMESTAMPTZ as Date objects.

function ts(d: Date): string {
	return d instanceof Date ? d.toISOString() : String(d);
}

function rowToFinding(row: FindingRow): Finding {
	return {
		id: row.id,
		agent_id: row.agent_id as AgentId,
		round: row.round,
		category: row.category,
		title: row.title,
		description: row.description,
		confidence: row.confidence,
		tags: row.tags, // JSONB already parsed
		references: row.references, // JSONB already parsed
		parent_finding_id: row.parent_finding_id,
		created_at: ts(row.created_at),
	};
}

function rowToConnection(row: ConnectionRow): Connection {
	return {
		id: row.id,
		from_finding_id: row.from_finding_id,
		to_finding_id: row.to_finding_id,
		relationship: row.relationship as ConnectionRelationship,
		strength: row.strength,
		reasoning: row.reasoning,
		created_by: row.created_by as AgentId,
		round: row.round,
		created_at: ts(row.created_at),
	};
}

function rowToThesis(row: ThesisRow): InvestmentThesis {
	return {
		id: row.id,
		title: row.title,
		thesis: row.thesis,
		evidence: row.evidence as unknown as EvidenceItem[],
		connections_used: row.connections_used,
		confidence: row.confidence,
		market_size: row.market_size,
		timing: row.timing,
		risks: row.risks,
		votes: row.votes as InvestmentThesis['votes'],
		status: row.status as InvestmentThesis['status'],
		created_by: row.created_by as AgentId,
		created_at: ts(row.created_at),
	};
}

function rowToReaction(row: ReactionRow): Reaction {
	return {
		id: row.id,
		finding_id: row.finding_id,
		agent_id: row.agent_id as AgentId,
		status: row.status as Reaction['status'],
		reaction: row.reaction,
		created_at: ts(row.created_at),
		reacted_at: row.reacted_at ? ts(row.reacted_at) : null,
	};
}

function rowToRoundState(row: RoundStateRow): RoundState {
	return {
		round_number: row.round_number,
		round_phase: row.round_phase as RoundState['round_phase'],
		agents_ready: row.agents_ready as AgentId[],
		started_at: ts(row.started_at),
	};
}

// ── Implementation ──────────────────────────────────────────────────────────

export class PostgresKnowledgeGraph implements KnowledgeGraphDB {
	private pool: pg.Pool;
	private taskId: string;

	private constructor(pool: pg.Pool, taskId: string) {
		this.pool = pool;
		this.taskId = taskId;
	}

	/** Create a new task DB context (updates task status + ensures initial round state). */
	static async create(pool: pg.Pool, taskId: string, prompt: string): Promise<PostgresKnowledgeGraph> {
		const db = new PostgresKnowledgeGraph(pool, taskId);
		await pool.query(
			`INSERT INTO tasks (task_id, prompt, status, started_at)
       VALUES ($1, $2, 'running', NOW())
       ON CONFLICT (task_id) DO UPDATE SET status = 'running', started_at = COALESCE(tasks.started_at, NOW())`,
			[taskId, prompt],
		);
		const { rowCount } = await pool.query('SELECT 1 FROM round_state WHERE task_id = $1 LIMIT 1', [taskId]);
		if (rowCount === 0) {
			await pool.query(
				`INSERT INTO round_state (task_id, round_number, round_phase, agents_ready, started_at)
         VALUES ($1, 1, 'active', '[]'::jsonb, NOW())`,
				[taskId],
			);
		}
		return db;
	}

	/** Open a context for an existing task (read-only, no initialization). */
	static forExistingTask(pool: pg.Pool, taskId: string): PostgresKnowledgeGraph {
		return new PostgresKnowledgeGraph(pool, taskId);
	}

	// ── Findings ──────────────────────────────────────────────────────────────

	async createFinding(input: {
		agent_id: AgentId;
		round: number;
		category: string;
		title: string;
		description: string;
		confidence: number;
		tags: string[];
		references?: Reference[];
		parent_finding_id?: string;
		embedding?: number[];
	}): Promise<Finding> {
		const id = uuid();
		await this.pool.query(
			`INSERT INTO findings (id, task_id, agent_id, round, category, title, description, confidence, tags, "references", parent_finding_id, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
			[
				id,
				this.taskId,
				input.agent_id,
				input.round,
				input.category,
				input.title,
				input.description,
				input.confidence,
				JSON.stringify(input.tags),
				JSON.stringify(input.references ?? []),
				input.parent_finding_id ?? null,
				input.embedding?.length ? `[${input.embedding.join(',')}]` : null,
			],
		);
		// Don't count questions toward findings_count — they're discussion prompts, not insights
		if (input.category !== 'question') {
			await this.pool.query(
				`UPDATE agent_status SET findings_count = findings_count + 1
         WHERE task_id = $1 AND agent_id = $2`,
				[this.taskId, input.agent_id],
			);
		}
		const finding = await this.getFinding(id);
		if (!finding) throw new Error(`Finding ${id} not found after insert`);
		return finding;
	}

	async queryFindings(filters?: {
		agent_id?: AgentId;
		round?: number;
		category?: string;
		tags?: string[];
		limit?: number;
	}): Promise<Finding[]> {
		let sql = 'SELECT * FROM findings WHERE task_id = $1';
		const params: unknown[] = [this.taskId];
		let paramIdx = 2;

		// Exclude question-category findings by default (they're discussion prompts, not insights).
		// Only include them when explicitly requested via category filter.
		if (!filters?.category) {
			sql += ` AND category != 'question'`;
		}

		if (filters?.agent_id) {
			sql += ` AND agent_id = $${paramIdx++}`;
			params.push(filters.agent_id);
		}
		if (filters?.round !== undefined) {
			sql += ` AND round = $${paramIdx++}`;
			params.push(filters.round);
		}
		if (filters?.category) {
			sql += ` AND category = $${paramIdx++}`;
			params.push(filters.category);
		}
		if (filters?.tags?.length) {
			// JSONB ?| operator: does the array contain any of these strings?
			sql += ` AND tags ?| $${paramIdx++}`;
			params.push(filters.tags);
		}
		sql += ' ORDER BY created_at ASC';
		sql += ` LIMIT $${paramIdx++}`;
		params.push(filters?.limit ?? 50);

		const { rows } = await this.pool.query(sql, params);
		return (rows as FindingRow[]).map(rowToFinding);
	}

	async querySemanticallySimilarFindings(
		queryEmbedding: number[],
		limit = 5,
		similarityThreshold = 0.5,
	): Promise<Array<Finding & { similarity: number }>> {
		if (!queryEmbedding || queryEmbedding.length === 0) return [];

		// pgvector uses <-> for L2 distance, <=> for cosine distance, <#> for inner product.
		// We use vector_cosine_ops (<=>) for cosine distance. Similarity is 1 - distance.
		const vectorStr = `[${queryEmbedding.join(',')}]`;
		const sql = `
			SELECT *, 1 - (embedding <=> $1::vector) AS similarity
			FROM findings
			WHERE task_id = $2 AND embedding IS NOT NULL AND (1 - (embedding <=> $1::vector)) > $3
			ORDER BY embedding <=> $1::vector
			LIMIT $4
		`;
		const { rows } = await this.pool.query(sql, [vectorStr, this.taskId, similarityThreshold, limit]);

		return rows.map((row: FindingRow & { similarity: string }) => ({
			...rowToFinding(row),
			similarity: parseFloat(row.similarity),
		}));
	}

	async querySimilarFindingsByAgent(
		agentId: string,
		embedding: number[],
		similarityThreshold = 0.85,
	): Promise<Array<Finding & { similarity: number }>> {
		if (!embedding || embedding.length === 0) return [];
		const vectorStr = `[${embedding.join(',')}]`;
		const sql = `
			SELECT *, 1 - (embedding <=> $1::vector) AS similarity
			FROM findings
			WHERE task_id = $2 AND agent_id = $3 AND embedding IS NOT NULL
			  AND (1 - (embedding <=> $1::vector)) > $4
			ORDER BY embedding <=> $1::vector
			LIMIT 1
		`;
		const { rows } = await this.pool.query(sql, [vectorStr, this.taskId, agentId, similarityThreshold]);
		return rows.map((row: FindingRow & { similarity: string }) => ({
			...rowToFinding(row),
			similarity: parseFloat(row.similarity),
		}));
	}

	async countNovelFindings(round: number, similarityThreshold = 0.85): Promise<number> {
		const sql = `
			SELECT COUNT(*)::int AS novel_count
			FROM findings f
			WHERE f.task_id = $1 AND f.round = $2 AND f.embedding IS NOT NULL
			  AND NOT EXISTS (
			    SELECT 1 FROM findings prior
			    WHERE prior.task_id = $1 AND prior.agent_id = f.agent_id
			      AND prior.round < $2 AND prior.embedding IS NOT NULL
			      AND (1 - (f.embedding <=> prior.embedding)) > $3
			  )
		`;
		const { rows } = await this.pool.query(sql, [this.taskId, round, similarityThreshold]);
		return rows[0]?.novel_count ?? 0;
	}

	async getFindingEmbedding(id: string): Promise<number[] | null> {
		const { rows } = await this.pool.query('SELECT embedding FROM findings WHERE task_id = $1 AND id = $2', [
			this.taskId,
			id,
		]);
		if (rows.length === 0 || !rows[0].embedding) return null;
		// pgvector returns embeddings as a string like "[0.1,0.2,...]"
		const raw = rows[0].embedding;
		if (typeof raw === 'string') return JSON.parse(raw);
		return raw;
	}

	async findTensionCandidates(
		agentId: string,
		queryEmbedding: number[],
		limit = 5,
		similarityThreshold = 0.5,
	): Promise<Array<{ finding_a: Finding; finding_b: Finding; similarity: number }>> {
		if (!queryEmbedding || queryEmbedding.length === 0) return [];

		const vectorStr = `[${queryEmbedding.join(',')}]`;

		// Find pairs of findings from different agents that are semantically similar
		// but NOT yet connected with a "contradicts" relationship.
		// "a" = the requesting agent's findings, "b" = other agents' findings near the topic.
		const sql = `
			WITH my_findings AS (
				SELECT * FROM findings
				WHERE task_id = $1 AND agent_id = $2 AND embedding IS NOT NULL
			),
			nearby_others AS (
				SELECT *
				FROM findings
				WHERE task_id = $1 AND agent_id != $2 AND embedding IS NOT NULL
				  AND (1 - (embedding <=> $3::vector)) > $4
				ORDER BY embedding <=> $3::vector
				LIMIT 20
			)
			SELECT
				a.id AS a_id, a.task_id AS a_task_id, a.agent_id AS a_agent_id,
				a.round AS a_round, a.category AS a_category, a.title AS a_title,
				a.description AS a_description, a.confidence AS a_confidence,
				a.tags AS a_tags, a."references" AS a_references,
				a.parent_finding_id AS a_parent_finding_id, a.created_at AS a_created_at,
				b.id AS b_id, b.task_id AS b_task_id, b.agent_id AS b_agent_id,
				b.round AS b_round, b.category AS b_category, b.title AS b_title,
				b.description AS b_description, b.confidence AS b_confidence,
				b.tags AS b_tags, b."references" AS b_references,
				b.parent_finding_id AS b_parent_finding_id, b.created_at AS b_created_at,
				1 - (a.embedding <=> b.embedding) AS pair_similarity
			FROM my_findings a
			CROSS JOIN nearby_others b
			WHERE NOT EXISTS (
				SELECT 1 FROM connections c
				WHERE c.task_id = $1 AND c.relationship = 'contradicts'
				  AND ((c.from_finding_id = a.id AND c.to_finding_id = b.id)
				    OR (c.from_finding_id = b.id AND c.to_finding_id = a.id))
			)
			ORDER BY pair_similarity DESC
			LIMIT $5
		`;

		const { rows } = await this.pool.query(sql, [this.taskId, agentId, vectorStr, similarityThreshold, limit]);

		return rows.map((row: Record<string, unknown>) => ({
			finding_a: rowToFinding({
				id: row.a_id as string,
				task_id: row.a_task_id as string,
				agent_id: row.a_agent_id as string,
				round: row.a_round as number,
				category: row.a_category as string,
				title: row.a_title as string,
				description: row.a_description as string,
				confidence: row.a_confidence as number,
				tags: row.a_tags as string[],
				references: row.a_references as FindingRow['references'],
				parent_finding_id: row.a_parent_finding_id as string | null,
				created_at: row.a_created_at as Date,
			}),
			finding_b: rowToFinding({
				id: row.b_id as string,
				task_id: row.b_task_id as string,
				agent_id: row.b_agent_id as string,
				round: row.b_round as number,
				category: row.b_category as string,
				title: row.b_title as string,
				description: row.b_description as string,
				confidence: row.b_confidence as number,
				tags: row.b_tags as string[],
				references: row.b_references as FindingRow['references'],
				parent_finding_id: row.b_parent_finding_id as string | null,
				created_at: row.b_created_at as Date,
			}),
			similarity: parseFloat(row.pair_similarity as string),
		}));
	}

	async getFinding(id: string): Promise<Finding | null> {
		const { rows } = await this.pool.query('SELECT * FROM findings WHERE task_id = $1 AND id = $2', [this.taskId, id]);
		return rows.length > 0 ? rowToFinding(rows[0] as FindingRow) : null;
	}

	// ── Connections ───────────────────────────────────────────────────────────

	async createConnection(input: {
		from_finding_id: string;
		to_finding_id: string;
		relationship: ConnectionRelationship;
		strength: number;
		reasoning: string;
		created_by: AgentId;
		round: number;
	}): Promise<Connection> {
		const id = uuid();
		await this.pool.query(
			`INSERT INTO connections (id, task_id, from_finding_id, to_finding_id, relationship, strength, reasoning, created_by, round)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				id,
				this.taskId,
				input.from_finding_id,
				input.to_finding_id,
				input.relationship,
				input.strength,
				input.reasoning,
				input.created_by,
				input.round,
			],
		);
		const { rows } = await this.pool.query('SELECT * FROM connections WHERE task_id = $1 AND id = $2', [
			this.taskId,
			id,
		]);
		return rowToConnection(rows[0] as ConnectionRow);
	}

	async getConnections(findingId?: string): Promise<Connection[]> {
		if (findingId) {
			const { rows } = await this.pool.query(
				`SELECT * FROM connections
         WHERE task_id = $1 AND (from_finding_id = $2 OR to_finding_id = $2)
         ORDER BY created_at ASC`,
				[this.taskId, findingId],
			);
			return (rows as ConnectionRow[]).map(rowToConnection);
		}
		const { rows } = await this.pool.query('SELECT * FROM connections WHERE task_id = $1 ORDER BY created_at ASC', [
			this.taskId,
		]);
		return (rows as ConnectionRow[]).map(rowToConnection);
	}

	async getConnectionsForFindings(findingIds: string[]): Promise<Connection[]> {
		if (findingIds.length === 0) return [];
		const { rows } = await this.pool.query(
			`SELECT * FROM connections
       WHERE task_id = $1 AND (from_finding_id = ANY($2) OR to_finding_id = ANY($2))
       ORDER BY created_at ASC`,
			[this.taskId, findingIds],
		);
		return (rows as ConnectionRow[]).map(rowToConnection);
	}

	// ── Reactions ─────────────────────────────────────────────────────────────

	async createReactionsForFinding(findingId: string, excludeAgent: AgentId, targetAgents?: AgentId[]): Promise<void> {
		const livingAgents = await this.getLivingAgents();

		const reactTargets: AgentId[] = [];
		for (const agentId of livingAgents) {
			if (agentId === excludeAgent) continue;
			if (targetAgents && !targetAgents.includes(agentId)) continue;
			reactTargets.push(agentId);
		}

		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			for (const agentId of reactTargets) {
				await client.query(
					`INSERT INTO reactions_needed (id, task_id, finding_id, agent_id, status, created_at)
           VALUES ($1, $2, $3, $4, 'pending', NOW())`,
					[uuid(), this.taskId, findingId, agentId],
				);
			}
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	}

	async getPendingReactions(agentId: AgentId): Promise<(Reaction & { finding: Finding })[]> {
		const { rows } = await this.pool.query(
			`SELECT r.*, f.id AS f_id, f.task_id AS f_task_id, f.agent_id AS f_agent_id,
              f.round AS f_round, f.category AS f_category, f.title AS f_title,
              f.description AS f_description, f.confidence AS f_confidence,
              f.tags AS f_tags, f."references" AS f_references,
              f.parent_finding_id AS f_parent_finding_id, f.created_at AS f_created_at
       FROM reactions_needed r
       JOIN findings f ON r.task_id = f.task_id AND r.finding_id = f.id
       WHERE r.task_id = $1 AND r.agent_id = $2 AND r.status = 'pending'
       ORDER BY r.created_at ASC`,
			[this.taskId, agentId],
		);

		return rows.map((row: Record<string, unknown>) => ({
			...rowToReaction(row as unknown as ReactionRow),
			finding: rowToFinding({
				id: row.f_id as string,
				task_id: row.f_task_id as string,
				agent_id: row.f_agent_id as string,
				round: row.f_round as number,
				category: row.f_category as string,
				title: row.f_title as string,
				description: row.f_description as string,
				confidence: row.f_confidence as number,
				tags: row.f_tags as string[],
				references: row.f_references as FindingRow['references'],
				parent_finding_id: row.f_parent_finding_id as string | null,
				created_at: row.f_created_at as Date,
			}),
		}));
	}

	async getReaction(reactionId: string): Promise<Reaction | null> {
		const { rows } = await this.pool.query('SELECT * FROM reactions_needed WHERE task_id = $1 AND id = $2', [
			this.taskId,
			reactionId,
		]);
		return rows.length > 0 ? rowToReaction(rows[0] as ReactionRow) : null;
	}

	async completeReaction(reactionId: string, response: string): Promise<void> {
		await this.pool.query(
			`UPDATE reactions_needed SET status = 'reacted', reaction = $1, reacted_at = NOW()
       WHERE task_id = $2 AND id = $3`,
			[response, this.taskId, reactionId],
		);
	}

	async skipReaction(reactionId: string, reason: string): Promise<void> {
		await this.pool.query(
			`UPDATE reactions_needed SET status = 'skipped', reaction = $1, reacted_at = NOW()
       WHERE task_id = $2 AND id = $3`,
			[reason, this.taskId, reactionId],
		);
	}

	async skipReactionsForAgent(agentId: AgentId): Promise<void> {
		await this.pool.query(
			`UPDATE reactions_needed SET status = 'skipped', reaction = 'agent offline', reacted_at = NOW()
       WHERE task_id = $1 AND agent_id = $2 AND status = 'pending'`,
			[this.taskId, agentId],
		);
	}

	async getAllReactions(): Promise<(Reaction & { finding: Finding })[]> {
		const { rows } = await this.pool.query(
			`SELECT r.*, f.id AS f_id, f.task_id AS f_task_id, f.agent_id AS f_agent_id,
              f.round AS f_round, f.category AS f_category, f.title AS f_title,
              f.description AS f_description, f.confidence AS f_confidence,
              f.tags AS f_tags, f."references" AS f_references,
              f.parent_finding_id AS f_parent_finding_id, f.created_at AS f_created_at
       FROM reactions_needed r
       JOIN findings f ON r.task_id = f.task_id AND r.finding_id = f.id
       WHERE r.task_id = $1
       ORDER BY r.created_at ASC`,
			[this.taskId],
		);

		return rows.map((row: Record<string, unknown>) => ({
			...rowToReaction(row as unknown as ReactionRow),
			finding: rowToFinding({
				id: row.f_id as string,
				task_id: row.f_task_id as string,
				agent_id: row.f_agent_id as string,
				round: row.f_round as number,
				category: row.f_category as string,
				title: row.f_title as string,
				description: row.f_description as string,
				confidence: row.f_confidence as number,
				tags: row.f_tags as string[],
				references: row.f_references as FindingRow['references'],
				parent_finding_id: row.f_parent_finding_id as string | null,
				created_at: row.f_created_at as Date,
			}),
		}));
	}

	// ── Theses ───────────────────────────────────────────────────────────────

	async createThesis(input: {
		title: string;
		thesis: string;
		evidence: EvidenceItem[];
		connections_used: string[];
		confidence: number;
		market_size?: string;
		timing?: string;
		risks?: string[];
		created_by: AgentId;
		embedding?: number[];
	}): Promise<InvestmentThesis> {
		const id = uuid();
		const { rowCount } = await this.pool.query(
			`INSERT INTO theses (id, task_id, title, thesis, evidence, connections_used, confidence, market_size, timing, risks, votes, status, created_by, embedding)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb, '[]'::jsonb, 'proposed', $11, $12)
       ON CONFLICT (task_id, title) DO NOTHING`,
			[
				id,
				this.taskId,
				input.title,
				input.thesis,
				JSON.stringify(input.evidence),
				JSON.stringify(input.connections_used),
				input.confidence,
				input.market_size ?? null,
				input.timing ?? null,
				JSON.stringify(input.risks ?? []),
				input.created_by,
				input.embedding?.length ? `[${input.embedding.join(',')}]` : null,
			],
		);
		// If conflict (duplicate title), return the existing thesis
		if (rowCount === 0) {
			const { rows } = await this.pool.query('SELECT * FROM theses WHERE task_id = $1 AND title = $2', [
				this.taskId,
				input.title,
			]);
			if (rows.length > 0) return rowToThesis(rows[0] as ThesisRow);
		}
		const thesis = await this.getThesis(id);
		if (!thesis) throw new Error(`Thesis ${id} not found after insert`);
		return thesis;
	}

	async getTheses(): Promise<InvestmentThesis[]> {
		const { rows } = await this.pool.query('SELECT * FROM theses WHERE task_id = $1 ORDER BY confidence DESC', [
			this.taskId,
		]);
		return (rows as ThesisRow[]).map(rowToThesis);
	}

	async getThesis(id: string): Promise<InvestmentThesis | null> {
		const { rows } = await this.pool.query('SELECT * FROM theses WHERE task_id = $1 AND id = $2', [this.taskId, id]);
		return rows.length > 0 ? rowToThesis(rows[0] as ThesisRow) : null;
	}

	async voteOnThesis(thesisId: string, vote: ThesisVote): Promise<void> {
		// Atomic: append vote only if this agent hasn't already voted.
		// Uses a JSON sub-query to check for existing votes from the same agent_id,
		// avoiding the TOCTOU race of a separate SELECT then UPDATE.
		await this.pool.query(
			`UPDATE theses
       SET votes = votes || $1::jsonb
       WHERE task_id = $2 AND id = $3
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(votes) AS v
           WHERE v->>'agent_id' = $4
         )`,
			[JSON.stringify([vote]), this.taskId, thesisId, vote.agent_id],
		);
	}

	async getThesisEmbedding(id: string): Promise<number[] | null> {
		const { rows } = await this.pool.query('SELECT embedding FROM theses WHERE task_id = $1 AND id = $2', [
			this.taskId,
			id,
		]);
		if (rows.length === 0 || !rows[0].embedding) return null;
		const raw = rows[0].embedding;
		if (typeof raw === 'string') return JSON.parse(raw);
		return raw;
	}

	// ── Round State ───────────────────────────────────────────────────────────

	async getRoundState(): Promise<RoundState> {
		const { rows } = await this.pool.query(
			'SELECT * FROM round_state WHERE task_id = $1 ORDER BY round_number DESC LIMIT 1',
			[this.taskId],
		);
		return rowToRoundState(rows[0] as RoundStateRow);
	}

	async markAgentReady(agentId: AgentId): Promise<void> {
		// Look up the agent's current round so we mark ready in the correct row
		const { rows: agentRows } = await this.pool.query(
			'SELECT current_round FROM agent_status WHERE task_id = $1 AND agent_id = $2',
			[this.taskId, agentId],
		);
		const agentRound = (agentRows[0]?.current_round as number) ?? 1;

		// Ensure a round_state row exists for this round (created on-demand, not eagerly)
		await this.pool.query(
			`INSERT INTO round_state (task_id, round_number, round_phase, agents_ready, started_at)
       VALUES ($1, $2, 'active', '[]'::jsonb, NOW())
       ON CONFLICT DO NOTHING`,
			[this.taskId, agentRound],
		);

		// Atomic: append agent to agents_ready if not already present
		await this.pool.query(
			`UPDATE round_state
       SET agents_ready = CASE
         WHEN NOT (agents_ready @> $1::jsonb) THEN agents_ready || $1::jsonb
         ELSE agents_ready
       END
       WHERE task_id = $2 AND round_number = $3`,
			[JSON.stringify([agentId]), this.taskId, agentRound],
		);
		await this.updateAgentStatus(agentId, 'round_ready', `Ready for round ${agentRound + 1}`);
	}

	async advanceRound(): Promise<RoundState> {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			// Lock the current round row to prevent concurrent advance
			const { rows: locked } = await client.query(
				`SELECT * FROM round_state
         WHERE task_id = $1 AND round_phase = 'active'
         ORDER BY round_number DESC LIMIT 1
         FOR UPDATE`,
				[this.taskId],
			);
			if (locked.length === 0) {
				// Already advanced by another agent
				await client.query('COMMIT');
				return this.getRoundState();
			}
			const current = rowToRoundState(locked[0] as RoundStateRow);
			const nextRound = current.round_number + 1;

			await client.query(
				`UPDATE round_state SET round_phase = 'complete'
         WHERE task_id = $1 AND round_number = $2`,
				[this.taskId, current.round_number],
			);
			await client.query(
				`INSERT INTO round_state (task_id, round_number, round_phase, agents_ready, started_at)
         VALUES ($1, $2, 'active', '[]'::jsonb, NOW())
         ON CONFLICT DO NOTHING`,
				[this.taskId, nextRound],
			);
			await client.query('COMMIT');

			const living = await this.getLivingAgents();
			if (living.length > 0) {
				await this.pool.query(
					`UPDATE agent_status
					 SET status = 'idle', current_task = NULL, current_round = $1, last_heartbeat = NOW()
					 WHERE task_id = $2 AND agent_id = ANY($3::text[])`,
					[nextRound, this.taskId, living],
				);
			}

			return this.getRoundState();
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	}

	async isRoundReady(): Promise<boolean> {
		const state = await this.getRoundState();
		const living = await this.getLivingAgents();
		return living.length > 0 && living.every((a) => state.agents_ready.includes(a));
	}

	async advanceAgentRound(agentId: AgentId): Promise<number> {
		const { rows } = await this.pool.query(
			`UPDATE agent_status SET current_round = current_round + 1, status = 'idle', last_heartbeat = NOW()
       WHERE task_id = $1 AND agent_id = $2
       RETURNING current_round`,
			[this.taskId, agentId],
		);
		return rows[0]?.current_round ?? 1;
	}

	// ── Agent Status ──────────────────────────────────────────────────────────

	async updateAgentStatus(agentId: AgentId, status: AgentStatusType, task?: string | null): Promise<void> {
		await this.pool.query(
			`INSERT INTO agent_status (task_id, agent_id, status, current_task, current_round, findings_count, last_heartbeat)
       VALUES ($1, $2, $3, $4, 1, 0, NOW())
       ON CONFLICT (task_id, agent_id) DO UPDATE
       SET status = $3, current_task = $4, last_heartbeat = NOW()`,
			[this.taskId, agentId, status, task ?? null],
		);
	}

	async getAgentStatuses(): Promise<AgentStatus[]> {
		const { rows } = await this.pool.query('SELECT * FROM agent_status WHERE task_id = $1 ORDER BY agent_id', [
			this.taskId,
		]);
		return rows.map((r: Record<string, unknown>) => ({
			agent_id: r.agent_id as AgentId,
			status: r.status as AgentStatusType,
			current_task: r.current_task as string | null,
			current_round: r.current_round as number,
			findings_count: r.findings_count as number,
			last_heartbeat: ts(r.last_heartbeat as Date),
		}));
	}

	async getLivingAgents(): Promise<AgentId[]> {
		const { rows } = await this.pool.query(
			"SELECT agent_id FROM agent_status WHERE task_id = $1 AND status != 'dead'",
			[this.taskId],
		);
		return rows.map((r: { agent_id: string }) => r.agent_id as AgentId);
	}

	async markAgentDead(agentId: AgentId): Promise<void> {
		await this.pool.query("UPDATE agent_status SET status = 'dead' WHERE task_id = $1 AND agent_id = $2", [
			this.taskId,
			agentId,
		]);
		await this.skipReactionsForAgent(agentId);
	}

	async heartbeat(agentId: AgentId): Promise<void> {
		await this.pool.query('UPDATE agent_status SET last_heartbeat = NOW() WHERE task_id = $1 AND agent_id = $2', [
			this.taskId,
			agentId,
		]);
	}

	// ── Activity Log ──────────────────────────────────────────────────────────

	async logActivity(agentId: AgentId, round: number, action: string, summary: string): Promise<void> {
		await this.pool.query(
			`INSERT INTO activity_log (task_id, agent_id, round, action, summary)
       VALUES ($1, $2, $3, $4, $5)`,
			[this.taskId, agentId, round, action, summary],
		);
	}

	async getRecentActivity(limit = 15): Promise<ActivityEntry[]> {
		const { rows } = await this.pool.query(
			'SELECT * FROM activity_log WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
			[this.taskId, limit],
		);
		return rows.map((r: Record<string, unknown>) => ({
			id: r.id as number,
			agent_id: r.agent_id as AgentId,
			round: r.round as number,
			action: r.action as string,
			summary: r.summary as string,
			created_at: ts(r.created_at as Date),
		}));
	}

	async getToolUsageStats(): Promise<ToolUsageStat[]> {
		const { rows } = await this.pool.query(
			`SELECT agent_id, round, action, COUNT(*)::int AS count
       FROM activity_log
       WHERE task_id = $1 AND action NOT IN ('started', 'killed', 'agent_died')
       GROUP BY agent_id, round, action
       ORDER BY round, agent_id, count DESC`,
			[this.taskId],
		);
		return rows.map((r: Record<string, unknown>) => ({
			agent_id: r.agent_id as string,
			round: r.round as number,
			action: r.action as string,
			count: r.count as number,
		}));
	}

	// ── Batch queries ─────────────────────────────────────────────────────────

	async queryFindingsByIds(ids: string[]): Promise<Finding[]> {
		if (ids.length === 0) return [];
		const { rows } = await this.pool.query('SELECT * FROM findings WHERE task_id = $1 AND id = ANY($2)', [
			this.taskId,
			ids,
		]);
		return (rows as FindingRow[]).map(rowToFinding);
	}

	async queryConnectionsByIds(ids: string[]): Promise<Connection[]> {
		if (ids.length === 0) return [];
		const { rows } = await this.pool.query('SELECT * FROM connections WHERE task_id = $1 AND id = ANY($2)', [
			this.taskId,
			ids,
		]);
		return (rows as ConnectionRow[]).map(rowToConnection);
	}

	async getReactionChain(findingId: string): Promise<Finding[]> {
		const { rows } = await this.pool.query(
			`WITH RECURSIVE chain AS (
				SELECT f.*, 0 AS depth
				FROM findings f
				WHERE f.task_id = $1 AND f.id = $2

				UNION ALL

				SELECT p.*, c.depth + 1
				FROM findings p
				JOIN chain c ON p.task_id = $1 AND p.id = c.parent_finding_id
				WHERE c.parent_finding_id IS NOT NULL AND c.depth < 20
			)
			SELECT * FROM chain WHERE depth > 0 ORDER BY depth ASC`,
			[this.taskId, findingId],
		);
		return (rows as FindingRow[]).map(rowToFinding);
	}

	async getReactionChains(findingIds: string[]): Promise<Map<string, Finding[]>> {
		const result = new Map<string, Finding[]>();
		if (findingIds.length === 0) return result;

		const { rows } = await this.pool.query(
			`WITH RECURSIVE chain AS (
				SELECT f.*, f.id AS root_id, 0 AS depth
				FROM findings f
				WHERE f.task_id = $1 AND f.id = ANY($2)

				UNION ALL

				SELECT p.*, c.root_id, c.depth + 1
				FROM findings p
				JOIN chain c ON p.task_id = $1 AND p.id = c.parent_finding_id
				WHERE c.parent_finding_id IS NOT NULL AND c.depth < 20
			)
			SELECT * FROM chain WHERE depth > 0 ORDER BY root_id, depth ASC`,
			[this.taskId, findingIds],
		);

		for (const row of rows as (FindingRow & { root_id: string })[]) {
			const rootId = row.root_id;
			if (!result.has(rootId)) result.set(rootId, []);
			result.get(rootId)?.push(rowToFinding(row));
		}
		return result;
	}

	async traverseConnections(
		startFindingId: string,
		maxDepth: number,
		minStrength: number,
	): Promise<{
		findings: Finding[];
		connections: Connection[];
	}> {
		const { rows } = await this.pool.query(
			`WITH RECURSIVE graph AS (
        SELECT id, from_finding_id, to_finding_id, relationship, strength, reasoning, created_by, round, created_at,
               CASE WHEN from_finding_id = $2 THEN to_finding_id ELSE from_finding_id END AS reached_id,
               0 AS depth,
               ARRAY[$2::text] AS visited_nodes
        FROM connections
        WHERE task_id = $1 AND (from_finding_id = $2 OR to_finding_id = $2) AND strength >= $4

        UNION ALL

        SELECT c.id, c.from_finding_id, c.to_finding_id, c.relationship, c.strength, c.reasoning, c.created_by, c.round, c.created_at,
               CASE WHEN c.from_finding_id = g.reached_id THEN c.to_finding_id ELSE c.from_finding_id END,
               g.depth + 1,
               g.visited_nodes || g.reached_id
        FROM connections c
        JOIN graph g ON c.task_id = $1
          AND (c.from_finding_id = g.reached_id OR c.to_finding_id = g.reached_id)
          AND c.id != g.id
          AND c.strength >= $4
          AND NOT (CASE WHEN c.from_finding_id = g.reached_id THEN c.to_finding_id ELSE c.from_finding_id END = ANY(g.visited_nodes))
        WHERE g.depth < $3
      )
      SELECT DISTINCT id, from_finding_id, to_finding_id, relationship, strength, reasoning, created_by, round, created_at
      FROM graph`,
			[this.taskId, startFindingId, maxDepth, minStrength],
		);
		const connections = (rows as ConnectionRow[]).map(rowToConnection);

		// Collect all finding IDs referenced by these connections + the start
		const findingIds = new Set<string>([startFindingId]);
		for (const c of connections) {
			findingIds.add(c.from_finding_id);
			findingIds.add(c.to_finding_id);
		}
		const findings = await this.queryFindingsByIds([...findingIds]);

		return { findings, connections };
	}

	async getCounts(): Promise<{ findings: number; connections: number; theses: number }> {
		const { rows } = await this.pool.query(
			`SELECT
				(SELECT COUNT(*)::int FROM findings WHERE task_id = $1) AS findings,
				(SELECT COUNT(*)::int FROM connections WHERE task_id = $1) AS connections,
				(SELECT COUNT(*)::int FROM theses WHERE task_id = $1) AS theses`,
			[this.taskId],
		);
		return rows[0] as { findings: number; connections: number; theses: number };
	}

	// ── Summary Persistence ──────────────────────────────────────────────────

	async getSavedSummary(taskId: string): Promise<StructuredSummary | null> {
		const { rows } = await this.pool.query(`SELECT summary FROM task_summaries WHERE task_id = $1`, [taskId]);
		if (rows.length === 0) return null;
		return rows[0].summary as StructuredSummary;
	}

	async saveSummary(taskId: string, summary: StructuredSummary): Promise<void> {
		await this.pool.query(
			`INSERT INTO task_summaries (task_id, summary) VALUES ($1, $2)
			 ON CONFLICT (task_id) DO UPDATE SET summary = $2, created_at = NOW()`,
			[taskId, JSON.stringify(summary)],
		);
	}

	async close(): Promise<void> {
		// No-op: pool is shared and managed by the application lifecycle.
	}
}

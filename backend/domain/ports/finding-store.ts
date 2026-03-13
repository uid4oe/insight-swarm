// ── Data Layer Ports ────────────────────────────────────────────────────────
// Findings (CRUD + semantic search) and connections between them.

import type { AgentId, Connection, ConnectionRelationship, Finding, Reference } from '../types.js';

/** CRUD operations for findings. */
export interface FindingStore {
	createFinding(input: {
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
	}): Promise<Finding>;

	queryFindings(filters?: {
		agent_id?: AgentId;
		round?: number;
		category?: string;
		tags?: string[];
		limit?: number;
	}): Promise<Finding[]>;

	getFinding(id: string): Promise<Finding | null>;
	queryFindingsByIds(ids: string[]): Promise<Finding[]>;
}

/** Semantic (vector) search over findings. */
export interface SemanticSearch {
	querySemanticallySimilarFindings(
		queryEmbedding: number[],
		limit?: number,
		similarityThreshold?: number,
	): Promise<Array<Finding & { similarity: number }>>;

	/** Find the most similar existing finding by the same agent (for deduplication). */
	querySimilarFindingsByAgent(
		agentId: AgentId,
		embedding: number[],
		similarityThreshold?: number,
	): Promise<Array<Finding & { similarity: number }>>;

	/** Count findings in a round that are semantically novel (no prior-round duplicate by same agent). */
	countNovelFindings(round: number, similarityThreshold?: number): Promise<number>;

	/** Get a finding's raw embedding vector. */
	getFindingEmbedding(id: string): Promise<number[] | null>;

	/**
	 * Find tension candidates: pairs of findings from different agents that are
	 * semantically similar (same topic) but not yet connected with a "contradicts"
	 * relationship. High similarity + different agents = likely tension.
	 */
	findTensionCandidates(
		agentId: AgentId,
		queryEmbedding: number[],
		limit?: number,
		similarityThreshold?: number,
	): Promise<Array<{ finding_a: Finding; finding_b: Finding; similarity: number }>>;
}

/** Connection graph between findings. */
export interface ConnectionGraph {
	createConnection(input: {
		from_finding_id: string;
		to_finding_id: string;
		relationship: ConnectionRelationship;
		strength: number;
		reasoning: string;
		created_by: AgentId;
		round: number;
	}): Promise<Connection>;

	getConnections(findingId?: string): Promise<Connection[]>;
	/** Get connections where any of the given finding IDs appear as source or target. */
	getConnectionsForFindings(findingIds: string[]): Promise<Connection[]>;
	queryConnectionsByIds(ids: string[]): Promise<Connection[]>;

	traverseConnections(
		startFindingId: string,
		maxDepth: number,
		minStrength: number,
	): Promise<{
		findings: Finding[];
		connections: Connection[];
	}>;
}

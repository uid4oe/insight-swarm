// ── Collaboration Ports ─────────────────────────────────────────────────────
// Cross-agent reactions, thesis synthesis, and voting.

import type { AgentId, EvidenceItem, Finding, InvestmentThesis, Reaction, ThesisVote } from '../types.js';

/** Cross-agent reaction workflow. */
export interface ReactionWorkflow {
	createReactionsForFinding(findingId: string, excludeAgent: AgentId, targetAgents?: AgentId[]): Promise<void>;
	getPendingReactions(agentId: AgentId): Promise<(Reaction & { finding: Finding })[]>;
	getReaction(reactionId: string): Promise<Reaction | null>;
	completeReaction(reactionId: string, response: string): Promise<void>;
	skipReaction(reactionId: string, reason: string): Promise<void>;
	skipReactionsForAgent(agentId: AgentId): Promise<void>;

	/** Get ALL reactions for this task (completed, skipped, pending) with associated finding. */
	getAllReactions(): Promise<(Reaction & { finding: Finding })[]>;

	getReactionChain(findingId: string): Promise<Finding[]>;
	/** Batch version: get reaction chains for multiple findings in a single query. */
	getReactionChains(findingIds: string[]): Promise<Map<string, Finding[]>>;
}

/** Multi-agent thesis synthesis and voting. */
export interface ThesisStore {
	createThesis(input: {
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
	}): Promise<InvestmentThesis>;

	getTheses(): Promise<InvestmentThesis[]>;
	getThesis(id: string): Promise<InvestmentThesis | null>;
	voteOnThesis(thesisId: string, vote: ThesisVote): Promise<void>;
	/** Get a thesis's cached embedding vector. */
	getThesisEmbedding(id: string): Promise<number[] | null>;
}

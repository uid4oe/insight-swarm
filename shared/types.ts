// ── Shared Domain Types ───────────────────────────────────────────────────
// These types are shared across the backend and frontend to ensure consistency.

// ── Agent Identity ──────────────────────────────────────────────────────────

/** Agent ID — lowercase slug (e.g. "financial", "legal"). */
export type AgentId = string;

// ── Shared Constants ────────────────────────────────────────────────────────
// Extract string literal unions into const arrays so both runtime validation
// and types derive from a single source of truth.

export const TASK_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CONNECTION_RELATIONSHIPS = ['supports', 'contradicts', 'enables', 'amplifies'] as const;

export const AGENT_STATUS_TYPES = [
	'idle',
	'thinking',
	'tool_use',
	'writing',
	'reacting',
	'waiting',
	'dead',
	'round_ready',
] as const;

export const EVIDENCE_ROLES = ['primary', 'supporting', 'contextual'] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

// ── Shared Types ────────────────────────────────────────────────────────────

export interface AgentMeta {
	id: string;
	label: string;
	color: string;
	description: string;
	/** Agent's analytical perspective — used for summary generation. */
	perspective?: string;
}

// ── References ──────────────────────────────────────────────────────────────

export interface Reference {
	url?: string;
	title: string;
	snippet?: string;
}

// ── Findings ────────────────────────────────────────────────────────────────

export interface Finding {
	id: string;
	agent_id: AgentId;
	round: number;
	category: string;
	title: string;
	description: string;
	confidence: number;
	tags: string[];
	references: Reference[];
	parent_finding_id: string | null;
	created_at: string;
}

// ── Connections ─────────────────────────────────────────────────────────────

export type ConnectionRelationship = (typeof CONNECTION_RELATIONSHIPS)[number];

export interface Connection {
	id: string;
	from_finding_id: string;
	to_finding_id: string;
	relationship: ConnectionRelationship;
	strength: number;
	reasoning: string;
	created_by: AgentId;
	round: number;
	created_at: string;
}

// ── Reactions ───────────────────────────────────────────────────────────────

export type ReactionStatus = 'pending' | 'reacted' | 'skipped';

export interface Reaction {
	id: string;
	finding_id: string;
	agent_id: AgentId;
	status: ReactionStatus;
	reaction: string | null;
	created_at: string;
	reacted_at: string | null;
}

// ── Investment Theses ──────────────────────────────────────────────────────

export interface EvidenceItem {
	finding_id: string;
	reasoning: string; // Why this finding supports the investment thesis
	relevance: EvidenceRole;
}

export interface ThesisVote {
	agent_id: AgentId;
	vote: 'support' | 'challenge';
	reasoning: string;
	supporting_evidence?: string[]; // Finding IDs that informed this vote
}

export interface InvestmentThesis {
	id: string;
	title: string;
	thesis: string;
	evidence: EvidenceItem[]; // enriched evidence with reasoning
	connections_used: string[]; // connection IDs
	confidence: number;
	market_size: string | null;
	timing: string | null;
	risks: string[];
	votes: ThesisVote[];
	status: 'proposed' | 'validated' | 'refined';
	created_by: AgentId;
	created_at: string;
}

// ── Round State ─────────────────────────────────────────────────────────────

export interface RoundState {
	round_number: number;
	round_phase: 'active' | 'complete';
	agents_ready: AgentId[];
	started_at: string;
}

// ── Agent Status ────────────────────────────────────────────────────────────

export type AgentStatusType = (typeof AGENT_STATUS_TYPES)[number];

export interface AgentStatus {
	agent_id: AgentId;
	status: AgentStatusType;
	current_task: string | null;
	current_round: number;
	findings_count: number;
	last_heartbeat: string;
}

// ── Activity Log ────────────────────────────────────────────────────────────

export interface ActivityEntry {
	id: number;
	agent_id: AgentId;
	round: number;
	action: string;
	summary: string;
	created_at: string;
}

// ── Tool Usage Stats ───────────────────────────────────────────────────────

export interface ToolUsageStat {
	agent_id: AgentId;
	round: number;
	action: string;
	count: number;
}

// ── Shared Task Orchestration ───────────────────────────────────────────────

export interface TaskSummary {
	taskId: string;
	prompt: string;
	title: string;
	selectedAgents: string[];
	status: TaskStatus;
	startedAt: string;
	completedAt: string | null;
}

export interface TaskState {
	taskId: string;
	prompt: string;
	title: string;
	selectedAgents: string[];
	status: TaskStatus;
	startedAt: string | null;
	completedAt: string | null;
	roundState: RoundState;
	agents: AgentStatus[];
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	activity: ActivityEntry[];
	agentMeta?: AgentMeta[];
}

// ── Summary Types ───────────────────────────────────────────────────────────

export interface NarrativeEvent {
	round: number;
	agent: AgentId;
	action: string;
	detail: string;
	relatedAgents?: AgentId[];
}

/** Full evidence chain for a single thesis — shows how findings led to synthesis */
export interface EvidenceChain {
	thesisId: string;
	thesisTitle: string;
	confidence: number;
	consensus: 'strong' | 'mixed' | 'contested';
	chain: Array<{
		findingId: string;
		findingTitle: string;
		agent: AgentId;
		role: 'primary' | 'supporting' | 'contextual';
		confidence: number;
		connectionTo?: {
			targetFindingId: string;
			relationship: string;
			strength: number;
		};
	}>;
	challengeVotes: Array<{
		agent: AgentId;
		reasoning: string;
	}>;
}

/** A pair of findings from different agents that contradict or tension each other */
export interface TensionEntry {
	id: string;
	findingA: { id: string; title: string; agent: AgentId; confidence: number };
	findingB: { id: string; title: string; agent: AgentId; confidence: number };
	relationship: 'contradicts' | 'qualifies' | 'complicates';
	reasoning: string;
	resolution?: string;
}

/** Risk derived from challenges, low-confidence findings, and unresolved tensions */
export interface RiskEntry {
	title: string;
	severity: 'high' | 'medium' | 'low';
	source: 'challenge_vote' | 'low_confidence' | 'unresolved_tension' | 'missing_evidence';
	description: string;
	relatedThesisId?: string;
	relatedFindingIds: string[];
}

/** Confidence breakdown — shows how certain the analysis is */
export interface ConfidenceDistribution {
	high: number;
	medium: number;
	low: number;
	averageConfidence: number;
	agentAgreement: number;
}

/** Per-agent contribution breakdown (computed from real data) */
// ── Reaction Dialogue ──────────────────────────────────────────────────────

/** A finding and all the reactions it received from other agents */
export interface ReactionDialogue {
	findingId: string;
	findingTitle: string;
	findingAgent: AgentId;
	round: number;
	reactions: Array<{
		agentId: AgentId;
		text: string;
		status: 'reacted' | 'skipped';
		followUpFindingId?: string;
	}>;
}

// ── Conversation Thread ────────────────────────────────────────────────────

/** A threaded dialogue built from parent_finding_id chains */
export interface ConversationThread {
	rootFindingId: string;
	rootTitle: string;
	rootAgent: AgentId;
	round: number;
	replies: Array<{
		findingId: string;
		title: string;
		agent: AgentId;
		round: number;
		confidence: number;
		depth: number;
	}>;
	agentCount: number;
}

// ── Tag Overlap ────────────────────────────────────────────────────────────

/** Cross-agent tag analysis — reveals hidden consensus and blind spots */
export interface TagOverlap {
	sharedTags: Array<{
		tag: string;
		agents: AgentId[];
		findingCount: number;
	}>;
	blindSpotTags: Array<{
		tag: string;
		agent: AgentId;
		findingCount: number;
	}>;
}

// ── Stance Evolution ───────────────────────────────────────────────────────

/** Per-agent round-by-round analytical evolution */
export interface AgentEvolution {
	agentId: AgentId;
	rounds: Array<{
		round: number;
		avgConfidence: number;
		findingCount: number;
		topCategories: string[];
		reactionsGiven: number;
		reactionsReceived: number;
	}>;
	confidenceTrend: 'increasing' | 'decreasing' | 'stable';
	categoryShift: boolean;
}

// ── Agent Breakdown ────────────────────────────────────────────────────────

export interface AgentBreakdown {
	agentId: AgentId;
	/** Agent's role label (e.g. "financial analyst") */
	role: string;
	findingsCount: number;
	connectionsCount: number;
	thesesCreated: number;
	votesSupport: number;
	votesChallenge: number;
	avgConfidence: number;
	/** Categories this agent investigated */
	categories: string[];
}

// ── LLM Summary Output ─────────────────────────────────────────────────────
// Fields generated by the LLM and parsed from its JSON output.
// After postProcessSummary(), these are enriched/validated against real data.

export interface LlmSummaryOutput {
	headline: string;
	overview: string;
	/** Chronological narrative of how agents interacted — the core timeline */
	narrative: NarrativeEvent[];
	themes: Array<{
		name: string;
		description: string;
		agents: AgentId[];
	}>;
	theses: Array<{
		id?: string; // Injected by postProcess from real thesis data
		title: string;
		confidence: number;
		consensus: 'strong' | 'mixed' | 'contested';
		oneLiner: string;
	}>;
	recommendations: Array<{
		action: string;
		priority: 'high' | 'medium' | 'low';
		reasoning?: string;
	}>;
	/** Key debates between agents (LLM-generated, may be omitted by the model). */
	keyDebates?: Array<{
		topic: string;
		agents: AgentId[];
		summary: string;
		resolution: 'resolved' | 'unresolved' | 'partially_resolved';
	}>;
	/** LLM-generated collaboration insights (may be omitted by the model). */
	collaborationHighlights?: Array<{
		type: 'reaction_dialogue' | 'blind_spot' | 'hidden_consensus' | 'stance_shift';
		agents: AgentId[];
		summary: string;
		round: number;
		significance: 'high' | 'medium' | 'low';
	}>;
	/** LLM-generated blind spot analysis (may be omitted by the model). */
	blindSpots?: Array<{
		topic: string;
		coveredBy: AgentId[];
		missedBy: AgentId[];
		impact: string;
	}>;
}

// ── Computed Analytics ─────────────────────────────────────────────────────
// Always present after postProcessSummary(). Computed from real swarm data,
// never LLM-generated. Consumers can rely on these fields without null checks.

export interface ComputedAnalytics {
	stats: {
		findings: number;
		connections: number;
		theses: number;
		agentsActive: number;
		roundsCompleted: number;
		crossAgentConnectionRate: number;
		reactionsTotal: number;
		reactionsCompleted: number;
		reactionsSkipped: number;
		conversationThreads: number;
	};
	evidenceChains: EvidenceChain[];
	tensionMap: TensionEntry[];
	riskMatrix: RiskEntry[];
	confidenceDistribution: ConfidenceDistribution;
	disagreementScore: {
		challengeVoteRatio: number;
		tensionCount: number;
		unresolvedTensions: number;
	};
	agentBreakdown: AgentBreakdown[];
	sources: Array<{ url: string; title: string; citedBy: AgentId[] }>;
	reactionDialogues: ReactionDialogue[];
	conversationThreads: ConversationThread[];
	tagOverlap: TagOverlap;
	agentEvolution: AgentEvolution[];
}

// ── Full Structured Summary ────────────────────────────────────────────────
// LLM output enriched with computed analytics. Returned by generateAndSaveSummary().

export type StructuredSummary = LlmSummaryOutput & ComputedAnalytics;

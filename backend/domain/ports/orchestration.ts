// ── Orchestration Ports ─────────────────────────────────────────────────────
// Round coordination, agent health, activity logging, summary persistence,
// and lightweight count queries.

import type {
	ActivityEntry,
	AgentId,
	AgentStatus,
	AgentStatusType,
	RoundState,
	StructuredSummary,
	ToolUsageStat,
} from '../types.js';

/** Round synchronization across agents. */
export interface RoundCoordinator {
	getRoundState(): Promise<RoundState>;
	markAgentReady(agentId: AgentId): Promise<void>;
	advanceRound(): Promise<RoundState>;
	isRoundReady(): Promise<boolean>;
	/** Advance a specific agent to its next round (async round advancement). */
	advanceAgentRound(agentId: AgentId): Promise<number>;
}

/** Agent health monitoring. */
export interface AgentHealth {
	updateAgentStatus(agentId: AgentId, status: AgentStatusType, task?: string | null): Promise<void>;
	getAgentStatuses(): Promise<AgentStatus[]>;
	getLivingAgents(): Promise<AgentId[]>;
	markAgentDead(agentId: AgentId): Promise<void>;
	heartbeat(agentId: AgentId): Promise<void>;
}

/** Audit trail. */
export interface ActivityLog {
	logActivity(agentId: AgentId, round: number, action: string, summary: string): Promise<void>;
	getRecentActivity(limit?: number): Promise<ActivityEntry[]>;
	getToolUsageStats(): Promise<ToolUsageStat[]>;
}

/** Cached summary persistence. */
export interface SummaryPersistence {
	getSavedSummary(taskId: string): Promise<StructuredSummary | null>;
	saveSummary(taskId: string, summary: StructuredSummary): Promise<void>;
}

/** Lightweight count query for delta-based SSE polling. */
export interface KnowledgeGraphCounts {
	getCounts(): Promise<{ findings: number; connections: number; theses: number }>;
}

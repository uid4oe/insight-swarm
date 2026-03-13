// ── Application-Layer Types ──────────────────────────────────────────────────
// Grouped: swarm orchestration, summary generation.

import type { Connection, Finding, InvestmentThesis } from '../../shared/types.js';
import type { AgentConfig } from '../domain/agents.js';
import type { SwarmEventBus } from '../domain/ports/event-bus.js';
import type { KnowledgeGraphDB } from '../domain/ports/knowledge-graph.js';
import type { SwarmAgent } from './agents/swarm-agent.js';

// ── Swarm Orchestration ─────────────────────────────────────────────────────

// Runtime-only handles for a live swarm task. Status/timestamps/agentMeta are
// authoritative in the DB (tasks table) — never duplicated here.
export interface SwarmTask {
	taskId: string;
	prompt: string;
	db: KnowledgeGraphDB;
	eventBus: SwarmEventBus;
	agents: SwarmAgent[];
	// Resolves on success, rejects on failure/cancel
	promise: Promise<SwarmResult>;
}

export interface SwarmResult {
	taskId: string;
	prompt: string;
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	durationMs: number;
}

export interface SwarmRunOptions {
	/** Override which agents participate (default: selected from static definitions) */
	agentConfigs?: AgentConfig[];
	/** Per-agent model overrides keyed by agent ID */
	modelOverrides?: Record<string, string>;
	/** Which DD agent IDs to activate (default: all 5) */
	selectedAgents?: string[];
	/** User-defined custom agents to include alongside built-in agents */
	customAgents?: import('../../shared/agent-definitions.js').CustomAgentDefinition[];
}

// ── Summary Generation ──────────────────────────────────────────────────────

import type { ComputedAnalytics, LlmSummaryOutput, NarrativeEvent, StructuredSummary } from '../../shared/types.js';
export type { ComputedAnalytics, LlmSummaryOutput, NarrativeEvent, StructuredSummary };

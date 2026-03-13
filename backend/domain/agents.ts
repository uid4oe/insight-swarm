import type { AgentId } from './types.js';

// Re-export AgentMeta from shared types (single source of truth)
export type { AgentMeta } from './types.js';

export interface AgentConfig {
	id: AgentId;
	model: string;
	systemPrompt: string;
	relevantTags: string[];
	maxTurnsPerRound: number;
	maxRounds?: number;
	thesisThreshold?: number;

	/** Display metadata — provided by static agent definitions. */
	label: string;
	color: string;
	description: string;
	/** Used for dead-agent compensation prompts. */
	perspective: string;
}

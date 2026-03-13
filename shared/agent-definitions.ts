// ── Static DD Agent Definitions ──────────────────────────────────────────────
// Shared between backend (full configs) and frontend (selector UI).
// 5 due diligence specialist agents.

export interface AgentDefinition {
	id: string;
	label: string;
	shortLabel: string;
	color: string;
	description: string;
	perspective: string;
}

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
	{
		id: 'financial',
		label: 'FINANCIAL',
		shortLabel: 'Financial',
		color: '#c084fc',
		description:
			'Analyzes revenue models, unit economics, financial health, burn rate, projections, cap table implications, and valuation benchmarks.',
		perspective: 'Financial due diligence — revenue, profitability, valuation, and capital structure',
	},
	{
		id: 'operational',
		label: 'OPERATIONAL',
		shortLabel: 'Operational',
		color: '#22d3ee',
		description:
			'Evaluates business model scalability, technology stack, supply chain, operational efficiency, processes, and infrastructure.',
		perspective: 'Operational due diligence — scalability, technology, processes, and infrastructure',
	},
	{
		id: 'legal',
		label: 'LEGAL & REGULATORY',
		shortLabel: 'Legal',
		color: '#fb923c',
		description:
			'Assesses regulatory compliance, IP portfolio, litigation risks, contractual obligations, data privacy, and licensing.',
		perspective: 'Legal and regulatory due diligence — compliance, IP, litigation, and governance',
	},
	{
		id: 'market',
		label: 'MARKET & COMMERCIAL',
		shortLabel: 'Market',
		color: '#4ade80',
		description:
			'Analyzes market sizing, competitive landscape, customer acquisition, go-to-market strategy, product-market fit, and growth drivers.',
		perspective: 'Market and commercial due diligence — market size, competition, and growth',
	},
	{
		id: 'management',
		label: 'MANAGEMENT & TEAM',
		shortLabel: 'Management',
		color: '#f472b6',
		description:
			'Evaluates leadership quality, team composition, culture, key-person risk, hiring pipeline, board effectiveness, and founder dynamics.',
		perspective: 'Management and team due diligence — leadership, culture, and organizational risk',
	},
] as const;

export const ALL_AGENT_IDS = AGENT_DEFINITIONS.map((d) => d.id);

export const BUILTIN_AGENT_IDS = new Set(ALL_AGENT_IDS);

export const AGENT_DEFINITION_MAP = new Map(AGENT_DEFINITIONS.map((d) => [d.id, d]));

// ── Custom Agent Definitions ────────────────────────────────────────────────
// Passed via the API to define user-created agents beyond the 5 built-ins.

export interface CustomAgentDefinition {
	/** Agent ID slug, e.g. "agent_legal" — auto-prefixed with "agent_" if missing. */
	id: string;
	/** Display label, e.g. "Legal Analyst". */
	label: string;
	/** Analytical perspective — injected as the agent's mandate. */
	perspective: string;
	/** Hex color for UI rendering. */
	color: string;
	/** Brief description of the agent's role. */
	description: string;
}

/** Normalize a custom agent ID to ensure it has the "agent_" prefix. */
export function normalizeAgentId(id: string): string {
	return id.startsWith('agent_') ? id : `agent_${id}`;
}

/**
 * Convert a CustomAgentDefinition into a full AgentDefinition (adds shortLabel).
 */
export function customToAgentDefinition(custom: CustomAgentDefinition): AgentDefinition {
	const id = normalizeAgentId(custom.id);
	return {
		id,
		label: custom.label.toUpperCase(),
		shortLabel: custom.label,
		color: custom.color,
		description: custom.description,
		perspective: custom.perspective,
	};
}

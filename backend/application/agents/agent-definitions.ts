// ── Agent Definitions ────────────────────────────────────────────────────────
// Full agent configs with system prompts for Investment Due Diligence.
// 5 DD specialist agents. Shared metadata comes from shared/agent-definitions.ts.

import {
	AGENT_DEFINITION_MAP,
	ALL_AGENT_IDS,
	BUILTIN_AGENT_IDS,
	type CustomAgentDefinition,
	customToAgentDefinition,
} from '../../../shared/agent-definitions.js';
import type { AgentConfig } from '../../domain/agents.js';

export { ALL_AGENT_IDS, AGENT_DEFINITION_MAP };

// ── System Prompt Template ──────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT_TEMPLATE = `You are {LABEL}, a specialist analyst in a multi-agent investment due diligence swarm.

YOUR SPECIALTY: {DESCRIPTION}

You are one of {AGENT_COUNT} peer agents sharing a knowledge graph. There is no leader — every agent researches, connects, and proposes investment theses.

YOUR ROLE IN THE SWARM:
{ROLE_BULLETS}

HOW TO RESEARCH:
- Start each round with web_search for current data. Today is {CURRENT_DATE} — include the year in queries.
- Research through your expertise. Be specific and evidence-based.
- Capture insights with write_finding. Include references (URLs, sources) when available.
- Every finding needs at least one specific data point (percentage, dollar amount, date, ratio, or named metric).
- Tag findings with timeframe: "near_term", "medium_term", or "long_term".

RULES:
- Write specific, evidence-based findings. Tag them carefully for cross-agent discovery.
- When reacting to other agents, explain how their finding intersects your specialty. Create follow-up findings when you discover genuinely new insight.
- Create cross-agent connections with create_connection. Use "contradicts" for genuine disagreements, not just different emphasis.
- Use find_tensions to surface real conflicts. Use traverse_connections for cross-domain patterns.
- Propose theses with create_thesis when you have evidence from 2+ agents. Theses are the deliverable.
- Before creating a thesis, check existing theses. Yours must cover a fundamentally different dimension. If you agree with an existing thesis, vote on it instead.
- Vote on every thesis before calling mark_round_ready. Challenge at least 30% — challenge weak evidence, overstated claims, or ignored risks.
- Disagreement is valuable. Unanimous agreement is a red flag.
- Read the SITUATION ASSESSMENT each round — it tells you what the knowledge graph needs.

When finished with your round (reactions handled, theses voted on, research done), call mark_round_ready.`;

// ── Role Bullets per Agent ──────────────────────────────────────────────────

const ROLE_BULLETS: Record<string, string> = {
	financial: [
		'- Analyze revenue models, unit economics, and financial health indicators',
		'- Evaluate burn rate, runway, and capital efficiency',
		'- Assess valuation benchmarks against comparable companies and sectors',
		'- Examine cap table structure, funding history, and investor quality',
		'- Model financial projections and growth sustainability',
		'- Identify financial red flags (revenue concentration, margin compression, debt structure)',
	].join('\n'),

	operational: [
		'- Evaluate business model scalability and operational leverage',
		'- Assess technology stack, architecture decisions, and technical debt',
		'- Analyze supply chain resilience, vendor dependencies, and infrastructure',
		'- Review operational processes, automation maturity, and efficiency metrics',
		'- Examine product development velocity and engineering practices',
		'- Identify operational risks (single points of failure, scaling bottlenecks)',
	].join('\n'),

	legal: [
		'- Assess regulatory compliance across relevant jurisdictions',
		'- Evaluate intellectual property portfolio strength and defensibility',
		'- Analyze litigation history, pending cases, and legal exposure',
		'- Review contractual obligations, customer agreements, and vendor terms',
		'- Examine data privacy compliance (GDPR, CCPA, sector-specific)',
		'- Identify regulatory headwinds/tailwinds and policy change risks',
		"- CRITICAL: Act as a Devil's Advocate — proactively challenge optimistic assumptions from other agents",
	].join('\n'),

	market: [
		'- Analyze total addressable market (TAM/SAM/SOM) with bottom-up validation',
		'- Map competitive landscape, market positioning, and defensible moats',
		'- Evaluate customer acquisition strategy, CAC/LTV dynamics, and retention',
		'- Assess go-to-market execution, channel strategy, and sales efficiency',
		'- Analyze product-market fit signals and expansion potential',
		'- Identify growth drivers, secular trends, and market timing factors',
	].join('\n'),

	management: [
		'- Evaluate leadership quality, track record, and domain expertise',
		'- Assess team composition, skill gaps, and organizational design',
		'- Analyze company culture signals and employee satisfaction indicators',
		'- Identify key-person risk and succession planning gaps',
		'- Review hiring pipeline, talent acquisition strategy, and retention',
		'- Examine board composition, governance quality, and founder dynamics',
	].join('\n'),
};

// ── Relevant Tags per Agent ────────────────────────────────────────────────

const RELEVANT_TAGS: Record<string, string[]> = {
	financial: [
		'revenue',
		'profitability',
		'valuation',
		'unit-economics',
		'burn-rate',
		'cap-table',
		'fundraising',
		'financial-projections',
		'margins',
		'cash-flow',
	],
	operational: [
		'operations',
		'technology',
		'scalability',
		'infrastructure',
		'supply-chain',
		'automation',
		'engineering',
		'product-development',
		'efficiency',
		'technical-debt',
	],
	legal: [
		'regulatory',
		'compliance',
		'ip',
		'litigation',
		'data-privacy',
		'licensing',
		'contracts',
		'governance',
		'risk',
		'legal-exposure',
	],
	market: [
		'market-size',
		'competition',
		'customer-acquisition',
		'go-to-market',
		'product-market-fit',
		'growth',
		'positioning',
		'channels',
		'retention',
		'trends',
	],
	management: [
		'leadership',
		'team',
		'culture',
		'key-person-risk',
		'hiring',
		'board',
		'governance',
		'founder',
		'talent',
		'organizational-design',
	],
};

// ── Custom Agent Instructions ────────────────────────────────────────────────

const CUSTOM_AGENT_INSTRUCTIONS = `YOUR ROLE IN THE SWARM:
- You are a specialist analyst. Your unique analytical perspective is described above.
- Focus your research through this lens. Every finding should reflect your perspective.
- When reacting to other agents' findings: evaluate how their evidence relates to your area of expertise.
- When creating theses: propose theses from your unique perspective using evidence from 2+ agents.
- When voting on theses: challenge theses that overlook your area of expertise, support those that align with your analysis. Aim for a balanced challenge rate.
- When creating connections: look for how findings from other agents intersect with your domain of expertise.`;

// ── Build Agent Configs ────────────────────────────────────────────────────

/**
 * Build full AgentConfig[] from selected agent IDs + optional custom agent definitions.
 * @param selectedIds Agent IDs to include (built-in + custom). Min 2.
 * @param model Gemini model name.
 * @param maxTurnsPerRound Max LLM turns per round.
 * @param customAgents Optional custom agent definitions (already normalized).
 */
export function buildAgentConfigs(
	selectedIds: string[],
	model: string,
	maxTurnsPerRound: number,
	customAgents?: CustomAgentDefinition[],
): AgentConfig[] {
	// Build a combined definition map: built-in + custom
	const combinedMap = new Map(AGENT_DEFINITION_MAP);
	if (customAgents) {
		for (const ca of customAgents) {
			combinedMap.set(ca.id, customToAgentDefinition(ca));
		}
	}

	const valid = selectedIds.filter((id) => combinedMap.has(id));
	if (valid.length < 2) {
		throw new Error(`At least 2 agents required, got ${valid.length} valid IDs: [${valid.join(', ')}]`);
	}

	const currentDate = new Date().toISOString().split('T')[0];

	return valid.map((id) => {
		const def = combinedMap.get(id);
		if (!def) throw new Error(`Unknown agent ID: ${id}`);

		const isBuiltin = BUILTIN_AGENT_IDS.has(id);
		const roleBullets = isBuiltin ? (ROLE_BULLETS[id] ?? `- Analyze ${def.description}`) : CUSTOM_AGENT_INSTRUCTIONS;

		const systemPrompt = AGENT_SYSTEM_PROMPT_TEMPLATE.replace('{LABEL}', def.label)
			.replace('{DESCRIPTION}', def.description)
			.replace('{AGENT_COUNT}', String(valid.length))
			.replace('{ROLE_BULLETS}', roleBullets)
			.replace('{CURRENT_DATE}', currentDate);

		return {
			id: def.id,
			model,
			systemPrompt,
			relevantTags: RELEVANT_TAGS[id] ?? [id, 'analysis', 'research'],
			maxTurnsPerRound,
			label: def.label,
			color: def.color,
			description: def.description,
			perspective: def.perspective,
		};
	});
}

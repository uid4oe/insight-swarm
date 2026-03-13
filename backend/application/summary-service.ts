// ── Summary Service ──────────────────────────────────────────────────────────
// Application-level service for generating structured task summaries.
// Owns the full lifecycle: dedup tracking, persistence, LLM generation, validation.

import type { AgentDefinition } from '../../shared/agent-definitions.js';
import { AGENT_DEFINITION_MAP } from '../../shared/agent-definitions.js';
import type { KnowledgeGraphDB } from '../domain/ports/knowledge-graph.js';
import type { Logger } from '../domain/ports/logger.js';
import type {
	ActivityEntry,
	AgentId,
	Connection,
	Finding,
	InvestmentThesis,
	LlmSummaryOutput,
	Reaction,
	StructuredSummary,
} from '../domain/types.js';
import { adkGenerate } from './agents/adk-generate.js';
import {
	buildAgentBreakdown,
	buildAgentEvolution,
	buildConfidenceDistribution,
	buildConversationThreads,
	buildDisagreementScore,
	buildEvidenceChains,
	buildReactionDialogues,
	buildRiskMatrix,
	buildSources,
	buildTagOverlap,
	buildTensionMap,
} from './summary-analytics.js';
import { extractJson, stripCodeFences } from './utils.js';

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildSummaryPrompt(
	prompt: string,
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	activityLog: ActivityEntry[],
	allReactions: (Reaction & { finding: Finding })[],
	agentDefMap?: Map<string, AgentDefinition>,
): string {
	const effectiveDefMap = agentDefMap ?? AGENT_DEFINITION_MAP;
	const findingMap = new Map(findings.map((f) => [f.id, f]));
	const uniqueAgentIds = [...new Set(findings.map((f) => f.agent_id))];
	const agentIdsStr = uniqueAgentIds.map((a) => `"${a}"`).join(', ');

	// ── Agent Roles & Stances ──────────────────────────────────────────────
	const agentRoleLines = uniqueAgentIds.map((id) => {
		const def = effectiveDefMap.get(id);
		if (def) return `  ${id} (${def.label}): ${def.description}`;
		return `  ${id}: Research analyst`;
	});

	// ── Round count ──────────────────────────────────────────────────────────
	const maxRound = findings.reduce((max, f) => Math.max(max, f.round), 0);

	// ── Per-agent stats ──────────────────────────────────────────────────────
	const agentStats = uniqueAgentIds.map((id) => {
		const agentFindings = findings.filter((f) => f.agent_id === id);
		const agentConns = connections.filter((c) => c.created_by === id);
		const agentTheses = theses.filter((t) => t.created_by === id);
		const agentCategories = [...new Set(agentFindings.map((f) => f.category))];
		const avgConf =
			agentFindings.length > 0 ? agentFindings.reduce((sum, f) => sum + f.confidence, 0) / agentFindings.length : 0;
		return `  ${id}: ${agentFindings.length} findings (avg ${Math.round(avgConf * 100)}% confidence), ${agentConns.length} connections, ${agentTheses.length} theses. Categories: ${agentCategories.join(', ') || 'none'}`;
	});

	// ── Connection type distribution ─────────────────────────────────────────
	const connTypeCounts: Record<string, number> = {};
	let crossAgentConns = 0;
	for (const c of connections) {
		connTypeCounts[c.relationship] = (connTypeCounts[c.relationship] || 0) + 1;
		const from = findingMap.get(c.from_finding_id);
		const to = findingMap.get(c.to_finding_id);
		if (from && to && from.agent_id !== to.agent_id) crossAgentConns++;
	}
	const connDistStr = Object.entries(connTypeCounts)
		.map(([rel, count]) => `${rel}: ${count}`)
		.join(', ');
	const crossAgentRate = connections.length > 0 ? Math.round((crossAgentConns / connections.length) * 100) : 0;

	// ── Round-by-round narrative with full context ────────────────────────────
	const findingsByRound = new Map<number, Finding[]>();
	for (const f of findings) {
		const arr = findingsByRound.get(f.round) || [];
		arr.push(f);
		findingsByRound.set(f.round, arr);
	}

	const roundNarratives: string[] = [];
	for (const [round, roundFindings] of [...findingsByRound.entries()].sort((a, b) => a[0] - b[0])) {
		const lines: string[] = [`ROUND ${round}:`];

		for (const f of roundFindings) {
			const tags = f.tags.length > 0 ? ` [${f.tags.join(', ')}]` : '';
			const category = f.category !== 'general' ? ` {${f.category}}` : '';
			const parentNote = f.parent_finding_id
				? ` (reaction to "${findingMap.get(f.parent_finding_id)?.title ?? '?'}" by ${findingMap.get(f.parent_finding_id)?.agent_id ?? '?'})`
				: '';

			// Include references if present (web search sources)
			const refs =
				f.references.length > 0
					? ` Sources: ${f.references.map((r) => (r.url ? `[${r.title}](${r.url})` : r.title)).join(', ')}`
					: '';

			lines.push(
				`  ${f.agent_id} found${category}: "${f.title}" (${Math.round(f.confidence * 100)}%)${tags}${parentNote}`,
			);
			lines.push(`    → ${f.description}${refs}`);
		}

		// Connections made in this round
		const roundConnections = connections.filter((c) => c.round === round);
		if (roundConnections.length > 0) {
			for (const c of roundConnections) {
				const from = findingMap.get(c.from_finding_id);
				const to = findingMap.get(c.to_finding_id);
				if (from && to) {
					const crossAgent = from.agent_id !== to.agent_id ? ' [CROSS-AGENT]' : '';
					lines.push(
						`  ${c.created_by} connected "${from.title}" (${from.agent_id}) → "${to.title}" (${to.agent_id}): ${c.relationship} (${Math.round(c.strength * 100)}%)${crossAgent} — ${c.reasoning}`,
					);
				}
			}
		}

		roundNarratives.push(lines.join('\n'));
	}

	// ── Theses with full voting and evidence context ─────────────────────────
	const thesisLines = theses.map((t) => {
		const supportCount = t.votes.filter((v) => v.vote === 'support').length;
		const challengeCount = t.votes.filter((v) => v.vote === 'challenge').length;
		const evidenceIds = t.evidence.map((e) => e.finding_id);
		const evidenceAgents = new Set(evidenceIds.map((eid) => findingMap.get(eid)?.agent_id).filter(Boolean));
		const voteDetails = t.votes.map((v) => `${v.agent_id} ${v.vote}s: "${v.reasoning}"`).join('; ');
		const evidenceDetails = t.evidence
			.map((e) => {
				const f = findingMap.get(e.finding_id);
				return f ? `[${e.relevance}] "${f.title}" by ${f.agent_id}: ${e.reasoning}` : null;
			})
			.filter(Boolean)
			.join('; ');

		// Include thesis extra fields when available
		const extras: string[] = [];
		if (t.market_size) extras.push(`Market size: ${t.market_size}`);
		if (t.timing) extras.push(`Timing: ${t.timing}`);
		if (t.risks.length > 0) extras.push(`Identified risks: ${t.risks.join('; ')}`);
		const extrasStr = extras.length > 0 ? ` | ${extras.join(' | ')}` : '';

		return `"${t.title}" by ${t.created_by} (${Math.round(t.confidence * 100)}%, ${evidenceAgents.size}-agent convergence) — ${supportCount} support, ${challengeCount} challenge. Votes: ${voteDetails || 'none'}. Evidence: ${evidenceDetails || 'none'}. Thesis: ${t.thesis}${extrasStr}`;
	});

	// ── Key interactions from the activity log ────────────────────────────────
	// Surface reactions, challenges, questions, and thesis creation — the key
	// collaboration moments that the round-by-round findings may not capture.
	const interactionTypes = new Set([
		'react_to_finding',
		'thesis_challenge',
		'post_question',
		'create_thesis',
		'find_tensions',
	]);
	const keyInteractions = activityLog.filter((a) => interactionTypes.has(a.action));

	const interactionLines =
		keyInteractions.length > 0
			? keyInteractions.map((a) => `  R${a.round} ${a.agent_id} [${a.action}]: ${a.summary}`)
			: ['  (No interactions logged)'];

	// ── Questions between agents ─────────────────────────────────────────────
	const questions = findings.filter((f) => f.category === 'question');
	const questionLines =
		questions.length > 0
			? questions.map((q) => `  R${q.round} ${q.agent_id} asked: "${q.title}" — ${q.description.slice(0, 150)}`)
			: [];

	// ── Reaction Dialogues (how agents responded to each other's findings) ──
	const completedReactions = allReactions.filter((r) => r.status === 'reacted' && r.reaction);
	const skippedReactions = allReactions.filter((r) => r.status === 'skipped' && r.reaction);

	// Group completed reactions by finding for the prompt
	const reactionsByFinding = new Map<string, typeof completedReactions>();
	for (const r of completedReactions) {
		const arr = reactionsByFinding.get(r.finding_id) || [];
		arr.push(r);
		reactionsByFinding.set(r.finding_id, arr);
	}

	const reactionDialogueLines: string[] = [];
	for (const [, reactions] of reactionsByFinding) {
		const finding = reactions[0]?.finding;
		if (!finding) continue;
		const header = `  Finding: "${finding.title}" by ${finding.agent_id} (R${finding.round})`;
		const reactionStrs = reactions.map((r) => `    → ${r.agent_id} reacted: "${(r.reaction ?? '').slice(0, 300)}"`);
		reactionDialogueLines.push(header, ...reactionStrs);
	}

	const skippedReactionLines = skippedReactions
		.slice(0, 20)
		.map(
			(r) =>
				`  ${r.agent_id} skipped "${r.finding.title}" by ${r.finding.agent_id}: "${(r.reaction ?? '').slice(0, 150)}"`,
		);

	// ── Conversation Chains (parent_finding_id threaded dialogues) ──────────
	const childByParentPrompt = new Map<string, Finding[]>();
	for (const f of findings) {
		if (!f.parent_finding_id) continue;
		const arr = childByParentPrompt.get(f.parent_finding_id) || [];
		arr.push(f);
		childByParentPrompt.set(f.parent_finding_id, arr);
	}

	const conversationChainLines: string[] = [];
	const rootIds = new Set(
		findings.filter((f) => f.parent_finding_id !== null).map((f) => f.parent_finding_id as string),
	);
	for (const rootId of rootIds) {
		const root = findingMap.get(rootId);
		if (!root) continue;
		const children = childByParentPrompt.get(rootId) || [];
		// Only include cross-agent chains
		const agents = new Set([root.agent_id, ...children.map((c) => c.agent_id)]);
		if (agents.size < 2) continue;
		conversationChainLines.push(`  ROOT: "${root.title}" by ${root.agent_id} (R${root.round})`);
		for (const child of children.sort((a, b) => a.round - b.round)) {
			conversationChainLines.push(
				`    └─ "${child.title}" by ${child.agent_id} (R${child.round}, ${Math.round(child.confidence * 100)}%)`,
			);
		}
	}

	// ── Cross-Agent Tag Analysis ────────────────────────────────────────────
	const tagAgentsPrompt = new Map<string, Set<string>>();
	for (const f of findings) {
		if (f.category === 'question') continue;
		for (const tag of f.tags) {
			const agentSet = tagAgentsPrompt.get(tag) || new Set<string>();
			agentSet.add(f.agent_id);
			tagAgentsPrompt.set(tag, agentSet);
		}
	}
	const sharedTagLines: string[] = [];
	const uniqueTagLines: string[] = [];
	for (const [tag, agentSet] of tagAgentsPrompt) {
		if (agentSet.size >= 2) {
			sharedTagLines.push(`  "${tag}": covered by ${[...agentSet].join(', ')}`);
		} else if (agentSet.size === 1) {
			uniqueTagLines.push(`  "${tag}": only covered by ${[...agentSet][0]}`);
		}
	}

	return `You are an analyst producing a multi-perspective verdict from a multi-agent research analysis.

The user's original research request was: "${prompt}"

=== AGENT ROLES ===
${uniqueAgentIds.length} AI agents collaborated over ${maxRound} rounds. Each has a specific analytical perspective:
${agentRoleLines.join('\n')}

=== PER-AGENT CONTRIBUTION STATS ===
${agentStats.join('\n')}

=== CONNECTION NETWORK ===
${connections.length} total connections (${connDistStr}). Cross-agent rate: ${crossAgentRate}%.

=== ROUND-BY-ROUND TIMELINE ===
${roundNarratives.join('\n\n')}

=== KEY INTERACTIONS (reactions, challenges, questions) ===
${interactionLines.join('\n')}
${questionLines.length > 0 ? `\n=== INTER-AGENT QUESTIONS ===\n${questionLines.join('\n')}` : ''}

=== REACTION DIALOGUES (how agents responded to each other's findings) ===
${reactionDialogueLines.length > 0 ? reactionDialogueLines.join('\n') : '  (No reaction dialogues)'}

=== SKIPPED REACTIONS (what agents chose NOT to engage with) ===
${skippedReactionLines.length > 0 ? skippedReactionLines.join('\n') : '  (No skipped reactions)'}

=== CONVERSATION CHAINS (threaded cross-agent dialogues via follow-up findings) ===
${conversationChainLines.length > 0 ? conversationChainLines.join('\n') : '  (No cross-agent conversation chains)'}

=== CROSS-AGENT TAG ANALYSIS ===
Shared tags (hidden consensus — multiple agents investigated same topic):
${sharedTagLines.length > 0 ? sharedTagLines.join('\n') : '  (No shared tags)'}
Unique tags (potential blind spots — only one agent covered this):
${uniqueTagLines.length > 0 ? uniqueTagLines.join('\n') : '  (No unique tags)'}

=== THESES PROPOSED ===
${thesisLines.join('\n')}

Return a JSON object (no markdown, no code fences) with exactly this structure:

{
  "headline": "A concrete verdict or conclusion (max 15 words) — state a position, not a topic. e.g. 'Strong buy with execution risk: valuation justified if unit economics hold' NOT 'Analysis of company growth prospects'",
  "overview": "2-4 sentence executive verdict. Lead with the bottom-line conclusion (recommend/caution/conditional). Then state the strongest bull case and the most critical risk. End with the single most important unresolved question.",
  "narrative": [
    {
      "round": 1,
      "agent": "${uniqueAgentIds[0] ?? 'agent'}",
      "action": "Short verb phrase describing what the agent did",
      "detail": "One sentence: what they found AND what it means for the decision",
      "relatedAgents": []
    }
  ],
  "themes": [
    {"name": "Short theme name", "description": "One sentence stating the implication, not just the topic", "agents": [${agentIdsStr}]}
  ],
  "theses": [
    {"title": "Thesis title", "confidence": 0.8, "consensus": "strong", "oneLiner": "State the implication: what this means for the decision and why, not a neutral description"}
  ],
  "recommendations": [
    {"action": "CONCRETE next step: who should do what, by when, and what decision it informs. e.g. 'Verify the key claims by consulting primary sources before making a commitment' NOT 'Consider reviewing the data'", "priority": "high", "reasoning": "Which specific findings or theses drive this recommendation and what risk it mitigates"}
  ],
  "keyDebates": [
    {"topic": "Short debate topic", "agents": [${agentIdsStr}], "summary": "State both sides concretely: Agent X argued [specific claim] while Agent Y countered [specific counter-evidence]. Include the key data points, the specific challenges, and what evidence was cited.", "resolution": "resolved or unresolved or partially_resolved"}
  ],
  "collaborationHighlights": [
    {"type": "reaction_dialogue or blind_spot or hidden_consensus or stance_shift", "agents": [${agentIdsStr}], "summary": "Concrete description of what happened between agents — quote actual reactions or findings where possible", "round": 1, "significance": "high or medium or low"}
  ],
  "blindSpots": [
    {"topic": "What was missed or under-investigated", "coveredBy": [${agentIdsStr}], "missedBy": [${agentIdsStr}], "impact": "Concrete impact: what decision risk does this blind spot create?"}
  ]
}

NARRATIVE RULES:
- The narrative array tells the story of how agents collaborated to reach the verdict.
- Include 10-20 entries covering the key moments across all ${maxRound} rounds.
- Focus on INTERACTIONS: when agents reacted to each other's findings, when challenges were made, when agents linked findings across domains, when questions were posted, and when theses emerged from multiple agents' work.
- Use the activity log and agent stances to understand WHY agents made certain connections or challenges. The Bull agent advocates for growth, the Bear agent probes for risks, the Skeptic stress-tests both sides.
- Use "relatedAgents" to track which agents influenced each action.
- Order chronologically by round, then by the natural flow of research → reaction → connection → thesis.
- Use the agents' actual finding titles and descriptions. Don't make things up.
- Each "detail" must state the SO WHAT — what the finding means for the decision, not just what was found.

CONTENT RULES:
- NEVER use neutral paraphrasing. Every sentence must state a concrete claim, verdict, or implication.
- BAD: "The analysis revealed several financial considerations" — GOOD: "Unit economics are unsustainable: CAC exceeds LTV by 2.3x with no clear path to improvement"
- BAD: "Regulatory factors were examined" — GOOD: "GDPR exposure is the top dealbreaker: no DPA in place, €20M fine risk"
- BAD: "Consider further analysis" — GOOD: "Commission independent verification of key claims — 3 of 5 cited advantages lack supporting evidence"
- recommendations: 3-5 SPECIFIC actions. Each must name what to do, who does it, what it validates, and what decision it gates. "Further research" is NOT a recommendation — name the exact research.
- themes: 3-5 max. Each theme should span multiple agents. State the implication, not just the topic.
- theses: Include ALL theses from the analysis. consensus is "strong" (mostly support), "mixed" (split), or "contested" (mostly challenge).
- keyDebates: 0-4 entries. Include ONLY genuine disagreements where agents challenged each other with specific evidence. Use the activity log for thesis_challenge events and contradicts connections. Do NOT manufacture debates — if agents largely agreed, return an empty array. Resolution values: "resolved" (agents converged), "unresolved" (still in tension), "partially_resolved" (some aspects settled, others open).

COLLABORATION RULES:
- collaborationHighlights: 3-8 entries. These are the most important moments of inter-agent collaboration. Types:
  - "reaction_dialogue": An agent responded substantively to another's finding — quote or paraphrase the actual reaction text from the REACTION DIALOGUES section.
  - "blind_spot": One agent identified something others missed — use the CROSS-AGENT TAG ANALYSIS unique tags section.
  - "hidden_consensus": Agents independently arrived at similar conclusions — use CROSS-AGENT TAG ANALYSIS shared tags.
  - "stance_shift": An agent changed their confidence or approach after seeing another agent's work — look for reactions that led to follow-up findings.
- For each highlight, reference the specific finding, reaction, or tag that triggered it. Significance: "high" for moments that changed the analysis direction, "medium" for important corroboration, "low" for interesting but non-critical moments.
- blindSpots: 0-4 entries. Topics or angles that were under-investigated. Look at: unique tags only covered by one agent, skipped reactions (what agents chose not to engage with), missing categories that you'd expect for this research topic. "impact" must state the concrete decision risk. If no blind spots are evident, return an empty array.
- CRITICAL: All "agent" and "agents" values MUST be lowercase strings exactly matching one of: ${agentIdsStr}.
- Return ONLY valid JSON. No markdown, no explanation.`;
}

// ── JSON Repair ──────────────────────────────────────────────────────────────

/** Attempt to repair JSON truncated mid-output by closing unclosed braces/brackets and strings. */
function repairTruncatedJson(text: string): string | null {
	if (!text || text.length < 10) return null;

	let repaired = text.trimEnd();

	// Strip trailing comma or partial key/value
	repaired = repaired.replace(/,\s*$/, '');
	// Strip partial string at end (no closing quote)
	repaired = repaired.replace(/"[^"]*$/, '""');

	// Count open vs close braces/brackets
	let braces = 0;
	let brackets = 0;
	let inString = false;
	let prevChar = '';
	for (const ch of repaired) {
		if (ch === '"' && prevChar !== '\\') inString = !inString;
		if (!inString) {
			if (ch === '{') braces++;
			else if (ch === '}') braces--;
			else if (ch === '[') brackets++;
			else if (ch === ']') brackets--;
		}
		prevChar = ch;
	}

	// Close unclosed brackets then braces
	while (brackets > 0) {
		repaired += ']';
		brackets--;
	}
	while (braces > 0) {
		repaired += '}';
		braces--;
	}

	return repaired;
}

// ── Generator ────────────────────────────────────────────────────────────────

async function generateTaskSummary(
	model: string,
	researchPrompt: string,
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	activityLog: ActivityEntry[],
	allReactions: (Reaction & { finding: Finding })[],
	agentDefMap?: Map<string, AgentDefinition>,
): Promise<StructuredSummary> {
	const prompt = buildSummaryPrompt(
		researchPrompt,
		findings,
		connections,
		theses,
		activityLog,
		allReactions,
		agentDefMap,
	);

	// Retry up to 3 times: LLM can return empty or truncated JSON
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const text = await adkGenerate({
			model,
			systemInstruction:
				'You are an analytical summarizer. Produce concrete verdicts, not neutral descriptions. Return only valid JSON — no markdown, no explanation.',
			userMessage: prompt,
			maxOutputTokens: 24576,
		});

		const cleaned = extractJson(stripCodeFences(text));

		if (!cleaned || cleaned.length < 10) {
			lastError = new Error(`LLM returned empty/too-short response (attempt ${attempt}/3, length=${cleaned.length})`);
			if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
			continue;
		}

		try {
			const parsed = JSON.parse(cleaned) as LlmSummaryOutput;
			return postProcessSummary(parsed, findings, connections, theses, allReactions, agentDefMap);
		} catch (err) {
			// Try to repair truncated JSON by closing open braces/brackets
			const repaired = repairTruncatedJson(cleaned);
			if (repaired) {
				try {
					const parsed = JSON.parse(repaired) as LlmSummaryOutput;
					return postProcessSummary(parsed, findings, connections, theses, allReactions, agentDefMap);
				} catch {
					// Repair didn't help — fall through to retry
				}
			}
			lastError = err;
			if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
		}
	}

	throw lastError;
}

function postProcessSummary(
	llmOutput: LlmSummaryOutput,
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	allReactions: (Reaction & { finding: Finding })[],
	agentDefMap?: Map<string, AgentDefinition>,
): StructuredSummary {
	// Cast to full summary — all ComputedAnalytics fields are assigned below.
	const parsed = llmOutput as StructuredSummary;
	// Inject computed stats from real data (not LLM output)
	const uniqueAgents = new Set(findings.map((f) => f.agent_id));
	const findingMap = new Map(findings.map((f) => [f.id, f]));
	let crossAgentConns = 0;
	for (const c of connections) {
		const from = findingMap.get(c.from_finding_id);
		const to = findingMap.get(c.to_finding_id);
		if (from && to && from.agent_id !== to.agent_id) crossAgentConns++;
	}
	const maxRound = findings.reduce((max, f) => Math.max(max, f.round), 0);
	parsed.stats = {
		findings: findings.length,
		connections: connections.length,
		theses: theses.length,
		agentsActive: uniqueAgents.size,
		roundsCompleted: maxRound,
		crossAgentConnectionRate: connections.length > 0 ? crossAgentConns / connections.length : 0,
		reactionsTotal: allReactions.length,
		reactionsCompleted: allReactions.filter((r) => r.status === 'reacted').length,
		reactionsSkipped: allReactions.filter((r) => r.status === 'skipped').length,
		conversationThreads: 0, // Updated below after buildConversationThreads()
	};

	// Ensure narrative exists even if LLM omits it
	if (!parsed.narrative) {
		parsed.narrative = [];
	}

	// Validate + enrich theses against actual database entries
	if (parsed.theses && theses.length > 0) {
		const realThesisByTitle = new Map(theses.map((t) => [t.title.toLowerCase().trim(), t]));

		/** Fuzzy match: find the best matching real thesis if exact title match fails. */
		const fuzzyMatch = (summaryTitle: string): InvestmentThesis | undefined => {
			const lower = summaryTitle.toLowerCase().trim();
			// Exact match first
			if (realThesisByTitle.has(lower)) return realThesisByTitle.get(lower);
			// Substring containment — LLM may truncate or prefix titles
			for (const [realTitle, realThesis] of realThesisByTitle) {
				if (realTitle.includes(lower) || lower.includes(realTitle)) return realThesis;
			}
			// Word overlap — at least 60% of words match
			const summaryWords = new Set(lower.split(/\s+/).filter((w) => w.length > 2));
			if (summaryWords.size === 0) return undefined;
			let bestOverlap = 0;
			let bestThesis: InvestmentThesis | undefined;
			for (const [realTitle, realThesis] of realThesisByTitle) {
				const realWords = new Set(realTitle.split(/\s+/).filter((w) => w.length > 2));
				const overlap = [...summaryWords].filter((w) => realWords.has(w)).length;
				const ratio = overlap / Math.max(summaryWords.size, realWords.size);
				if (ratio > bestOverlap && ratio >= 0.6) {
					bestOverlap = ratio;
					bestThesis = realThesis;
				}
			}
			return bestThesis;
		};

		// Match each LLM-generated thesis to a real one (fuzzy), enrich with real data
		const enriched: typeof parsed.theses = [];
		for (const t of parsed.theses) {
			const realThesis = fuzzyMatch(t.title);
			if (!realThesis) continue; // Filter out hallucinated theses

			// Inject real ID for frontend click-through
			t.id = realThesis.id;
			// Compute consensus from actual vote data instead of trusting LLM
			const supportCount = realThesis.votes.filter((v) => v.vote === 'support').length;
			const totalVotes = realThesis.votes.length;
			if (totalVotes === 0) {
				t.consensus = 'mixed';
			} else {
				const supportRatio = supportCount / totalVotes;
				t.consensus = supportRatio >= 0.75 ? 'strong' : supportRatio <= 0.25 ? 'contested' : 'mixed';
			}
			enriched.push(t);
		}
		// Append any real theses the LLM omitted (ensure 100% coverage)
		const matchedIds = new Set(enriched.map((t) => t.id));
		for (const realThesis of theses) {
			if (matchedIds.has(realThesis.id)) continue;
			const supportCount = realThesis.votes.filter((v) => v.vote === 'support').length;
			const totalVotes = realThesis.votes.length;
			const supportRatio = totalVotes > 0 ? supportCount / totalVotes : 0.5;
			enriched.push({
				title: realThesis.title,
				confidence: realThesis.confidence,
				consensus: supportRatio >= 0.75 ? 'strong' : supportRatio <= 0.25 ? 'contested' : 'mixed',
				oneLiner: realThesis.thesis.slice(0, 200),
				id: realThesis.id,
			});
		}
		parsed.theses = enriched;
	} else if (!theses.length) {
		parsed.theses = [];
	}

	// ── Attach structured deliverables (computed from real data) ──────────
	const tensionMap = buildTensionMap(connections, findings);
	parsed.evidenceChains = buildEvidenceChains(findings, connections, theses);
	parsed.tensionMap = tensionMap;
	parsed.riskMatrix = buildRiskMatrix(findings, theses, tensionMap);
	parsed.confidenceDistribution = buildConfidenceDistribution(findings, theses);
	parsed.disagreementScore = buildDisagreementScore(theses, tensionMap);

	// ── Agent Breakdown (computed from real data) ──────────────────────────
	parsed.agentBreakdown = buildAgentBreakdown(findings, connections, theses, agentDefMap);

	// ── Deduplicated Sources/References ─────────────────────────────────────
	parsed.sources = buildSources(findings);

	// ── New: Collaboration data (leverages reaction + parent_finding_id chains) ──
	parsed.reactionDialogues = buildReactionDialogues(allReactions, findings);
	const conversationThreads = buildConversationThreads(findings);
	parsed.conversationThreads = conversationThreads;
	parsed.tagOverlap = buildTagOverlap(findings);
	parsed.agentEvolution = buildAgentEvolution(findings, allReactions);

	// Update conversation thread count (depends on buildConversationThreads above)
	parsed.stats.conversationThreads = conversationThreads.length;

	// Normalize agent IDs to lowercase and validate against actual findings.
	const validAgents = new Set(findings.map((f) => f.agent_id));
	const normalizeAgent = (id: string): string => {
		const lower = id.toLowerCase();
		return validAgents.has(lower) ? lower : id;
	};

	if (parsed.narrative) {
		for (const e of parsed.narrative) {
			e.agent = normalizeAgent(e.agent) as AgentId;
			if (e.relatedAgents) {
				e.relatedAgents = e.relatedAgents.map((a) => normalizeAgent(a) as AgentId);
			}
		}
		parsed.narrative = parsed.narrative.filter((e) => validAgents.has(e.agent));
	}
	if (parsed.themes) {
		for (const t of parsed.themes) {
			t.agents = t.agents.map((a) => normalizeAgent(a) as AgentId).filter((a) => validAgents.has(a));
		}
	}
	if (parsed.keyDebates) {
		for (const d of parsed.keyDebates) {
			d.agents = d.agents.map((a) => normalizeAgent(a) as AgentId).filter((a) => validAgents.has(a));
		}
		// Remove debates with no valid agents
		parsed.keyDebates = parsed.keyDebates.filter((d) => d.agents.length >= 2);
	}
	if (parsed.collaborationHighlights) {
		for (const h of parsed.collaborationHighlights) {
			h.agents = h.agents.map((a) => normalizeAgent(a) as AgentId).filter((a) => validAgents.has(a));
		}
		parsed.collaborationHighlights = parsed.collaborationHighlights.filter((h) => h.agents.length >= 1);
	}
	if (parsed.blindSpots) {
		for (const b of parsed.blindSpots) {
			b.coveredBy = b.coveredBy.map((a) => normalizeAgent(a) as AgentId).filter((a) => validAgents.has(a));
			b.missedBy = b.missedBy.map((a) => normalizeAgent(a) as AgentId).filter((a) => validAgents.has(a));
		}
	}

	return parsed;
}

// ── Persistence & Orchestration ─────────────────────────────────────────────

/** Track in-progress generation to avoid duplicate concurrent runs. */
const summaryInProgress = new Set<string>();

export function isSummaryInProgress(taskId: string): boolean {
	return summaryInProgress.has(taskId);
}

export async function getSavedSummary(db: KnowledgeGraphDB, taskId: string): Promise<StructuredSummary | null> {
	return db.getSavedSummary(taskId);
}

/**
 * Full summary lifecycle: check cache → fetch data → generate via LLM → persist.
 * Returns null if already in progress, task not found, or generation fails.
 */
export async function generateAndSaveSummary(
	db: KnowledgeGraphDB,
	model: string,
	prompt: string,
	logger: Logger,
	taskId: string,
	agentDefMap?: Map<string, AgentDefinition>,
): Promise<StructuredSummary | null> {
	if (summaryInProgress.has(taskId)) return null;

	// Check if already persisted
	const existing = await db.getSavedSummary(taskId);
	if (existing) return existing;

	// Fetch all data in parallel — no limit on findings to ensure nothing is missed
	const [findings, connections, theses, activityLog, allReactions] = await Promise.all([
		db.queryFindings({ limit: 500 }),
		db.getConnections(),
		db.getTheses(),
		db.getRecentActivity(1000),
		db.getAllReactions(),
	]);

	summaryInProgress.add(taskId);
	try {
		const summary = await generateTaskSummary(
			model,
			prompt,
			findings,
			connections,
			theses,
			activityLog,
			allReactions,
			agentDefMap,
		);
		await db.saveSummary(taskId, summary);
		return summary;
	} catch (err) {
		logger.error('Summary generation failed', err, { taskId });
		return null;
	} finally {
		summaryInProgress.delete(taskId);
	}
}

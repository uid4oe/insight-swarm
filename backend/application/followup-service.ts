// ── Follow-up Service ────────────────────────────────────────────────────────
// Answers user follow-up questions against a completed task's knowledge graph.
// Single LLM call — no agents, no tools — just RAG over existing findings/connections/theses.

import type { KnowledgeGraphDB } from '../domain/ports/knowledge-graph.js';
import type { Connection, Finding, InvestmentThesis, StructuredSummary } from '../domain/types.js';
import { adkGenerate } from './agents/adk-generate.js';

function buildFollowupPrompt(
	question: string,
	researchPrompt: string,
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	summary: StructuredSummary | null,
): string {
	const findingMap = new Map(findings.map((f) => [f.id, f]));

	// Findings context
	const findingsText = findings
		.map((f) => {
			const refs =
				f.references.length > 0
					? ` | Refs: ${f.references.map((r) => (r.url ? `${r.title} (${r.url})` : r.title)).join('; ')}`
					: '';
			return `[${f.agent_id}, R${f.round}] "${f.title}" (${Math.round(f.confidence * 100)}%, tags: ${f.tags.join(', ')})\n  ${f.description}${refs}`;
		})
		.join('\n\n');

	// Connections context
	const connectionsText = connections
		.map((c) => {
			const from = findingMap.get(c.from_finding_id);
			const to = findingMap.get(c.to_finding_id);
			if (!from || !to) return null;
			return `${from.agent_id}:"${from.title}" --${c.relationship}(${c.strength})--> ${to.agent_id}:"${to.title}" — ${c.reasoning}`;
		})
		.filter(Boolean)
		.join('\n');

	// Theses context
	const thesesText = theses
		.map((t) => {
			const votes = t.votes.map((v) => `${v.agent_id}: ${v.vote} ("${v.reasoning}")`).join('; ');
			const evidence = t.evidence
				.map((e) => {
					const f = findingMap.get(e.finding_id);
					return f ? `"${f.title}" by ${f.agent_id} (${e.relevance})` : null;
				})
				.filter(Boolean)
				.join('; ');
			return `"${t.title}" by ${t.created_by} (${Math.round(t.confidence * 100)}%)\n  Thesis: ${t.thesis}\n  Evidence: ${evidence}\n  Votes: ${votes || 'none'}\n  Risks: ${t.risks.join('; ') || 'none'}`;
		})
		.join('\n\n');

	// Summary context (if available)
	const summaryText = summary
		? `Headline: ${summary.headline}\nOverview: ${summary.overview}\nRecommendations: ${summary.recommendations.map((r) => `[${r.priority}] ${r.action}`).join('; ')}`
		: '';

	return `You are an analyst answering a follow-up question about a completed multi-agent analysis.

The original research request was: "${researchPrompt}"

The user's question: "${question}"

=== ANALYSIS SUMMARY ===
${summaryText || '(No summary available)'}

=== FINDINGS (${findings.length}) ===
${findingsText || '(none)'}

=== CONNECTIONS (${connections.length}) ===
${connectionsText || '(none)'}

=== THESES (${theses.length}) ===
${thesesText || '(none)'}

ANSWER RULES:
- Answer based ONLY on the research data above. Reference specific findings, agents, and theses by name.
- Lead with a direct answer — state your conclusion first, then support it with evidence.
- Be concrete: cite specific data points, agent names, confidence levels, and vote tallies. Avoid vague generalities like "several factors were considered".
- When agents disagreed, surface both sides with their specific claims and evidence.
- If the data doesn't contain enough to fully answer, say so clearly and state what specific information is missing.
- Keep your answer focused (2-4 paragraphs). Use markdown formatting.`;
}

export async function answerFollowup(
	db: KnowledgeGraphDB,
	model: string,
	taskId: string,
	question: string,
	researchPrompt: string,
): Promise<string> {
	const [findings, connections, theses, summary] = await Promise.all([
		db.queryFindings({ limit: 200 }),
		db.getConnections(),
		db.getTheses(),
		db.getSavedSummary(taskId),
	]);

	const prompt = buildFollowupPrompt(question, researchPrompt, findings, connections, theses, summary);

	const answer = await adkGenerate({
		model,
		systemInstruction:
			'You are an analyst answering follow-up questions. Lead with concrete conclusions, cite specific findings and agents, and surface disagreements between agents. Never paraphrase neutrally — state verdicts.',
		userMessage: prompt,
		maxOutputTokens: 4096,
	});

	return answer;
}

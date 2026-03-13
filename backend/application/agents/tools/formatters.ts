// ── Tool Output Formatters ──────────────────────────────────────────────────
// Human-readable formatters for knowledge graph entities returned by tools.

import type { Finding } from '../../../domain/types.js';

export function formatFinding(f: Finding): string {
	const refLines =
		f.references.length > 0
			? f.references
					.map((r) => `    - ${r.title}${r.url ? ` (${r.url})` : ''}${r.snippet ? ` — ${r.snippet}` : ''}`)
					.join('\n')
			: null;
	return [
		`  [${f.id}]`,
		`  Agent: ${f.agent_id} | Round: ${f.round} | Category: ${f.category}`,
		`  Title: ${f.title}`,
		`  ${f.description}`,
		`  Confidence: ${(f.confidence * 100).toFixed(0)}% | Tags: ${f.tags.join(', ') || '(none)'}`,
		refLines ? `  References:\n${refLines}` : null,
		f.parent_finding_id ? `  Parent: ${f.parent_finding_id}` : null,
	]
		.filter(Boolean)
		.join('\n');
}

export function formatConnection(c: {
	id: string;
	from_finding_id: string;
	to_finding_id: string;
	relationship: string;
	strength: number;
	created_by: string;
	round: number;
	reasoning: string;
}): string {
	return [
		`  [${c.id}]`,
		`  ${c.from_finding_id} --${c.relationship}--> ${c.to_finding_id}`,
		`  Strength: ${(c.strength * 100).toFixed(0)}% | By: ${c.created_by} | Round: ${c.round}`,
		`  Reasoning: ${c.reasoning}`,
	].join('\n');
}

export function formatThesis(o: {
	id: string;
	title: string;
	status: string;
	confidence: number;
	created_by: string;
	thesis: string;
	evidence: Array<{ finding_id: string; relevance: string; reasoning: string }>;
	market_size?: string | null;
	timing?: string | null;
	risks: string[];
	votes: Array<{ agent_id: string; vote: string; reasoning: string }>;
}): string {
	const votesSummary =
		o.votes.length > 0 ? o.votes.map((v) => `${v.agent_id}: ${v.vote} - ${v.reasoning}`).join('; ') : 'No votes yet';
	const evidenceLines = o.evidence.map((e) => `    - [${e.finding_id}] (${e.relevance}) ${e.reasoning}`).join('\n');
	return [
		`  [${o.id}] ${o.title}`,
		`  Status: ${o.status} | Confidence: ${(o.confidence * 100).toFixed(0)}% | By: ${o.created_by}`,
		`  Thesis: ${o.thesis}`,
		`  Evidence (${o.evidence.length} finding(s)):`,
		evidenceLines,
		o.market_size ? `  Market Size: ${o.market_size}` : null,
		o.timing ? `  Timing: ${o.timing}` : null,
		o.risks.length > 0 ? `  Risks: ${o.risks.join(', ')}` : null,
		`  Votes: ${votesSummary}`,
	]
		.filter(Boolean)
		.join('\n');
}

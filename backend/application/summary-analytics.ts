// ── Summary Analytics ────────────────────────────────────────────────────────
// Pure functions that compute structured deliverables from raw swarm data.
// No LLM calls — these are deterministic transformations of findings,
// connections, theses, and reactions into display-ready analytics.

import type { AgentDefinition } from '../../shared/agent-definitions.js';
import { AGENT_DEFINITION_MAP } from '../../shared/agent-definitions.js';
import type {
	AgentBreakdown,
	AgentEvolution,
	AgentId,
	ConfidenceDistribution,
	Connection,
	ConversationThread,
	EvidenceChain,
	Finding,
	InvestmentThesis,
	Reaction,
	ReactionDialogue,
	RiskEntry,
	StructuredSummary,
	TagOverlap,
	TensionEntry,
} from '../domain/types.js';

// ── Evidence Chains ─────────────────────────────────────────────────────────

/** Build evidence chain for each thesis — how findings led to synthesis. */
export function buildEvidenceChains(
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
): EvidenceChain[] {
	const findingMap = new Map(findings.map((f) => [f.id, f]));
	const connectionsByFinding = new Map<string, Connection[]>();
	for (const c of connections) {
		const arr = connectionsByFinding.get(c.from_finding_id) ?? [];
		arr.push(c);
		connectionsByFinding.set(c.from_finding_id, arr);
	}

	return theses.map((thesis) => {
		const supportCount = thesis.votes.filter((v) => v.vote === 'support').length;
		const totalVotes = thesis.votes.length;
		const supportRatio = totalVotes > 0 ? supportCount / totalVotes : 0.5;
		const consensus: 'strong' | 'mixed' | 'contested' =
			supportRatio >= 0.75 ? 'strong' : supportRatio <= 0.25 ? 'contested' : 'mixed';

		const chain = thesis.evidence.map((e) => {
			const finding = findingMap.get(e.finding_id);
			const outgoingConnections = connectionsByFinding.get(e.finding_id) ?? [];
			const relevantConn = outgoingConnections.find((c) =>
				thesis.evidence.some((ev) => ev.finding_id === c.to_finding_id),
			);

			return {
				findingId: e.finding_id,
				findingTitle: finding?.title ?? 'Unknown',
				agent: (finding?.agent_id ?? 'unknown') as AgentId,
				role: e.relevance as 'primary' | 'supporting' | 'contextual',
				confidence: finding?.confidence ?? 0,
				...(relevantConn
					? {
							connectionTo: {
								targetFindingId: relevantConn.to_finding_id,
								relationship: relevantConn.relationship,
								strength: relevantConn.strength,
							},
						}
					: {}),
			};
		});

		const challengeVotes = thesis.votes
			.filter((v) => v.vote === 'challenge')
			.map((v) => ({
				agent: v.agent_id as AgentId,
				reasoning: v.reasoning,
			}));

		return {
			thesisId: thesis.id,
			thesisTitle: thesis.title,
			confidence: thesis.confidence,
			consensus,
			chain,
			challengeVotes,
		};
	});
}

// ── Tension Map ─────────────────────────────────────────────────────────────

/** Find tensions — contradicts or cross-agent disagreements. */
export function buildTensionMap(connections: Connection[], findings: Finding[]): TensionEntry[] {
	const findingMap = new Map(findings.map((f) => [f.id, f]));
	const tensions: TensionEntry[] = [];

	for (const c of connections) {
		if (c.relationship !== 'contradicts') continue;
		const fromFinding = findingMap.get(c.from_finding_id);
		const toFinding = findingMap.get(c.to_finding_id);
		if (!fromFinding || !toFinding) continue;
		if (fromFinding.agent_id === toFinding.agent_id) continue;

		tensions.push({
			id: c.id,
			findingA: {
				id: fromFinding.id,
				title: fromFinding.title,
				agent: fromFinding.agent_id as AgentId,
				confidence: fromFinding.confidence,
			},
			findingB: {
				id: toFinding.id,
				title: toFinding.title,
				agent: toFinding.agent_id as AgentId,
				confidence: toFinding.confidence,
			},
			relationship: 'contradicts',
			reasoning: c.reasoning,
		});
	}

	return tensions;
}

// ── Risk Matrix ─────────────────────────────────────────────────────────────

/** Build risk matrix from challenge votes, low-confidence findings, and unresolved tensions. */
export function buildRiskMatrix(
	findings: Finding[],
	theses: InvestmentThesis[],
	tensions: TensionEntry[],
): RiskEntry[] {
	const risks: RiskEntry[] = [];

	for (const thesis of theses) {
		const challenges = thesis.votes.filter((v) => v.vote === 'challenge');
		if (challenges.length === 0) continue;
		const totalVotes = thesis.votes.length;
		const challengeRatio = challenges.length / totalVotes;
		const severity = challengeRatio > 0.5 ? 'high' : challengeRatio > 0.25 ? 'medium' : 'low';

		risks.push({
			title: `Contested: ${thesis.title}`,
			severity,
			source: 'challenge_vote',
			description: challenges.map((v) => `${v.agent_id}: ${v.reasoning}`).join('; '),
			relatedThesisId: thesis.id,
			relatedFindingIds: thesis.evidence.map((e) => e.finding_id),
		});
	}

	for (const t of tensions) {
		if (t.resolution) continue;
		risks.push({
			title: `Tension: ${t.findingA.title} vs ${t.findingB.title}`,
			severity: 'medium',
			source: 'unresolved_tension',
			description: t.reasoning,
			relatedFindingIds: [t.findingA.id, t.findingB.id],
		});
	}

	const primaryEvidenceIds = new Set<string>();
	for (const thesis of theses) {
		for (const e of thesis.evidence) {
			if (e.relevance === 'primary') primaryEvidenceIds.add(e.finding_id);
		}
	}
	for (const f of findings) {
		if (primaryEvidenceIds.has(f.id) && f.confidence < 0.5) {
			risks.push({
				title: `Weak primary evidence: ${f.title}`,
				severity: f.confidence < 0.3 ? 'high' : 'medium',
				source: 'low_confidence',
				description: `Finding used as primary evidence has only ${Math.round(f.confidence * 100)}% confidence`,
				relatedFindingIds: [f.id],
			});
		}
	}

	return risks.sort((a, b) => {
		const order = { high: 0, medium: 1, low: 2 };
		return order[a.severity] - order[b.severity];
	});
}

// ── Confidence Distribution ─────────────────────────────────────────────────

/** Compute confidence distribution and agreement metrics. */
export function buildConfidenceDistribution(findings: Finding[], theses: InvestmentThesis[]): ConfidenceDistribution {
	const high = findings.filter((f) => f.confidence >= 0.7).length;
	const medium = findings.filter((f) => f.confidence >= 0.4 && f.confidence < 0.7).length;
	const low = findings.filter((f) => f.confidence < 0.4).length;
	const averageConfidence =
		findings.length > 0 ? findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length : 0;

	let agreementSum = 0;
	let votedCount = 0;
	for (const thesis of theses) {
		if (thesis.votes.length === 0) continue;
		const supportRatio = thesis.votes.filter((v) => v.vote === 'support').length / thesis.votes.length;
		agreementSum += supportRatio;
		votedCount++;
	}
	const agentAgreement = votedCount > 0 ? agreementSum / votedCount : 0;

	return { high, medium, low, averageConfidence, agentAgreement };
}

// ── Disagreement Score ──────────────────────────────────────────────────────

/** Compute disagreement metrics for a task. */
export function buildDisagreementScore(
	theses: InvestmentThesis[],
	tensions: TensionEntry[],
): StructuredSummary['disagreementScore'] {
	const totalVotes = theses.reduce((sum, t) => sum + t.votes.length, 0);
	const challengeVotes = theses.reduce((sum, t) => sum + t.votes.filter((v) => v.vote === 'challenge').length, 0);
	const challengeVoteRatio = totalVotes > 0 ? challengeVotes / totalVotes : 0;
	const unresolvedTensions = tensions.filter((t) => !t.resolution).length;

	return { challengeVoteRatio, tensionCount: tensions.length, unresolvedTensions };
}

// ── Agent Breakdown ─────────────────────────────────────────────────────────

/** Per-agent contribution breakdown. */
export function buildAgentBreakdown(
	findings: Finding[],
	connections: Connection[],
	theses: InvestmentThesis[],
	agentDefMap?: Map<string, AgentDefinition>,
): AgentBreakdown[] {
	const effectiveDefMap = agentDefMap ?? AGENT_DEFINITION_MAP;
	const agentIds = [...new Set(findings.map((f) => f.agent_id))];
	return agentIds.map((agentId) => {
		const agentFindings = findings.filter((f) => f.agent_id === agentId);
		const agentConns = connections.filter((c) => c.created_by === agentId);
		const agentTheses = theses.filter((t) => t.created_by === agentId);
		const categories = [...new Set(agentFindings.map((f) => f.category))];
		const avgConfidence =
			agentFindings.length > 0 ? agentFindings.reduce((sum, f) => sum + f.confidence, 0) / agentFindings.length : 0;

		let votesSupport = 0;
		let votesChallenge = 0;
		for (const t of theses) {
			for (const v of t.votes) {
				if (v.agent_id === agentId) {
					if (v.vote === 'support') votesSupport++;
					else votesChallenge++;
				}
			}
		}

		const def = effectiveDefMap.get(agentId);
		return {
			agentId,
			role: def ? def.label.toLowerCase() : 'unknown',
			findingsCount: agentFindings.length,
			connectionsCount: agentConns.length,
			thesesCreated: agentTheses.length,
			votesSupport,
			votesChallenge,
			avgConfidence,
			categories,
		};
	});
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** Deduplicate and aggregate references/sources from findings. */
export function buildSources(findings: Finding[]): Array<{ url: string; title: string; citedBy: AgentId[] }> {
	const urlMap = new Map<string, { title: string; citedBy: Set<string> }>();
	for (const f of findings) {
		for (const ref of f.references) {
			if (!ref.url) continue;
			const existing = urlMap.get(ref.url);
			if (existing) {
				existing.citedBy.add(f.agent_id);
			} else {
				urlMap.set(ref.url, { title: ref.title, citedBy: new Set([f.agent_id]) });
			}
		}
	}
	return [...urlMap.entries()].map(([url, { title, citedBy }]) => ({
		url,
		title,
		citedBy: [...citedBy],
	}));
}

// ── Reaction Dialogues ──────────────────────────────────────────────────────

/** Build reaction dialogues — shows how agents responded to each other's findings. */
export function buildReactionDialogues(
	allReactions: (Reaction & { finding: Finding })[],
	findings: Finding[],
): ReactionDialogue[] {
	const byFinding = new Map<string, (Reaction & { finding: Finding })[]>();
	for (const r of allReactions) {
		if (r.status === 'pending') continue;
		const arr = byFinding.get(r.finding_id) || [];
		arr.push(r);
		byFinding.set(r.finding_id, arr);
	}

	const childByParent = new Map<string, Finding>();
	for (const f of findings) {
		if (f.parent_finding_id) childByParent.set(`${f.parent_finding_id}:${f.agent_id}`, f);
	}

	const dialogues: ReactionDialogue[] = [];
	for (const [findingId, reactions] of byFinding) {
		const finding = reactions[0]?.finding;
		if (!finding) continue;

		dialogues.push({
			findingId,
			findingTitle: finding.title,
			findingAgent: finding.agent_id,
			round: finding.round,
			reactions: reactions.map((r) => {
				const followUp = childByParent.get(`${findingId}:${r.agent_id}`);
				return {
					agentId: r.agent_id,
					text: r.reaction ?? '',
					status: r.status as 'reacted' | 'skipped',
					...(followUp ? { followUpFindingId: followUp.id } : {}),
				};
			}),
		});
	}

	return dialogues.sort((a, b) => a.round - b.round);
}

// ── Conversation Threads ────────────────────────────────────────────────────

/** Build conversation threads from parent_finding_id chains. */
export function buildConversationThreads(findings: Finding[]): ConversationThread[] {
	const findingMap = new Map(findings.map((f) => [f.id, f]));
	const childrenOf = new Map<string, Finding[]>();
	for (const f of findings) {
		if (!f.parent_finding_id) continue;
		const arr = childrenOf.get(f.parent_finding_id) || [];
		arr.push(f);
		childrenOf.set(f.parent_finding_id, arr);
	}

	const rootIds = new Set(
		findings.filter((f) => f.parent_finding_id !== null).map((f) => f.parent_finding_id as string),
	);

	const threads: ConversationThread[] = [];
	for (const rootId of rootIds) {
		const root = findingMap.get(rootId);
		if (!root) continue;

		const replies: ConversationThread['replies'] = [];
		const agents = new Set<string>([root.agent_id]);
		const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

		while (queue.length > 0) {
			const item = queue.shift();
			if (!item) break;
			const children = childrenOf.get(item.id) || [];
			for (const child of children) {
				agents.add(child.agent_id);
				replies.push({
					findingId: child.id,
					title: child.title,
					agent: child.agent_id,
					round: child.round,
					confidence: child.confidence,
					depth: item.depth + 1,
				});
				queue.push({ id: child.id, depth: item.depth + 1 });
			}
		}

		if (agents.size >= 2 && replies.length > 0) {
			threads.push({
				rootFindingId: rootId,
				rootTitle: root.title,
				rootAgent: root.agent_id,
				round: root.round,
				replies,
				agentCount: agents.size,
			});
		}
	}

	return threads.sort((a, b) => a.round - b.round);
}

// ── Tag Overlap ─────────────────────────────────────────────────────────────

/** Build cross-agent tag analysis — shared tags (consensus) and unique tags (blind spots). */
export function buildTagOverlap(findings: Finding[]): TagOverlap {
	const tagAgents = new Map<string, Map<string, number>>();
	for (const f of findings) {
		if (f.category === 'question' || f.confidence === 0) continue;
		for (const tag of f.tags) {
			const agentMap = tagAgents.get(tag) || new Map<string, number>();
			agentMap.set(f.agent_id, (agentMap.get(f.agent_id) || 0) + 1);
			tagAgents.set(tag, agentMap);
		}
	}

	const sharedTags: TagOverlap['sharedTags'] = [];
	const blindSpotTags: TagOverlap['blindSpotTags'] = [];

	for (const [tag, agentMap] of tagAgents) {
		const agents = [...agentMap.keys()];
		const totalCount = [...agentMap.values()].reduce((a, b) => a + b, 0);

		if (agents.length >= 2) {
			sharedTags.push({ tag, agents, findingCount: totalCount });
		} else if (agents.length === 1 && totalCount >= 2) {
			blindSpotTags.push({ tag, agent: agents[0], findingCount: totalCount });
		}
	}

	sharedTags.sort((a, b) => b.agents.length - a.agents.length || b.findingCount - a.findingCount);
	blindSpotTags.sort((a, b) => b.findingCount - a.findingCount);

	return { sharedTags: sharedTags.slice(0, 20), blindSpotTags: blindSpotTags.slice(0, 10) };
}

// ── Stance Evolution ────────────────────────────────────────────────────────

/** Build per-agent evolution — how each agent's analysis evolved across rounds. */
export function buildAgentEvolution(
	findings: Finding[],
	allReactions: (Reaction & { finding: Finding })[],
): AgentEvolution[] {
	const agentIds = [...new Set(findings.map((f) => f.agent_id))];
	const maxRound = findings.reduce((max, f) => Math.max(max, f.round), 0);

	const reactionsGiven = new Map<string, number>();
	const reactionsReceived = new Map<string, number>();
	for (const r of allReactions) {
		if (r.status !== 'reacted') continue;
		const givenKey = `${r.agent_id}:${r.finding.round}`;
		reactionsGiven.set(givenKey, (reactionsGiven.get(givenKey) || 0) + 1);
		const receivedKey = `${r.finding.agent_id}:${r.finding.round}`;
		reactionsReceived.set(receivedKey, (reactionsReceived.get(receivedKey) || 0) + 1);
	}

	return agentIds.map((agentId) => {
		const rounds: AgentEvolution['rounds'] = [];

		for (let round = 1; round <= maxRound; round++) {
			const roundFindings = findings.filter((f) => f.agent_id === agentId && f.round === round && f.confidence > 0);
			if (roundFindings.length === 0) continue;

			const avgConf = roundFindings.reduce((s, f) => s + f.confidence, 0) / roundFindings.length;
			const categories = [...new Set(roundFindings.map((f) => f.category))];

			rounds.push({
				round,
				avgConfidence: avgConf,
				findingCount: roundFindings.length,
				topCategories: categories.slice(0, 3),
				reactionsGiven: reactionsGiven.get(`${agentId}:${round}`) ?? 0,
				reactionsReceived: reactionsReceived.get(`${agentId}:${round}`) ?? 0,
			});
		}

		let confidenceTrend: AgentEvolution['confidenceTrend'] = 'stable';
		if (rounds.length >= 2) {
			const first = rounds[0].avgConfidence;
			const last = rounds[rounds.length - 1].avgConfidence;
			const delta = last - first;
			if (delta > 0.1) confidenceTrend = 'increasing';
			else if (delta < -0.1) confidenceTrend = 'decreasing';
		}

		const firstCats = new Set(rounds[0]?.topCategories ?? []);
		const lastCats = new Set(rounds[rounds.length - 1]?.topCategories ?? []);
		const categoryShift = rounds.length >= 2 && [...lastCats].filter((c) => !firstCats.has(c)).length > 0;

		return { agentId, rounds, confidenceTrend, categoryShift };
	});
}

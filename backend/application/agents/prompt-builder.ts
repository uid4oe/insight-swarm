// ── Prompt Builder ──────────────────────────────────────────────────────────
// Constructs dynamic LLM prompts from the current knowledge graph state.
// Pure functions — no side effects, easy to test.

import type { AgentId, Finding } from '../../domain/types.js';
import { MAX_CONTEXT_CHARS, MIN_CHALLENGE_RATIO, TENSION_DEFICIT_THRESHOLD } from './constants.js';

// ── Types ─────────────────────────────────────────────────────────────────

type ConnectionSummary = {
	id: string;
	from_finding_id: string;
	to_finding_id: string;
	relationship: string;
	strength: number;
	reasoning: string;
	created_by: string;
	round: number;
};

type ThesisSummary = {
	id: string;
	title: string;
	confidence: number;
	created_by: string;
	votes: Array<{ agent_id: string; vote: string }>;
};

// ── Knowledge Context ─────────────────────────────────────────────────────

export function buildKnowledgeContext(
	findings: Finding[],
	semanticFindings: Finding[],
	connections: ConnectionSummary[],
	theses: ThesisSummary[],
): string {
	if (findings.length === 0) return '(No findings yet)';

	const parts: string[] = [];
	const byRound = new Map<number, Finding[]>();
	for (const f of findings) {
		const arr = byRound.get(f.round) || [];
		arr.push(f);
		byRound.set(f.round, arr);
	}

	// Show most recent rounds first (reversed), then re-sort for output.
	// This ensures that if we hit the limit, we keep the latest findings.
	const sortedRounds = [...byRound.entries()].sort((a, b) => b[0] - a[0]);
	let charBudget = MAX_CONTEXT_CHARS;
	const includedRounds: Array<[number, Finding[]]> = [];

	for (const [round, roundFindings] of sortedRounds) {
		const header = `\n--- Round ${round} Findings ---\n`;
		const lines = roundFindings.map(
			(f) =>
				`[${f.id}] ${f.agent_id}: "${f.title}" ` +
				`(confidence: ${f.confidence}, tags: ${f.tags.join(', ')})` +
				(f.parent_finding_id ? ` [reaction to ${f.parent_finding_id}]` : ''),
		);
		const sectionSize = header.length + lines.reduce((s, l) => s + l.length + 1, 0);
		if (charBudget - sectionSize < 0 && includedRounds.length > 0) {
			parts.unshift(`(${sortedRounds.length - includedRounds.length} earlier round(s) omitted for brevity)`);
			break;
		}
		charBudget -= sectionSize;
		includedRounds.push([round, roundFindings]);
	}

	// 1. Semantic Findings Section (Injecting highly relevant older findings)
	const includedFindingIds = new Set(includedRounds.flatMap(([_, rFindings]) => rFindings.map((f) => f.id)));
	// Only include semantic findings that aren't already in the recent chronological rounds
	const novelSemanticFindings = semanticFindings.filter((f) => !includedFindingIds.has(f.id));

	if (novelSemanticFindings.length > 0 && charBudget > 500) {
		parts.push(`\n--- Semantically Relevant Findings (from older rounds) ---`);
		for (const f of novelSemanticFindings) {
			const line =
				`[${f.id}] ${f.agent_id} (Round ${f.round}): "${f.title}" ` +
				`(confidence: ${f.confidence}, tags: ${f.tags.join(', ')})`;
			if (charBudget - line.length - 1 < 0) {
				parts.push(`  (...plus ${novelSemanticFindings.length - parts.length} more omitted)`);
				break;
			}
			parts.push(line);
			charBudget -= line.length + 1;
		}
	}

	// Output in chronological order
	for (const [round, roundFindings] of includedRounds.reverse()) {
		parts.push(`\n--- Round ${round} Findings ---`);
		for (const f of roundFindings) {
			parts.push(
				`[${f.id}] ${f.agent_id}: "${f.title}" ` +
					`(confidence: ${f.confidence}, tags: ${f.tags.join(', ')})` +
					(f.parent_finding_id ? ` [reaction to ${f.parent_finding_id}]` : ''),
			);
		}
	}

	if (connections.length > 0 && charBudget > 500) {
		const findingMap = new Map(findings.map((f) => [f.id, f]));
		const crossAgentIds = new Set<string>();
		const crossAgent = connections.filter((c) => {
			const fromAgent = findingMap.get(c.from_finding_id)?.agent_id;
			const toAgent = findingMap.get(c.to_finding_id)?.agent_id;
			const isCross = !!(fromAgent && toAgent && fromAgent !== toAgent);
			if (isCross) crossAgentIds.add(c.id);
			return isCross;
		});
		const sameAgent = connections.filter((c) => !crossAgentIds.has(c.id));

		// Show cross-agent connections first (they're more valuable)
		if (crossAgent.length > 0) {
			parts.push(`\n--- Cross-Agent Connections (${crossAgent.length}) ---`);
			for (const c of crossAgent) {
				const fromF = findingMap.get(c.from_finding_id);
				const toF = findingMap.get(c.to_finding_id);
				const line =
					`${fromF?.agent_id ?? '?'}: "${fromF?.title?.slice(0, 50) ?? '?'}" ` +
					`--${c.relationship}(${c.strength})--> ` +
					`${toF?.agent_id ?? '?'}: "${toF?.title?.slice(0, 50) ?? '?'}"`;
				charBudget -= line.length + 1;
				if (charBudget < 0) break;
				parts.push(line);
			}
		}
		if (sameAgent.length > 0 && charBudget > 200) {
			parts.push(`(${sameAgent.length} same-agent connection(s) also exist)`);
		}
	}

	if (theses.length > 0 && charBudget > 200) {
		parts.push('\n--- Theses ---');
		for (const t of theses) {
			const votesSummary = t.votes.map((v) => `${v.agent_id}: ${v.vote}`).join(', ') || 'no votes yet';
			parts.push(`[${t.id}] "${t.title}" (confidence: ${t.confidence}, by: ${t.created_by}, votes: ${votesSummary})`);
		}
	}

	return parts.join('\n');
}

// ── Dynamic Guidance ──────────────────────────────────────────────────────

type ToolUsageEntry = {
	agent_id: string;
	round: number;
	action: string;
	count: number;
};

export function buildDynamicPrompt(
	agentId: AgentId,
	allFindings: Finding[],
	allConnections: ConnectionSummary[],
	theses: ThesisSummary[],
	currentRound: number,
	maxRounds?: number,
	toolUsageStats?: ToolUsageEntry[],
): string {
	const totalFindings = allFindings.length;
	const myFindings = allFindings.filter((f) => f.agent_id === agentId).length;
	const othersFindings = totalFindings - myFindings;
	const uniqueAgentsWithFindings = new Set(allFindings.map((f) => f.agent_id));
	const agentCount = uniqueAgentsWithFindings.size || 1;
	const totalConnections = allConnections.length;
	const totalTheses = theses.length;
	const votedTheses = theses.filter((t) => t.votes.length > 0).length;
	const unvotedTheses = totalTheses - votedTheses;
	const notYetVotedByMe = theses.filter((t) => !t.votes.some((v) => v.agent_id === agentId)).length;

	const findingAgentMap = new Map(allFindings.map((f) => [f.id, f.agent_id]));
	let crossAgentConnections = 0;
	let contradictsConnections = 0;
	for (const c of allConnections) {
		const fromAgent = findingAgentMap.get(c.from_finding_id);
		const toAgent = findingAgentMap.get(c.to_finding_id);
		if (fromAgent && toAgent && fromAgent !== toAgent) crossAgentConnections++;
		if (c.relationship === 'contradicts') contradictsConnections++;
	}

	// ── Challenge ratio tracking (per-agent only) ───────────────────────
	let myTotalVotes = 0;
	let myChallengeVotes = 0;
	for (const t of theses) {
		for (const v of t.votes) {
			if (v.agent_id === agentId) {
				myTotalVotes++;
				if (v.vote === 'challenge') myChallengeVotes++;
			}
		}
	}
	const myChallengeRatio = myTotalVotes > 0 ? myChallengeVotes / myTotalVotes : 0;

	const effectiveMaxRounds = maxRounds ?? 6;
	const roundsRemaining = effectiveMaxRounds - currentRound;
	const isLateGame = roundsRemaining <= 1;

	// ── State-based maturity signals (emergent, not time-based) ──────────
	const isEarlyGraph = totalFindings < agentCount * 2;
	const isUnderConnected = totalFindings > 0 && totalConnections / totalFindings < 0.3;
	const needsTheses = totalTheses === 0 && crossAgentConnections >= 2;
	const isMature = totalTheses / agentCount >= 1;
	const contradictsRatio = totalConnections > 0 ? contradictsConnections / totalConnections : 0;
	const tensionDeficit = myFindings > 0 && totalConnections >= 3 && contradictsRatio < TENSION_DEFICIT_THRESHOLD;

	// Track per-agent thesis creation
	const myTheses = theses.filter((t) => t.created_by === agentId).length;
	const iHaveNotSynthesized = myTheses === 0 && myFindings >= 2 && crossAgentConnections >= 1;
	const needsMoreTheses = totalTheses > 0 && totalTheses < agentCount && crossAgentConnections >= 2;

	const lines: string[] = [];
	lines.push(`=== SITUATION ASSESSMENT (round ${currentRound}/${effectiveMaxRounds}) ===`);
	lines.push(
		`Findings: ${totalFindings} total (${myFindings} yours, ${othersFindings} from other agents across ${agentCount} agent(s))`,
	);
	lines.push(
		`Connections: ${totalConnections} (${crossAgentConnections} cross-agent, ${contradictsConnections} contradicts)`,
	);
	lines.push(
		`Theses: ${totalTheses} (${votedTheses} with votes, ${unvotedTheses} awaiting votes, ${notYetVotedByMe} you haven't voted on)`,
	);
	if (myTotalVotes > 0) {
		lines.push(
			`Challenge Rate: ${Math.round(myChallengeRatio * 100)}% (target: ≥${Math.round(MIN_CHALLENGE_RATIO * 100)}%)`,
		);
	}

	// ── State-based observations (not prescriptive phases) ──────────────
	lines.push('');

	if (isEarlyGraph) {
		lines.push(
			`The knowledge graph is thin — only ${totalFindings} finding(s) across ${agentCount} agent(s). The swarm needs more raw material before it can synthesize effectively.`,
		);
	}

	if (!isEarlyGraph && isUnderConnected) {
		lines.push(
			`There are ${totalFindings} findings but only ${totalConnections} connection(s) (ratio: ${(totalConnections / totalFindings).toFixed(2)}). The graph is under-connected — look for relationships between your findings and other agents' work.`,
		);
	}

	if (needsTheses) {
		lines.push(
			`⚡ ACTION NEEDED: The building blocks exist for synthesis — ${crossAgentConnections} cross-agent connections but zero theses. You should create an thesis using create_thesis with evidence from 2+ agents. This is the swarm's primary deliverable.`,
		);
	}

	if (!needsTheses && needsMoreTheses) {
		lines.push(
			`The swarm has ${totalTheses} thesis(es) but needs more diverse perspectives. Only ${totalTheses}/${agentCount} agents have synthesized so far. Each agent should contribute at least one thesis from their unique angle.`,
		);
	}

	if (iHaveNotSynthesized && !isEarlyGraph) {
		const existingTitles = theses.map((t) => `"${t.title}"`).join(', ');
		const titlesNote =
			theses.length > 0
				? ` Existing theses cover: ${existingTitles}. Your thesis MUST reflect YOUR unique perspective — each specialist should propose a thesis grounded in their domain expertise. If you agree with an existing thesis, VOTE on it instead of creating a duplicate.`
				: '';
		lines.push(
			`⚡ YOU have not created any theses yet. You have ${myFindings} findings and there are ${crossAgentConnections} cross-agent connections available. Use create_thesis to synthesize your findings into an actionable investment thesis. This is HIGH PRIORITY — theses are the deliverable.${titlesNote}`,
		);
	}

	if (tensionDeficit) {
		lines.push(
			`⚠ TENSION DEFICIT: Only ${contradictsConnections}/${totalConnections} connections (${Math.round(contradictsRatio * 100)}%) are contradictions — healthy analysis needs ≥15%. Consider calling find_tensions to surface genuine conflicts worth capturing as "contradicts" connections.`,
		);
	}

	const isOverContradicted = totalConnections >= 5 && contradictsRatio > 0.5;
	if (isOverContradicted) {
		lines.push(
			`⚠ CONTRADICTION OVERLOAD: ${Math.round(contradictsRatio * 100)}% of connections are "contradicts" — this suggests forced disagreements. Prioritise "supports", "amplifies", and "enables" connections that build the graph constructively. Only use "contradicts" for genuine substantive conflicts.`,
		);
	}

	if (totalTheses > 0 && notYetVotedByMe > 0) {
		lines.push(
			`There are ${notYetVotedByMe} thesis(es) you haven't voted on. Review each one critically — challenge theses where the evidence is weak or your findings present a different picture.`,
		);
	}

	if (isMature && totalTheses > 0 && notYetVotedByMe === 0) {
		lines.push(
			'The swarm has produced theses with votes. Look for additional theses from your unique perspective, especially ones that challenge the prevailing consensus. Antithetical theses (using contradicts_thesis_id) are welcome.',
		);
	}

	// ── Late-game urgency (the only time-aware signal) ──────────────────
	if (isLateGame) {
		const actions: string[] = [];

		if (totalTheses === 0 && agentCount >= 2) {
			actions.push(
				"🚨 No theses exist yet. You MUST create at least one using create_thesis with evidence from 2+ agents. This is the swarm's primary deliverable.",
			);
		} else if (myTheses === 0 && crossAgentConnections >= 1) {
			actions.push(
				`You have NOT created any theses yet. Create one from your unique perspective using create_thesis. ${totalTheses} exist from other agents — bring YOUR angle.`,
			);
		}

		if (notYetVotedByMe > 0) {
			actions.push(`Vote on ${notYetVotedByMe} thesis(es) you haven't reviewed yet.`);
		}

		// Validation phase: verify existing theses against current data
		if (totalTheses > 0) {
			actions.push(
				'VALIDATION: Use web_search to check what happened THIS WEEK regarding the topic. Compare current data against your thesis predictions. If your thesis predicted X but Y is happening, create a finding acknowledging the discrepancy and adjust your confidence. Search for the most recent price levels, news events, and data releases.',
			);
		}

		if (actions.length > 0) {
			lines.push('');
			lines.push(`⏰ FINAL ROUND(S). Before calling mark_round_ready:`);
			for (const action of actions) {
				lines.push(`  • ${action}`);
			}
		} else {
			lines.push('');
			lines.push('Final round(s). If you see additional theses or tensions, act now. Otherwise, mark round ready.');
		}
	}

	// ── Tool usage observations (soft, not commanding) ──────────────────
	if (toolUsageStats && toolUsageStats.length > 0) {
		const myStats = toolUsageStats.filter((s) => s.agent_id === agentId);
		const myConnectionCount = myStats
			.filter((s) => s.action === 'create_connection')
			.reduce((sum, s) => sum + s.count, 0);
		const myThesisCount = myStats.filter((s) => s.action === 'create_thesis').reduce((sum, s) => sum + s.count, 0);
		const myFindingCount = myStats.filter((s) => s.action === 'write_finding').reduce((sum, s) => sum + s.count, 0);

		if (myConnectionCount >= 4 && myThesisCount === 0) {
			lines.push('');
			lines.push(
				`Note: You have created ${myConnectionCount} connections but no theses yet. You may have enough evidence to synthesize an thesis.`,
			);
		}
		if (myFindingCount >= 8 && myThesisCount === 0 && !isEarlyGraph) {
			lines.push('');
			lines.push(
				`Note: You have written ${myFindingCount} findings but no theses. Consider whether your findings support an actionable thesis.`,
			);
		}
	}

	// ── Voting reminder ────────────────────────────────────────────────────
	if (notYetVotedByMe > 0 && !isLateGame) {
		lines.push('');
		lines.push(
			`Reminder: ${notYetVotedByMe} thesis(es) need your vote. Use vote_on_thesis to support or challenge each one.`,
		);
	}

	return lines.join('\n');
}

// ── Round Summary ────────────────────────────────────────────────────

/**
 * Build a compact recap of what happened in the previous round.
 * Injected into agent prompts at round >= 2 so agents have debate context.
 */
export function buildRoundSummary(
	previousRound: number,
	allFindings: Finding[],
	allConnections: ConnectionSummary[],
	theses: ThesisSummary[],
): string {
	const roundFindings = allFindings.filter((f) => f.round === previousRound);
	if (roundFindings.length === 0) return '';

	const lines: string[] = [`=== ROUND ${previousRound} RECAP ===`];

	// Group findings by agent with best finding
	const byAgent = new Map<string, Finding[]>();
	for (const f of roundFindings) {
		const arr = byAgent.get(f.agent_id) || [];
		arr.push(f);
		byAgent.set(f.agent_id, arr);
	}

	for (const [agentId, findings] of byAgent) {
		const best = findings.reduce((a, b) => (b.confidence > a.confidence ? b : a));
		lines.push(
			`${agentId}: ${findings.length} finding(s), best: "${best.title}" (${(best.confidence * 100).toFixed(0)}%)`,
		);
	}

	// Cross-agent connections made in this round
	const findingAgentMap = new Map(allFindings.map((f) => [f.id, f.agent_id]));
	const roundConnections = allConnections.filter((c) => c.round === previousRound);
	const crossAgent = roundConnections.filter((c) => {
		const fromAgent = findingAgentMap.get(c.from_finding_id);
		const toAgent = findingAgentMap.get(c.to_finding_id);
		return fromAgent && toAgent && fromAgent !== toAgent;
	});
	if (crossAgent.length > 0) {
		const contradicts = crossAgent.filter((c) => c.relationship === 'contradicts');
		lines.push(`Cross-agent connections: ${crossAgent.length}`);
		if (contradicts.length > 0) {
			lines.push(`  Contradictions: ${contradicts.length} — areas of genuine disagreement`);
		}
	}

	// Thesis state recap
	if (theses.length > 0) {
		lines.push(`Active theses: ${theses.length}`);
		for (const t of theses) {
			const supports = t.votes.filter((v) => v.vote === 'support').length;
			const challenges = t.votes.filter((v) => v.vote === 'challenge').length;
			lines.push(`  "${t.title}" by ${t.created_by}: ${supports} support, ${challenges} challenge`);
		}
	}

	lines.push("Build on this debate. Don't repeat what was already found — extend, challenge, or synthesize.");
	return lines.join('\n');
}

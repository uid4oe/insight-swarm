// ── Collaboration Tools ─────────────────────────────────────────────────────
// Tools for inter-agent collaboration: reactions, questions, round signaling,
// agent status, theses, and voting.

import { FunctionTool } from '@google/adk';
import { logAndEmit } from '../../../domain/services/activity.js';
import type { AgentId, EvidenceItem, Finding, ThesisVote } from '../../../domain/types.js';
import { schemas } from '../../tool-validator.js';
import { getUnvotedTheses } from '../agent-utils.js';
import { FINDING_DEDUP_SIM_THRESHOLD, THESIS_DEDUP_SIM_THRESHOLD } from '../constants.js';
import { formatThesis } from './formatters.js';
import { cosineSimilarity, normalizeCategory } from './knowledge-tools.js';
import { extractDollarAmounts, formatDollarAmount, isValueGrounded } from './numeric-utils.js';
import { safeExecute } from './safe-execute.js';
import type { SwarmToolContext } from './types.js';

/**
 * Cross-reference dollar amount claims in thesis text against evidence findings.
 * Returns warnings for thesis amounts that don't appear (within tolerance) in any evidence.
 * Also flags when the thesis contains dollar amounts but the evidence contains none,
 * which indicates the LLM fabricated the numbers from training data.
 */
function crossReferenceThesisData(thesisText: string, evidenceDescriptions: string[]): string[] {
	const evidenceText = evidenceDescriptions.join(' ');
	const warnings: string[] = [];

	const thesisAmounts = extractDollarAmounts(thesisText);
	if (thesisAmounts.length === 0) return warnings; // No dollar claims to verify

	const evidenceAmounts = extractDollarAmounts(evidenceText);

	// Edge case: thesis has dollar amounts but evidence has NONE — likely hallucinated
	if (evidenceAmounts.length === 0) {
		for (const tAmt of thesisAmounts) {
			warnings.push(formatDollarAmount(tAmt));
		}
		return warnings;
	}

	for (const tAmt of thesisAmounts) {
		if (!isValueGrounded(tAmt, evidenceAmounts)) {
			warnings.push(formatDollarAmount(tAmt));
		}
	}

	return warnings;
}

/**
 * Verify that evidence quotes actually appear in the cited findings.
 * Uses normalized substring matching with fuzzy tolerance.
 * Returns an array of verification failures.
 */
function verifyEvidenceQuotes(
	quotes: Array<{ finding_id: string; quote: string }>,
	findingMap: Map<string, { title: string; description: string }>,
): string[] {
	const failures: string[] = [];
	for (const { finding_id, quote } of quotes) {
		const finding = findingMap.get(finding_id);
		if (!finding) {
			failures.push(`Quote references unknown finding ${finding_id}`);
			continue;
		}
		// Normalize both for comparison: lowercase, collapse whitespace
		const normalizedQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim();
		const normalizedSource = `${finding.title} ${finding.description}`.toLowerCase().replace(/\s+/g, ' ');

		if (normalizedQuote.length < 5) continue; // skip trivially short quotes

		// Exact substring match first
		if (normalizedSource.includes(normalizedQuote)) continue;

		// Token overlap fallback: ≥70% of quote tokens must appear in source
		const quoteTokens = new Set(normalizedQuote.split(' ').filter((t) => t.length > 2));
		const sourceTokens = new Set(normalizedSource.split(' '));
		if (quoteTokens.size === 0) continue;
		const hits = [...quoteTokens].filter((t) => sourceTokens.has(t)).length;
		const overlap = hits / quoteTokens.size;
		if (overlap >= 0.7) continue;

		failures.push(
			`Quote "${quote.slice(0, 60)}…" (${(overlap * 100).toFixed(0)}% token match) not found in finding "${finding.title}"`,
		);
	}
	return failures;
}

/** Build a compact data anchor summary from evidence findings for the thesis response. */
function buildEvidenceAnchor(findings: Array<{ agent_id: string; title: string; description: string }>): string {
	if (findings.length === 0) return '';
	const lines = findings.slice(0, 6).map((f) => {
		// Extract key numbers from the finding for the anchor
		const dollarAmounts = extractDollarAmounts(`${f.title} ${f.description}`);
		const numSummary =
			dollarAmounts.length > 0 ? ` [Key $: ${dollarAmounts.slice(0, 3).map(formatDollarAmount).join(', ')}]` : '';
		return `  - [${f.agent_id}] "${f.title}"${numSummary}`;
	});
	return `\n  Evidence data anchors:\n${lines.join('\n')}`;
}

export function createCollaborationTools(ctx: SwarmToolContext, onRoundReady: () => void): FunctionTool[] {
	return [
		// ── react_to_finding ───────────────────────────────────────────────────
		new FunctionTool({
			name: 'react_to_finding',
			description:
				"React to another agent's finding from your analytical perspective. Don't just agree — identify what's missing, what could go wrong, or what the finding overlooks. Challenge assumptions and add nuance. Optionally create a follow-up finding that qualifies, extends, or counters the original.",
			parameters: schemas.react_to_finding,
			execute: safeExecute(async (input) => {
				if (ctx.timedOut) {
					return 'Error: Agent timed out. Call mark_round_ready to finish this round.';
				}
				const reactionId = input.reaction_id as string;
				const reactionRow = await ctx.db.getReaction(reactionId);
				if (!reactionRow) return `Error: Reaction ${reactionId} not found.`;

				// completeReaction writes the reactions_needed row; getFinding reads a different row — independent
				const [, originalFinding] = await Promise.all([
					ctx.db.completeReaction(reactionId, input.reaction_text as string),
					ctx.db.getFinding(reactionRow.finding_id),
				]);
				let resultText = `Reaction recorded for reaction ${reactionId}.`;
				let followupFinding: Finding | null = null;

				if (input.create_followup_finding && input.followup) {
					const existingFindings = await ctx.db.queryFindings({
						agent_id: ctx.agentId,
						round: ctx.currentRound,
					});
					if (existingFindings.length >= ctx.config.maxFindingsPerRound) {
						resultText += `\n  (Follow-up finding skipped: findings limit of ${ctx.config.maxFindingsPerRound} reached this round)`;
					} else {
						const followup = input.followup as {
							category: string;
							title: string;
							description: string;
							confidence: number;
							tags: string[];
						};
						const followupEmbedding = await ctx.embeddingService.generateEmbedding(
							`${followup.title}\n\n${followup.description}`,
						);

						// Semantic deduplication: block if too similar to agent's own existing finding
						if (followupEmbedding.length > 0) {
							const similar = await ctx.db.querySimilarFindingsByAgent(
								ctx.agentId,
								followupEmbedding,
								FINDING_DEDUP_SIM_THRESHOLD,
							);
							if (similar.length > 0) {
								resultText += `\n  (Follow-up finding skipped: too similar to "${similar[0].title}" at ${(similar[0].similarity * 100).toFixed(0)}%)`;
								return resultText;
							}
						}

						followupFinding = await ctx.db.createFinding({
							agent_id: ctx.agentId,
							round: ctx.currentRound,
							category: normalizeCategory(followup.category),
							title: followup.title,
							description: followup.description,
							confidence: Math.max(0, Math.min(1, followup.confidence)),
							tags: followup.tags,
							parent_finding_id: reactionRow.finding_id,
							embedding: followupEmbedding,
						});

						await ctx.db.createReactionsForFinding(followupFinding.id, ctx.agentId);

						ctx.eventBus.emit('finding:created', { finding: followupFinding, agent_id: ctx.agentId });
						resultText += `\n  Follow-up finding created: ${followupFinding.id} - "${followupFinding.title}"`;
					}
				}

				// Emit using data we already have instead of re-reading to avoid
				// read-after-write race where the completed state isn't visible yet.
				if (originalFinding) {
					ctx.eventBus.emit('reaction:completed', {
						reaction: {
							...reactionRow,
							status: 'reacted' as const,
							reaction: input.reaction_text as string,
							reacted_at: new Date().toISOString(),
						},
						agent_id: ctx.agentId,
						finding: originalFinding,
					});
				}

				const findingLabel = originalFinding ? `"${originalFinding.title}"` : `finding ${reactionRow.finding_id}`;
				await logAndEmit(
					ctx,
					'react_to_finding',
					`Reacted to ${findingLabel}${followupFinding ? ` → follow-up: "${followupFinding.title}"` : ''}`,
				);
				return resultText;
			}),
		}),

		// ── mark_round_ready ───────────────────────────────────────────────────
		new FunctionTool({
			name: 'mark_round_ready',
			description:
				'Signal that you have completed your work for this round and are ready for the swarm to advance. All pending reactions must be handled first, and you must vote on all existing theses before marking ready. When all living agents signal readiness, the round advances.',
			parameters: schemas.mark_round_ready,
			execute: safeExecute(async () => {
				// Fetch pending reactions and current theses in parallel — both are needed for gate checks
				const [pending, theses] = await Promise.all([ctx.db.getPendingReactions(ctx.agentId), ctx.db.getTheses()]);

				if (pending.length > 0) {
					return `Cannot mark ready: you have ${pending.length} pending reaction(s) to handle. Use react_to_finding for each before marking ready.`;
				}

				// Voting gate: block marking ready if there are theses the agent hasn't voted on
				const unvoted = getUnvotedTheses(ctx.agentId, theses);
				if (unvoted.length > 0) {
					const ids = unvoted.map((t) => `"${t.title}" (${t.id})`).join(', ');
					return `Cannot mark ready: you have ${unvoted.length} thesis(es) to vote on first: ${ids}. Use vote_on_thesis for each one, then call mark_round_ready again.`;
				}

				await ctx.db.markAgentReady(ctx.agentId);
				await logAndEmit(ctx, 'mark_round_ready', `Marked ready for round ${ctx.currentRound + 1}`);
				onRoundReady();

				return `Marked ready for round ${ctx.currentRound + 1}. You will advance immediately to continue work.`;
			}),
		}),

		// ── post_question ──────────────────────────────────────────────────────
		new FunctionTool({
			name: 'post_question',
			description:
				'Post a question for other agents. Creates a finding with category "question" and assigns reaction records to target agents.',
			parameters: schemas.post_question,
			execute: safeExecute(async (input) => {
				if (ctx.shuttingDown || ctx.timedOut) {
					return 'Error: Task is completing. Call mark_round_ready to finish this round.';
				}
				const existingFindings = await ctx.db.queryFindings({
					agent_id: ctx.agentId,
					round: ctx.currentRound,
				});
				if (existingFindings.length >= ctx.config.maxFindingsPerRound) {
					return `Finding limit reached: you have already created ${existingFindings.length} findings this round (max ${ctx.config.maxFindingsPerRound}).`;
				}

				const question = input.question as string;
				const targets = input.target_agents as string[];

				const finding = await ctx.db.createFinding({
					agent_id: ctx.agentId,
					round: ctx.currentRound,
					category: 'question',
					title: `Question: ${question.slice(0, 80)}${question.length > 80 ? '...' : ''}`,
					description: question,
					confidence: 0,
					tags: ['question', 'discussion'],
				});

				const isAll = targets.length === 1 && targets[0] === 'all';
				const targetList = isAll ? undefined : (targets as AgentId[]);
				await ctx.db.createReactionsForFinding(finding.id, ctx.agentId, targetList);

				ctx.eventBus.emit('finding:created', { finding, agent_id: ctx.agentId });
				await logAndEmit(
					ctx,
					'post_question',
					`Posted question to ${isAll ? 'all agents' : targets.join(', ')}: "${question.slice(0, 60)}..."`,
				);

				return `Question posted successfully.\n  ID: ${finding.id}\n  Directed to: ${isAll ? 'all agents' : targets.join(', ')}\n  Question: ${question}`;
			}),
		}),

		// ── create_thesis ─────────────────────────────────────────────────────
		new FunctionTool({
			name: 'create_thesis',
			description:
				'Create a thesis synthesizing multiple findings into an actionable insight. Provide finding IDs as evidence. Requires evidence from at least 2 different agents. Other agents can vote to support or challenge it. You can also create an ANTITHETICAL thesis — one that deliberately opposes an existing thesis — by providing contradicts_thesis_id with the ID of the thesis you are opposing. Antithetical theses bypass dedup checks.\n\nSCENARIO REQUIREMENT: Every thesis MUST include in the thesis text: (1) a specific scenario with numbers (specific metric, quantified outcome, or measurable result), (2) a timeframe (e.g. "by Q3 2026", "over the next 6 months"), and (3) what would INVALIDATE it (a specific trigger that would make this thesis wrong). Theses without quantified scenarios are vague and low-value.\n\nGROUNDING REQUIREMENT: Every dollar amount, percentage, and data point in your thesis MUST come from a cited evidence finding. You SHOULD provide evidence_quotes — a verbatim or near-verbatim quote from each key finding. The system will verify these quotes exist in the cited findings and REJECT the thesis if it contains numbers not found in the evidence. Do NOT use numbers from memory or training data.',
			parameters: schemas.create_thesis,
			execute: safeExecute(async (input) => {
				if (ctx.shuttingDown || ctx.timedOut) {
					return 'Error: Task is completing. Focus on voting on existing theses using vote_on_thesis, then call mark_round_ready.';
				}

				const evidenceIds = input.evidence_finding_ids as string[];
				const contradictsThesisId = input.contradicts_thesis_id as string | undefined;

				// Validate contradicts_thesis_id references an existing thesis
				if (contradictsThesisId) {
					const referencedThesis = await ctx.db.getThesis(contradictsThesisId);
					if (!referencedThesis) {
						return `Error: contradicts_thesis_id "${contradictsThesisId}" does not reference an existing thesis. Use get_theses to list valid thesis IDs.`;
					}
				}

				// Validate all finding IDs exist
				const evidenceFindings = await ctx.db.queryFindingsByIds(evidenceIds);
				const foundIds = new Set(evidenceFindings.map((f) => f.id));
				const missingIds = evidenceIds.filter((id) => !foundIds.has(id));
				if (missingIds.length > 0) {
					return `Error: These evidence finding IDs do not exist: ${missingIds.join(', ')}. Use read_findings to get valid full UUIDs (36 characters).`;
				}

				const evidenceAgents = new Set(evidenceFindings.map((f) => f.agent_id));
				if (evidenceFindings.length < 3) {
					return `Error: Theses require at least 3 evidence findings to ensure substantive synthesis. You provided ${evidenceFindings.length}. Gather more cross-agent evidence before creating a thesis.`;
				}
				if (evidenceAgents.size < 2) {
					return `Error: Theses require evidence from at least 2 different agents. The provided evidence all comes from ${[...evidenceAgents].join(', ') || 'unknown agent(s)'}.`;
				}

				// Hard cap: reject if max theses already reached
				const existingTheses = await ctx.db.getTheses();
				if (existingTheses.length >= ctx.config.maxTheses) {
					return `Maximum theses (${ctx.config.maxTheses}) reached. Vote on existing ones using vote_on_thesis instead.`;
				}

				// ── Data cross-reference: warn if key dollar amounts are ungrounded ──
				const thesisText = input.thesis as string;
				const evidenceDescriptions = evidenceFindings.map((f) => `${f.title} ${f.description}`);
				const ungroundedAmounts = crossReferenceThesisData(thesisText, evidenceDescriptions);
				let dataWarning = '';
				if (ungroundedAmounts.length > 0) {
					dataWarning = `\n  WARNING: Dollar amounts (${ungroundedAmounts.join(', ')}) not found in cited evidence. Consider verifying these figures.`;
				}

				// ── Evidence quote verification (soft warning) ──
				let quoteWarning = '';
				const evidenceQuotes = input.evidence_quotes as Array<{ finding_id: string; quote: string }> | undefined;
				if (evidenceQuotes && evidenceQuotes.length > 0) {
					const findingMap = new Map(
						evidenceFindings.map((f) => [f.id, { title: f.title, description: f.description }]),
					);
					const quoteFailures = verifyEvidenceQuotes(evidenceQuotes, findingMap);
					if (quoteFailures.length > 0) {
						quoteWarning = `\n  WARNING: Some evidence quotes could not be verified:\n${quoteFailures.map((f) => `    - ${f}`).join('\n')}`;
					}
				}

				// Generate embedding for thesis (used for dedup and stored for future dedup)
				const thesisTextForEmbed = `${input.title}\n\n${input.thesis}`;
				const thesisEmbedding = await ctx.embeddingService.generateEmbedding(thesisTextForEmbed);

				// Deduplication: reject theses too similar to existing ones.
				// Skip dedup if this is an intentional antithetical thesis.
				if (!contradictsThesisId && existingTheses.length > 0) {
					const newTitle = (input.title as string).toLowerCase().trim();

					// Tier 1: Exact title match (fast path)
					for (const existing of existingTheses) {
						if (existing.title.toLowerCase().trim() === newTitle) {
							return `Error: A thesis with this exact title already exists: "${existing.title}" (${existing.id}). Vote on it using vote_on_thesis, or create a thesis with a clearly distinct angle and title.`;
						}
					}

					// Tier 2: Semantic similarity via embeddings
					if (thesisEmbedding.length > 0) {
						for (const existing of existingTheses) {
							const isSameAgent = existing.created_by === ctx.agentId;
							const simThreshold = isSameAgent ? THESIS_DEDUP_SIM_THRESHOLD : THESIS_DEDUP_SIM_THRESHOLD + 0.1;
							let existingEmbedding = await ctx.db.getThesisEmbedding(existing.id);
							if (!existingEmbedding || existingEmbedding.length === 0) {
								const existingText = `${existing.title}\n\n${existing.thesis}`;
								existingEmbedding = await ctx.embeddingService.generateEmbedding(existingText);
							}
							if (existingEmbedding.length > 0) {
								const sim = cosineSimilarity(thesisEmbedding, existingEmbedding);
								if (sim > simThreshold) {
									return isSameAgent
										? `Error: This thesis is too semantically similar to your own thesis "${existing.title}" (${existing.id}, similarity: ${(sim * 100).toFixed(0)}%). Create a meaningfully different thesis or vote on it instead.`
										: `Error: This thesis is too semantically similar to "${existing.title}" (${existing.id}, similarity: ${(sim * 100).toFixed(0)}%). If you intentionally want to oppose it, set contradicts_thesis_id="${existing.id}". Otherwise, vote on it or create a thesis that covers a different dimension entirely.`;
								}
							}
						}
					}
				}

				// Auto-populate evidence with reasoning from thesis and relevance based on agent count
				const evidence: EvidenceItem[] = evidenceFindings.map((f, i) => ({
					finding_id: f.id,
					reasoning: `[${f.agent_id}] "${f.title}" — ${f.description.slice(0, 150)}`,
					relevance: (i < 2 ? 'primary' : 'supporting') as EvidenceItem['relevance'],
				}));

				const thesis = await ctx.db.createThesis({
					title: input.title as string,
					thesis: input.thesis as string,
					evidence,
					connections_used: (input.connections_used as string[] | undefined) ?? [],
					confidence: Math.max(0, Math.min(1, input.confidence as number)),
					market_size: input.market_size as string | undefined,
					timing: input.timing as string | undefined,
					risks: input.risks as string[] | undefined,
					created_by: ctx.agentId,
					embedding: thesisEmbedding.length > 0 ? thesisEmbedding : undefined,
				});

				ctx.eventBus.emit('thesis:created', { thesis });
				await logAndEmit(
					ctx,
					'create_thesis',
					`Created thesis: "${thesis.title}" (confidence: ${(thesis.confidence * 100).toFixed(0)}%)`,
				);
				const anchor = buildEvidenceAnchor(evidenceFindings);
				const quoteStatus =
					evidenceQuotes && evidenceQuotes.length > 0
						? `\n  ✓ ${evidenceQuotes.length} evidence quote(s) provided`
						: '';
				return `Thesis created successfully.\n${formatThesis(thesis)}${anchor}${quoteStatus}${dataWarning}${quoteWarning}`;
			}),
		}),

		// ── vote_on_thesis ────────────────────────────────────────────────────
		new FunctionTool({
			name: 'vote_on_thesis',
			description:
				'Vote to support or challenge a proposed thesis. You MUST challenge at least 30% of theses you vote on. Actively challenge when: evidence is weak or cherry-picked, the thesis overstates conclusions, key risks are ignored, or your findings contradict it. Challenges are the HIGHEST-VALUE votes — they prevent groupthink and produce stronger output. Provide specific reasoning and cite finding IDs.',
			parameters: schemas.vote_on_thesis,
			execute: safeExecute(async (input) => {
				if (ctx.timedOut) {
					return 'Error: Agent timed out. Call mark_round_ready to finish this round.';
				}
				const thesisId = input.thesis_id as string;

				// Early checks: prevent wasting LLM turns on invalid/duplicate votes
				const existing = await ctx.db.getThesis(thesisId);
				if (!existing) return `Error: Thesis ${thesisId} not found.`;
				if (existing.created_by === ctx.agentId) {
					return `You created "${existing.title}" — you cannot vote on your own thesis. Vote on OTHER agents' theses, create a new thesis, or call mark_round_ready.`;
				}
				if (existing.votes.some((v) => v.agent_id === ctx.agentId)) {
					const supportCount = existing.votes.filter((v) => v.vote === 'support').length;
					const challengeCount = existing.votes.filter((v) => v.vote === 'challenge').length;
					return `You have already voted on "${existing.title}". Tally: ${supportCount} support, ${challengeCount} challenge. Move on to other tasks — create a new thesis or call mark_round_ready.`;
				}

				const supportingIds = input.supporting_finding_ids as string[] | undefined;
				const vote: ThesisVote = {
					agent_id: ctx.agentId,
					vote: input.vote as 'support' | 'challenge',
					reasoning: input.reasoning as string,
					...(supportingIds?.length ? { supporting_evidence: supportingIds } : {}),
				};

				await ctx.db.voteOnThesis(thesisId, vote);
				const updated = await ctx.db.getThesis(thesisId);
				if (!updated) return `Error: Thesis ${thesisId} not found after voting.`;

				ctx.eventBus.emit('thesis:voted', { thesis: updated, vote });
				await logAndEmit(ctx, 'vote_on_thesis', `Voted "${vote.vote}" on thesis "${updated.title}"`);

				// Log challenge votes without creating a finding — the challenge reasoning
				// is already stored in the thesis votes JSONB. Creating a separate finding
				// would pollute the knowledge graph with zero-confidence meta-commentary
				// and spawn reaction cascades.
				if (vote.vote === 'challenge' && updated.created_by !== ctx.agentId) {
					await logAndEmit(
						ctx,
						'thesis_challenge',
						`Challenged thesis "${updated.title}" — reasoning: ${vote.reasoning.slice(0, 120)}`,
					);
				}

				const supportCount = updated.votes.filter((v) => v.vote === 'support').length;
				const challengeCount = updated.votes.filter((v) => v.vote === 'challenge').length;
				return `Vote recorded on "${updated.title}".\n  Your vote: ${vote.vote}\n  Reasoning: ${vote.reasoning}\n  Tally: ${supportCount} support, ${challengeCount} challenge`;
			}),
		}),

		// ── get_theses ────────────────────────────────────────────────────────
		new FunctionTool({
			name: 'get_theses',
			description:
				'Get all proposed theses. Review evidence data anchors to verify that the thesis numbers match the cited findings. Challenge theses with ungrounded claims.',
			parameters: schemas.get_theses,
			execute: safeExecute(async () => {
				const theses = await ctx.db.getTheses();
				if (theses.length === 0) return 'No theses have been proposed yet.';
				const header = `${theses.length} thesis(es):`;

				// Batch-fetch all evidence findings across all theses in ONE query (avoids N+1)
				const allEvidenceIds = [...new Set(theses.flatMap((t) => t.evidence.map((e) => e.finding_id)))];
				const allEvidenceFindings = allEvidenceIds.length > 0 ? await ctx.db.queryFindingsByIds(allEvidenceIds) : [];
				const evidenceMap = new Map(allEvidenceFindings.map((f) => [f.id, f]));

				const thesisBlocks = theses.map((t, i) => {
					const formatted = formatThesis(t);
					const evidenceFindings = t.evidence
						.map((e) => evidenceMap.get(e.finding_id))
						.filter((f): f is NonNullable<typeof f> => f != null);
					if (evidenceFindings.length === 0) return `${i + 1}.\n${formatted}`;
					const anchor = buildEvidenceAnchor(evidenceFindings);
					return `${i + 1}.\n${formatted}${anchor}`;
				});
				return `${header}\n\n${thesisBlocks.join('\n\n')}`;
			}),
		}),
	];
}

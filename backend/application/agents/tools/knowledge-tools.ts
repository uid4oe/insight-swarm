// ── Knowledge Graph Tools ───────────────────────────────────────────────────
// Tools for reading/writing findings, connections, and reactions.

import { FunctionTool } from '@google/adk';
import { logAndEmit } from '../../../domain/services/activity.js';
import type { AgentId, ConnectionRelationship, Reference } from '../../../domain/types.js';
import { schemas } from '../../tool-validator.js';
import { FINDING_DEDUP_SIM_THRESHOLD, SAME_AGENT_CONTRADICTS_SIM_THRESHOLD } from '../constants.js';
import { formatConnection, formatFinding } from './formatters.js';
import { extractDollarAmounts } from './numeric-utils.js';
import { safeExecute } from './safe-execute.js';
import type { SwarmToolContext } from './types.js';

/** Compute cosine similarity between two embedding vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	// Use epsilon to avoid near-zero denominator producing Infinity
	return denom < 1e-10 ? 0 : dot / denom;
}

/** Normalize free-text category to a consistent snake_case form. */
export function normalizeCategory(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/[-\s]+/g, '_')
		.replace(/^_|_$/g, '');
}

export function createKnowledgeTools(ctx: SwarmToolContext): FunctionTool[] {
	return [
		// ── read_findings ──────────────────────────────────────────────────────
		new FunctionTool({
			name: 'read_findings',
			description:
				'Read findings from the shared knowledge graph. Use filters to narrow results by agent, round, category, or tags.',
			parameters: schemas.read_findings,
			execute: safeExecute(async (input) => {
				const findings = await ctx.db.queryFindings({
					agent_id: input.agent_id as AgentId | undefined,
					round: input.round as number | undefined,
					category: input.category as string | undefined,
					tags: input.tags as string[] | undefined,
					limit: input.limit as number | undefined,
				});
				if (findings.length === 0) return 'No findings match the given filters.';
				const header = `Found ${findings.length} finding(s):`;
				const body = findings.map((f, i) => `${i + 1}.\n${formatFinding(f)}`).join('\n\n');
				return `${header}\n\n${body}`;
			}),
		}),

		// ── write_finding ──────────────────────────────────────────────────────
		new FunctionTool({
			name: 'write_finding',
			description:
				'Write a new finding to the shared knowledge graph. Other agents will be notified and may react to it. Include references (URLs, article titles, data sources) to back up your finding — especially from web search results. IMPORTANT: Every number (data points, metrics, statistics) MUST come from a web search result or another finding. Never use numbers from memory.',
			parameters: schemas.write_finding,
			execute: safeExecute(async (input) => {
				if (ctx.shuttingDown || ctx.timedOut) {
					return 'Error: Task is completing. Focus on voting on existing theses using vote_on_thesis, then call mark_round_ready.';
				}
				const existingFindings = await ctx.db.queryFindings({
					agent_id: ctx.agentId,
					round: ctx.currentRound,
				});
				if (existingFindings.length >= ctx.config.maxFindingsPerRound) {
					return `Finding limit reached: you have already created ${existingFindings.length} findings this round (max ${ctx.config.maxFindingsPerRound}). Focus on creating connections or marking round ready instead.`;
				}

				// ── Price anchor consistency check (rounds 2+) ──
				// If the agent already established a price anchor in a prior round,
				// warn if this new finding contains a wildly different price for the same subject.
				if (ctx.currentRound >= 2) {
					const findingText = `${input.title} ${input.description}`;
					const newDollarAmounts = extractDollarAmounts(findingText);
					if (newDollarAmounts.length > 0) {
						// Get all previous findings from this agent to find price anchors
						const priorFindings = await ctx.db.queryFindings({ agent_id: ctx.agentId });
						const priorText = priorFindings.map((f) => `${f.title} ${f.description}`).join(' ');
						const priorAmounts = extractDollarAmounts(priorText);

						if (priorAmounts.length > 0) {
							// Check if any new amounts diverge >3x from ALL prior anchors in similar magnitude
							const divergent = newDollarAmounts.filter((newAmt) => {
								// Skip very small amounts (< $1) — they're likely percentages parsed as amounts
								if (newAmt < 1) return false;
								// Find prior amounts in a similar order of magnitude
								const sameMagnitude = priorAmounts.filter(
									(p) => p >= 1 && Math.abs(Math.log10(newAmt) - Math.log10(p)) < 2,
								);
								// Only flag if there ARE prior amounts in this magnitude AND all diverge >3x
								if (sameMagnitude.length === 0) return false;
								return sameMagnitude.every((priorAmt) => {
									const ratio = newAmt / priorAmt;
									return ratio > 3 || ratio < 0.33;
								});
							});
							if (divergent.length > 0) {
								const divergentStr = divergent.map((d) => `$${d}`).join(', ');
								const priorStr = priorAmounts
									.slice(0, 5)
									.map((p) => `$${p}`)
									.join(', ');
								return `⚠ DATA CONSISTENCY REJECTED: Your new finding contains dollar amounts (${divergentStr}) that are wildly divergent from your own prior data (${priorStr}). This likely indicates hallucinated data. Use web_search to verify the correct figure, then try again. If the discrepancy is real (e.g., different metric), add an explicit note explaining why.`;
							}
						}
					}
				}

				// Reject near-zero confidence findings — these are noise, not insights
				const confidence = Math.max(0, Math.min(1, input.confidence as number));
				if (confidence < 0.15) {
					return `Rejected: confidence ${(confidence * 100).toFixed(0)}% is below the 15% minimum. If you're uncertain, set confidence to 0.3-0.5 and explain the uncertainty in the description. Findings below 15% add noise without value.`;
				}

				const fullTextForEmbedding = `${input.title}\n\n${input.description}`;
				const embedding = await ctx.embeddingService.generateEmbedding(fullTextForEmbedding);

				// Semantic deduplication: block if too similar to agent's own existing finding
				if (embedding.length > 0) {
					const similar = await ctx.db.querySimilarFindingsByAgent(ctx.agentId, embedding, FINDING_DEDUP_SIM_THRESHOLD);
					if (similar.length > 0) {
						return `Finding too similar to your existing finding: "${similar[0].title}" (similarity: ${(similar[0].similarity * 100).toFixed(0)}%). Write something with a genuinely new angle, or use create_connection to build on the existing finding instead.`;
					}
				}

				const finding = await ctx.db.createFinding({
					agent_id: ctx.agentId,
					round: ctx.currentRound,
					category: normalizeCategory(input.category as string),
					title: input.title as string,
					description: input.description as string,
					confidence: Math.max(0, Math.min(1, input.confidence as number)),
					tags: input.tags as string[],
					references: input.references as Reference[] | undefined,
					parent_finding_id: input.parent_finding_id as string | undefined,
					embedding,
				});

				if (ctx.currentRound >= 2) {
					// Smart reaction dispatch: only target the 2 most semantically relevant agents
					// to reduce the 31-65% skip rate from dispatching too broadly.
					let relevantAgents: AgentId[] | undefined;
					if (embedding.length > 0) {
						const similar = await ctx.db.querySemanticallySimilarFindings(embedding, 20, 0.45);
						// Score each agent by their best similarity match
						const agentBestSim = new Map<AgentId, number>();
						for (const s of similar) {
							if (s.agent_id === ctx.agentId) continue;
							const prev = agentBestSim.get(s.agent_id) ?? 0;
							if (s.similarity > prev) agentBestSim.set(s.agent_id, s.similarity);
						}
						if (agentBestSim.size > 0) {
							// Take top 2 agents by similarity score
							relevantAgents = [...agentBestSim.entries()]
								.sort((a, b) => b[1] - a[1])
								.slice(0, 2)
								.map(([agentId]) => agentId);
						}
					}
					await ctx.db.createReactionsForFinding(finding.id, ctx.agentId, relevantAgents);
				}

				ctx.eventBus.emit('finding:created', {
					finding,
					agent_id: ctx.agentId,
				});
				await logAndEmit(ctx, 'write_finding', `Created finding: "${finding.title}" [${finding.category}]`);

				return `Finding created successfully.\n  ID: ${finding.id}\n  Title: ${finding.title}\n  Category: ${finding.category}\n  Confidence: ${(finding.confidence * 100).toFixed(0)}%${ctx.currentRound >= 2 ? '\n  Reaction records created for other agents.' : ''}`;
			}),
		}),

		// ── create_connection ──────────────────────────────────────────────────
		new FunctionTool({
			name: 'create_connection',
			description:
				"Create a connection between two findings in the knowledge graph. CROSS-AGENT connections are the most valuable — they enable thesis creation. Relationship types: supports (A provides evidence for B), contradicts (A conflicts with, undermines, qualifies, or limits B — the HIGHEST-VALUE relationship type), enables (A makes B possible or more likely), amplifies (A strengthens the impact of B). IMPORTANT: 'contradicts' doesn't require total disagreement — use it for partial conflicts, qualifications, caveats, or when one finding reveals risks the other ignores. The swarm needs at least 15% contradicts connections for healthy analysis. Both finding IDs must be full UUIDs.",
			parameters: schemas.create_connection,
			execute: safeExecute(async (input) => {
				if (ctx.shuttingDown || ctx.timedOut) {
					return 'Error: Task is completing. Focus on voting on existing theses using vote_on_thesis, then call mark_round_ready.';
				}
				const fromId = input.from_finding_id as string;
				const toId = input.to_finding_id as string;

				// Validate that both finding IDs exist before creating the connection
				const [fromFinding, toFinding] = await Promise.all([ctx.db.getFinding(fromId), ctx.db.getFinding(toId)]);
				if (!fromFinding) {
					return `Error: from_finding_id "${fromId}" does not exist. Use read_findings to get valid finding IDs. IDs must be full UUIDs (36 characters), not truncated.`;
				}
				if (!toFinding) {
					return `Error: to_finding_id "${toId}" does not exist. Use read_findings to get valid finding IDs. IDs must be full UUIDs (36 characters), not truncated.`;
				}

				// Deduplication: skip if an equivalent connection already exists
				const existingFrom = await ctx.db.getConnections(fromId);
				const duplicate = existingFrom.find((c) => c.to_finding_id === toId && c.relationship === input.relationship);
				if (duplicate) {
					return `Connection already exists: ${fromFinding.title} --${duplicate.relationship}--> ${toFinding.title}. Use your remaining turns for theses or new analysis instead.`;
				}

				// Quality gate: block same-agent "contradicts" between semantically similar findings
				if (input.relationship === 'contradicts' && fromFinding.agent_id === toFinding.agent_id) {
					const [fromEmb, toEmb] = await Promise.all([
						ctx.db.getFindingEmbedding(fromId),
						ctx.db.getFindingEmbedding(toId),
					]);
					if (fromEmb && toEmb) {
						const sim = cosineSimilarity(fromEmb, toEmb);
						if (sim > SAME_AGENT_CONTRADICTS_SIM_THRESHOLD) {
							return `Cannot create 'contradicts' connection between your own findings "${fromFinding.title}" and "${toFinding.title}" — they are too semantically similar (${(sim * 100).toFixed(0)}%). A genuine contradiction should involve substantially different claims. Try connecting to findings from other agents instead.`;
						}
					}
				}

				const connection = await ctx.db.createConnection({
					from_finding_id: input.from_finding_id as string,
					to_finding_id: input.to_finding_id as string,
					relationship: input.relationship as ConnectionRelationship,
					strength: input.strength as number,
					reasoning: input.reasoning as string,
					created_by: ctx.agentId,
					round: ctx.currentRound,
				});

				ctx.eventBus.emit('connection:created', {
					connection,
					agent_id: ctx.agentId,
				});
				const crossAgent = fromFinding.agent_id !== toFinding.agent_id;
				await logAndEmit(
					ctx,
					'create_connection',
					`${crossAgent ? '⚡ ' : ''}"${fromFinding.title}" —${connection.relationship}→ "${toFinding.title}"`,
				);

				return `Connection created successfully.\n  ID: ${connection.id}\n  "${fromFinding.title}" --${connection.relationship}--> "${toFinding.title}"\n  Strength: ${(connection.strength * 100).toFixed(0)}%${crossAgent ? '\n  ⚡ Cross-agent connection!' : ''}`;
			}),
		}),

		// ── read_connections ───────────────────────────────────────────────────
		new FunctionTool({
			name: 'read_connections',
			description:
				'Read connections from the knowledge graph. Optionally filter by a specific finding to see all connections it participates in.',
			parameters: schemas.read_connections,
			execute: safeExecute(async (input) => {
				const connections = await ctx.db.getConnections(input.finding_id as string | undefined);
				if (connections.length === 0) {
					return input.finding_id
						? `No connections found for finding ${input.finding_id}.`
						: 'No connections exist in the knowledge graph yet.';
				}
				const header = `Found ${connections.length} connection(s):`;
				const body = connections.map((c, i) => `${i + 1}.\n${formatConnection(c)}`).join('\n\n');
				return `${header}\n\n${body}`;
			}),
		}),

		// ── traverse_connections ───────────────────────────────────────────────
		new FunctionTool({
			name: 'traverse_connections',
			description:
				'Starting from a finding, traverse the connection graph to discover multi-hop chains of related findings.',
			parameters: schemas.traverse_connections,
			execute: safeExecute(async (input) => {
				const startId = input.start_finding_id as string;
				const maxDepth = (input.max_depth as number | undefined) ?? 3;
				const minStrength = (input.min_strength as number | undefined) ?? 0.3;

				await logAndEmit(
					ctx,
					'traverse_connections',
					`Traversing connections from ${startId.slice(0, 8)}... (depth: ${maxDepth}, min strength: ${minStrength})`,
				);

				const { findings, connections } = await ctx.db.traverseConnections(startId, maxDepth, minStrength);
				const startFinding = findings.find((f) => f.id === startId);
				if (!startFinding) return JSON.stringify({ error: `Finding not found: ${startId}` }, null, 2);

				const findingMap = new Map(findings.map((f) => [f.id, f]));
				const lines: string[] = [
					`Connection chain from: "${startFinding.title}" (${startFinding.agent_id})`,
					`Depth: ${maxDepth}, Min strength: ${minStrength}`,
					`Nodes discovered: ${findings.length}`,
					'',
					`[${startFinding.agent_id}] "${startFinding.title}" (confidence: ${startFinding.confidence})`,
					`  Tags: ${startFinding.tags.join(', ')}`,
				];

				for (const conn of connections) {
					const neighbor =
						conn.from_finding_id === startId
							? findingMap.get(conn.to_finding_id)
							: findingMap.get(conn.from_finding_id);
					lines.push(`  --[${conn.relationship} (${conn.strength.toFixed(2)})]-->`);
					if (neighbor) {
						lines.push(`  [${neighbor.agent_id}] "${neighbor.title}" (confidence: ${neighbor.confidence})`);
						lines.push(`    Tags: ${neighbor.tags.join(', ')}`);
					}
				}

				return JSON.stringify(
					{
						start: startId,
						nodes_discovered: findings.length,
						finding_ids: findings.map((f) => f.id),
						connection_ids: connections.map((c) => c.id),
						chain_text: lines.join('\n'),
					},
					null,
					2,
				);
			}),
		}),

		// ── find_tensions ─────────────────────────────────────────────────────
		new FunctionTool({
			name: 'find_tensions',
			description:
				'Find tensions between your findings and other agents\' findings. CALL THIS EVERY ROUND after round 1. Uses semantic similarity to surface cross-agent finding pairs that likely conflict or qualify each other. For EACH returned pair, you MUST evaluate whether a "contradicts" connection is warranted and create one with create_connection if so. This is one of the HIGHEST-VALUE actions in the swarm — tension identification prevents groupthink and is essential for strong synthesis.',
			parameters: schemas.find_tensions,
			execute: safeExecute(async (input) => {
				const limit = (input.limit as number | undefined) ?? 5;

				const topicEmbedding = await ctx.embeddingService.generateEmbedding(ctx.prompt);
				const candidates = await ctx.db.findTensionCandidates(ctx.agentId, topicEmbedding, limit, 0.4);

				await logAndEmit(ctx, 'find_tensions', `Found ${candidates.length} tension candidate(s)`);

				if (candidates.length === 0) {
					return 'No tension candidates found. This could mean all cross-agent pairs are already connected, or embeddings are too dissimilar. Try creating findings on topics where you disagree with other agents.';
				}

				const lines: string[] = [
					`Found ${candidates.length} potential tension(s) between your findings and other agents':`,
					'',
					'For each pair, consider: do these findings conflict, qualify each other, or present different conclusions about the same topic?',
					'If so, use create_connection with relationship="contradicts" to link them.',
					'',
				];

				for (let i = 0; i < candidates.length; i++) {
					const { finding_a, finding_b, similarity } = candidates[i];
					lines.push(
						`--- Tension Candidate ${i + 1} (similarity: ${(similarity * 100).toFixed(0)}%) ---`,
						`YOUR finding: [${finding_a.id}] "${finding_a.title}"`,
						`  ${finding_a.description.slice(0, 200)}`,
						`THEIR finding (${finding_b.agent_id}): [${finding_b.id}] "${finding_b.title}"`,
						`  ${finding_b.description.slice(0, 200)}`,
						'',
					);
				}

				lines.push(
					'ACTION: For each pair where you see a genuine conflict or tension, call create_connection with:',
					'  from_finding_id=<your finding ID>, to_finding_id=<their finding ID>, relationship="contradicts"',
				);

				return lines.join('\n');
			}),
		}),
	];
}

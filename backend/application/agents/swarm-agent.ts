// ── Swarm Agent ─────────────────────────────────────────────────────────────
// Async round-based orchestration loop: reactions → primary work → advance.
// Each agent tracks its own round independently — no global synchronization barrier.
// Delegates LLM execution to AdkRunner and prompt construction to prompt-builder.

import type { AgentConfig } from '../../domain/agents.js';
import type { SwarmConfig } from '../../domain/ports/config.js';
import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import type { SwarmEventBus } from '../../domain/ports/event-bus.js';
import type { KnowledgeGraphDB } from '../../domain/ports/knowledge-graph.js';
import type { Logger } from '../../domain/ports/logger.js';
import type { AgentStatusType, Finding, InvestmentThesis } from '../../domain/types.js';
import { AdkRunner } from './adk-runner.js';
import { getUnvotedTheses } from './agent-utils.js';
import { MIN_CHALLENGE_RATIO, STALE_HEARTBEAT_MS } from './constants.js';
import { buildDynamicPrompt, buildKnowledgeContext, buildRoundSummary } from './prompt-builder.js';
import { WebSearchBudget } from './tools/google-search-limited.js';
import { createAgentTools } from './tools/index.js';
import type { SwarmToolContext } from './tools/types.js';
import type { SwarmAgentDeps } from './types.js';

/** Max iterations of the main agent loop before force-breaking (safety valve). */
const MAX_LOOP_ITERATIONS = 200;
/** Max consecutive reaction-only loops before forcing round advancement. */
const MAX_CONSECUTIVE_REACTION_LOOPS = 5;
/** Max voting passes before auto-marking ready (prevents infinite voting loops). */
const MAX_VOTING_PASSES = 3;

export class SwarmAgent {
	readonly config: AgentConfig;
	private db: KnowledgeGraphDB;
	private eventBus: SwarmEventBus;
	private prompt: string;
	private swarmConfig: SwarmConfig;
	private running = true;
	private roundWorkDone = new Set<number>();
	private roundReactionsCount = new Map<number, number>();
	private agentTagMap: Record<string, string[]>;
	private logger: Logger;
	private deps: SwarmAgentDeps;
	private adkRunner: AdkRunner;
	private webSearchBudget = new WebSearchBudget();
	private embeddingService: EmbeddingPort;
	private promptEmbedding: number[] | null = null;
	/** Set by mark_round_ready tool, checked by AdkRunner to exit early. Reset each runAdkAgent call. */
	private roundReady = false;
	/** True once thesis threshold is met — agent finishes voting then exits. */
	private shuttingDown = false;
	/** Per-agent round counter — each agent advances independently. */
	private currentRound = 1;

	constructor(
		config: AgentConfig,
		db: KnowledgeGraphDB,
		eventBus: SwarmEventBus,
		prompt: string,
		agentTagMap: Record<string, string[]>,
		deps: SwarmAgentDeps,
	) {
		this.config = config;
		this.db = db;
		this.eventBus = eventBus;
		this.prompt = prompt;
		this.swarmConfig = deps.swarmConfig;
		this.agentTagMap = agentTagMap;
		this.logger = deps.logger;
		this.deps = deps;
		this.embeddingService = deps.embeddingService;

		this.adkRunner = new AdkRunner({
			agentId: config.id,
			model: config.model,
			systemPrompt: config.systemPrompt,
			maxTurnsPerRound: Math.min(deps.swarmConfig.maxTurnsPerRound, config.maxTurnsPerRound),
			db,
			eventBus,
			rateLimiter: deps.rateLimiter,
			logger: deps.logger,
			enableDebug: deps.swarmConfig.adkDebug,
			runTimeoutMs: deps.swarmConfig.adkRunTimeoutMs,
			circuitBreaker: deps.circuitBreaker,
		});
	}

	// ── Main Run Loop ─────────────────────────────────────────────────────
	// Async round advancement: each agent tracks its own round and advances
	// independently. No global synchronization barrier — agents proceed as
	// soon as they finish their work for a round.

	async run(): Promise<void> {
		const maxRounds = this.config.maxRounds ?? this.swarmConfig.maxRounds;
		const thesisThreshold = this.config.thesisThreshold ?? this.swarmConfig.thesisThreshold;

		await this.db.updateAgentStatus(this.config.id, 'idle', 'Starting up');
		await this.logAndEmitActivity(1, 'started', `${this.config.id} agent online`);

		let loopIterations = 0;
		let consecutiveReactionLoops = 0;
		let votingPassesThisRound = 0;

		try {
			while (this.running) {
				// Safety valve: prevent runaway loops
				if (++loopIterations > MAX_LOOP_ITERATIONS) {
					this.log(`Safety limit reached (${MAX_LOOP_ITERATIONS} iterations). Force-exiting.`);
					break;
				}

				const roundStart = Date.now();

				if (this.currentRound > maxRounds) {
					this.log(`Max rounds (${maxRounds}) reached. Shutting down.`);
					break;
				}

				const theses = await this.db.getTheses();
				const votedTheses = theses.filter((t) => t.votes.length > 0);

				// ── Shutdown exit point (fires on the round AFTER shutdown was triggered) ──
				if (this.shuttingDown || votedTheses.length >= thesisThreshold) {
					if (!this.shuttingDown) {
						this.log(
							`Thesis threshold met (${votedTheses.length}/${thesisThreshold} with votes). Entering graceful shutdown.`,
						);
						this.shuttingDown = true;
					}
					// Final voting pass on any theses we haven't voted on yet
					const allTheses = await this.db.getTheses();
					const unvoted = getUnvotedTheses(this.config.id, allTheses);
					if (unvoted.length > 0) {
						await this.setStatus('thinking', `Shutdown: voting on ${unvoted.length} thesis(es)`);
						await this.runVotingPass(this.currentRound, unvoted);
					}
					await this.db.markAgentReady(this.config.id);
					this.log('Graceful shutdown complete. Exiting agent loop.');
					break;
				}

				await this.db.heartbeat(this.config.id);
				await this.checkPeerHealth();

				// Step 1: Handle pending reactions (priority, but don't strictly block)
				// Reactions can come from peers in any round — not gated by round matching.
				const reactionsHandled = this.roundReactionsCount.get(this.currentRound) ?? 0;
				let handledReactionsThisPass = false;
				const pendingReactions = await this.db.getPendingReactions(this.config.id);
				if (pendingReactions.length > 0) {
					const maxReactions = this.swarmConfig.maxReactionsPerRound;
					if (reactionsHandled >= maxReactions) {
						this.log(`Reaction limit reached (${maxReactions}), skipping ${pendingReactions.length} remaining`);
						await this.batchSkipReactions(pendingReactions, `Reaction limit (${maxReactions}) reached for this round`);
					} else {
						const batch = pendingReactions.slice(0, maxReactions - reactionsHandled);
						await this.setStatus('reacting', `Reacting to ${batch.length} finding(s)`);
						await this.handleReactions(batch, this.currentRound);

						// Auto-skip any reactions from this batch that the LLM didn't address
						const batchIds = new Set(batch.map((r) => r.id));
						const stillPending = await this.db.getPendingReactions(this.config.id);
						const unreacted = stillPending.filter((r) => batchIds.has(r.id));
						if (unreacted.length > 0) {
							await this.batchSkipReactions(unreacted, 'Not addressed during reaction pass');
							this.log(`Auto-skipped ${unreacted.length} unreacted finding(s) from batch`);
						}

						this.roundReactionsCount.set(this.currentRound, reactionsHandled + batch.length);
						handledReactionsThisPass = true;
					}
				}

				// Step 2: Do primary work for this round
				if (!this.roundWorkDone.has(this.currentRound)) {
					await this.setStatus('thinking', `Round ${this.currentRound} primary analysis`);
					await this.doPrimaryWork(this.currentRound);
					this.roundWorkDone.add(this.currentRound);

					await this.emitRoundProgress(this.currentRound);
				}

				// ── Graceful shutdown: vote on remaining theses before marking ready ──
				if (this.shuttingDown) {
					const allTheses = await this.db.getTheses();
					const unvoted = getUnvotedTheses(this.config.id, allTheses);
					if (unvoted.length > 0) {
						await this.setStatus('thinking', `Shutdown: voting on ${unvoted.length} thesis(es)`);
						await this.runVotingPass(this.currentRound, unvoted);
					}
				}

				// Step 3: Check for new pending reactions (if we didn't just handle some)
				// Cap consecutive reaction-only loops to prevent infinite cycling
				if (!handledReactionsThisPass && !this.shuttingDown) {
					const newReactions = await this.db.getPendingReactions(this.config.id);
					if (newReactions.length > 0) {
						consecutiveReactionLoops++;
						if (consecutiveReactionLoops <= MAX_CONSECUTIVE_REACTION_LOOPS) {
							continue;
						}
						this.log(
							`Reaction loop cap reached (${MAX_CONSECUTIVE_REACTION_LOOPS}), skipping ${newReactions.length} reactions to advance round`,
						);
						await this.batchSkipReactions(newReactions, 'Reaction loop cap reached — advancing round');
					}
				}
				consecutiveReactionLoops = 0;

				// Step 4: If the LLM called mark_round_ready during primary work, advance.
				// Otherwise, vote on unvoted theses and run another pass.
				if (!this.roundReady) {
					const currentTheses = await this.db.getTheses();
					const unvoted = getUnvotedTheses(this.config.id, currentTheses);
					if (unvoted.length > 0 && votingPassesThisRound < MAX_VOTING_PASSES) {
						votingPassesThisRound++;
						this.log(
							`Cannot auto-ready: ${unvoted.length} unvoted thesis(es). Running voting pass (${votingPassesThisRound}/${MAX_VOTING_PASSES}).`,
						);
						await this.setStatus('thinking', `Voting on ${unvoted.length} thesis(es)`);
						await this.runVotingPass(this.currentRound, unvoted);
						// If the voting pass called mark_round_ready, proceed to advance
						if (!this.roundReady) continue;
					} else {
						// No unvoted theses, or voting pass cap reached — auto-mark ready
						if (unvoted.length > 0) {
							this.log(
								`Voting pass cap reached (${MAX_VOTING_PASSES}). Auto-marking ready with ${unvoted.length} unvoted thesis(es).`,
							);
						}
						await this.db.markAgentReady(this.config.id);
						await this.logAndEmitActivity(
							this.currentRound,
							'mark_round_ready',
							`Auto-ready for round ${this.currentRound + 1}`,
						);
						this.roundReady = true;
					}
				}

				// Also update global round state if all living agents are ready
				// (keeps round_state consistent for SSE/frontend)
				if (await this.db.isRoundReady()) {
					await this.db.advanceRound();
				}

				const prevRound = this.currentRound;

				// Advance this agent's own round immediately — no waiting
				this.currentRound = await this.db.advanceAgentRound(this.config.id);
				this.eventBus.emit('round:advanced', {
					from: prevRound,
					to: this.currentRound,
					agent_id: this.config.id,
				});

				// Reset per-round counters
				votingPassesThisRound = 0;
				consecutiveReactionLoops = 0;

				this.log(
					`Round ${prevRound} completed in ${Date.now() - roundStart}ms, advancing to round ${this.currentRound}`,
				);
			}
		} finally {
			this.running = false;
			this.log('Agent loop ended');
		}
	}

	stop(): void {
		this.running = false;
	}

	async kill(): Promise<void> {
		this.running = false;
		await this.db.markAgentDead(this.config.id);
		this.eventBus.emit('agent:died', { agent_id: this.config.id });
		await this.logAndEmitActivity(this.currentRound, 'killed', `${this.config.id} agent was killed`);
		this.log('Agent killed');
	}

	// ── Primary Work ──────────────────────────────────────────────────────

	/** Lazy accessor — computes the embedding once and caches it for the agent's lifetime. */
	private async getCategoryEmbedding(): Promise<number[]> {
		if (!this.promptEmbedding) {
			this.promptEmbedding = await this.embeddingService.generateEmbedding(this.prompt);
		}
		return this.promptEmbedding;
	}

	private async doPrimaryWork(round: number): Promise<void> {
		const maxRounds = this.config.maxRounds ?? this.swarmConfig.maxRounds;

		// Fetch embedding first (semantic search depends on it), then run all DB queries in parallel
		const topicEmbedding = await this.getCategoryEmbedding();
		const [allFindings, allConnections, theses, agentStatuses, toolUsageStats, semanticFindings] = await Promise.all([
			this.db.queryFindings({ limit: 100 }),
			this.db.getConnections(),
			this.db.getTheses(),
			this.db.getAgentStatuses(),
			this.db.getToolUsageStats(),
			this.db.querySemanticallySimilarFindings(topicEmbedding, 5, 0.4),
		]);

		const knowledgeContext = buildKnowledgeContext(allFindings, semanticFindings, allConnections, theses);
		const dynamicPrompt = buildDynamicPrompt(
			this.config.id,
			allFindings,
			allConnections,
			theses,
			round,
			maxRounds,
			toolUsageStats,
		);

		const roundSummary = round >= 2 ? buildRoundSummary(round - 1, allFindings, allConnections, theses) : '';

		const userMessage = `
=== RESEARCH REQUEST ===
${this.prompt}

CURRENT ROUND: ${round} (max ${maxRounds})
${roundSummary ? `\n${roundSummary}\n` : ''}
${dynamicPrompt}

=== CURRENT KNOWLEDGE GRAPH ===
${knowledgeContext}

=== AGENT STATUS ===
${agentStatuses.map((a) => `${a.agent_id}: ${a.status} (${a.findings_count} findings)`).join('\n')}

Read the SITUATION ASSESSMENT above and adapt. The swarm's goal is to produce well-supported THESES. Findings and connections are building blocks — use them to create theses.${round === 1 ? ` FIRST: Call web_search to establish the CURRENT state of the subject with specific, verifiable data as of today (${new Date().toISOString().split('T')[0]}). Your very first finding MUST anchor the current state with concrete metrics — numbers, dates, and named sources. Without this anchor, all subsequent analysis risks being based on outdated information. Use specific queries like "[subject] latest data March 2026" or "[subject] current status 2026". Then continue with domain-specific research.` : ' FIRST: Call web_search to get the latest news and data. Then focus on primary research — write new findings backed by evidence. Use find_tensions if you want to surface genuine cross-agent conflicts worth capturing.'} You MUST vote on all existing theses before calling mark_round_ready.
`.trim();

		await this.runAdkAgent(userMessage, round);
	}

	// ── Reaction Handling ─────────────────────────────────────────────────

	private async handleReactions(
		reactions: Array<{ id: string; finding_id: string; finding: Finding }>,
		round: number,
	): Promise<void> {
		const reactionsText = reactions
			.map((r, i) => {
				const refsLine =
					r.finding.references.length > 0
						? `References: ${r.finding.references.map((ref) => (ref.url ? `${ref.title} (${ref.url})` : ref.title)).join('; ')}`
						: '';
				return (
					`[Reaction ${i + 1}] Reaction ID: ${r.id}\n` +
					`Finding ID: ${r.finding_id}\n` +
					`From: ${r.finding.agent_id} (Round ${r.finding.round})\n` +
					`Title: ${r.finding.title}\n` +
					`Description: ${r.finding.description}\n` +
					`Tags: ${r.finding.tags.join(', ')}\n` +
					`Confidence: ${r.finding.confidence}` +
					(refsLine ? `\n${refsLine}` : '')
				);
			})
			.join('\n\n---\n\n');

		// Semantic Search: Find older findings relevant to the findings we are reacting to
		// We concatenate the titles to get a blend vector of what we're looking at
		const contextText = `${reactions.map((r) => r.finding.title).join(' ')} ${this.prompt}`;
		const reactionEmbedding = await this.embeddingService.generateEmbedding(contextText);
		const [allFindings, semanticFindings, allConnections, theses] = await Promise.all([
			this.db.queryFindings({ limit: 100 }),
			this.db.querySemanticallySimilarFindings(reactionEmbedding, 5, 0.4),
			this.db.getConnections(),
			this.db.getTheses(),
		]);
		const knowledgeContext = buildKnowledgeContext(allFindings, semanticFindings, allConnections, theses);
		const maxRounds = this.config.maxRounds ?? this.swarmConfig.maxRounds;

		const myFindings = allFindings.filter((f) => f.agent_id === this.config.id);
		const myFindingsText =
			myFindings.length > 0
				? myFindings.map((f) => `  [${f.id}] "${f.title}" (tags: ${f.tags.join(', ')})`).join('\n')
				: '  (none yet — create findings first, then connect them)';

		const userMessage = `
You are analyzing the topic: "${this.prompt}"
CURRENT ROUND: ${round} (max ${maxRounds})

You have ${reactions.length} pending reaction(s) from other agents' findings. For EACH reaction:

1. REACT using react_to_finding — explain how this finding relates to your current analysis from your perspective.
2. CREATE A CROSS-AGENT CONNECTION using create_connection — link this finding to one of YOUR findings. Pick the relationship type honestly: "supports" if aligned, "contradicts" only for genuine substantive conflicts (not just different emphasis or added nuance), "amplifies" if it reinforces, "enables" if it unlocks something. Most connections should be supports/amplifies/enables — contradicts should be reserved for real disagreements.
3. FOLLOWUP FINDING (optional): Only if the reaction reveals a genuinely new insight not yet captured anywhere in the knowledge graph — create it with create_followup_finding=true. Don't create followups just to add more findings; they must add distinct new information.

=== YOUR FINDINGS (use these IDs for create_connection) ===
${myFindingsText}

=== FINDINGS REQUIRING YOUR REACTION ===
${reactionsText}

=== CURRENT KNOWLEDGE GRAPH ===
${knowledgeContext}

React to ALL pending findings. For each one, try to create at least one cross-agent connection linking their finding to one of yours.
`.trim();

		await this.runAdkAgent(userMessage, round);
	}

	// ── ADK Delegation ────────────────────────────────────────────────────

	private async runAdkAgent(userMessage: string, round: number): Promise<void> {
		this.roundReady = false;

		const maxRounds = this.config.maxRounds ?? this.swarmConfig.maxRounds;
		const toolCtx: SwarmToolContext = {
			agentId: this.config.id,
			db: this.db,
			eventBus: this.eventBus,
			prompt: this.prompt,
			currentRound: round,
			agentTagMap: this.agentTagMap,
			config: {
				maxFindingsPerRound: this.swarmConfig.maxFindingsPerRound,
				maxRounds,
				maxTheses: this.swarmConfig.maxTheses,
				googleSearchEnabled: this.swarmConfig.googleSearchEnabled,
				googleSearchMaxPerRound: this.swarmConfig.googleSearchMaxPerRound,
				geminiModel: this.swarmConfig.geminiModel,
			},
			rateLimiter: this.deps.rateLimiter,
			logger: this.logger,
			webSearchBudget: this.webSearchBudget,
			shuttingDown: this.shuttingDown,
			timedOut: false,
			embeddingService: this.embeddingService,
		};

		const tools = createAgentTools({
			ctx: toolCtx,
			onRoundReady: () => {
				this.roundReady = true;
			},
		});

		await this.adkRunner.run(userMessage, round, tools, {
			isRoundReady: () => this.roundReady,
			isRunning: () => this.running,
			onTimeout: () => {
				toolCtx.timedOut = true;
			},
		});
	}

	// ── Voting Pass ──────────────────────────────────────────────────────

	/**
	 * Run a focused LLM pass to vote on unvoted theses.
	 * Called when the agent tries to auto-ready but has unvoted theses.
	 */
	private async runVotingPass(round: number, unvoted: InvestmentThesis[]): Promise<void> {
		const thesisList = unvoted
			.map(
				(t, i) =>
					`${i + 1}. "${t.title}" (ID: ${t.id})\n` +
					`   Thesis: ${t.thesis}\n` +
					`   Confidence: ${(t.confidence * 100).toFixed(0)}% | By: ${t.created_by}\n` +
					`   Current votes: ${t.votes.map((v) => `${v.agent_id}: ${v.vote}`).join(', ') || 'none'}`,
			)
			.join('\n\n');

		const minChallenges = Math.max(1, Math.ceil(unvoted.length * MIN_CHALLENGE_RATIO));

		const userMessage = `
You have ${unvoted.length} thesis(es) that need your vote before you can finish this round.

For EACH thesis below, evaluate from your analytical perspective:
- Vote "support" if the thesis is well-evidenced and consistent with your analysis
- Vote "challenge" if: the evidence is weak or cherry-picked, the thesis overstates the case, key factors are ignored, or your findings contradict the thesis

IMPORTANT: You MUST challenge at least ${minChallenges} out of ${unvoted.length} thesis(es). Genuine disagreement prevents groupthink and produces higher-quality output. Every "challenge" vote must include specific reasoning and, when possible, cite a finding ID.

=== THESES AWAITING YOUR VOTE ===
${thesisList}

Vote on ALL of them now using vote_on_thesis, then call mark_round_ready.
`.trim();

		await this.runAdkAgent(userMessage, round);
	}

	// ── Peer Health ───────────────────────────────────────────────────────

	private async checkPeerHealth(): Promise<void> {
		const statuses = await this.db.getAgentStatuses();
		const now = new Date();

		for (const s of statuses) {
			if (s.agent_id === this.config.id) continue;
			if (s.status === 'dead') continue;

			const lastBeat = new Date(s.last_heartbeat);
			const staleMs = now.getTime() - lastBeat.getTime();

			if (staleMs > STALE_HEARTBEAT_MS) {
				// markAgentDead sets status='dead' and skips all pending reactions for this agent
				await this.db.markAgentDead(s.agent_id);
				const roundState = await this.db.getRoundState();

				this.eventBus.emit('agent:died', { agent_id: s.agent_id });
				await this.logAndEmitActivity(roundState.round_number, 'agent_died', `Detected ${s.agent_id} is offline`);
				this.log(`Detected ${s.agent_id} is dead (${staleMs}ms stale)`);
			}
		}
	}

	// ── Utilities ─────────────────────────────────────────────────────────

	/** Skip a batch of reactions in parallel. No-op if the array is empty. */
	private async batchSkipReactions(reactions: Array<{ id: string }>, reason: string): Promise<void> {
		if (reactions.length === 0) return;
		await Promise.all(reactions.map((r) => this.db.skipReaction(r.id, reason)));
	}

	private async setStatus(status: AgentStatusType, task?: string): Promise<void> {
		await this.db.updateAgentStatus(this.config.id, status, task);
		this.eventBus.emit('agent:status', {
			agent_id: this.config.id,
			status,
			task,
		});
	}

	/**
	 * Emit a human-readable progress summary after a round's primary work.
	 * Derives what happened from the DB — no LLM call.
	 */
	private async emitRoundProgress(round: number): Promise<void> {
		try {
			const [myFindings, allConnections, theses] = await Promise.all([
				this.db.queryFindings({ agent_id: this.config.id, round }),
				this.db.getConnections(),
				this.db.getTheses(),
			]);

			const myConnections = allConnections.filter((c) => c.created_by === this.config.id && c.round === round);
			const myTheses = theses.filter((t) => t.created_by === this.config.id);
			// Only count theses created this round (approximate via creation timestamp)
			const newTheses = myTheses.filter((t) => {
				const createdAt = new Date(t.created_at).getTime();
				return Date.now() - createdAt < 120_000;
			});

			const parts: string[] = [];

			if (myFindings.length > 0) {
				const best = myFindings.reduce((a, b) => (b.confidence > a.confidence ? b : a));
				if (myFindings.length === 1) {
					parts.push(`Researched "${best.title}"`);
				} else {
					parts.push(`Found ${myFindings.length} insights, including "${best.title}"`);
				}
			}

			if (myConnections.length > 0) {
				// Resolve actual agents for both sides of each connection
				const referencedIds = new Set<string>();
				for (const c of myConnections) {
					referencedIds.add(c.from_finding_id);
					referencedIds.add(c.to_finding_id);
				}
				const referencedFindings = await this.db.queryFindingsByIds([...referencedIds]);
				const agentByFindingId = new Map(referencedFindings.map((f) => [f.id, f.agent_id]));

				const crossAgent = myConnections.filter((c) => {
					const fromAgent = agentByFindingId.get(c.from_finding_id);
					const toAgent = agentByFindingId.get(c.to_finding_id);
					return fromAgent && toAgent && fromAgent !== toAgent;
				});
				if (crossAgent.length > 0) {
					parts.push(`made ${crossAgent.length} cross-agent connection(s)`);
				} else {
					parts.push(`made ${myConnections.length} connection(s)`);
				}
			}

			if (newTheses.length > 0) {
				parts.push(`proposed "${newTheses[0].title}"`);
			}

			if (parts.length > 0) {
				const summary = parts.join(', ');
				await this.logAndEmitActivity(round, 'round_progress', summary);
			}
		} catch (err) {
			this.logger.error('Failed to emit round progress', err);
		}
	}

	private async logAndEmitActivity(round: number, action: string, summary: string): Promise<void> {
		await this.db.logActivity(this.config.id, round, action, summary);
		this.eventBus.emit('activity:logged', {
			agent_id: this.config.id,
			round,
			action,
			summary,
			created_at: new Date().toISOString(),
		});
	}

	private log(message: string): void {
		this.logger.info(message);
	}
}

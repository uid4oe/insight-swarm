// ── Web Search Function Tool ────────────────────────────────────────────────
// A FunctionTool that agents call on-demand: web_search({ query: "..." }).
// Under the hood it runs a one-shot search-only LLM agent with GOOGLE_SEARCH
// grounding (no function tools), avoiding the Gemini API 400 error when mixing
// googleSearch with function calling. The agent stays autonomous — it decides
// when and what to search. A per-round call counter enforces the budget.

import { FunctionTool, GOOGLE_SEARCH, InMemorySessionService, LlmAgent, Runner } from '@google/adk';
import type { GroundingChunkWeb } from '@google/genai';
import { z } from 'zod';
import type { Logger } from '../../../domain/ports/logger.js';
import type { RateLimiter } from '../../../domain/ports/rate-limiter.js';
import { PERMISSIVE_SAFETY } from '../safety.js';

/** Unique web source extracted from grounding metadata. */
interface GroundingSource {
	url: string;
	title: string;
}

const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const REDIRECT_TIMEOUT_MS = 3_000;
/** Global timeout for resolving all grounding source redirect URLs. */
const RESOLVE_ALL_TIMEOUT_MS = 10_000;

/**
 * Follow a Google grounding redirect URL to get the real destination.
 * Returns the resolved URL, or the original URL if resolution fails.
 */
async function resolveRedirectUrl(url: string): Promise<string> {
	if (!url.includes(REDIRECT_HOST)) return url;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
		const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
		clearTimeout(timer);
		const location = res.headers.get('location');
		return location ?? url;
	} catch {
		return url;
	}
}

/**
 * Resolve all redirect URLs in parallel, returning sources with real URLs.
 * Drops any sources whose URLs still point at a redirect after resolution.
 */
async function resolveGroundingSources(sources: GroundingSource[]): Promise<GroundingSource[]> {
	// Apply a global timeout to prevent unbounded blocking when many sources need resolution
	const resolveAll = Promise.all(
		sources.map(async (src) => {
			const url = await resolveRedirectUrl(src.url);
			return { ...src, url };
		}),
	);

	let resolved: GroundingSource[];
	try {
		resolved = await Promise.race([
			resolveAll,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Redirect resolution timeout')), RESOLVE_ALL_TIMEOUT_MS),
			),
		]);
	} catch {
		// On timeout, return sources that don't need resolution (non-redirect URLs)
		return sources.filter((s) => !s.url.includes(REDIRECT_HOST));
	}

	// Drop any that still failed to resolve (still a redirect URL)
	return resolved.filter((s) => !s.url.includes(REDIRECT_HOST));
}

const webSearchParams = z.object({
	query: z
		.string()
		.describe(
			'The search query. NEVER use generic queries like "[topic] outlook" or "[topic] analysis". Instead target SPECIFIC data points: "[subject] latest statistics March 2026", "[subject] key metrics Q1 2026", "[subject] recent regulatory changes 2026". Always include the current year and month for time-sensitive data. Each search should retrieve one concrete, verifiable data point.',
		),
});

/**
 * Compute the per-round search budget. Later rounds get more searches
 * because agents need to validate specific claims and check current data,
 * while early rounds are more about broad exploration.
 *
 * Round 1: base - 1 (exploration, broad queries)
 * Round 2-3: base (standard)
 * Round 4+: base + 1 (validation, specific data checks)
 */
export function getSearchBudgetForRound(round: number, base: number): number {
	if (round <= 1) return Math.max(1, base - 1);
	if (round >= 4) return base + 1;
	return base;
}

/** Shared counter so the budget survives across multiple tool factory calls within a round. */
export class WebSearchBudget {
	private counts = new Map<number, number>();

	/** Increment and return whether the call is allowed. */
	tryUse(round: number, max: number): boolean {
		const used = this.counts.get(round) ?? 0;
		if (used >= max) return false;
		this.counts.set(round, used + 1);
		return true;
	}

	used(round: number): number {
		return this.counts.get(round) ?? 0;
	}
}

interface WebSearchToolConfig {
	model: string;
	maxCallsPerRound: number;
	rateLimiter: RateLimiter;
	logger: Logger;
	round: number;
	budget: WebSearchBudget;
}

export function createWebSearchTool(config: WebSearchToolConfig): FunctionTool {
	return new FunctionTool({
		name: 'web_search',
		description:
			'Search the web for current information. Use this to find recent data, news, market figures, regulatory changes, or any real-time information. Returns a summary with a Sources section containing [Title](URL) links. When creating findings based on search results, include those URLs in your references array. Budget is limited — use targeted, specific queries.',
		parameters: webSearchParams,
		execute: async (input) => {
			const query = input.query;
			if (!config.budget.tryUse(config.round, config.maxCallsPerRound)) {
				config.logger.warn(
					`web_search BLOCKED — budget exhausted [${config.maxCallsPerRound}/${config.maxCallsPerRound}]`,
				);
				return `Web search budget exhausted (${config.maxCallsPerRound} searches per round). Continue your analysis using the information you already have.`;
			}
			const used = config.budget.used(config.round);
			config.logger.info(`web_search [${used}/${config.maxCallsPerRound}]: "${query}"`);

			try {
				await config.rateLimiter.acquire();

				// Inject today's date into the query if it doesn't already contain the current year+month
				const today = new Date();
				const currentYear = today.getFullYear().toString();
				const currentMonth = today.toLocaleString('en-US', { month: 'long' });
				const dateAnchor = `${currentMonth} ${currentYear}`;
				const anchoredQuery = query.includes(currentYear) ? query : `${query} ${dateAnchor}`;

				const agent = new LlmAgent({
					name: 'web_search_worker',
					model: config.model,
					instruction: `You are a web research assistant. Today's date is ${today.toISOString().split('T')[0]}.

CRITICAL RULES:
- ONLY report data, numbers, and facts that appear in the search results. NEVER fill in numbers from your own knowledge.
- If the search results don't contain a specific number (price, valuation, percentage), say "not found in search results" instead of guessing.
- Always include the DATE associated with any data point you report (e.g., "as of March 7, 2026" or "Q4 2025 earnings").
- If search results show data from different dates, always report the MOST RECENT data and note the date.
- Do NOT include a sources section — source URLs are extracted automatically from grounding metadata.`,
					tools: [GOOGLE_SEARCH],
					generateContentConfig: { maxOutputTokens: 2048, safetySettings: PERMISSIVE_SAFETY },
				});

				const sessionService = new InMemorySessionService();
				const appName = 'insight-swarm-websearch';
				const sessionId = `ws_${Date.now()}_${used}`;

				const runner = new Runner({ appName, agent, sessionService });
				await sessionService.createSession({ appName, userId: 'search', sessionId });

				let result = '';
				const groundingSources: GroundingSource[] = [];
				const SEARCH_TIMEOUT = 30_000;
				let searchTimedOut = false;
				let searchTimeoutId: ReturnType<typeof setTimeout> | undefined;

				const searchDone = (async () => {
					for await (const event of runner.runAsync({
						userId: 'search',
						sessionId,
						newMessage: { role: 'user', parts: [{ text: anchoredQuery }] },
						runConfig: { maxLlmCalls: 3 },
					})) {
						if (searchTimedOut) break;
						if (event.content?.parts) {
							for (const part of event.content.parts) {
								if ('text' in part && part.text) {
									result = part.text;
								}
							}
						}
						// Extract real source URLs from grounding metadata
						if (event.groundingMetadata?.groundingChunks) {
							for (const chunk of event.groundingMetadata.groundingChunks) {
								const web = chunk.web as GroundingChunkWeb | undefined;
								if (web?.uri && web.title) {
									groundingSources.push({
										url: web.uri,
										title: web.title,
									});
								}
							}
						}
					}
				})();

				const timeout = new Promise<never>((_, reject) => {
					searchTimeoutId = setTimeout(() => {
						searchTimedOut = true;
						reject(new Error('Web search timed out'));
					}, SEARCH_TIMEOUT);
					if (searchTimeoutId.unref) searchTimeoutId.unref();
				});
				// Prevent unhandled rejection if searchDone wins the race
				timeout.catch(() => {});

				try {
					await Promise.race([searchDone, timeout]);
				} catch {
					config.logger.warn(`web_search TIMEOUT [${used}/${config.maxCallsPerRound}]: "${query}"`);
					return result.trim() || 'Search timed out. Continue without this search.';
				} finally {
					clearTimeout(searchTimeoutId);
				}

				// Deduplicate grounding sources by URL
				const seenUrls = new Set<string>();
				const uniqueSources: GroundingSource[] = [];
				for (const src of groundingSources) {
					if (!seenUrls.has(src.url)) {
						seenUrls.add(src.url);
						uniqueSources.push(src);
					}
				}

				// Resolve Google grounding redirect URLs to actual destination URLs
				const resolvedSources = await resolveGroundingSources(uniqueSources);

				// Strip any LLM-hallucinated "Sources:" section (often contains vertex.ai / redirect URLs)
				let body = result
					.trim()
					.replace(/\n*Sources?:\s*\n([-*•]\s*(\[.*?\]\(.*?\)|https?:\/\/\S+).*\n?)+$/i, '')
					.trim();

				// Append resolved real sources from grounding metadata
				if (resolvedSources.length > 0) {
					body += '\n\nSources:\n';
					for (const src of resolvedSources) {
						body += `- [${src.title}](${src.url})\n`;
					}
					// Add structured reference block for easy copy into write_finding references
					body += '\nWhen creating findings based on these results, include these as references:\n';
					body += JSON.stringify(
						resolvedSources.slice(0, 5).map((s) => ({ url: s.url, title: s.title })),
						null,
						2,
					);
				}

				// Only append grounding reminder when there are actual results
				// (otherwise body is empty and the || 'No results found.' fallback should fire)
				if (body.length > 0) {
					body +=
						'\n\n⚠ GROUNDING REMINDER: Only use data points that appear above. If a specific number (price, %, valuation) was NOT in the search results, do NOT guess — say "not found" and search again with a more specific query.';
				}

				const preview = body.slice(0, 120).replace(/\n/g, ' ');
				config.logger.info(
					`web_search DONE [${used}/${config.maxCallsPerRound}]: ${preview}${body.length > 120 ? '…' : ''} (${resolvedSources.length}/${uniqueSources.length} sources resolved)`,
				);
				return body || 'No results found.';
			} catch (err) {
				config.logger.warn(`web_search FAILED [${used}/${config.maxCallsPerRound}]: ${err}`);
				return 'Search failed. Continue your analysis without this search.';
			}
		},
	});
}

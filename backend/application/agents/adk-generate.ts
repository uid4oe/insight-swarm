// ── ADK Generate ────────────────────────────────────────────────────────────
// One-shot LLM call via ADK. Replaces the LLMProvider port for simple
// "prompt in -> text out" use cases (e.g. summary generation).

import { InMemorySessionService, LlmAgent, Runner } from '@google/adk';
import { PERMISSIVE_SAFETY } from './safety.js';

interface AdkGenerateOptions {
	model: string;
	systemInstruction: string;
	userMessage: string;
	maxOutputTokens?: number;
}

/**
 * Run a single-turn ADK agent and return the final text response.
 * No tools - just a system instruction + user message -> model text.
 * Throws if the API returns an error or empty response.
 */
export async function adkGenerate(options: AdkGenerateOptions): Promise<string> {
	const { model, systemInstruction, userMessage, maxOutputTokens = 8192 } = options;

	const agent = new LlmAgent({
		name: 'oneshot',
		model,
		instruction: systemInstruction,
		tools: [],
		generateContentConfig: { maxOutputTokens, safetySettings: PERMISSIVE_SAFETY },
	});

	const sessionService = new InMemorySessionService();
	const appName = 'insight-swarm-oneshot';
	const sessionId = `oneshot_${Date.now()}`;

	const runner = new Runner({ appName, agent, sessionService });
	await sessionService.createSession({ appName, userId: 'system', sessionId });

	let finalText = '';
	let lastErrorCode: string | undefined;
	let lastErrorMessage: string | undefined;

	for await (const event of runner.runAsync({
		userId: 'system',
		sessionId,
		newMessage: { role: 'user', parts: [{ text: userMessage }] },
		runConfig: { maxLlmCalls: 1 },
	})) {
		// Detect ADK error events
		const eventAny = event as unknown as Record<string, unknown>;
		if (eventAny.errorCode) {
			lastErrorCode = String(eventAny.errorCode);
			lastErrorMessage = String(eventAny.errorMessage ?? 'no message');
		}

		if (event.content?.parts) {
			for (const part of event.content.parts) {
				if ('text' in part && part.text) {
					finalText = part.text;
				}
			}
		}
	}

	// If the API errored and we got no text, throw so callers can retry
	if (!finalText && lastErrorCode) {
		throw new Error(`ADK generate failed: ${lastErrorCode} - ${lastErrorMessage}`);
	}

	return finalText;
}

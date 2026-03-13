import { GoogleGenAI } from '@google/genai';
import type { EmbeddingPort } from '../../domain/ports/embedding.js';
import { getEnv } from '../env.js';
import { createLogger } from '../resilience/logger.js';

export type { EmbeddingPort };

export class EmbeddingService implements EmbeddingPort {
	private ai: GoogleGenAI;
	private logger = createLogger('EmbeddingService');
	private static MODEL = 'gemini-embedding-001';
	/** Truncated output dimensionality — matches the pgvector column definition. */
	private static DIMENSIONS = 768;

	constructor() {
		const env = getEnv();
		this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
	}

	/**
	 * Generate a 768-dimensional embedding for the given text.
	 * Uses Matryoshka Representation Learning to truncate from native 3072-d.
	 */
	async generateEmbedding(text: string): Promise<number[]> {
		try {
			const response = await this.ai.models.embedContent({
				model: EmbeddingService.MODEL,
				contents: text,
				config: { outputDimensionality: EmbeddingService.DIMENSIONS },
			});
			const embedding = response.embeddings?.[0]?.values;
			if (!embedding) {
				throw new Error('No embedding returned from API');
			}
			return embedding;
		} catch (err) {
			this.logger.error('Failed to generate embedding, finding will be stored without vector', err, {
				textSnippet: text.slice(0, 100),
			});
			return [];
		}
	}
}

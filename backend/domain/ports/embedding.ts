// ── Embedding Port ──────────────────────────────────────────────────────────
// Defines the embedding-generation contract for the application layer.
// Implementation lives in infrastructure/ai/embeddings.ts.

/** Port for generating vector embeddings from text. */
export interface EmbeddingPort {
	generateEmbedding(text: string): Promise<number[]>;
}

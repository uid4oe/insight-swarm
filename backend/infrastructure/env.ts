/**
 * Centralized environment validation using Zod.
 *
 * Call `validateEnv()` once at startup (before any service initialization).
 * Then use `getEnv()` anywhere to access typed, validated config.
 */

import { z } from 'zod';

const intFromEnv = (defaultVal: number) => z.coerce.number().int().positive().default(defaultVal);

const envSchema = z.object({
	// ── Environment ──────────────────────────────────────────────────────────
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

	// ── Required ──────────────────────────────────────────────────────────────
	GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
	RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL is required'),
	DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

	// ── Infrastructure (optional with defaults) ──────────────────────────────
	API_PORT: intFromEnv(3000),
	CORS_ORIGIN: z.string().optional(),
	PG_POOL_MAX: intFromEnv(20),
	PG_STATEMENT_TIMEOUT: intFromEnv(30000),

	// ── LLM tuning ───────────────────────────────────────────────────────────
	GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
	LLM_RATE_LIMIT_RPM: intFromEnv(60),
	ADK_RUN_TIMEOUT_MS: intFromEnv(180000),

	// ── Debug ────────────────────────────────────────────────────────────────
	ADK_DEBUG: z.coerce.boolean().default(false),

	// ── Google Search (grounding) ────────────────────────────────────────
	GOOGLE_SEARCH_ENABLED: z.coerce.boolean().default(true),
	GOOGLE_SEARCH_MAX_PER_ROUND: intFromEnv(3),

	// ── Swarm tuning ─────────────────────────────────────────────────────────
	MAX_FINDINGS_PER_ROUND: intFromEnv(5),
	MAX_REACTIONS_PER_ROUND: intFromEnv(8),
	MAX_TURNS_PER_ROUND: intFromEnv(15),
	MAX_ROUNDS: intFromEnv(4),
	THESIS_THRESHOLD: intFromEnv(3),
	MAX_THESES: intFromEnv(8),

	// ── Task queue tuning ────────────────────────────────────────────────────
	TASK_QUEUE_MAX_RETRIES: intFromEnv(3),
	TASK_QUEUE_RETRY_DELAYS: z
		.string()
		.default('5000,30000,120000')
		.transform((s) => {
			const parsed = s
				.split(',')
				.map(Number)
				.filter((n) => Number.isFinite(n) && n > 0);
			return parsed.length > 0 ? parsed : [5000, 30000, 120000];
		}),
	TASK_QUEUE_PREFETCH: intFromEnv(3),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Validate all environment variables at startup.
 * Exits the process with clear error messages on failure.
 */
export function validateEnv(): Env {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
		console.error(`\nEnvironment validation failed:\n${issues}\n`);
		console.error('Check your .env file or environment variables.\n');
		process.exit(1);
	}
	_env = result.data;
	return _env;
}

/**
 * Get the validated environment config.
 * Throws if `validateEnv()` hasn't been called yet.
 */
export function getEnv(): Env {
	if (!_env) throw new Error('Environment not validated. Call validateEnv() first.');
	return _env;
}

// ── Logger Port ─────────────────────────────────────────────────────────────
// Defines the logging contract for the application layer.
// Implementation lives in infrastructure/resilience/logger.ts.

export interface Logger {
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}

/**
 * Lightweight structured logger.
 *
 * Wraps console.* with timestamps, severity levels, and component names
 * so that every log line is searchable and consistent.  No external
 * dependency — swap in pino/winston later by changing only this file.
 */

import type { Logger } from '../../domain/ports/logger.js';

export type { Logger };

type LogLevel = 'info' | 'warn' | 'error';

function formatError(err: unknown): string {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	if (typeof err === 'string') return err;
	return String(err);
}

function log(
	level: LogLevel,
	component: string,
	message: string,
	error?: unknown,
	context?: Record<string, unknown>,
): void {
	const ts = new Date().toISOString();
	const prefix = `[${ts}] [${level.toUpperCase()}] [${component}]`;
	const msg = `${prefix} ${message}`;

	const extra: unknown[] = [];
	if (error !== undefined) extra.push(formatError(error));
	if (context !== undefined && Object.keys(context).length > 0) extra.push(context);

	if (level === 'error') {
		console.error(msg, ...extra);
	} else if (level === 'warn') {
		console.warn(msg, ...extra);
	} else {
		console.log(msg, ...extra);
	}
}

export function createLogger(component: string): Logger {
	return {
		info: (message, context?) => log('info', component, message, undefined, context),
		warn: (message, context?) => log('warn', component, message, undefined, context),
		error: (message, error?, context?) => log('error', component, message, error, context),
	};
}

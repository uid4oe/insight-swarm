// ── Task Routes ──────────────────────────────────────────────────────────────
// POST /api/tasks — queue a new swarm analysis
// GET  /api/tasks — list all tasks
// POST /api/tasks/:id/cancel — cancel a running or queued task

import { randomUUID as uuid } from 'node:crypto';
import type { Hono } from 'hono';
import {
	BUILTIN_AGENT_IDS,
	type CustomAgentDefinition,
	normalizeAgentId,
} from '../../../../shared/agent-definitions.js';
import { ALL_AGENT_IDS } from '../../../application/agents/agent-definitions.js';
import { cancelSwarmTask } from '../../../application/swarm-runner.js';
import type { RouteDeps } from '../types.js';

const MAX_TOTAL_AGENTS = 8;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ── Keyword-based agent auto-selection ──────────────────────────────────
// Each agent has domain keywords. Score prompt against these to auto-select
// the most relevant agents (min 2, max 5).
const AGENT_KEYWORDS: Record<string, string[]> = {
	financial: [
		'financial',
		'finance',
		'revenue',
		'profit',
		'valuation',
		'earnings',
		'eps',
		'margin',
		'cash flow',
		'burn rate',
		'capital',
		'debt',
		'equity',
		'ipo',
		'stock',
		'share price',
		'market cap',
		'p/e',
		'balance sheet',
		'income',
		'cost',
		'roi',
		'investment',
		'funding',
		'series',
		'arpu',
		'arr',
		'mrr',
		'unit economics',
		'cap table',
		'dividend',
		'fiscal',
		'budget',
		'expense',
	],
	operational: [
		'operational',
		'operations',
		'scalability',
		'technology',
		'tech stack',
		'infrastructure',
		'supply chain',
		'logistics',
		'manufacturing',
		'production',
		'efficiency',
		'process',
		'platform',
		'architecture',
		'engineering',
		'delivery',
		'capacity',
		'moat',
		'product',
		'r&d',
		'development',
	],
	legal: [
		'legal',
		'regulatory',
		'regulation',
		'compliance',
		'litigation',
		'lawsuit',
		'patent',
		'ip',
		'intellectual property',
		'privacy',
		'gdpr',
		'antitrust',
		'fda',
		'sec',
		'fcc',
		'faa',
		'license',
		'contract',
		'governance',
		'eu ai act',
		'data protection',
		'sanctions',
		'enforcement',
	],
	market: [
		'market',
		'competition',
		'competitive',
		'customer',
		'growth',
		'tam',
		'sam',
		'market share',
		'acquisition',
		'retention',
		'churn',
		'go-to-market',
		'positioning',
		'pricing',
		'demand',
		'industry',
		'sector',
		'trend',
		'adoption',
		'penetration',
		'landscape',
		'rival',
		'competitor',
	],
	management: [
		'management',
		'leadership',
		'ceo',
		'founder',
		'team',
		'culture',
		'board',
		'key-person',
		'key person',
		'executive',
		'hiring',
		'talent',
		'turnover',
		'succession',
		'governance',
		'organizational',
		'elon musk',
		'cto',
		'cfo',
	],
};

const MIN_AUTO_AGENTS = 2;

function selectAgentsByPrompt(prompt: string): string[] {
	const lower = prompt.toLowerCase();

	const scores: Array<{ id: string; score: number }> = [];
	for (const [agentId, keywords] of Object.entries(AGENT_KEYWORDS)) {
		let score = 0;
		for (const kw of keywords) {
			if (lower.includes(kw)) score++;
		}
		scores.push({ id: agentId, score });
	}

	// Sort by score descending
	scores.sort((a, b) => b.score - a.score);

	// Always include agents with score > 0
	const selected = scores.filter((s) => s.score > 0).map((s) => s.id);

	// If fewer than minimum, add the top-scoring agents to reach minimum
	if (selected.length < MIN_AUTO_AGENTS) {
		for (const s of scores) {
			if (!selected.includes(s.id)) {
				selected.push(s.id);
			}
			if (selected.length >= MIN_AUTO_AGENTS) break;
		}
	}

	// For very broad/complex prompts (many keywords matched across 4+ agents), include all
	// For narrow prompts, cap at what matched
	return selected;
}

/** Derive a short display title from a user prompt (first line, truncated). */
function deriveTitle(prompt: string): string {
	const firstLine = prompt.split('\n')[0].trim();
	if (firstLine.length <= 80) return firstLine;
	return `${firstLine.slice(0, 77)}...`;
}

export function registerTaskRoutes(app: Hono, deps: RouteDeps): void {
	const { container, taskRegistry, taskQueue, pool } = deps;
	const logger = container.createLogger('TaskRoutes');

	// POST /api/tasks — queue a new swarm analysis
	app.post('/api/tasks', async (c) => {
		let body: {
			prompt?: string;
			selectedAgents?: string[];
			modelOverrides?: Record<string, string>;
			customAgents?: CustomAgentDefinition[];
		};
		try {
			body = await c.req.json<typeof body>();
		} catch {
			return c.json({ error: 'Invalid JSON body' }, 400);
		}
		const prompt = body.prompt?.trim();

		if (!prompt || prompt.length > 2000) {
			return c.json({ error: 'prompt is required (max 2000 characters)' }, 400);
		}

		// ── Validate & normalize custom agents ──────────────────────────────
		let customAgents: CustomAgentDefinition[] | undefined;
		if (body.customAgents && body.customAgents.length > 0) {
			customAgents = [];
			const seenIds = new Set<string>();
			for (const ca of body.customAgents) {
				if (!ca.id || !ca.label || !ca.perspective || !ca.color || !ca.description) {
					return c.json({ error: 'Each customAgent must have id, label, perspective, color, and description' }, 400);
				}
				if (!HEX_COLOR_RE.test(ca.color)) {
					return c.json({ error: `Invalid hex color for agent "${ca.id}": ${ca.color}` }, 400);
				}
				const normalized = normalizeAgentId(ca.id);
				if (BUILTIN_AGENT_IDS.has(normalized)) {
					return c.json({ error: `Custom agent ID "${ca.id}" conflicts with built-in agent` }, 400);
				}
				if (seenIds.has(normalized)) {
					return c.json({ error: `Duplicate custom agent ID: "${ca.id}"` }, 400);
				}
				seenIds.add(normalized);
				customAgents.push({ ...ca, id: normalized });
			}
		}

		// ── Resolve selected agents ─────────────────────────────────────────
		const builtinSelected = body.selectedAgents?.length ? body.selectedAgents : selectAgentsByPrompt(prompt);
		const invalidIds = builtinSelected.filter((id) => !ALL_AGENT_IDS.includes(id));
		if (invalidIds.length > 0) {
			return c.json({ error: `Invalid agent IDs: ${invalidIds.join(', ')}. Valid: ${ALL_AGENT_IDS.join(', ')}` }, 400);
		}
		const selectedAgents = [...builtinSelected, ...(customAgents?.map((a) => a.id) ?? [])];
		if (selectedAgents.length < 2) {
			return c.json({ error: 'At least 2 agents are required' }, 400);
		}
		if (selectedAgents.length > MAX_TOTAL_AGENTS) {
			return c.json({ error: `Maximum ${MAX_TOTAL_AGENTS} total agents allowed` }, 400);
		}

		const taskId = uuid();
		const title = deriveTitle(prompt);

		// Atomic insert + publish: insert inside a transaction, publish, then commit.
		// If publish fails the transaction rolls back — no orphaned DB rows.
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(
				`INSERT INTO tasks (task_id, prompt, title, selected_agents, status, started_at) VALUES ($1, $2, $3, $4, 'queued', NOW())`,
				[taskId, prompt, title, JSON.stringify(selectedAgents)],
			);

			await taskQueue.publish({
				taskId,
				prompt,
				title,
				selectedAgents: builtinSelected,
				modelOverrides: body.modelOverrides,
				customAgents,
			});

			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK');
			logger.error('Failed to create and publish task', err, { taskId });
			return c.json({ error: 'Failed to queue task' }, 503);
		} finally {
			client.release();
		}

		taskRegistry.notifyChange();
		return c.json({ taskId, title, selectedAgents, status: 'queued' }, 201);
	});

	// GET /api/tasks — list all tasks
	app.get('/api/tasks', async (c) => {
		return c.json(await taskRegistry.getAllSummaries());
	});

	// POST /api/tasks/:id/cancel — cancel a running or queued task
	app.post('/api/tasks/:id/cancel', async (c) => {
		const taskId = c.req.param('id');

		const manifest = await taskRegistry.getManifestEntry(taskId);
		if (!manifest) return c.json({ error: 'Task not found or not cancellable' }, 404);

		if (manifest.status === 'running') {
			const task = taskRegistry.get(taskId);
			if (task) {
				await cancelSwarmTask(task, container, logger);
				taskRegistry.notifyChange();
				return c.json({ cancelled: taskId });
			}
		}

		if (manifest.status === 'queued') {
			await pool.query(`UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE task_id = $1`, [taskId]);
			taskRegistry.notifyChange();
			return c.json({ cancelled: taskId });
		}

		return c.json({ error: 'Task not found or not cancellable' }, 404);
	});
}

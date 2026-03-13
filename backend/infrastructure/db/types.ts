// DB row types — raw Postgres shapes after query result.
// JSONB columns are returned as parsed JavaScript objects by the pg driver.

export interface FindingRow {
	id: string;
	task_id: string;
	agent_id: string;
	round: number;
	category: string;
	title: string;
	description: string;
	confidence: number;
	tags: string[]; // JSONB → parsed array
	references: Array<{ url?: string; title: string; snippet?: string }>; // JSONB → parsed array
	parent_finding_id: string | null;
	created_at: Date; // TIMESTAMPTZ → Date object
}

export interface ConnectionRow {
	id: string;
	task_id: string;
	from_finding_id: string;
	to_finding_id: string;
	relationship: string;
	strength: number;
	reasoning: string;
	created_by: string;
	round: number;
	created_at: Date;
}

export interface ReactionRow {
	id: string;
	task_id: string;
	finding_id: string;
	agent_id: string;
	status: string;
	reaction: string | null;
	created_at: Date;
	reacted_at: Date | null;
}

export interface ThesisRow {
	id: string;
	task_id: string;
	title: string;
	thesis: string;
	evidence: string[]; // JSONB → parsed array
	connections_used: string[]; // JSONB → parsed array
	confidence: number;
	market_size: string | null;
	timing: string | null;
	risks: string[]; // JSONB → parsed array
	votes: Array<{ agent_id: string; vote: string; reasoning: string }>; // JSONB → parsed array
	status: string;
	created_by: string;
	created_at: Date;
}

export interface RoundStateRow {
	task_id: string;
	round_number: number;
	round_phase: string;
	agents_ready: string[]; // JSONB → parsed array
	started_at: Date;
}

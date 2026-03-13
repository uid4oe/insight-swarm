import type { AgentMeta } from './agents.js';
import type { AgentId, AgentStatusType, Connection, Finding, InvestmentThesis, Reaction, ThesisVote } from './types.js';

export interface SwarmEvents {
	'finding:created': { finding: Finding; agent_id: AgentId };
	'connection:created': { connection: Connection; agent_id: AgentId };
	'reaction:completed': { reaction: Reaction; agent_id: AgentId; finding: Finding };
	'thesis:created': { thesis: InvestmentThesis };
	'thesis:voted': { thesis: InvestmentThesis; vote: ThesisVote };
	'round:advanced': { from: number; to: number; agent_id: AgentId };
	'agent:status': { agent_id: AgentId; status: AgentStatusType; task?: string };
	'agent:died': { agent_id: AgentId };
	'activity:logged': { agent_id: AgentId; round: number; action: string; summary: string; created_at: string };
	'agents:planned': { agents: AgentMeta[] };
}

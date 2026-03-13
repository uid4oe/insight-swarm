import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { API_BASE } from "../lib/config";
import type {
	ActivityEntry,
	AgentId,
	AgentMeta,
	AgentStatus,
	AgentStatusType,
	Connection,
	Finding,
	InvestmentThesis,
	RoundState,
} from "../lib/types";

// ── SSE Types ──────────────────────────────────────────────────────────────

export interface SSEState {
	roundState: RoundState | null;
	agents: AgentStatus[];
	findings: Finding[];
	connections: Connection[];
	theses: InvestmentThesis[];
	activity: ActivityEntry[];
	agentMeta: AgentMeta[];
	status: "queued" | "running" | "completed" | "failed";
	lastRoundAdvanced: number | null;
}

export type SSEAction =
	| { type: "snapshot"; payload: SSEState }
	| { type: "reset" }
	| { type: "finding:created"; payload: Finding }
	| { type: "connection:created"; payload: Connection }
	| { type: "thesis:created"; payload: InvestmentThesis }
	| { type: "thesis:voted"; payload: InvestmentThesis }
	| {
			type: "agent:status";
			payload: { agent_id: AgentId; status: AgentStatusType; task?: string };
	  }
	| { type: "agent:died"; payload: { agent_id: AgentId } }
	| { type: "round:advanced"; payload: { from: number; to: number; agent_id?: string } }
	| { type: "activity:logged"; payload: ActivityEntry }
	| { type: "agents:planned"; payload: { agents: AgentMeta[] } }
	| { type: "task:queued" }
	| { type: "task:started" }
	| { type: "task:completed" }
	| { type: "task:failed" };

function reducer(state: SSEState, action: SSEAction): SSEState {
	switch (action.type) {
		case "snapshot":
			return action.payload;
		case "reset":
			return initialState;
		case "finding:created":
			return { ...state, findings: [...state.findings, action.payload] };
		case "connection:created":
			return {
				...state,
				connections: [...state.connections, action.payload],
			};
		case "thesis:created":
			return {
				...state,
				theses: [...state.theses, action.payload],
			};
		case "thesis:voted":
			return {
				...state,
				theses: state.theses.map((t) => (t.id === action.payload.id ? action.payload : t)),
			};
		case "agent:status": {
			const { agent_id, status, task } = action.payload;
			const existing = state.agents.find((a) => a.agent_id === agent_id);
			const updated: AgentStatus = existing
				? { ...existing, status, current_task: task ?? null }
				: {
						agent_id,
						status,
						current_task: task ?? null,
						current_round: 1,
						findings_count: 0,
						last_heartbeat: new Date().toISOString(),
					};
			return {
				...state,
				agents: existing
					? state.agents.map((a) => (a.agent_id === agent_id ? updated : a))
					: [...state.agents, updated],
			};
		}
		case "agent:died": {
			const { agent_id } = action.payload;
			return {
				...state,
				agents: state.agents.map((a) => (a.agent_id === agent_id ? { ...a, status: "dead" as AgentStatusType } : a)),
			};
		}
		case "round:advanced": {
			const prev = state.roundState;
			const newRound = action.payload.to;
			const advancedAgentId = action.payload.agent_id;
			// Per-agent async advancement: update only the agent that advanced,
			// or all living agents if no agent_id specified (backward compat)
			const updatedAgents = advancedAgentId
				? state.agents.map((a) => (a.agent_id === advancedAgentId ? { ...a, current_round: newRound } : a))
				: state.agents.map((a) => (a.status === "dead" ? a : { ...a, current_round: newRound }));
			// Track the max round across all agents for the global round state display
			const maxRound = Math.max(newRound, prev?.round_number ?? 1);
			return {
				...state,
				lastRoundAdvanced: Date.now(),
				agents: updatedAgents,
				roundState: prev
					? {
							...prev,
							round_number: maxRound,
							round_phase: "active",
							agents_ready: [],
						}
					: {
							round_number: maxRound,
							round_phase: "active",
							agents_ready: [],
							started_at: new Date().toISOString(),
						},
			};
		}
		case "activity:logged":
			return {
				...state,
				activity: [action.payload, ...state.activity].slice(0, 100),
			};
		case "agents:planned":
			return { ...state, agentMeta: action.payload.agents };
		case "task:queued":
			return { ...state, status: "queued" };
		case "task:started":
			return { ...state, status: "running" };
		case "task:completed":
			return { ...state, status: "completed" };
		case "task:failed":
			return { ...state, status: "failed" };
		default:
			return state;
	}
}

const initialState: SSEState = {
	roundState: null,
	agents: [],
	findings: [],
	connections: [],
	theses: [],
	activity: [],
	agentMeta: [],
	status: "running",
	lastRoundAdvanced: null,
};

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];

/** Safely parse JSON from SSE event data. Returns null on failure. */
function safeParse<T = unknown>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		console.warn("[SSE] Failed to parse event data:", raw.slice(0, 200));
		return null;
	}
}

export function useTaskSSE(taskId: string | null, isRunning: boolean): SSEState & { connected: boolean } {
	const [state, dispatch] = useReducer(reducer, initialState);
	const [connected, setConnected] = useState(false);
	const esRef = useRef<EventSource | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Use a ref for status so the onerror closure always reads the latest value
	const statusRef = useRef(state.status);
	statusRef.current = state.status;

	// Reset state when taskId changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: taskId is the intended trigger; dispatch and setConnected are stable
	useEffect(() => {
		dispatch({ type: "reset" });
		setConnected(false);
	}, [taskId]);

	const connectSSE = useCallback(
		(tid: string) => {
			if (esRef.current) {
				esRef.current.close();
				esRef.current = null;
			}

			const es = new EventSource(`${API_BASE}/api/tasks/${tid}/events`);
			esRef.current = es;

			// Guard: if a new connection supersedes this one, ignore late events
			const isActive = () => esRef.current === es;

			es.addEventListener("snapshot", (e) => {
				if (!isActive()) return;
				const payload = safeParse<SSEState>(e.data);
				if (!payload) return;
				setConnected(true);
				retryCountRef.current = 0;
				dispatch({ type: "snapshot", payload });
			});
			es.addEventListener("finding:created", (e) => {
				if (!isActive()) return;
				const data = safeParse<{ finding: Finding }>(e.data);
				if (!data) return;
				dispatch({ type: "finding:created", payload: data.finding });
			});
			es.addEventListener("connection:created", (e) => {
				if (!isActive()) return;
				const data = safeParse<{ connection: Connection }>(e.data);
				if (!data) return;
				dispatch({ type: "connection:created", payload: data.connection });
			});
			es.addEventListener("thesis:created", (e) => {
				if (!isActive()) return;
				const data = safeParse<{ thesis: InvestmentThesis }>(e.data);
				if (!data) return;
				dispatch({
					type: "thesis:created",
					payload: data.thesis,
				});
			});
			es.addEventListener("thesis:voted", (e) => {
				if (!isActive()) return;
				const data = safeParse<{ thesis: InvestmentThesis }>(e.data);
				if (!data) return;
				dispatch({
					type: "thesis:voted",
					payload: data.thesis,
				});
			});
			es.addEventListener("agent:status", (e) => {
				if (!isActive()) return;
				const payload = safeParse<{ agent_id: AgentId; status: AgentStatusType; task?: string }>(e.data);
				if (!payload) return;
				dispatch({ type: "agent:status", payload });
			});
			es.addEventListener("agent:died", (e) => {
				if (!isActive()) return;
				const payload = safeParse<{ agent_id: AgentId }>(e.data);
				if (!payload) return;
				dispatch({ type: "agent:died", payload });
			});
			es.addEventListener("round:advanced", (e) => {
				if (!isActive()) return;
				const payload = safeParse<{ from: number; to: number; agent_id?: string }>(e.data);
				if (!payload) return;
				dispatch({ type: "round:advanced", payload });
			});
			es.addEventListener("activity:logged", (e) => {
				if (!isActive()) return;
				const payload = safeParse<ActivityEntry>(e.data);
				if (!payload) return;
				dispatch({ type: "activity:logged", payload });
			});
			es.addEventListener("agents:planned", (e) => {
				if (!isActive()) return;
				const data = safeParse<{ agents: AgentMeta[] }>(e.data);
				if (data) dispatch({ type: "agents:planned", payload: data });
			});
			es.addEventListener("task:queued", () => {
				if (!isActive()) return;
				dispatch({ type: "task:queued" });
			});
			es.addEventListener("task:started", () => {
				if (!isActive()) return;
				dispatch({ type: "task:started" });
			});
			es.addEventListener("task:completed", () => {
				if (!isActive()) return;
				dispatch({ type: "task:completed" });
			});
			es.addEventListener("task:failed", () => {
				if (!isActive()) return;
				dispatch({ type: "task:failed" });
			});

			es.onerror = () => {
				if (!isActive()) return;
				setConnected(false);
				es.close();
				esRef.current = null;

				// Read latest status via ref — avoids stale closure
				if (statusRef.current === "completed" || statusRef.current === "failed") return;

				const delay = RECONNECT_DELAYS[Math.min(retryCountRef.current, RECONNECT_DELAYS.length - 1)];
				retryCountRef.current++;
				retryTimerRef.current = setTimeout(() => connectSSE(tid), delay);
			};
		},
		[], // stable — reads mutable refs, not state
	);

	useEffect(() => {
		if (!taskId || !isRunning) return;

		retryCountRef.current = 0;
		connectSSE(taskId);

		return () => {
			if (esRef.current) {
				esRef.current.close();
				esRef.current = null;
			}
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = null;
			}
			setConnected(false);
		};
	}, [taskId, isRunning, connectSSE]);

	return { ...state, connected };
}

import { API_BASE } from "./config";
import type { StructuredSummary, TaskState, TaskSummary, ThesisDetail } from "./types";

/** Extract a meaningful error message from a failed API response. */
async function apiError(res: Response, fallback: string): Promise<Error> {
	try {
		const body = await res.json();
		return new Error(body.error ?? fallback);
	} catch {
		return new Error(`${fallback} (${res.status})`);
	}
}

export async function createTask(
	prompt: string,
	selectedAgents?: string[],
	signal?: AbortSignal,
): Promise<{ taskId: string }> {
	const body: Record<string, unknown> = { prompt };
	if (selectedAgents && selectedAgents.length > 0) {
		body.selectedAgents = selectedAgents;
	}
	const res = await fetch(`${API_BASE}/api/tasks`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!res.ok) throw await apiError(res, "Failed to create task");
	return res.json();
}

export async function fetchTasks(signal?: AbortSignal): Promise<TaskSummary[]> {
	const res = await fetch(`${API_BASE}/api/tasks`, { signal });
	if (!res.ok) throw await apiError(res, "Failed to fetch tasks");
	return res.json();
}

export async function fetchTaskState(taskId: string, signal?: AbortSignal): Promise<TaskState> {
	const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, { signal });
	if (!res.ok) throw await apiError(res, "Failed to fetch task");
	return res.json();
}

export async function fetchThesisDetail(taskId: string, thesisId: string, signal?: AbortSignal): Promise<ThesisDetail> {
	const res = await fetch(`${API_BASE}/api/tasks/${taskId}/theses/${thesisId}`, { signal });
	if (!res.ok) throw await apiError(res, "Failed to fetch thesis detail");
	return res.json();
}

export async function fetchTaskSummary(
	taskId: string,
	signal?: AbortSignal,
): Promise<{ summary: StructuredSummary } | { status: string }> {
	const res = await fetch(`${API_BASE}/api/tasks/${taskId}/summary`, { signal });
	return res.json();
}

export async function requestTaskSummary(
	taskId: string,
	signal?: AbortSignal,
): Promise<{ summary: StructuredSummary }> {
	const res = await fetch(`${API_BASE}/api/tasks/${taskId}/summary`, { method: "POST", signal });
	if (!res.ok) throw await apiError(res, "Summary generation failed");
	return res.json();
}

export async function cancelTask(taskId: string): Promise<void> {
	const res = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, { method: "POST" });
	if (!res.ok) throw await apiError(res, "Failed to cancel task");
}

export async function askFollowup(taskId: string, question: string, signal?: AbortSignal): Promise<{ answer: string }> {
	const res = await fetch(`${API_BASE}/api/tasks/${taskId}/followup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ question }),
		signal,
	});
	if (!res.ok) throw await apiError(res, "Failed to get answer");
	return res.json();
}

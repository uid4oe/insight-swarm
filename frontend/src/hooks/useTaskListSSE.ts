import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "../components/common/Toast";
import { fetchTasks } from "../lib/api";
import { API_BASE } from "../lib/config";
import { parseTaskIdFromURL } from "../lib/router";
import { useAppStore } from "../lib/store";
import type { TaskSummary } from "../lib/types";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];
const ERROR_THRESHOLD = 3;

/**
 * Subscribe to the global SSE stream (`GET /api/events`) for task list updates.
 * Replaces the old 3s polling approach with real-time push.
 *
 * On mount: does a fast initial fetch, then opens SSE for incremental updates.
 * Once the SSE snapshot arrives, subsequent updates come purely from SSE events.
 */
export function useTaskListSSE(): boolean {
	const [pollError, setPollError] = useState(false);
	const esRef = useRef<EventSource | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevStatusRef = useRef<Record<string, string>>({});
	// Once the SSE snapshot arrives, skip any pending initial fetch result
	const sseReadyRef = useRef(false);

	const applyTasks = useCallback((tasks: TaskSummary[]) => {
		// Detect status transitions for toast notifications
		for (const task of tasks) {
			const prev = prevStatusRef.current[task.taskId];
			if (prev === "running" && task.status === "completed") {
				showToast(`"${task.title}" — insight complete`, "success");
			} else if (prev === "running" && task.status === "failed") {
				showToast(`"${task.title}" — insight failed`, "error");
			}
			prevStatusRef.current[task.taskId] = task.status;
		}

		useAppStore.getState().setTasks(tasks);
	}, []);

	const connectSSE = useCallback(() => {
		if (esRef.current) {
			esRef.current.close();
			esRef.current = null;
		}

		const es = new EventSource(`${API_BASE}/api/events`);
		esRef.current = es;

		const isActive = () => esRef.current === es;

		es.addEventListener("tasks", (e) => {
			if (!isActive()) return;
			try {
				const tasks = JSON.parse(e.data) as TaskSummary[];
				const wasFirstSnapshot = !sseReadyRef.current;
				sseReadyRef.current = true;
				retryCountRef.current = 0;
				setPollError(false);
				applyTasks(tasks);

				// Sync URL on first connection (in case SSE beat the initial fetch)
				if (wasFirstSnapshot) {
					const urlTaskId = parseTaskIdFromURL();
					const state = useAppStore.getState();
					if (urlTaskId && state.selectedTaskId !== urlTaskId) {
						useAppStore.setState({ selectedTaskId: urlTaskId });
					}
				}
			} catch {
				console.warn("[GlobalSSE] Failed to parse tasks event");
			}
		});

		es.onerror = () => {
			if (!isActive()) return;
			es.close();
			esRef.current = null;

			retryCountRef.current++;
			if (retryCountRef.current >= ERROR_THRESHOLD) {
				setPollError(true);
			}

			const delay = RECONNECT_DELAYS[Math.min(retryCountRef.current - 1, RECONNECT_DELAYS.length - 1)];
			retryTimerRef.current = setTimeout(() => connectSSE(), delay);
		};
	}, [applyTasks]);

	useEffect(() => {
		sseReadyRef.current = false;

		// Fast initial fetch so task list renders before SSE handshake completes
		fetchTasks()
			.then((tasks) => {
				// Skip if SSE already delivered its snapshot (it's authoritative)
				if (sseReadyRef.current) return;

				applyTasks(tasks);

				// Sync URL task selection on first load
				const urlTaskId = parseTaskIdFromURL();
				const state = useAppStore.getState();
				if (urlTaskId && state.selectedTaskId !== urlTaskId) {
					useAppStore.setState({ selectedTaskId: urlTaskId });
				}
			})
			.catch(() => {
				// Will recover via SSE or reconnect
			});

		connectSSE();

		return () => {
			if (esRef.current) {
				esRef.current.close();
				esRef.current = null;
			}
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = null;
			}
		};
	}, [connectSSE, applyTasks]);

	return pollError;
}

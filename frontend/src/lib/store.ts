import { create } from "zustand";
import { createTask as apiCreateTask, fetchTaskState, fetchTasks } from "./api";
import { pushTaskURL } from "./router";
import type { AgentMeta, Connection, Finding, TaskState, TaskSummary } from "./types";

// ── Global App Store (Zustand) ──────────────────────────────────────────────
// Replaces prop-drilling and scattered useState across App, Sidebar, TaskView.

interface AppState {
	// Task list
	tasks: TaskSummary[];
	selectedTaskId: string | null;
	archivedState: TaskState | null;

	// UI state
	creating: boolean;
	error: string | null;

	// Agent metadata (set by TaskView, consumed by overlays)
	agentMeta: AgentMeta[];

	// Overlays
	thesisOverlay: { taskId: string; thesisId: string } | null;
	findingOverlay: { finding: Finding; allFindings: Finding[]; allConnections: Connection[] } | null;
	findingHistory: Finding[];

	// Sidebar
	sidebarCollapsed: boolean;

	// Graph highlighting (driven by summary hover)
	highlightedThesisId: string | null;

	// Actions
	toggleSidebar: () => void;
	setTasks: (tasks: TaskSummary[]) => void;
	selectTask: (taskId: string) => void;
	deselectTask: () => void;
	setArchivedState: (state: TaskState | null) => void;
	setAgentMeta: (meta: AgentMeta[]) => void;
	setError: (error: string | null) => void;
	setHighlightedThesis: (thesisId: string | null) => void;
	openThesis: (taskId: string, thesisId: string) => void;
	closeThesis: () => void;
	openFinding: (finding: Finding, allFindings: Finding[], allConnections: Connection[]) => void;
	navigateToFinding: (finding: Finding) => void;
	goBackFinding: () => void;
	closeFinding: () => void;

	// Async actions
	loadTasks: () => Promise<void>;
	createTask: (prompt: string, selectedAgents?: string[]) => Promise<void>;
	loadArchivedState: (taskId: string, signal?: AbortSignal) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
	tasks: [],
	selectedTaskId: null,
	archivedState: null,
	creating: false,
	error: null,
	agentMeta: [],
	thesisOverlay: null,
	findingOverlay: null,
	findingHistory: [],
	sidebarCollapsed: false,
	highlightedThesisId: null,

	toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
	setTasks: (tasks) => set({ tasks }),
	selectTask: (taskId) => {
		if (taskId === get().selectedTaskId) return;
		set({
			selectedTaskId: taskId,
			archivedState: null,
			thesisOverlay: null,
			findingOverlay: null,
			findingHistory: [],
			error: null,
		});
		pushTaskURL(taskId);
	},
	deselectTask: () => {
		set({
			selectedTaskId: null,
			thesisOverlay: null,
			findingOverlay: null,
			findingHistory: [],
			error: null,
			archivedState: null,
		});
		pushTaskURL(null);
	},
	setArchivedState: (state) => set({ archivedState: state }),
	setAgentMeta: (meta) => {
		const current = get().agentMeta;
		// Compare by IDs — reference equality never works since callers pass new arrays
		if (current.length === meta.length && current.every((c, i) => c.id === meta[i].id)) return;
		set({ agentMeta: meta });
	},
	setError: (error) => set({ error }),

	setHighlightedThesis: (thesisId) => set({ highlightedThesisId: thesisId }),
	openThesis: (taskId, thesisId) =>
		set({ findingOverlay: null, findingHistory: [], thesisOverlay: { taskId, thesisId } }),
	closeThesis: () => set({ thesisOverlay: null }),
	openFinding: (finding, allFindings, allConnections) =>
		set({ thesisOverlay: null, findingHistory: [], findingOverlay: { finding, allFindings, allConnections } }),
	navigateToFinding: (finding) => {
		const state = get();
		if (!state.findingOverlay) return;
		set({
			findingHistory: [...state.findingHistory, state.findingOverlay.finding],
			findingOverlay: { ...state.findingOverlay, finding },
		});
	},
	goBackFinding: () => {
		const state = get();
		if (!state.findingOverlay || state.findingHistory.length === 0) return;
		const history = [...state.findingHistory];
		const prev = history.pop();
		if (!prev) return;
		set({
			findingHistory: history,
			findingOverlay: { ...state.findingOverlay, finding: prev },
		});
	},
	closeFinding: () => set({ findingOverlay: null, findingHistory: [] }),

	loadTasks: async () => {
		try {
			const tasks = await fetchTasks();
			set({ tasks });
			// Note: auto-selection is handled by URL initialization in App.tsx
		} catch (e) {
			console.warn("[Store] Failed to load tasks:", e);
		}
	},

	createTask: async (prompt, selectedAgents?) => {
		set({ creating: true, error: null });
		try {
			const { taskId } = await apiCreateTask(prompt, selectedAgents);
			// Add synthetic task immediately so there's no "not found" flash
			const syntheticTask: TaskSummary = {
				taskId,
				prompt,
				title: prompt.slice(0, 80),
				selectedAgents: selectedAgents ?? [],
				status: "queued",
				startedAt: new Date().toISOString(),
				completedAt: null,
			};
			set({
				selectedTaskId: taskId,
				sidebarCollapsed: true,
				tasks: [syntheticTask, ...get().tasks],
			});
			pushTaskURL(taskId);
			// Refresh real task list in background
			fetchTasks().then((tasks) => set({ tasks }));
		} catch {
			set({ error: "Failed to create task. Is the API server running?" });
		} finally {
			set({ creating: false });
		}
	},

	loadArchivedState: async (taskId, signal?) => {
		try {
			const state = await fetchTaskState(taskId, signal);
			// Only apply if this task is still the selected one
			if (get().selectedTaskId === taskId) {
				set({ archivedState: state });
			}
		} catch (e) {
			// Ignore abort errors — expected on rapid task switching
			if (e instanceof DOMException && e.name === "AbortError") return;
			set({ archivedState: null });
		}
	},
}));

import { useEffect } from "react";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { ToastContainer } from "./components/common/Toast";
import { FindingDetail } from "./components/detail/FindingDetail";
import { ThesisDetailView } from "./components/detail/ThesisDetail";
import { HomePrompt } from "./components/home/HomePrompt";
import { Sidebar } from "./components/sidebar/Sidebar";
import { TaskView } from "./components/task/TaskView";
import { useTaskListSSE } from "./hooks/useTaskListSSE";
import { parseTaskIdFromURL } from "./lib/router";
import { useAppStore } from "./lib/store";

export function App() {
	const {
		tasks,
		selectedTaskId,
		archivedState,
		thesisOverlay,
		findingOverlay,
		findingHistory,
		error,
		creating,
		sidebarCollapsed,
		selectTask,
		deselectTask,
		setError,
		toggleSidebar,
		openThesis,
		closeThesis,
		openFinding,
		navigateToFinding,
		goBackFinding,
		closeFinding,
		createTask,
		loadArchivedState,
	} = useAppStore();

	const pollError = useTaskListSSE();

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (findingOverlay) {
					if (findingHistory.length > 0) {
						goBackFinding();
					} else {
						closeFinding();
					}
				} else if (thesisOverlay) {
					closeThesis();
				}
				return;
			}
			if (
				e.key === "n" &&
				!e.metaKey &&
				!e.ctrlKey &&
				!creating &&
				!(e.target instanceof HTMLInputElement) &&
				!(e.target instanceof HTMLTextAreaElement)
			) {
				deselectTask();
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [creating, thesisOverlay, findingOverlay, findingHistory, closeFinding, closeThesis, goBackFinding, deselectTask]);

	// Sync Zustand state with browser back/forward
	useEffect(() => {
		const handlePopState = () => {
			const urlTaskId = parseTaskIdFromURL();
			const current = useAppStore.getState().selectedTaskId;
			if (urlTaskId !== current) {
				useAppStore.setState({
					selectedTaskId: urlTaskId,
					thesisOverlay: null,
					findingOverlay: null,
					findingHistory: [],
					error: null,
					archivedState: null,
				});
			}
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;
	const isRunning = selectedTask?.status === "running" || selectedTask?.status === "queued";

	// Load archived state for non-running tasks
	useEffect(() => {
		if (!selectedTaskId || isRunning) {
			useAppStore.getState().setArchivedState(null);
			return;
		}
		const controller = new AbortController();
		loadArchivedState(selectedTaskId, controller.signal);
		return () => controller.abort();
	}, [selectedTaskId, isRunning, loadArchivedState]);

	return (
		<div className="flex h-screen bg-studio font-sans text-[14px] text-text-secondary antialiased">
			<Sidebar
				tasks={tasks}
				selectedTaskId={selectedTaskId}
				collapsed={sidebarCollapsed}
				onToggle={toggleSidebar}
				onSelectTask={selectTask}
				onGoHome={deselectTask}
			/>
			<main className="flex flex-1 flex-col overflow-hidden">
				{pollError && (
					<div role="alert" className="banner-warning">
						<span className="status-dot animate-pulse-slow" />
						Unable to reach the server — data may be stale
					</div>
				)}
				{error && (
					<div role="alert" className="banner-error">
						{error}
						<button
							type="button"
							onClick={() => setError(null)}
							aria-label="Dismiss error"
							className="cursor-pointer border-none bg-transparent px-1 text-lg opacity-60 hover:opacity-100"
						>
							&times;
						</button>
					</div>
				)}
				{selectedTask ? (
					<ErrorBoundary>
						<div className="relative flex h-full flex-1 flex-col overflow-hidden">
							{/* Loading overlay — only for completed/failed tasks waiting for archived state */}
							{!isRunning && !archivedState && (
								<div className="absolute inset-0 z-50 flex items-center justify-center bg-studio">
									<span className="spinner-lg" />
								</div>
							)}
							<TaskView
								taskId={selectedTask.taskId}
								title={selectedTask.title}
								prompt={selectedTask.prompt}
								isRunning={isRunning}
								archivedState={archivedState}
								startedAt={selectedTask.startedAt}
								onOpenThesis={(thesisId) => openThesis(selectedTask.taskId, thesisId)}
								onOpenFinding={openFinding}
							/>
						</div>
					</ErrorBoundary>
				) : selectedTaskId ? (
					<div className="m-auto flex max-w-md flex-col items-center gap-6 p-12 text-center">
						<h2 className="text-label text-text-primary">Task not found</h2>
						<p className="text-body-secondary">
							The task you&apos;re looking for doesn&apos;t exist or may have been removed.
						</p>
						<button type="button" onClick={deselectTask} className="btn-primary px-6 py-2.5">
							Go to home
						</button>
					</div>
				) : (
					<HomePrompt creating={creating} onSubmit={(prompt, selectedAgents) => createTask(prompt, selectedAgents)} />
				)}
			</main>
			{thesisOverlay && (
				<ErrorBoundary>
					<ThesisDetailView taskId={thesisOverlay.taskId} thesisId={thesisOverlay.thesisId} onClose={closeThesis} />
				</ErrorBoundary>
			)}
			{findingOverlay && (
				<ErrorBoundary>
					<FindingDetail
						finding={findingOverlay.finding}
						allFindings={findingOverlay.allFindings}
						allConnections={findingOverlay.allConnections}
						onClose={closeFinding}
						onOpenFinding={(findingId) => {
							const f = findingOverlay.allFindings.find((x) => x.id === findingId);
							if (f) navigateToFinding(f);
						}}
						canGoBack={findingHistory.length > 0}
						onGoBack={goBackFinding}
					/>
				</ErrorBoundary>
			)}
			<ToastContainer />
		</div>
	);
}

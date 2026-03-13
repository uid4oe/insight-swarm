/** Lightweight URL ↔ Zustand sync for /tasks/:uuid routing. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a task ID from the current browser URL.
 * Returns the UUID if the path matches `/tasks/:uuid`, otherwise null.
 */
export function parseTaskIdFromURL(): string | null {
	const match = window.location.pathname.match(/^\/tasks\/([^/]+)$/);
	if (!match) return null;
	const candidate = match[1];
	return UUID_RE.test(candidate) ? candidate : null;
}

/**
 * Push a URL into the browser history that reflects the given taskId.
 * Only pushes if the URL would actually change (avoids duplicate history entries).
 */
export function pushTaskURL(taskId: string | null): void {
	const target = taskId ? `/tasks/${taskId}` : "/";
	if (window.location.pathname !== target) {
		window.history.pushState({ taskId }, "", target);
	}
}

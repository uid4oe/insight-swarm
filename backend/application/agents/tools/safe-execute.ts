/** Wrap a tool execute function with error handling so DB/event errors return a string instead of crashing. */
export function safeExecute(
	fn: (input: Record<string, unknown>) => Promise<string>,
): (input: Record<string, unknown>) => Promise<string> {
	return async (input) => {
		try {
			return await fn(input);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return `Error: Tool execution failed — ${msg}`;
		}
	};
}

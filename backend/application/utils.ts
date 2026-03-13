/** Strip markdown code fences (```json ... ```) that LLMs sometimes wrap around JSON output. */
export function stripCodeFences(text: string): string {
	return text
		.replace(/^```(?:json)?\s*\n?/i, '')
		.replace(/\n?```\s*$/i, '')
		.trim();
}

/**
 * Extract a JSON object or array from text that may contain leading/trailing prose.
 * Returns the extracted JSON string, or the original text if no JSON delimiters found.
 */
export function extractJson(text: string): string {
	const stripped = stripCodeFences(text);
	const firstBrace = stripped.indexOf('{');
	const firstBracket = stripped.indexOf('[');

	let start: number;
	if (firstBrace === -1 && firstBracket === -1) return stripped;
	if (firstBrace === -1) start = firstBracket;
	else if (firstBracket === -1) start = firstBrace;
	else start = Math.min(firstBrace, firstBracket);

	const openChar = stripped[start];
	const closeChar = openChar === '{' ? '}' : ']';
	const end = stripped.lastIndexOf(closeChar);

	if (end <= start) return stripped;
	return stripped.slice(start, end + 1);
}

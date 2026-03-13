// ── Numeric Utilities ──────────────────────────────────────────────────────
// Shared helpers for extracting and validating numeric data from text.
// Used by both knowledge-tools and collaboration-tools for grounding checks.

/**
 * Extract dollar amounts from text.
 * Handles: $8.30, $34, $69.5 billion, $5bn, $5k, $392 million, $5B, $5M, $5T
 * Also handles ranges like "$40-$41" by extracting both endpoints.
 */
export function extractDollarAmounts(text: string): number[] {
	const amounts: number[] = [];

	// Primary pattern: $X with optional decimal and magnitude suffix
	const regex = /\$[\d,]+(?:\.\d+)?(?:\s*(?:billion|bn|million|mn|trillion|tn|thousand|k|B|M|T|K))?/gi;
	for (const match of text.matchAll(regex)) {
		const parsed = parseDollarMatch(match[0]);
		if (parsed !== null) amounts.push(parsed);
	}

	// Range pattern: "$X-$Y" or "$X to $Y" (with optional shared suffix like "$40-$41 billion")
	const rangeRegex =
		/\$[\d,]+(?:\.\d+)?\s*[-–—]\s*\$?[\d,]+(?:\.\d+)?(?:\s*(?:billion|bn|million|mn|trillion|tn|thousand|k|B|M|T|K))?/gi;
	for (const match of text.matchAll(rangeRegex)) {
		const parts = match[0].split(/[-–—]/);
		for (const part of parts) {
			const cleaned = part.trim();
			if (cleaned.includes('$') || /^\d/.test(cleaned)) {
				// Inherit the magnitude suffix from the full match if the part doesn't have one
				const suffixMatch = match[0].match(/(?:billion|bn|million|mn|trillion|tn|thousand|k|B|M|T|K)\s*$/i);
				const withSuffix =
					suffixMatch && !cleaned.match(/(?:billion|bn|million|mn|trillion|tn|thousand|k|B|M|T|K)\s*$/i)
						? `${cleaned} ${suffixMatch[0]}`
						: cleaned;
				const dollarStr = withSuffix.includes('$') ? withSuffix : `$${withSuffix}`;
				const parsed = parseDollarMatch(dollarStr);
				if (parsed !== null && !amounts.includes(parsed)) amounts.push(parsed);
			}
		}
	}

	// Deduplicate (from primary + range overlap)
	return [...new Set(amounts)];
}

/** Parse a single dollar match string into a number, applying magnitude multipliers. */
function parseDollarMatch(raw: string): number | null {
	const cleaned = raw.replace(/[$,]/g, '');
	const num = Number.parseFloat(cleaned);
	if (Number.isNaN(num)) return null;

	const lower = raw.toLowerCase();
	if (lower.includes('trillion') || lower.match(/\dt$/i)) return num * 1_000_000_000_000;
	if (lower.includes('billion') || lower.includes('bn') || lower.match(/\db$/i)) return num * 1_000_000_000;
	if (lower.includes('million') || lower.includes('mn') || lower.match(/\dm$/i)) return num * 1_000_000;
	if (lower.includes('thousand') || lower.match(/\dk$/i)) return num * 1_000;
	return num;
}

/**
 * Check if a numeric value exists within a set of reference values (with tolerance).
 * Default tolerance is 15% (ratio between 0.85x and 1.15x).
 */
/** Format a dollar amount into a compact display string (e.g. $1.2B, $5.0M, $3.5K). */
export function formatDollarAmount(amount: number): string {
	if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
	if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
	if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
	return `$${amount}`;
}

export function isValueGrounded(value: number, referenceValues: number[], tolerance = 0.15): boolean {
	return referenceValues.some((ref) => {
		if (ref === 0 && value === 0) return true;
		if (ref === 0) return false;
		const ratio = value / ref;
		return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
	});
}

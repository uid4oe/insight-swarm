// ── Frontend Types ──────────────────────────────────────────────────────────
// Pure type definitions. Helpers/constants live in ./agents.ts, ./format.ts, ./constants.ts.

export * from "../../../shared/types.js";

import type { Connection, Finding, InvestmentThesis } from "../../../shared/types.js";

// ── Frontend-Specific Types ─────────────────────────────────────────────────

export interface ThesisDetail {
	thesis: InvestmentThesis;
	evidenceFindings: Finding[];
	connectionsUsed: Connection[];
	reactionChains: Record<string, Finding[]>;
	allRelevantConnections: Connection[];
	emergence_score: number;
}

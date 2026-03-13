// ── Composite Knowledge Graph Interface ─────────────────────────────────────
// The full DB interface is the intersection of all sub-interfaces + close().
// Consumers that need everything (e.g. SwarmAgent, SwarmRunner) import this.
// Consumers that need a subset can import the specific sub-interface from its
// dedicated file (finding-store, collaboration, orchestration).

import type { ReactionWorkflow, ThesisStore } from './collaboration.js';
import type { ConnectionGraph, FindingStore, SemanticSearch } from './finding-store.js';
import type {
	ActivityLog,
	AgentHealth,
	KnowledgeGraphCounts,
	RoundCoordinator,
	SummaryPersistence,
} from './orchestration.js';

export type { ReactionWorkflow, ThesisStore } from './collaboration.js';
// Re-export sub-interfaces so existing `import from 'knowledge-graph.js'` still works
export type { ConnectionGraph, FindingStore, SemanticSearch } from './finding-store.js';
export type {
	ActivityLog,
	AgentHealth,
	KnowledgeGraphCounts,
	RoundCoordinator,
	SummaryPersistence,
} from './orchestration.js';

export interface KnowledgeGraphDB
	extends FindingStore,
		SemanticSearch,
		ConnectionGraph,
		ReactionWorkflow,
		ThesisStore,
		RoundCoordinator,
		AgentHealth,
		ActivityLog,
		SummaryPersistence,
		KnowledgeGraphCounts {
	close(): Promise<void>;
}

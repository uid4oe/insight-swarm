# CLAUDE.md — Operational Guide for Claude Code

This file gives Claude everything it needs to run, debug, and develop Insight Swarm without re-investigating the codebase.

## Agent Development Team

This project has a full team of specialized AI agents you can invoke via slash commands. Each agent has deep context about this codebase and its conventions.

### Available Agents

| Command | Role | When to Use |
|---------|------|-------------|
| `/team [task]` | **Tech Lead / Orchestrator** | Complex multi-step tasks — decomposes and delegates to other agents |
| `/plan [feature]` | **Technical Planner** | Generate detailed specs before implementation |
| `/architect [question]` | **System Architect** | Design decisions, new subsystems, schema changes, architecture review |
| `/backend [task]` | **Backend Developer** | Node.js/TypeScript features, API endpoints, DB queries, agent tools |
| `/frontend [task]` | **Frontend Developer** | React components, Sigma.js viz, Tailwind styling, real-time UX |
| `/reviewer [files]` | **Code Reviewer** | Code review across 7 dimensions (correctness, security, perf, etc.) |
| `/tester [module]` | **Test Engineer** | Write tests (Vitest), set up test infra, coverage analysis |
| `/devops [task]` | **DevOps Engineer** | Docker, CI/CD, monitoring, deployment, infrastructure |

### Workflow Examples

**Simple bug fix:**
```
/backend Fix the race condition in round advancement when agents mark ready simultaneously
```

**New feature (full team):**
```
/team Add WebSocket support alongside SSE for real-time events
```

**Code review:**
```
/reviewer Review the changes in backend/application/agents/swarm-agent.ts
```

**Architecture question:**
```
/architect Should we add Redis for caching summaries instead of the task_summaries table?
```

### Team Orchestration Pattern

For complex tasks, use `/team` which follows this protocol:
1. **Plan** → Architect designs the approach
2. **Build** → Backend/Frontend implement in parallel where possible
3. **Test** → Tester writes tests for new code
4. **Review** → Reviewer validates all changes
5. **Verify** → Type check + lint + tests pass

## Project Overview

Insight Swarm is a multi-agent due diligence platform. Five domain-based specialist agents (Financial, Operational, Legal & Regulatory, Market & Commercial, Management & Team) collaborate via a shared PostgreSQL knowledge graph, communicate through RabbitMQ events, and are orchestrated in consensus-based rounds. Each agent covers a specific due diligence domain: Financial analyzes revenue and valuation, Operational evaluates scalability and tech, Legal assesses compliance and IP, Market maps competition and growth, and Management evaluates leadership and culture. The system auto-selects 2-5 agents per run based on prompt complexity. The API also supports custom user-defined agents beyond the 5 built-ins. The LLM backend is Google Gemini via `@google/adk`.

## Quick Reference

```
Runtime:    Node.js 22+ (ESM, .js extensions in imports)
Package:    pnpm
Language:   TypeScript 5 (strict)
HTTP:       Hono
DB:         PostgreSQL 16 + pgvector
Queue:      RabbitMQ 4
LLM:        Google Gemini 2.0 Flash (@google/adk + @google/genai)
Validation: Zod
Frontend:   React 19 + Vite + Tailwind + Zustand + Sigma (graph viz)
```

## Starting the Project

### 1. Start infrastructure (Postgres + RabbitMQ)

```bash
pnpm infra
```

This runs `docker compose -f docker-compose.dev.yml up -d`. Uses:
- `pgvector/pgvector:pg16` on port 5432 (user: mts, pass: mts, db: insight_swarm)
- `rabbitmq:4-management-alpine` on port 5672 (guest/guest), management UI on 15672

Wait for healthy:
```bash
docker compose -f docker-compose.dev.yml ps
```

### 2. Initialize the database

```bash
pnpm db:init
```

This applies the schema from `backend/infrastructure/db/pg-schema.ts` (9 tables + pgvector indexes). Idempotent — safe to run repeatedly.

### 3. Start the backend

```bash
pnpm dev
```

Runs `node --env-file=.env --import tsx --watch backend/serve.ts` on port 3000.

### 4. Start the frontend (optional)

```bash
pnpm dev:frontend
```

Runs Vite dev server on port 5173.

### 5. Both at once

```bash
pnpm dev:full
```

## Running a Sample Task

```bash
# Submit a task (system auto-selects agents based on prompt complexity)
curl -s -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Due diligence on Stripe IPO"}' | jq

# Override with specific agents (min 2)
curl -s -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Due diligence on Stripe IPO", "selectedAgents": ["financial", "operational", "legal", "market", "management"]}' | jq

# Response: {"taskId":"<uuid>","prompt":"...","selectedAgents":["financial","operational"],"status":"queued"}
```

Then monitor:
```bash
# SSE stream (real-time events)
curl -N http://localhost:3000/api/tasks/<task-id>/events

# Snapshot (poll)
curl -s http://localhost:3000/api/tasks/<task-id> | jq

# Summary (after completion)
curl -s http://localhost:3000/api/tasks/<task-id>/summary | jq

# Follow-up question (after completion)
curl -s -X POST http://localhost:3000/api/tasks/<task-id>/followup \
  -H 'Content-Type: application/json' \
  -d '{"question": "What are the biggest risks identified?"}' | jq

# List all tasks
curl -s http://localhost:3000/api/tasks | jq
```

A typical task takes **2-12 minutes** depending on agent count (2-5) and round count (default 4).

## Environment Variables

Required in `.env`:
```env
GEMINI_API_KEY=<your-key>
DATABASE_URL=postgresql://mts:mts@localhost:5432/insight_swarm
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

Infrastructure tuning (all optional, shown with defaults):
```env
NODE_ENV=development             # development | production | test
API_PORT=3000
CORS_ORIGIN=                     # optional, restricts CORS
PG_POOL_MAX=20
PG_STATEMENT_TIMEOUT=30000       # ms
```

LLM & swarm tuning (all optional, shown with defaults):
```env
GEMINI_MODEL=gemini-2.0-flash
LLM_RATE_LIMIT_RPM=60
MAX_ROUNDS=4
MAX_FINDINGS_PER_ROUND=5
MAX_REACTIONS_PER_ROUND=8
MAX_TURNS_PER_ROUND=15
THESIS_THRESHOLD=3               # triggers graceful shutdown
MAX_THESES=8
GOOGLE_SEARCH_ENABLED=true
GOOGLE_SEARCH_MAX_PER_ROUND=3
ADK_RUN_TIMEOUT_MS=180000
ADK_DEBUG=false                  # set true for verbose LLM logging
```

Task queue tuning (all optional, shown with defaults):
```env
TASK_QUEUE_MAX_RETRIES=3
TASK_QUEUE_RETRY_DELAYS=5000,30000,120000
TASK_QUEUE_PREFETCH=3
```

For faster iteration during development, reduce `MAX_ROUNDS=2` and `MAX_TURNS_PER_ROUND=8`.

Full schema: `backend/infrastructure/env.ts`

## Type Checking

```bash
pnpm typecheck    # npx tsc --noEmit
```

tsconfig includes `backend/**/*` only. Frontend has its own tsconfig at `frontend/tsconfig.json`.

## Code Quality

```bash
pnpm lint         # biome lint .
pnpm format       # biome format .
pnpm check        # biome check . (both)
pnpm check:fix    # auto-fix
```

## Database Operations

### Connect to DB

```bash
# Via Docker
docker exec -it $(docker ps -qf "ancestor=pgvector/pgvector:pg16") \
  psql -U mts -d insight_swarm

# Or directly (if psql installed)
psql postgresql://mts:mts@localhost:5432/insight_swarm
```

### Reset database (destructive)

```bash
pnpm db:reset
```

### Useful Queries

```sql
-- Task overview
SELECT task_id, prompt, status, started_at, completed_at,
       EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))::int AS duration_s
FROM tasks ORDER BY started_at DESC;

-- Findings per agent
SELECT agent_id, COUNT(*) AS findings, ROUND(AVG(confidence)::numeric, 2) AS avg_conf
FROM findings WHERE task_id = '<task-id>'
GROUP BY agent_id;

-- Connection distribution
SELECT relationship, COUNT(*), ROUND(AVG(strength)::numeric, 2) AS avg_strength
FROM connections WHERE task_id = '<task-id>'
GROUP BY relationship;

-- Theses with vote counts
SELECT title, confidence, status, created_by,
       jsonb_array_length(votes) AS vote_count,
       jsonb_array_length(evidence) AS evidence_count
FROM theses WHERE task_id = '<task-id>';

-- Agent statuses
SELECT agent_id, status, current_round, findings_count, last_heartbeat
FROM agent_status WHERE task_id = '<task-id>';

-- Round state
SELECT round_number, round_phase, agents_ready
FROM round_state WHERE task_id = '<task-id>'
ORDER BY round_number;

-- Activity log (last 20)
SELECT agent_id, round, action, summary, created_at
FROM activity_log WHERE task_id = '<task-id>'
ORDER BY created_at DESC LIMIT 20;

-- Row counts across all tables (quick health check)
SELECT 'tasks' AS t, COUNT(*) FROM tasks UNION ALL
SELECT 'findings', COUNT(*) FROM findings UNION ALL
SELECT 'connections', COUNT(*) FROM connections UNION ALL
SELECT 'theses', COUNT(*) FROM theses UNION ALL
SELECT 'reactions_needed', COUNT(*) FROM reactions_needed UNION ALL
SELECT 'activity_log', COUNT(*) FROM activity_log;
```

### Schema

9 tables defined in `backend/infrastructure/db/pg-schema.ts`:

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `tasks` | task_id, prompt, title, status, selected_agents (JSONB), agent_meta (JSONB), retry_count | Master record |
| `findings` | (task_id, id), agent_id, round, confidence, tags (JSONB), references (JSONB), parent_finding_id, embedding (vector 768) | Core knowledge unit |
| `connections` | (task_id, id), from/to finding, relationship, strength, reasoning | supports/contradicts/enables/amplifies |
| `reactions_needed` | (task_id, id), finding_id, agent_id, status | pending/reacted/skipped |
| `theses` | (task_id, id), title, thesis, evidence (JSONB), connections_used (JSONB), confidence, market_size, timing, risks (JSONB), votes (JSONB), embedding (vector 768) | Multi-agent synthesis |
| `round_state` | (task_id, round_number), agents_ready (JSONB) | Consensus barrier |
| `agent_status` | (task_id, agent_id), status, last_heartbeat | Health tracking |
| `activity_log` | (task_id, id SERIAL), agent_id, action, summary | Audit trail |
| `task_summaries` | task_id, summary (JSONB) | Cached final summary |

All tables use composite keys with `task_id` for multi-tenant isolation. All have `ON DELETE CASCADE` from `tasks`.

## RabbitMQ

Management UI: http://localhost:15672 (guest/guest)

### Topology

**Task queue** (durable, DLX retry):
- `swarm.tasks.work` — main work queue
- `swarm.tasks.retry` — retry with per-message TTL
- `swarm.tasks.dead` — dead letter (max retries exceeded)

**Event bus** (per-task topic exchange):
- Exchange: `swarm.task.<taskId>` (topic type)
- Events: `finding:created`, `connection:created`, `reaction:completed`, `thesis:created`, `thesis:voted`, `round:advanced`, `agent:status`, `agent:died`, `activity:logged`, `agents:planned`

## Architecture

### Hexagonal (Ports & Adapters)

```
domain/           → pure types + all port interfaces (KnowledgeGraphDB, SwarmConfig, Logger, RateLimiter, etc.)
application/      → domain/ only (business logic, agents, tools)
infrastructure/   → domain/ + application/ + external packages
serve.ts          → infrastructure/bootstrap
```

**Never import infrastructure from application or domain.**

All port interfaces live in `domain/ports/`. Implementations in `infrastructure/` import their corresponding port from domain.

### Dependency Injection

`AppContainer` (defined in `application/container.ts`, wired in `infrastructure/bootstrap.ts`):

```typescript
interface AppContainer {
  config: SwarmConfig;                    // from domain/ports/config
  createLogger(name: string): Logger;     // port: domain/ports/logger, impl: infrastructure/resilience/logger
  rateLimiter: RateLimiter;               // port: domain/ports/rate-limiter, impl: infrastructure/resilience/rate-limiter
  circuitBreaker: CircuitBreakerPort;     // port: domain/ports/circuit-breaker, impl: infrastructure/resilience/circuit-breaker
  embeddingService: EmbeddingPort;        // port: domain/ports/embedding, impl: infrastructure/ai/embeddings

  // Per-task resource factories
  createKnowledgeGraph(taskId: string, prompt: string): Promise<KnowledgeGraphDB>;
  openKnowledgeGraph(taskId: string): KnowledgeGraphDB;
  createEventBus(taskId: string): Promise<SwarmEventBus>;

  // Persistence helpers
  updateTaskStatus(taskId: string, status: 'running' | 'completed' | 'failed' | 'cancelled', completedAt?: Date): Promise<void>;
  saveAgentMeta(taskId: string, meta: AgentMeta[]): Promise<void>;

  shutdown(): Promise<void>;
}
```

### Request Flow

```
POST /api/tasks  →  insert task row  →  publish to RabbitMQ work queue
                                              ↓
                                    consumer picks up message
                                              ↓
                                    buildAgentConfigs() for selected agents
                                              ↓
                                    startSwarmRun() launches agents
                                              ↓
                               ┌──────────────┼──────────────┐
                               ▼              ▼              ▼
                           Agent loop     Agent loop     Agent loop
                           (research →    (research →    (research →
                            react →        react →        react →
                            connect →      connect →      connect →
                            vote →         vote →         vote →
                            mark ready)    mark ready)    mark ready)
                               │              │              │
                               └──────────────┼──────────────┘
                                              ▼
                                    Round advances (consensus)
                                              ↓
                                    ... repeat for MAX_ROUNDS ...
                                              ↓
                                    Auto-generate summary
                                              ↓
                                    Task status → 'completed'
```

### SSE Streaming

`GET /api/tasks/:id/events` has two modes:
1. **Event bus mode**: Subscribes to RabbitMQ topic exchange, real-time push
2. **Polling fallback**: If event bus is closed, polls DB every 2s (only sends snapshots when counts change)

Sends initial `snapshot` event, then incremental events, then `task:completed` or `task:failed`.

## Key Files

| File | What It Does |
|------|-------------|
| `backend/serve.ts` | Process entry point — bootstrap + graceful shutdown |
| `backend/infrastructure/bootstrap.ts` | `createAppContainer()` — wires all implementations |
| `backend/infrastructure/env.ts` | Zod env validation schema |
| `backend/infrastructure/db/pg-schema.ts` | DDL (all 9 tables) |
| `backend/infrastructure/db/pg-knowledge-graph.ts` | KnowledgeGraphDB PostgreSQL implementation |
| `backend/infrastructure/messaging/connection.ts` | Shared RabbitMQ connection manager (recovery, channel pooling) |
| `backend/infrastructure/messaging/event-bus.ts` | SwarmEventBus RabbitMQ implementation |
| `backend/infrastructure/messaging/task-queue.ts` | Durable task queue with DLX retry |
| `backend/infrastructure/http/server.ts` | Hono app setup + route registration |
| `backend/infrastructure/http/routes/task-routes.ts` | POST/GET tasks, cancel, kill endpoints |
| `backend/infrastructure/http/routes/task-detail-routes.ts` | GET task snapshot + thesis backtracking |
| `backend/infrastructure/http/routes/sse-routes.ts` | Per-task SSE stream endpoint |
| `backend/infrastructure/http/routes/global-sse-routes.ts` | Global SSE stream for task list updates (replaces polling) |
| `backend/infrastructure/http/routes/summary-routes.ts` | GET/POST summary endpoints |
| `backend/application/swarm-runner.ts` | `startSwarmRun()` — main orchestration |
| `backend/application/agents/agent-definitions.ts` | DD specialist agent configs, `buildAgentConfigs()` — builds system prompts from shared definitions |
| `backend/application/agents/swarm-agent.ts` | Per-agent round loop |
| `backend/application/agents/adk-runner.ts` | Gemini LLM execution with retry/timeout/circuit breaker |
| `backend/application/agents/prompt-builder.ts` | Dynamic prompt generation |
| `backend/application/agents/tools/knowledge-tools.ts` | write_finding, read_findings, find_tensions, etc. |
| `backend/application/agents/tools/collaboration-tools.ts` | react_to_finding, create_thesis, vote, etc. |
| `backend/application/agents/tools/google-search-limited.ts` | Budget-tracked web search tool |
| `backend/application/agents/tools/index.ts` | Barrel export for all agent tools |
| `backend/application/agents/tools/safe-execute.ts` | Error-safe tool wrapper (returns strings, never throws) |
| `backend/application/agents/tools/formatters.ts` | Tool output formatting utilities |
| `backend/application/agents/tools/numeric-utils.ts` | Numeric parsing/validation helpers |
| `backend/application/agents/tools/types.ts` | Tool-specific type definitions |
| `backend/infrastructure/resilience/rate-limiter.ts` | Hierarchical token bucket rate limiter |
| `backend/infrastructure/resilience/circuit-breaker.ts` | Gemini API circuit breaker |
| `backend/infrastructure/resilience/logger.ts` | Structured console logger |
| `backend/domain/ports/logger.ts` | Logger port interface |
| `backend/domain/ports/rate-limiter.ts` | RateLimiter port interface |
| `backend/domain/ports/circuit-breaker.ts` | CircuitBreakerPort interface + CircuitOpenError |
| `backend/domain/ports/embedding.ts` | EmbeddingPort interface |
| `backend/application/container.ts` | AppContainer interface |
| `backend/application/summary-service.ts` | LLM-powered summary generation, JSON repair, persistence orchestration |
| `backend/application/summary-analytics.ts` | Pure analytics builders (evidence chains, risk matrix, stance evolution, etc.) |
| `backend/application/followup-service.ts` | Follow-up question answering (RAG over task knowledge graph) |
| `backend/infrastructure/http/routes/followup-routes.ts` | POST /api/tasks/:id/followup endpoint |
| `backend/infrastructure/http/task-registry.ts` | Live + archived task tracking (in-memory + DB) |
| `backend/domain/types.ts` | Re-exports all shared types from `shared/types.ts` |
| `backend/domain/agents.ts` | AgentConfig interface + re-exports AgentMeta from shared types |
| `backend/domain/events.ts` | SwarmEventBus interface + event type map |
| `backend/domain/services/activity.ts` | Activity logging domain service |
| `backend/domain/ports/knowledge-graph.ts` | KnowledgeGraphDB composed from sub-interfaces across 3 files |
| `backend/domain/ports/finding-store.ts` | FindingStore, SemanticSearch, ConnectionGraph sub-interfaces |
| `backend/domain/ports/collaboration.ts` | ReactionWorkflow, ThesisStore sub-interfaces |
| `backend/domain/ports/orchestration.ts` | RoundCoordinator, AgentHealth, ActivityLog, SummaryPersistence, KnowledgeGraphCounts sub-interfaces |
| `backend/domain/ports/config.ts` | SwarmConfig interface |
| `backend/domain/ports/event-bus.ts` | SwarmEventBus port interface |
| `shared/agent-definitions.ts` | 5 DD agent definitions (id, label, shortLabel, color, description, perspective), `CustomAgentDefinition` interface, `normalizeAgentId()`, `customToAgentDefinition()` — imported by both backend and frontend |
| `shared/types.ts` | Single source of truth for all domain types: Finding, Connection, InvestmentThesis, Reaction, AgentMeta, TaskState, StructuredSummary, etc. — shared across backend and frontend |

## Agent Tools

### Knowledge Tools
| Tool | Purpose |
|------|---------|
| `write_finding` | Create a finding with title, description, confidence, tags, embedding |
| `read_findings` | Query findings with filters (agent, round, category, tags) |
| `create_connection` | Link two findings with relationship type + strength |
| `read_connections` | Query connections |
| `query_findings_by_tags` | Discover findings across agents by tag |
| `traverse_connections` | Graph walk from a starting finding |
| `find_tensions` | Find semantically similar but unconnected cross-agent finding pairs |

### Collaboration Tools
| Tool | Purpose |
|------|---------|
| `react_to_finding` | Respond to another agent's finding (optionally create follow-up) |
| `skip_reaction` | Skip a reaction with reason |
| `get_pending_reactions` | Check what needs reacting to |
| `create_thesis` | Synthesize multi-agent insight (requires 2+ agent evidence) |
| `vote_on_thesis` | Vote support or challenge on a thesis |
| `get_theses` | List all theses |
| `mark_round_ready` | Signal done with current round |
| `check_agents` | See peer agent statuses |
| `post_question` | Ask other agents a question |

### Web Search
| Tool | Purpose |
|------|---------|
| `google_search` | Budget-limited web search (max per round per agent) |

## Debugging

### Enable verbose LLM logging

```env
ADK_DEBUG=true
```

This enables the ADK `LoggingPlugin` which logs every LLM request/response to console.

### Check agent progress

```bash
# Via API
curl -s http://localhost:3000/api/tasks/<task-id> | jq '.agents'

# Via DB
psql postgresql://mts:mts@localhost:5432/insight_swarm -c \
  "SELECT agent_id, status, current_round, findings_count FROM agent_status WHERE task_id = '<task-id>';"
```

### Check why a task failed

```bash
# Check task status
psql postgresql://mts:mts@localhost:5432/insight_swarm -c \
  "SELECT task_id, status, retry_count FROM tasks WHERE task_id = '<task-id>';"

# Check activity log for errors
psql postgresql://mts:mts@localhost:5432/insight_swarm -c \
  "SELECT agent_id, action, summary FROM activity_log WHERE task_id = '<task-id>' ORDER BY created_at DESC LIMIT 10;"
```

### Check RabbitMQ state

```bash
# Queue depths
docker exec $(docker ps -qf "ancestor=rabbitmq:4-management-alpine") \
  rabbitmqctl list_queues name messages consumers

# Or visit http://localhost:15672
```

### Kill a stuck agent

```bash
curl -X POST http://localhost:3000/api/tasks/<task-id>/kill/<agent-id>
```

### Cancel a task

```bash
curl -X POST http://localhost:3000/api/tasks/<task-id>/cancel
```

### Full reset

```bash
pnpm db:reset     # Wipe all data, re-apply schema
pnpm infra:down   # Stop Postgres + RabbitMQ
pnpm infra        # Restart fresh
pnpm db:init      # Re-apply schema
```

## Docker Deployment

### Full stack (production)

```bash
cp .env.example .env
# Set GEMINI_API_KEY, POSTGRES_PASSWORD, RABBITMQ_PASSWORD
docker compose up -d --build
```

Services: postgres (512M), rabbitmq (256M), api (1G), web/nginx (128M).

Frontend at port 80, API proxied through nginx with SSE support (1h timeout, buffering disabled).

## Performance Characteristics

From actual runs (4 tasks, Feb 2026):

| Metric | Range |
|--------|-------|
| Task duration | 97s - 771s (depends on agent count + topic) |
| Agents per task | 2-5 (auto-selected domain-based DD specialists) |
| Findings per task | 17-28 |
| Connections per task | 11-28 |
| Theses per task | 6-8 |
| Avg confidence | 0.70-0.74 |
| Cross-agent connections | 76% of all connections |
| Throughput | 2.8-10.5 findings/min |

Bottleneck: agents spend 60-70% of time waiting for slowest peer in later rounds (round synchronization barrier).

## Conventions

- ESM only — all imports use `.js` extensions
- Node imports use `node:` protocol (e.g., `import { randomUUID } from 'node:crypto'`)
- Strict TypeScript — no `any`, no implicit any
- Formatting: tabs, single quotes (backend), double quotes (frontend), trailing commas, semicolons, 120 char line width
- All port interfaces in `domain/ports/` (10 files: knowledge-graph, finding-store, collaboration, orchestration, config, event-bus, logger, rate-limiter, circuit-breaker, embedding); implementations in `infrastructure/`
- Per-task isolation — all DB tables keyed by `(task_id, ...)`
- Tools wrapped in `safeExecute()` — errors returned as strings, never thrown
- Categories normalized to snake_case at write time
- Agent IDs are lowercase slugs (e.g., `financial`, `operational`, `legal`, `market`, `management`)
- Custom agents use `agent_` prefix (auto-added via `normalizeAgentId()`)
- All domain types defined in `shared/types.ts` — single source of truth for backend and frontend
- Frontend utilities organized in `frontend/src/lib/` (api, store, config, types, router, agents, constants, format)
- Reusable frontend components in `frontend/src/components/common/` (ConfidenceMeter, Drawer, ErrorBoundary, SectionDivider, Toast)

# Insight Swarm

**[Live Demo](https://insight-swarm.web.app)** — watch a recorded analysis replay with the full interactive graph UI.

An experiment in emergent multi-agent intelligence. Multiple AI agents — each with a distinct analytical perspective — research a topic independently, write findings to a shared knowledge graph, discover tensions in each other's work, form cross-agent connections, and synthesize theses through structured debate. No central agent orchestrates them. Insights emerge from the graph.

The question driving this project: **what happens when you replace a central orchestrator with a shared knowledge graph and let agents figure it out?**

---

https://github.com/user-attachments/assets/3c130922-beac-41d1-a542-e8e50d69b54d

https://github.com/user-attachments/assets/60b50e34-38ba-4424-98f9-c5f96193fa35

---

## The Experiment

Most multi-agent systems follow the same pattern: one "manager" agent decomposes a task, assigns subtasks, and merges results. That manager becomes the bottleneck, the single point of failure, and — critically — the source of opinion bias. The orchestrator's framing shapes every output before agents even start thinking.

Insight Swarm removes the orchestrator entirely and replaces it with a **shared knowledge graph** that agents read from and write to independently. The interesting part is what emerges:

- **Agents discover each other's work through semantic similarity**, not explicit routing. When Agent A writes a finding, the system uses vector embeddings to identify which peers would find it most relevant — then queues asynchronous reactions.

- **Connections form organically.** Agents create typed relationships between findings (`supports`, `contradicts`, `enables`, `amplifies`) as they encounter related work in the graph. ~76% of connections end up being cross-agent.

- **Theses require multi-agent evidence.** An agent can only propose a thesis if it cites evidence from at least 2 different agents. This forces synthesis across perspectives rather than single-agent conclusions.

- **Disagreement is enforced, not just encouraged.** Each agent must vote "challenge" on at least 30% of theses. The system monitors contradiction ratios and injects dissent prompts when agreement becomes too uniform.

- **Prompts adapt to graph maturity.** Early rounds push agents toward raw discovery. As the graph grows, prompts shift toward connection-making and synthesis. Late rounds enforce thesis creation and voting.

The result: 2-5 agents running for 2-12 minutes typically produce 17-28 findings, 11-28 connections, and 6-8 theses — with genuine disagreements, contested conclusions, and evidence chains you can trace back through the graph.

```mermaid
graph TD
    KG["Knowledge Graph (PostgreSQL + pgvector)\nfindings · connections · theses · votes"]
    A["Financial Agent"]
    B["Operational Agent"]
    C["Market Agent"]

    KG --- A
    KG --- B
    KG --- C

    MQ["RabbitMQ Events"] -.->|peer awareness| A
    MQ -.->|peer awareness| B
    MQ -.->|peer awareness| C
```

---

## How It Works

### The Agent Loop

Each agent runs an independent round loop. No global synchronization barrier, no turn-taking, no waiting for instructions. Agents advance at their own pace:

```mermaid
graph LR
    R["React to peers"] --> W["Research & write findings"]
    W --> C["Connect across agents"]
    C --> S["Synthesize theses"]
    S --> V["Vote on theses"]
    V --> A["Advance round"]
    A -.->|next round| R
```

> Dynamic prompts inject: knowledge graph context, semantic neighbors, tension detection, groupthink warnings, and novelty pressure.

### The Knowledge Graph

The graph is the coordination mechanism. Agents don't talk to a manager — they talk to the graph:

| Entity | Role |
|--------|------|
| **Findings** | Core knowledge units — title, description, confidence score, tags, 768-dim vector embedding |
| **Connections** | Typed relationships between findings: `supports`, `contradicts`, `enables`, `amplifies` — with strength scores and reasoning |
| **Theses** | Multi-agent conclusions requiring evidence from 2+ agents |
| **Votes** | Support or challenge votes on theses, with agent reasoning |
| **Reactions** | Cross-agent responses — an agent reads a peer's finding and creates a follow-up |

### Anti-Groupthink Mechanisms

Without an orchestrator forcing diversity, agents naturally converge. The system actively fights this:

- **Mandatory challenge votes** — each agent must challenge at least 30% of theses it votes on
- **Tension detection** — pgvector cosine similarity surfaces semantically close but unconnected cross-agent findings as potential contradictions
- **Novelty pressure** — dynamic prompts push agents toward uncovered areas as rounds progress
- **Antithetical theses** — agents can propose theses that directly oppose existing ones
- **Duplicate blocking** — cosine similarity > 0.85 rejects redundant findings
- **Perspective lock** — each agent has a fixed analytical lens it cannot abandon

### What Emerges

Patterns that appear without being explicitly programmed:

**Finding cascades** — Agent X writes a finding, semantic routing triggers reactions from agents Y and Z, their follow-ups surface new tensions, connections form, more reactions cascade.

**Disagreement chains** — Agent X proposes a thesis, Agent Y votes challenge with reasoning, Y proposes an antithetical thesis, both coexist with competing vote tallies, the summary surfaces it as a "contested" conclusion.

**Blind spot detection** — if only one agent tags a topic (e.g., "supply chain risk"), the summary flags it as a blind spot needing broader perspective.

**Cross-domain synthesis** — Financial agent finds high CAC, Operational agent finds scaling bottleneck, Market agent discovers competitor dynamics — a thesis emerges connecting all three that no single agent could have proposed alone.

---

## Built-in Agents

The default configuration ships with 5 due diligence specialists, but the engine is domain-agnostic — swap in any perspective.

| Agent | Focus |
|-------|-------|
| **Financial** | Revenue, unit economics, valuation, burn rate, cap table |
| **Operational** | Scalability, tech stack, supply chain, infrastructure |
| **Legal & Regulatory** | Compliance, IP, litigation, data privacy, licensing |
| **Market & Commercial** | Market sizing, competition, PMF, growth drivers |
| **Management & Team** | Leadership quality, culture, key-person risk, board |

Custom agents can be defined at runtime via the API — no code changes. They get the same tools, graph access, and anti-groupthink protections as built-in agents.

---

## Quick Start

### Prerequisites

- Node.js 22+, pnpm, Docker
- [Gemini API key](https://aistudio.google.com/apikey)

### Setup

```bash
pnpm install
cd frontend && pnpm install && cd ..

cp .env.example .env
# Set GEMINI_API_KEY in .env

pnpm infra          # Start Postgres + RabbitMQ
pnpm db:init        # Apply schema (idempotent)
pnpm dev:full       # Backend (3000) + frontend (5173)
```

Open `http://localhost:5173` — type a prompt, pick 2-5 agents, hit Analyze.

### Try It

```bash
# Submit a task (agents auto-selected based on prompt)
curl -s -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Due diligence on Stripe IPO"}' | jq

# Stream real-time events (SSE)
curl -N http://localhost:3000/api/tasks/<id>/events

# Get structured summary (after completion)
curl -s http://localhost:3000/api/tasks/<id>/summary | jq

# Ask follow-up questions (RAG over the knowledge graph)
curl -s -X POST http://localhost:3000/api/tasks/<id>/followup \
  -H 'Content-Type: application/json' \
  -d '{"question":"What are the biggest risks?"}' | jq
```

---

## Architecture

```mermaid
graph TD
    UI["React Frontend"] -->|HTTP + SSE| API["Hono API Server"]
    API --> MQ["RabbitMQ"]
    API --> PG["PostgreSQL + pgvector"]
    MQ --> SR["Swarm Runner"]
    SR --> A1["Financial Agent"]
    SR --> A2["Operational Agent"]
    SR --> A3["Market Agent"]
    A1 --> PG
    A2 --> PG
    A3 --> PG
```

**The Swarm Runner is not an orchestrator.** It launches agents and manages lifecycle (startup, shutdown, crash recovery). It never reads findings, never directs work, never assigns subtasks, never merges outputs.

### Stack

| Layer | Technology |
|-------|-----------|
| LLM | Google Gemini 2.0 Flash via `@google/adk` + `@google/genai` |
| HTTP | Hono |
| Database | PostgreSQL 16 + pgvector (768-dim embeddings) |
| Queue | RabbitMQ 4 (per-task topic exchanges, durable work queue with DLX retry) |
| Frontend | React 19 + Vite + Tailwind 4 + Zustand + Sigma.js / Graphology |
| Language | TypeScript (strict, ESM-only) |

### Agent Tools

Every agent has the same toolkit — no privileged access:

- **Knowledge** — `write_finding`, `read_findings`, `create_connection`, `read_connections`, `query_findings_by_tags`, `traverse_connections`, `find_tensions`
- **Collaboration** — `react_to_finding`, `skip_reaction`, `get_pending_reactions`, `create_thesis`, `vote_on_thesis`, `get_theses`, `mark_round_ready`, `check_agents`, `post_question`
- **Web search** — `google_search` with per-round per-agent budget limits

### Resilience

| Mechanism | What It Does |
|-----------|-------------|
| Rate limiter | Hierarchical token bucket (global + per-agent) prevents starvation |
| Circuit breaker | Protects against cascading Gemini API failures |
| DLX retry queue | Failed tasks retry with backoff (5s, 30s, 120s) |
| Agent death detection | Heartbeat monitoring; dead agents skipped gracefully |
| Graceful shutdown | SIGTERM/SIGINT closes queues, DB, exit |

---

## Frontend

A real-time dashboard that makes the orchestrator-free collaboration visible.

**During analysis** — interactive Sigma.js knowledge graph (findings as nodes, connections as edges, theses as diamonds), agent status bar, activity log, emerging theses sidebar.

**After completion** — split-panel with structured summary (headline, risk matrix, key debates, recommendations) on the left, full interactive graph on the right. Thesis deep-dive shows emergence narrative, evidence chains, vote breakdowns. Follow-up chat uses RAG over the task's knowledge graph.

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks` | Submit a task (`prompt` + optional `selectedAgents` + `customAgents`) |
| `GET` | `/api/tasks` | List all tasks |
| `GET` | `/api/tasks/:id` | Full snapshot (findings, connections, theses, agents) |
| `GET` | `/api/tasks/:id/events` | SSE real-time event stream |
| `GET` | `/api/tasks/:id/summary` | Structured summary |
| `GET` | `/api/tasks/:id/theses/:thesisId` | Thesis detail with evidence chain |
| `POST` | `/api/tasks/:id/followup` | Follow-up question (RAG) |
| `POST` | `/api/tasks/:id/cancel` | Cancel a running task |

---

## Configuration

```env
# Required
GEMINI_API_KEY=your-key-here
DATABASE_URL=postgresql://mts:mts@localhost:5432/insight_swarm
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Swarm tuning (optional, defaults shown)
MAX_ROUNDS=4                     # rounds per task
MAX_FINDINGS_PER_ROUND=5
MAX_REACTIONS_PER_ROUND=8
THESIS_THRESHOLD=3               # thesis count that triggers graceful shutdown
GOOGLE_SEARCH_ENABLED=true
```

For faster dev iteration: `MAX_ROUNDS=2 MAX_TURNS_PER_ROUND=8`

---

## Deployment

### Docker

```bash
cp .env.example .env
# Set GEMINI_API_KEY, POSTGRES_PASSWORD, RABBITMQ_PASSWORD
docker compose up -d --build
```

### Development

```bash
pnpm infra          # Postgres + RabbitMQ in Docker
pnpm db:init        # Apply schema
pnpm dev:full       # Backend (3000) + Frontend (5173)
pnpm typecheck      # tsc --noEmit
pnpm check          # Biome lint + format
pnpm db:reset       # Wipe + re-apply schema
```

---

## License

MIT

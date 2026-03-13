export const PG_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tasks (
  task_id         TEXT PRIMARY KEY,
  prompt          TEXT NOT NULL,
  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'running',
  selected_agents JSONB NOT NULL DEFAULT '[]'::jsonb,
  agent_meta      JSONB,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS findings (
  id                TEXT NOT NULL,
  task_id           TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL,
  round             INTEGER NOT NULL,
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  tags              JSONB NOT NULL DEFAULT '[]'::jsonb,
  "references"      JSONB NOT NULL DEFAULT '[]'::jsonb,
  parent_finding_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedding         vector(768),
  PRIMARY KEY (task_id, id)
);

CREATE TABLE IF NOT EXISTS connections (
  id              TEXT NOT NULL,
  task_id         TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  from_finding_id TEXT NOT NULL,
  to_finding_id   TEXT NOT NULL,
  relationship    TEXT NOT NULL,
  strength        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  reasoning       TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  round           INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, id)
);

CREATE TABLE IF NOT EXISTS reactions_needed (
  id          TEXT NOT NULL,
  task_id     TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  finding_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  reaction    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reacted_at  TIMESTAMPTZ,
  PRIMARY KEY (task_id, id)
);

CREATE TABLE IF NOT EXISTS theses (
  id               TEXT NOT NULL,
  task_id          TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  thesis           TEXT NOT NULL,
  evidence         JSONB NOT NULL DEFAULT '[]'::jsonb,
  connections_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  market_size      TEXT,
  timing           TEXT,
  risks            JSONB NOT NULL DEFAULT '[]'::jsonb,
  votes            JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'proposed',
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedding        vector(768),
  PRIMARY KEY (task_id, id)
);

CREATE TABLE IF NOT EXISTS round_state (
  task_id       TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  round_number  INTEGER NOT NULL,
  round_phase   TEXT NOT NULL DEFAULT 'active',
  agents_ready  JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, round_number)
);

CREATE TABLE IF NOT EXISTS agent_status (
  task_id        TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  agent_id       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'idle',
  current_task   TEXT,
  current_round  INTEGER NOT NULL DEFAULT 1,
  findings_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, agent_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         SERIAL,
  task_id    TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL,
  round      INTEGER NOT NULL,
  action     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, id)
);

CREATE TABLE IF NOT EXISTS task_summaries (
  task_id    TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  summary    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_task_agent ON findings(task_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_findings_task_round ON findings(task_id, round);
CREATE INDEX IF NOT EXISTS idx_findings_tags ON findings USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_findings_embedding ON findings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_connections_task_from ON connections(task_id, from_finding_id);
CREATE INDEX IF NOT EXISTS idx_connections_task_to ON connections(task_id, to_finding_id);
CREATE INDEX IF NOT EXISTS idx_reactions_task_agent ON reactions_needed(task_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_reactions_task_finding ON reactions_needed(task_id, finding_id);
CREATE INDEX IF NOT EXISTS idx_activity_task_created ON activity_log(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_task_action ON activity_log(task_id, action);
CREATE INDEX IF NOT EXISTS idx_activity_task_agent ON activity_log(task_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_theses_task ON theses(task_id);
CREATE INDEX IF NOT EXISTS idx_theses_embedding ON theses USING hnsw (embedding vector_cosine_ops);
CREATE UNIQUE INDEX IF NOT EXISTS idx_theses_task_title ON theses(task_id, title);
CREATE INDEX IF NOT EXISTS idx_agent_status_task_status ON agent_status(task_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_status_task_heartbeat ON agent_status(task_id, last_heartbeat);

DO $$ BEGIN
  ALTER TABLE connections ADD CONSTRAINT fk_connections_from
    FOREIGN KEY (task_id, from_finding_id) REFERENCES findings(task_id, id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE connections ADD CONSTRAINT fk_connections_to
    FOREIGN KEY (task_id, to_finding_id) REFERENCES findings(task_id, id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE reactions_needed ADD CONSTRAINT chk_reactions_status
    CHECK (status IN ('pending', 'reacted', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;

-- Runs once when Postgres container initializes a fresh volume.
-- The database itself is created by POSTGRES_DB env var.
CREATE EXTENSION IF NOT EXISTS vector;

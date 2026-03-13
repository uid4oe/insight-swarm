import { PG_SCHEMA_SQL } from './pg-schema.js';
import { getPool } from './pool.js';

export async function initializeDatabase(): Promise<void> {
	const pool = getPool();
	await pool.query(PG_SCHEMA_SQL);
}

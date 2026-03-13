import pg from 'pg';
import { getEnv } from '../env.js';
import { createLogger } from '../resilience/logger.js';

const { Pool } = pg;
const logger = createLogger('PGPool');

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (!pool) {
		const env = getEnv();
		pool = new Pool({
			connectionString: env.DATABASE_URL,
			max: env.PG_POOL_MAX,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 5_000,
			statement_timeout: env.PG_STATEMENT_TIMEOUT,
		});

		pool.on('error', (err) => {
			logger.error('Unexpected PG pool error', err);
		});
	}
	return pool;
}

export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

import { validateEnv } from '../env.js';
import { initializeDatabase } from './pg-init.js';
import { getPool } from './pool.js';

validateEnv();

const command = process.argv[2];

if (command === 'init') {
	await initializeDatabase();
	console.log('Schema applied.');
	process.exit(0);
}

if (command === 'reset') {
	const pool = getPool();
	await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
	await initializeDatabase();
	await pool.end();
	console.log('Database reset + schema applied.');
	process.exit(0);
}

console.error(`Usage: db cli <init|reset>`);
process.exit(1);

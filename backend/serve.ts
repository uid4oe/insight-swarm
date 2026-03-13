import { createAppContainer } from './infrastructure/bootstrap.js';
import { startServer } from './infrastructure/http/server.js';

const container = await createAppContainer();

// taskQueue is set after startServer() resolves. shutdown() must guard against
// being called before that (e.g. uncaughtException during server bootstrap).
let taskQueue: { close(): Promise<void> } | null = null;
let shuttingDown = false;

// Graceful shutdown
async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;

	const isError = signal === 'uncaughtException';
	const logger = container.createLogger('Shutdown');
	logger.info(`Received ${signal}, shutting down gracefully...`);
	try {
		await taskQueue?.close();
		await container.shutdown();
	} catch (err) {
		logger.error('Error during shutdown', err);
	}
	process.exit(isError ? 1 : 0);
}

// Global error handlers — must be registered before startServer()
process.on('unhandledRejection', (reason) => {
	const logger = container.createLogger('Process');
	logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (err) => {
	const logger = container.createLogger('Process');
	logger.error('Uncaught exception — shutting down', err);
	shutdown('uncaughtException').catch(() => process.exit(1));
});

const serverHandle = await startServer(container);
taskQueue = serverHandle.taskQueue;

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

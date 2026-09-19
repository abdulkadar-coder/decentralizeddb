import { loadEnvFile, loadConfig } from './config.js';
import { logger } from './logger.js';
import { createAppContext } from './context.js';
import { createApp } from './app.js';

loadEnvFile();
const config = loadConfig();

if (!config.jwtSecretProvided) {
  logger.warn('bootstrap', 'JWT_SECRET is not set - using a random per-boot development secret (NOT production-safe)');
}
if (!config.masterKeyProvided) {
  logger.warn('bootstrap', 'MASTER_KEY is not set - using a random per-boot development master key (NOT production-safe)');
}

const ctx = await createAppContext(config);
const app = createApp(ctx);

const server = app.listen(config.port, config.host, () => {
  logger.info('bootstrap', 'zerotrust-hrms phase-1 API listening', {
    host: config.host,
    port: config.port,
    env: config.nodeEnv,
    storage: config.storageBackend,
    blockchain: 'local-single-node-hash-linked-prototype (not decentralized)',
  });
});

function shutdown(signal: string): void {
  logger.info('bootstrap', `received ${signal}, shutting down`);
  server.close(() => {
    ctx.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
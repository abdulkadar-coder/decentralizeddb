import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppContext, type AppContext } from '../src/context.js';
import { defaultFabricOptions, type AppConfig } from '../src/config.js';

export interface TestOverrides extends Partial<AppConfig> {
  dbFile?: string;
  fsStorageRoot?: string;
}

export function testConfig(overrides: TestOverrides = {}): { config: AppConfig; workDir: string } {
  const workDir = mkdtempSync(join(tmpdir(), 'hrms-test-'));
  const base: AppConfig = {
    nodeEnv: 'test',
    isDev: false,
    host: '127.0.0.1',
    port: 0,
    jwtSecret: 'test-only-jwt-secret-0123456789abcdef',
    jwtSecretProvided: true,
    masterKey: Buffer.from('3'.repeat(32), 'utf8'),
    masterKeyProvided: true,
    dataDir: workDir,
    dbFile: join(workDir, 'test.db'),
    storageBackend: 'filesystem',
    fsStorageRoot: join(workDir, 'objects'),
    minio: {
      endpoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'test',
      secretKey: 'test',
      bucket: 'test-bucket',
    },
    blockchainBackend: 'sqlite',
    ledgerBackend: 'off',
    fabric: { ...defaultFabricOptions(), enabled: false },
  };
  return { config: { ...base, ...overrides }, workDir };
}

export async function makeTestContext(overrides: TestOverrides = {}): Promise<{
  ctx: AppContext;
  workDir: string;
  cleanup: () => void;
}> {
  const { config, workDir } = testConfig(overrides);
  const ctx = await createAppContext(config);
  return {
    ctx,
    workDir,
    cleanup: () => {
      try {
        ctx.close();
      } catch {
        /* already closed */
      }
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
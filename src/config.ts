import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FabricLedgerOptions } from './ledger/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Walk up from the module location to find package.json (works from src/ and dist/). */
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = resolve(dir, '..');
  }
  return resolve(start, '..');
}

const PROJECT_ROOT = findProjectRoot(__dirname);

const DEV = process.env.NODE_ENV !== 'production';

/** Minimal `.env` loader (no external dependency). Never overrides real env vars. */
export function loadEnvFile(): void {
  const envPath = join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function resolvePath(p: string | undefined, fallback: string): string {
  if (!p) return join(PROJECT_ROOT, fallback);
  return resolve(PROJECT_ROOT, p);
}

export interface AppConfig {
  nodeEnv: string;
  isDev: boolean;
  host: string;
  port: number;
  jwtSecret: string;
  jwtSecretProvided: boolean;
  masterKey: Buffer;
  masterKeyProvided: boolean;
  dataDir: string;
  dbFile: string;
  storageBackend: 'filesystem' | 'minio';
  fsStorageRoot: string;
  minio: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  blockchainBackend: 'sqlite' | 'memory';
  ledgerBackend: 'off' | 'fabric';
  fabric: FabricLedgerOptions & { enabled: boolean };
}

/** Loads configuration. Falls back to random dev-only secrets when absent. */
export function loadConfig(): AppConfig {
  const jwtProvided = Boolean(process.env.JWT_SECRET);
  const jwtSecret = process.env.JWT_SECRET || randomBytes(32).toString('base64url');

  const masterProvided = Boolean(process.env.MASTER_KEY);
  const masterKey = process.env.MASTER_KEY
    ? Buffer.from(process.env.MASTER_KEY, 'base64')
    : randomBytes(32);

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const minioPort = Number.parseInt(process.env.MINIO_PORT ?? '9000', 10);

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    isDev: DEV,
    host: process.env.HOST ?? '0.0.0.0',
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    jwtSecret,
    jwtSecretProvided: jwtProvided,
    masterKey,
    masterKeyProvided: masterProvided,
    dataDir: resolvePath(process.env.DATA_DIR, 'data'),
    dbFile: resolvePath(process.env.DB_FILE, 'data/hrms.db'),
    storageBackend: (process.env.STORAGE_BACKEND as AppConfig['storageBackend']) ?? 'filesystem',
    fsStorageRoot: resolvePath(process.env.FS_STORAGE_ROOT, 'data/objects'),
    minio: {
      endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number.isFinite(minioPort) && minioPort > 0 ? minioPort : 9000,
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
      bucket: process.env.MINIO_BUCKET ?? 'hrms-documents',
    },
    blockchainBackend: (process.env.BLOCKCHAIN_BACKEND as AppConfig['blockchainBackend']) ?? 'sqlite',
    ledgerBackend: (process.env.LEDGER_BACKEND as AppConfig['ledgerBackend'] ?? 'off') === 'fabric' ? 'fabric' : 'off',
    fabric: {
      ...defaultFabricOptions(),
      enabled: process.env.LEDGER_BACKEND === 'fabric',
    },
  };
}

/** Default Hyperledger Fabric connection options (paths relative to the repo). */
export function defaultFabricOptions(): FabricLedgerOptions {
  return {
    mspId: process.env.FABRIC_MSP_ID ?? 'HROrgMSP',
    mspConfigDir: resolvePath(
      process.env.FABRIC_MSP_CONFIG_DIR,
      'fabric/organizations/peerOrganizations/hr.hrms.com/users/Admin@hr.hrms.com/msp',
    ),
    tlsCaCert: resolvePath(
      process.env.FABRIC_TLS_CA,
      'fabric/organizations/peerOrganizations/hr.hrms.com/tlsca/tlsca.hr.hrms.com-cert.pem',
    ),
    peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? 'localhost:7051',
    tlsHostOverride: process.env.FABRIC_TLS_HOST_OVERRIDE ?? 'peer0.hr.hrms.com',
    channel: process.env.FABRIC_CHANNEL ?? 'hrmsaudit',
    chaincode: process.env.FABRIC_CHAINCODE ?? 'hrmsauditcc',
    endorseOrgs: splitList(process.env.FABRIC_ENDORSE_ORGS, ['HROrgMSP', 'FinanceOrgMSP']),
  };
}

function splitList(value: string | undefined, fallback: string[]): string[] {
  if (!value || !value.trim()) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export { PROJECT_ROOT };
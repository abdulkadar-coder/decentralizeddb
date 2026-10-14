import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
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
  totp: {
    encryptionKey: Buffer;
    issuer: string;
    digits: number;
    period: number;
    window: number;
    recoveryCount: number;
    recoveryLen: number;
    /** DEV-ONLY: when true, any 6-digit code is accepted as a valid
     * authenticator code. Never enabled outside development. */
    acceptAnyCode: boolean;
  };
  sms: {
    enabled: boolean;
    toNumber: string;
    ttlSeconds: number;
    digits: number;
    devMode: boolean;
  };
  tokenTtlSeconds: number;
}

/** Loads configuration. Falls back to random dev-only secrets when absent. */
function deriveTotpKey(jwtSecret: string): Buffer {
  return createHash('sha256').update(jwtSecret + '|totp-enc').digest();
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isDev = nodeEnv !== 'production';
  const jwtProvided = Boolean(process.env.JWT_SECRET);
  if (!isDev && (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32)) {
    throw new Error('JWT_SECRET must be set to at least 32 bytes in production');
  }
  const jwtSecret = process.env.JWT_SECRET || randomBytes(32).toString('base64url');

  const masterProvided = Boolean(process.env.MASTER_KEY);
  const masterKeyValue = process.env.MASTER_KEY;
  const configuredMasterKey = masterKeyValue ? Buffer.from(masterKeyValue, 'base64') : undefined;
  if (
    !isDev &&
    (!masterKeyValue || !configuredMasterKey || configuredMasterKey.length < 32 || configuredMasterKey.toString('base64') !== masterKeyValue)
  ) {
    throw new Error('MASTER_KEY must be valid base64 containing at least 32 bytes in production');
  }
  const masterKey = process.env.MASTER_KEY
    ? configuredMasterKey!
    : randomBytes(32);

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const minioPort = Number.parseInt(process.env.MINIO_PORT ?? '9000', 10);
  const tokenTtlSeconds = Number.parseInt(process.env.TOKEN_TTL_SECONDS ?? '900', 10);

  return {
    nodeEnv,
    isDev,
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
    totp: {
      encryptionKey: process.env.TOTP_ENC_KEY
        ? Buffer.from(process.env.TOTP_ENC_KEY, 'base64')
        : deriveTotpKey(jwtSecret),
      issuer: process.env.TOTP_ISSUER ?? 'ZeroTrust HRMS',
      digits: Number.parseInt(process.env.TOTP_DIGITS ?? '6', 10),
      period: Number.parseInt(process.env.TOTP_PERIOD ?? '30', 10),
      window: Number.parseInt(process.env.TOTP_WINDOW ?? '1', 10),
      recoveryCount: Number.parseInt(process.env.TOTP_RECOVERY_COUNT ?? '8', 10),
      recoveryLen: Number.parseInt(process.env.TOTP_RECOVERY_LEN ?? '10', 10),
      acceptAnyCode: isDev && (process.env.TOTP_ACCEPT_ANY_CODE ?? 'false') === 'true',
    },
    tokenTtlSeconds: Number.isFinite(tokenTtlSeconds) && tokenTtlSeconds > 0 ? tokenTtlSeconds : 900,
    sms: {
      enabled: (process.env.SMS_OTP_ENABLED ?? (isDev ? 'true' : 'false')) === 'true',
      toNumber: process.env.SMS_TO_NUMBER ?? '+15555550100',
      ttlSeconds: Number.parseInt(process.env.SMS_OTP_TTL_SECONDS ?? '300', 10),
      digits: Number.parseInt(process.env.SMS_OTP_DIGITS ?? '6', 10),
      devMode: (process.env.SMS_OTP_DEV_MODE ?? 'true') === 'true' && isDev,
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

import type { AppConfig } from './config.js';
import type { Db } from './db/index.js';
import { openDatabase } from './db/index.js';
import { LocalKeyManager, type KeyManager } from './crypto/keys.js';
import { createStorageAdapter, type StorageAdapter } from './storage/factory.js';
import { MemoryChainStore, SqliteChainStore, LocalBlockchain } from './blockchain/blockchain.js';
import { FabricLedger } from './ledger/fabric.js';
import type { LedgerBridge } from './ledger/types.js';
import { AuditService } from './modules/audit/service.js';
import { AuthService } from './modules/auth/service.js';
import { TotpService } from './modules/auth/totp.service.js';
import { SmsOtpService } from './modules/auth/smsOtp.service.js';
import { EmployeesService } from './modules/employees/service.js';
import { DocumentsService } from './modules/documents/service.js';
import { UsersService } from './modules/users/service.js';
import { seedDemoAccounts } from './demo-accounts.js';

export interface AppContext {
  config: AppConfig;
  db: Db;
  storage: StorageAdapter;
  keys: KeyManager;
  blockchain: LocalBlockchain;
  ledger: LedgerBridge | null;
  audits: AuditService;
  auth: AuthService;
  totp: TotpService;
  smsOtp: SmsOtpService;
  employees: EmployeesService;
  documents: DocumentsService;
  users: UsersService;
  close: () => void;
}

/** Wire the full application from a validated configuration. */
export async function createAppContext(config: AppConfig): Promise<AppContext> {
  const db = openDatabase(config.dbFile);
  if (config.demoAccountsEnabled && config.totp.acceptAnyCode) seedDemoAccounts(db);
  const storage = createStorageAdapter(config);
  const keys = new LocalKeyManager(db, config.masterKey);
  const chainStore =
    config.blockchainBackend === 'memory' ? new MemoryChainStore() : new SqliteChainStore(db);
  const blockchain = new LocalBlockchain(chainStore);
  await blockchain.init();
  const ledger = config.fabric.enabled ? new FabricLedger(config.fabric) : null;
  const audits = new AuditService(blockchain, ledger ?? undefined);
  const auth = new AuthService(db, audits, { jwtSecret: config.jwtSecret, tokenTtlSeconds: config.tokenTtlSeconds, totp: config.totp });
  const totp = new TotpService(db, audits, config.totp, config.jwtSecret);
  const smsOtp = new SmsOtpService(db, audits, config.sms);
  const employees = new EmployeesService(db, audits, storage);
  const documents = new DocumentsService(db, config, storage, keys, audits);
  const users = new UsersService(db);

  return {
    config,
    db,
    storage,
    keys,
    blockchain,
    ledger,
    audits,
    auth,
    totp,
    smsOtp,
    employees,
    documents,
    users,
    close: () => {
      ledger?.close();
      db.close();
    },
  };
}

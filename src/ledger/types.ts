/**
 * Contract between the audit service and a remote permissioned ledger
 * (Hyperledger Fabric in phase 2). Kept dependency-free so the service can be
 * unit tested against a fake implementation.
 */
export interface AuditNetworkRecord {
  seq: number;
  eventType: string;
  actorId: string;
  subjectId: string;
  payload: Record<string, unknown>;
  creatorMsp: string;
  signerId: string;
  ts: string;
  txId: string;
  prevHash: string;
  hash: string;
}

export interface AuditNetworkSubmitResult {
  committed: boolean;
  seq: number;
  txId: string;
  hash: string;
}

export interface AuditNetworkIssue {
  seq: number;
  reason: string;
}

export interface AuditNetworkQuery {
  connected: boolean;
  seq: number;
  records: AuditNetworkRecord[];
  valid: boolean;
  issues: AuditNetworkIssue[];
  error?: string;
}

export interface LedgerBridge {
  /** Set when the operator enabled the remote ledger in configuration. */
  readonly enabled: boolean;
  submitAudit(
    eventType: string,
    actorId: string,
    subjectId: string,
    payloadJson: string,
  ): Promise<AuditNetworkSubmitResult>;
  query(): Promise<AuditNetworkQuery>;
}

export interface FabricLedgerOptions {
  mspId: string;
  mspConfigDir: string;
  tlsCaCert: string;
  peerEndpoint: string;
  tlsHostOverride: string;
  channel: string;
  chaincode: string;
  endorseOrgs: string[];
}

/** Event types the chaincode accepts. Anything else is recorded locally only. */
export const NETWORK_SUBMITTABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'EMPLOYEE_CREATED',
  'EMPLOYEE_UPDATED',
  'ROLE_CHANGED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_ACCESSED',
  'ACCESS_REVOKED',
]);
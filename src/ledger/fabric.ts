import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import type { PeerCertificate } from 'node:tls';
import * as grpc from '@grpc/grpc-js';
import type { CallOptions } from '@grpc/grpc-js';
import { connect, signers, type Contract, type Gateway, type Network } from '@hyperledger/fabric-gateway';
import type {
  AuditNetworkQuery,
  AuditNetworkRecord,
  AuditNetworkSubmitResult,
  FabricLedgerOptions,
  LedgerBridge,
} from './types.js';

const GRPC_TIMEOUT_MS = 30_000;

/**
 * Client for the permissioned Hyperledger Fabric audit network.
 *
 * Connects lazily on first use so an unreachable network (or misconfig) fails
 * on the first real operation rather than at server startup. All responses are
 * mapped from the chaincode's own return value; a transaction is only reported
 * as committed after the gateway receives a commit event from the network.
 */
export class FabricLedger implements LedgerBridge {
  readonly enabled = true;

  private grpc?: grpc.Client;
  private gateway?: Gateway;
  private network?: Network;
  private contract?: Contract;

  constructor(private readonly opts: FabricLedgerOptions) {}

  async submitAudit(
    eventType: string,
    actorId: string,
    subjectId: string,
    payloadJson: string,
  ): Promise<AuditNetworkSubmitResult> {
    const contract = await this.ensure();
    const result = await contract.submit('submitAudit', {
      arguments: [eventType, actorId, subjectId, payloadJson],
      ...(this.opts.endorseOrgs.length > 0 ? { endorsingOrganizations: [...this.opts.endorseOrgs] } : {}),
    });
    const record = JSON.parse(Buffer.from(result).toString('utf8')) as AuditNetworkRecord;
    return { committed: true, seq: record.seq, txId: record.txId, hash: record.hash };
  }

  async query(): Promise<AuditNetworkQuery> {
    try {
      const contract = await this.ensure();
      const seq = JSON.parse(await this.evaluateString(contract, 'querySeq')) as { seq: number };
      const verified = JSON.parse(await this.evaluateString(contract, 'verifyChain')) as {
        seq: number;
        intact: boolean;
        issues: Array<{ seq: number; reason: string }>;
      };
      const records = await this.fetchRecords(contract, seq.seq);
      return {
        connected: true,
        seq: seq.seq,
        records,
        valid: verified.seq === seq.seq && verified.intact,
        issues: verified.issues ?? [],
      };
    } catch (error) {
      return { connected: false, seq: 0, records: [], valid: false, issues: [], error: String(error) };
    }
  }

  close(): void {
    this.gateway?.close();
    this.gateway = undefined;
    this.network = undefined;
    this.contract = undefined;
    this.grpc?.close();
    this.grpc = undefined;
  }

  private async fetchRecords(contract: Contract, seq: number): Promise<AuditNetworkRecord[]> {
    if (seq < 1) return [];
    const raw = await this.evaluateString(contract, 'queryAll', '1', String(seq));
    return JSON.parse(raw) as AuditNetworkRecord[];
  }

  private async evaluateString(contract: Contract, name: string, ...args: string[]): Promise<string> {
    const bytes = await contract.evaluate(name, { arguments: args });
    return new TextDecoder().decode(bytes);
  }

  private async ensure(): Promise<Contract> {
    if (this.contract) return this.contract;
    const timeout = (): CallOptions => ({ deadline: Date.now() + GRPC_TIMEOUT_MS });
    const client = new grpc.Client(
      this.opts.peerEndpoint,
      grpc.credentials.createSsl(this.readTlsCa(), undefined, undefined, {
        checkServerIdentity: (_host, cert) => this.checkServerIdentity(cert),
      }),
    );
    const gateway = connect({
      client,
      identity: { mspId: this.opts.mspId, credentials: Buffer.from(this.readAdminCert()) },
      signer: signers.newPrivateKeySigner(this.readPrivateKey()),
      evaluateOptions: timeout,
      endorseOptions: timeout,
      submitOptions: timeout,
      commitStatusOptions: timeout,
    });
    this.grpc = client;
    this.gateway = gateway;
    this.network = gateway.getNetwork(this.opts.channel);
    this.contract = this.network.getContract(this.opts.chaincode);
    return this.contract;
  }

  private checkServerIdentity(cert: PeerCertificate): Error | undefined {
    const expected = this.opts.tlsHostOverride;
    const altNames = cert.subjectaltname ?? '';
    if (altNames.includes(`DNS:${expected}`)) return undefined;
    return new Error(`TLS peer certificate does not identify '${expected}' (SAN: ${altNames})`);
  }

  private readTlsCa(): Buffer {
    const path = this.opts.tlsCaCert;
    if (!existsSync(path)) throw new Error(`Fabric TLS CA certificate not found: ${path}`);
    return readFileSync(path);
  }

  private readAdminCert(): string {
    const dir = join(this.opts.mspConfigDir, 'signcerts');
    if (!existsSync(dir)) throw new Error(`Fabric admin signcerts not found: ${dir}`);
    const files = readdirSync(dir).filter((f) => f.endsWith('.pem'));
    if (files.length === 0) throw new Error(`No x509 certificate in Fabric signcerts: ${dir}`);
    return readFileSync(join(dir, files[0]!), 'utf8');
  }

  private readPrivateKey(): KeyObject {
    const keystore = join(this.opts.mspConfigDir, 'keystore');
    if (!existsSync(keystore)) throw new Error(`Fabric key store not found: ${keystore}`);
    const files = readdirSync(keystore);
    if (files.length === 0) throw new Error(`No private key in Fabric key store: ${keystore}`);
    const pem = readFileSync(join(keystore, files[0]!), 'utf8');
    return createPrivateKey(pem);
  }
}

export type { AuditNetworkQuery, AuditNetworkRecord, AuditNetworkSubmitResult };
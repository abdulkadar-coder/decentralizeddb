/**
 * fabric-probe.ts - check the backend's connection to the Hyperledger Fabric
 * audit network (read-only: querySeq + verifyChain + queryAll). Run with the
 * ledger enabled:
 *
 *   LEDGER_BACKEND=fabric npx tsx scripts/fabric-probe.ts
 */
import { loadEnvFile, loadConfig } from '../src/config.js';
import { FabricLedger } from '../src/ledger/fabric.js';

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  if (!config.fabric.enabled) {
    console.error('LEDGER_BACKEND=fabric is required for fabric-probe.ts');
    process.exitCode = 2;
    return;
  }

  const ledger = new FabricLedger(config.fabric);

  if (process.env.FABRIC_PROBE_SUBMIT === '1') {
    const result = await ledger.submitAudit(
      'ROLE_CHANGED',
      'probe-user',
      'emp-probe-1',
      JSON.stringify({ via: 'gateway-probe' }),
    );
    console.log('submit result:', JSON.stringify(result, null, 2));
  }

  const query = await ledger.query();
  if (!query.connected) {
    console.error('Fabric ledger UNREACHABLE:', query.error);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        enabled: true,
        connected: query.connected,
        endpoint: config.fabric.peerEndpoint,
        mspId: config.fabric.mspId,
        channel: config.fabric.channel,
        chaincode: config.fabric.chaincode,
        endorseOrgs: config.fabric.endorseOrgs,
        seq: query.seq,
        records: query.records.length,
        valid: query.valid,
        issues: query.issues,
        lastRecord: query.records[query.records.length - 1] ?? null,
      },
      null,
      2,
    ),
  );
  ledger.close();
}

main().catch((error) => {
  console.error('probe failed:', error);
  process.exitCode = 1;
});